"""In-App Notifications CRUD & Real-Time Server-Sent Events (SSE) API."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Cookie, Header, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.db import db
from app.routers.auth import resolve_current_user
from app.services.notifier import broker

router = APIRouter(prefix="/v1/notifications", tags=["notifications"])


def _user_identifiers(user: dict[str, Any]) -> list[str]:
    return [str(v).strip().lower() for v in (user.get("email"), user.get("username"), user.get("id")) if v]


def _format_sse(event_name: str, data: Any) -> str:
    return f"event: {event_name}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


@router.get("")
def list_my_notifications(
    unread_only: bool = False,
    limit: int = 50,
    x_user_email: str | None = Header(default=None),
    x_user_identifier: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    cric_sso_session: str | None = Cookie(default=None),
):
    user = resolve_current_user(
        x_user_email=x_user_email,
        x_user_identifier=x_user_identifier,
        authorization=authorization,
        cookie_session=cric_sso_session,
    )
    ids = _user_identifiers(user)
    items = db.list_notifications(ids, unread_only=unread_only, limit=max(1, min(limit, 200)))
    unread = db.count_unread_notifications(ids)
    return {"unread_count": unread, "notifications": items}


@router.post("/read-all")
def mark_all_read(
    x_user_email: str | None = Header(default=None),
    x_user_identifier: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    cric_sso_session: str | None = Cookie(default=None),
):
    user = resolve_current_user(
        x_user_email=x_user_email,
        x_user_identifier=x_user_identifier,
        authorization=authorization,
        cookie_session=cric_sso_session,
    )
    ids = _user_identifiers(user)
    updated = db.mark_all_notifications_read(ids)
    return {"ok": True, "updated": updated, "unread_count": 0}


@router.post("/{notif_id}/read")
def mark_one_read(
    notif_id: str,
    x_user_email: str | None = Header(default=None),
    x_user_identifier: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    cric_sso_session: str | None = Cookie(default=None),
):
    user = resolve_current_user(
        x_user_email=x_user_email,
        x_user_identifier=x_user_identifier,
        authorization=authorization,
        cookie_session=cric_sso_session,
    )
    ids = _user_identifiers(user)
    db.mark_notification_read(notif_id, ids)
    return {"ok": True, "unread_count": db.count_unread_notifications(ids)}


@router.delete("/{notif_id}")
def delete_one_notification(
    notif_id: str,
    x_user_email: str | None = Header(default=None),
    x_user_identifier: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    cric_sso_session: str | None = Cookie(default=None),
):
    user = resolve_current_user(
        x_user_email=x_user_email,
        x_user_identifier=x_user_identifier,
        authorization=authorization,
        cookie_session=cric_sso_session,
    )
    ids = _user_identifiers(user)
    removed = db.delete_notification(notif_id, ids)
    if not removed:
        raise HTTPException(status_code=404, detail="ไม่พบการแจ้งเตือนที่ระบุ")
    return {"ok": True, "unread_count": db.count_unread_notifications(ids)}


@router.get("/stream")
async def stream_notifications(
    request: Request,
    once: bool = False,
    x_user_email: str | None = Header(default=None),
    x_user_identifier: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    cric_sso_session: str | None = Cookie(default=None),
):
    user = resolve_current_user(
        x_user_email=x_user_email,
        x_user_identifier=x_user_identifier,
        authorization=authorization,
        cookie_session=cric_sso_session,
    )
    ids = _user_identifiers(user)
    broker.register_loop(asyncio.get_running_loop())

    async def event_generator():
        sub = broker.subscribe(ids)
        try:
            snapshot = {
                "unread_count": db.count_unread_notifications(ids),
                "notifications": db.list_notifications(ids, unread_only=False, limit=15),
            }
            yield _format_sse("snapshot", snapshot)
            if once:
                return
            while True:
                if await request.is_disconnected():
                    break
                try:
                    item = await asyncio.wait_for(sub.queue.get(), timeout=20.0)
                    yield _format_sse(
                        "notification",
                        {
                            "notification": item,
                            "unread_count": db.count_unread_notifications(ids),
                        },
                    )
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            broker.unsubscribe(sub)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
