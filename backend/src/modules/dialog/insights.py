import asyncio
import datetime as dtm
from typing import Literal

from fastapi import HTTPException

from src.config_schema import Settings
from src.logging_ import logger
from src.modules.dialog.analytics import insight_current
from src.modules.dialog.classification import classify_dialog
from src.modules.dialog.schemas import DialogClassification, DialogSummary, DialogView
from src.modules.dialog.service import DialogService
from src.modules.dialog.store import ConversationConflictError, ConversationState, utcnow
from src.modules.dialog.summary import summarize_dialog


class DialogInsightsService:
    def __init__(self, dialogs: DialogService, settings: Settings) -> None:
        self.dialogs = dialogs
        self.store = dialogs.store
        self.settings = settings

    @staticmethod
    def _view(state: ConversationState) -> DialogView:
        return DialogView.model_validate(state.model_dump() | {"reply": ""})

    async def _compute(self, state: ConversationState, kind: Literal["summary", "classification"]) -> None:
        if kind == "summary":
            state.summary = await summarize_dialog(self._view(state), self.settings)
        else:
            state.classification = await classify_dialog(self._view(state), self.settings)

    async def _get(self, dialog_id: str, kind: Literal["summary", "classification"]) -> ConversationState:
        for _ in range(3):
            state = await self.store.get(dialog_id)
            if state is None:
                raise HTTPException(404, "Dialog not found")
            state = state.model_copy(deep=True)
            if state.closed and insight_current(getattr(state, kind), state.updated_at):
                return state
            await self._compute(state, kind)
            if not state.closed:
                return state
            try:
                await self.store.save_insights(state)
            except ConversationConflictError:
                continue
            return state
        raise HTTPException(409, "Dialog changed concurrently; retry the request")

    async def summary(self, dialog_id: str) -> DialogSummary:
        state = await self._get(dialog_id, "summary")
        if state.summary is None:
            raise RuntimeError("Summary was not generated")
        return state.summary

    async def classification(self, dialog_id: str) -> DialogClassification:
        state = await self._get(dialog_id, "classification")
        if state.classification is None:
            raise RuntimeError("Classification was not generated")
        return state.classification

    async def process_batch(self) -> None:
        for state in await self.store.pending_insights(limit=10):
            failed = False
            for kind in ("summary", "classification"):
                if insight_current(getattr(state, kind), state.updated_at):
                    continue
                try:
                    async with asyncio.timeout(240):
                        await self._compute(state, kind)
                except Exception:  # noqa: BLE001 - individual failures must not stop the durable queue.
                    failed = True
                    logger.exception("Dialog insight generation failed: dialog=%s kind=%s", state.id, kind)
            state.insights_retry_at = utcnow() + dtm.timedelta(minutes=5) if failed else None
            try:
                await self.store.save_insights(state)
            except ConversationConflictError:
                # Feedback or another worker won; the next scan uses the new revision.
                continue

    async def run(self) -> None:
        while True:
            try:
                await self.process_batch()
            except Exception:  # noqa: BLE001 - database outages must not terminate the worker.
                logger.exception("Dialog insight worker failed")
            await asyncio.sleep(15)
