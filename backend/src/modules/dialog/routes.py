from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from src.api import docs
from src.modules.dialog.schemas import DialogResponse, DialogView, MessageCreate
from src.modules.dialog.service import DialogClosedError, DialogService

router = APIRouter(tags=["dialog"])
docs.TAGS_INFO.append(
    {
        "name": "dialog",
        "description": "Диалоговые обращения в поддержку: одно обращение, история сообщений, L1/L2.",
    }
)


def get_dialog_service(request: Request) -> DialogService:
    return request.app.state.dialog_service


DialogServiceDep = Annotated[DialogService, Depends(get_dialog_service)]


@router.post("/dialogs", response_model=DialogView)
async def create_dialog(service: DialogServiceDep) -> DialogView:
    return await service.create()


@router.get("/dialogs/{dialog_id}", response_model=DialogView)
async def get_dialog(dialog_id: str, service: DialogServiceDep) -> DialogView:
    return await service.get(dialog_id)


@router.post("/dialogs/{dialog_id}/messages", response_model=DialogResponse)
async def post_message(dialog_id: str, payload: MessageCreate, service: DialogServiceDep):
    try:
        return await service.add_message(dialog_id, payload.content)
    except DialogClosedError as exc:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)


@router.post("/dialogs/{dialog_id}/escalate", response_model=DialogResponse)
async def request_specialist(dialog_id: str, service: DialogServiceDep):
    """Select a specialist; only this action determines L1 versus L2."""
    try:
        return await service.request_specialist(dialog_id)
    except DialogClosedError as exc:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
