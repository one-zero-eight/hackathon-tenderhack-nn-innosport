from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

from src.api import docs
from src.modules.dialog.schemas import (
    DialogDeleteResult,
    DialogFeedback,
    DialogFeedbackCreate,
    DialogListItem,
    DialogResponse,
    DialogStreamEvent,
    DialogView,
    MessageCreate,
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


class DialogStreamingResponse(StreamingResponse):
    media_type = "application/x-ndjson"


@router.post("/dialogs", response_model=DialogView)
async def create_dialog(service: DialogServiceDep) -> DialogView:
    return await service.create()


@router.get("/dialogs", response_model=list[DialogListItem])
async def list_dialogs(
    service: DialogServiceDep,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[DialogListItem]:
    return await service.list_dialogs(limit=limit)


@router.delete("/dialogs", response_model=DialogDeleteResult)
async def delete_dialogs(service: DialogServiceDep) -> DialogDeleteResult:
    return await service.delete_all()


@router.get("/dialogs/{dialog_id}", response_model=DialogView)
async def get_dialog(dialog_id: str, service: DialogServiceDep) -> DialogView:
    return await service.get(dialog_id)


@router.put("/dialogs/{dialog_id}/feedback")
async def submit_feedback(dialog_id: str, payload: DialogFeedbackCreate, service: DialogServiceDep) -> DialogFeedback:
    return await service.submit_feedback(dialog_id, payload)


@router.delete("/dialogs/{dialog_id}", response_model=DialogDeleteResult)
async def delete_dialog(dialog_id: str, service: DialogServiceDep) -> DialogDeleteResult:
    return await service.delete(dialog_id)


@router.post("/dialogs/{dialog_id}/messages")
async def post_message(dialog_id: str, payload: MessageCreate, service: DialogServiceDep) -> DialogResponse:
    try:
        return await service.add_message(dialog_id, payload.content, clarification_id=payload.clarification_id)
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
        events = await service.stream_message(dialog_id, payload.content, clarification_id=payload.clarification_id)
    except DialogClosedError as exc:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    return DialogStreamingResponse(
        events,
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@router.post("/dialogs/{dialog_id}/escalate", response_model=DialogResponse)
async def request_specialist(dialog_id: str, service: DialogServiceDep):
    """Select a specialist; only this action determines L1 versus L2."""
    try:
        return await service.request_specialist(dialog_id)
    except DialogClosedError as exc:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
