from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

from src.api import docs
from src.modules.dialog.insights import DialogInsightsService
from src.modules.dialog.schemas import (
    DialogAnalytics,
    DialogClassification,
    DialogDeleteResult,
    DialogFeedback,
    DialogFeedbackCreate,
    DialogListItem,
    DialogResponse,
    DialogStreamEvent,
    DialogSummary,
    DialogView,
    MessageCreate,
    SpecialistContact,
)
from src.modules.dialog.service import DialogClosedError, DialogService

router = APIRouter(tags=["dialog"])
docs.TAGS_INFO.append(
    {
        "name": "dialog",
        "description": "Диалоговые обращения в поддержку: одно обращение, история сообщений, L1/L2/L3.",
    }
)


def get_dialog_service(request: Request) -> DialogService:
    return request.app.state.dialog_service


DialogServiceDep = Annotated[DialogService, Depends(get_dialog_service)]


def get_insights_service(service: DialogServiceDep) -> DialogInsightsService:
    from src.config import settings

    return DialogInsightsService(service, settings)


DialogInsightsDep = Annotated[DialogInsightsService, Depends(get_insights_service)]


class DialogStreamingResponse(StreamingResponse):
    media_type = "application/x-ndjson"


@router.post("/dialogs")
async def create_dialog(service: DialogServiceDep) -> DialogView:
    return await service.create()


@router.get("/dialogs")
async def list_dialogs(
    service: DialogServiceDep,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[DialogListItem]:
    return await service.list_dialogs(limit=limit)


@router.delete("/dialogs")
async def delete_dialogs(service: DialogServiceDep) -> DialogDeleteResult:
    return await service.delete_all()


@router.get("/dialogs/analytics")
async def get_dialog_analytics(
    service: DialogServiceDep,
    days: Annotated[int, Query(ge=1, le=365)] = 30,
) -> DialogAnalytics:
    return await service.store.analytics(days=days)


@router.get("/dialogs/{dialog_id}")
async def get_dialog(dialog_id: str, service: DialogServiceDep) -> DialogView:
    return await service.get(dialog_id)


@router.get("/dialogs/{dialog_id}/summary")
async def get_dialog_summary(dialog_id: str, service: DialogInsightsDep) -> DialogSummary:
    return await service.summary(dialog_id)


@router.get("/dialogs/{dialog_id}/classification")
async def get_dialog_classification(dialog_id: str, service: DialogInsightsDep) -> DialogClassification:
    return await service.classification(dialog_id)


@router.post("/dialogs/{dialog_id}/close")
async def close_dialog(dialog_id: str, service: DialogServiceDep) -> DialogResponse:
    return await service.close(dialog_id)


@router.put("/dialogs/{dialog_id}/feedback")
async def submit_feedback(dialog_id: str, payload: DialogFeedbackCreate, service: DialogServiceDep) -> DialogFeedback:
    return await service.submit_feedback(dialog_id, payload)


@router.delete("/dialogs/{dialog_id}")
async def delete_dialog(dialog_id: str, service: DialogServiceDep) -> DialogDeleteResult:
    return await service.delete(dialog_id)


@router.post("/dialogs/{dialog_id}/messages")
async def post_message(dialog_id: str, payload: MessageCreate, service: DialogServiceDep) -> DialogResponse:
    try:
        return await service.add_message(
            dialog_id,
            payload.content,
            clarification_id=payload.clarification_id,
            suggestion_id=payload.suggestion_id,
        )
    except DialogClosedError as exc:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)


@router.post(
    "/dialogs/{dialog_id}/messages/stream",
    response_class=DialogStreamingResponse,
    responses={
        200: {
            "model": DialogStreamEvent,
            "description": "NDJSON events: provisional text, tool execution statuses, then a saved response or an error.",
            "content": {"application/x-ndjson": {}},
        }
    },
)
async def stream_message(dialog_id: str, payload: MessageCreate, service: DialogServiceDep) -> StreamingResponse:
    try:
        events = await service.stream_message(
            dialog_id,
            payload.content,
            clarification_id=payload.clarification_id,
            suggestion_id=payload.suggestion_id,
        )
    except DialogClosedError as exc:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    return DialogStreamingResponse(
        events,
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@router.post("/dialogs/{dialog_id}/escalate")
async def request_specialist(dialog_id: str, payload: SpecialistContact, service: DialogServiceDep) -> DialogResponse:
    """Save contact details and hand the appeal to the selected specialist line."""
    try:
        return await service.request_specialist(dialog_id, payload)
    except DialogClosedError as exc:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
