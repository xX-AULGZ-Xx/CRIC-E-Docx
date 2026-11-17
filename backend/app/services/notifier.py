"""Workflow notification sender (In-App DB + SSE Real-Time Broker + Telegram / Discord / Webhook)."""

from __future__ import annotations

import asyncio
import threading
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.db import db

EVENT_LABELS = {
    "submitted": "ส่งตรวจ / เสนอลงนาม",
    "approved": "อนุมัติ / ลงนามแล้ว",
    "returned": "ส่งกลับแก้ไข",
    "numbered": "ออกเลขสารบรรณแล้ว",
}


@dataclass
class _SSESubscriber:
    identifiers: set[str]
    queue: asyncio.Queue[dict[str, Any]] = field(default_factory=lambda: asyncio.Queue(maxsize=100))


class NotificationBroker:
    """Thread-safe pub/sub broker delivering live workflow events to async SSE streams."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subscribers: list[_SSESubscriber] = []
        self._loop: asyncio.AbstractEventLoop | None = None

    def register_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        with self._lock:
            self._loop = loop

    def subscribe(self, identifiers: list[str]) -> _SSESubscriber:
        clean = {i.strip().lower() for i in identifiers if i and i.strip()}
        sub = _SSESubscriber(identifiers=clean)
        with self._lock:
            self._subscribers.append(sub)
        return sub

    def unsubscribe(self, sub: _SSESubscriber) -> None:
        with self._lock:
            self._subscribers = [s for s in self._subscribers if s is not sub]

    def publish(self, recipient_email: str, notif: dict[str, Any]) -> None:
        rec = recipient_email.strip().lower()
        if not rec:
            return
        with self._lock:
            loop = self._loop
            targets = [s for s in self._subscribers if rec in s.identifiers]
        if not targets or loop is None or loop.is_closed():
            return
        for sub in targets:
            try:
                loop.call_soon_threadsafe(sub.queue.put_nowait, notif)
            except Exception:
                pass


broker = NotificationBroker()


def send_webhook_message(cfg: dict[str, Any], message: str, payload_data: dict[str, Any]) -> tuple[bool, str]:
    url = (cfg.get("webhook_url") or "").strip()
    if not url:
        return False, "ยังไม่ได้ระบุ Webhook URL"

    provider = (cfg.get("provider") or "custom_webhook").lower()
    try:
        with httpx.Client(timeout=6.0) as client:
            if provider == "discord":
                r = client.post(url, json={"content": message})
            elif provider == "telegram":
                chat_id = (cfg.get("telegram_chat_id") or "").strip()
                r = client.post(url, json={"chat_id": chat_id, "text": message})
            else:
                r = client.post(url, json={"message": message, **payload_data})
        ok = 200 <= r.status_code < 300
        return ok, f"HTTP {r.status_code}"
    except Exception as exc:
        return False, str(exc)


def _dispatch_in_app_notifications(
    event_type: str,
    doc: dict[str, Any],
    actor_email: str,
    comment: str = "",
) -> None:
    doc_id = str(doc.get("id") or "")
    subject = str(doc.get("subject") or "-")
    doc_no = str(doc.get("doc_number") or "")
    status = str(doc.get("status") or "")
    creator = str(doc.get("created_by") or "").strip().lower()
    link_url = f"/approvals?doc={doc_id}" if doc_id else "/approvals"

    entries: list[tuple[str, str, str, str]] = []  # (recipient, event_key, title, message)
    pending_steps = [s for s in (doc.get("approval_steps") or []) if s.get("action") == "pending"]

    if event_type == "submitted" and pending_steps:
        assignee = str(pending_steps[0].get("assignee_email") or "").strip().lower()
        if assignee:
            entries.append(
                (
                    assignee,
                    "submitted",
                    f"มีเอกสารรอคุณพิจารณา: {subject}",
                    f"ส่งโดย {actor_email}",
                )
            )
    elif event_type == "approved":
        if status == "pending_approval" and pending_steps:
            next_assignee = str(pending_steps[0].get("assignee_email") or "").strip().lower()
            if next_assignee:
                entries.append(
                    (
                        next_assignee,
                        "approved",
                        f"เอกสารส่งต่อรออนุมัติ: {subject}",
                        f"ผ่านการตรวจจาก {actor_email}",
                    )
                )
        else:
            if creator:
                entries.append(
                    (
                        creator,
                        "approved",
                        f"เอกสารได้รับการอนุมัติแล้ว: {subject}",
                        f"อนุมัติโดย {actor_email}" + (f" · {comment}" if comment else ""),
                    )
                )
            for u in db.list_users():
                if u.get("role") == "saraban_admin" and u.get("is_active", True):
                    admin_id = str(u.get("email") or u.get("username") or "").strip().lower()
                    if admin_id:
                        entries.append(
                            (
                                admin_id,
                                "approved",
                                f"เอกสารอนุมัติแล้ว รอออกเลขสารบรรณ: {subject}",
                                f"เรื่องพร้อมออกเลขทะเบียนคุม (อนุมัติโดย {actor_email})",
                            )
                        )
    elif event_type == "returned":
        if creator:
            entries.append(
                (
                    creator,
                    "returned",
                    f"เอกสารถูกส่งกลับแก้ไข: {subject}",
                    f"โดย {actor_email}" + (f" — หมายเหตุ: {comment}" if comment else ""),
                )
            )
    elif event_type == "numbered":
        if creator:
            entries.append(
                (
                    creator,
                    "numbered",
                    f"ออกเลขสารบรรณแล้ว ({doc_no or 'เรียบร้อย'}): {subject}",
                    f"ดำเนินการโดย {actor_email}",
                )
            )

    seen: set[tuple[str, str]] = set()
    for recipient, ev_key, title, message in entries:
        key = (recipient, ev_key)
        if not recipient or key in seen:
            continue
        seen.add(key)
        try:
            created = db.create_notification(
                recipient_email=recipient,
                event_type=ev_key,
                title=title,
                message=message,
                link_url=link_url,
                actor_email=actor_email,
                document_id=doc_id or None,
            )
            broker.publish(recipient, created)
        except Exception:
            pass


def notify_workflow_event(
    event_type: str,
    doc: dict[str, Any],
    actor_email: str,
    comment: str = "",
) -> None:
    """Create persistent In-App notifications (with SSE push) + optional external Webhook."""
    _dispatch_in_app_notifications(event_type, doc, actor_email, comment)

    cfg = db.get_setting_json("notifications", {})
    if not cfg.get("enabled"):
        return
    allowed_events = cfg.get("events") or ["submitted", "approved", "returned", "numbered"]
    if event_type not in allowed_events:
        return

    label = EVENT_LABELS.get(event_type, event_type)
    subject = doc.get("subject", "-")
    doc_no = doc.get("doc_number") or "รอออกเลข"
    lines = [
        f"[CRIC E-Docx] {label}",
        f"เรื่อง: {subject}",
        f"เลขที่: {doc_no} | โดย: {actor_email}",
    ]
    if comment:
        lines.append(f"หมายเหตุ: {comment}")
    send_webhook_message(cfg, "\n".join(lines), {"event": event_type, "document_id": doc.get("id"), "actor": actor_email})
