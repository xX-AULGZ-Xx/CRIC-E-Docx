"""Saraban registry running number configuration, atomic allocation, and Excel export."""

from __future__ import annotations

import io
from typing import Any

import openpyxl
from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.db import db
from app.engine.thai_utils import format_doc_number, to_thai_digits
from app.routers.auth import resolve_current_user

router = APIRouter(prefix="/v1/registry", tags=["registry"])


class SequenceUpdate(BaseModel):
    registry_name: str | None = None
    prefix: str | None = None
    year_be: int | None = None
    last_number: int | None = None


class SequenceCreate(BaseModel):
    registry_key: str
    registry_name: str
    prefix: str = ""
    year_be: int = 2569
    last_number: int = 0


class AllocateNumberRequest(BaseModel):
    registry_key: str
    year_be: int = 2569
    is_circular: bool = False


@router.get("/sequences")
def list_sequences(x_user_email: str | None = Header(default=None)):
    resolve_current_user(x_user_email)
    return {"sequences": db.list_sequences()}


@router.post("/sequences")
def create_sequence(body: SequenceCreate, x_user_email: str | None = Header(default=None)):
    actor = resolve_current_user(x_user_email)
    if actor["role"] not in ("saraban_admin", "director"):
        raise HTTPException(status_code=403, detail="เฉพาะเจ้าหน้าที่สารบรรณหรือผู้อำนวยการเท่านั้นที่สร้างทะเบียนคุมได้")
    if body.last_number < 0:
        raise HTTPException(status_code=400, detail="เลขเริ่มต้นต้องไม่น้อยกว่า 0")
    try:
        seq = db.create_sequence(body.model_dump(), actor["email"])
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"ไม่สามารถสร้างทะเบียนคุมได้: {exc}") from exc
    db.add_audit_log(None, actor["email"], "sequence_created", seq)
    return {"sequence": seq}


@router.put("/sequences/{seq_id}")
def update_sequence(seq_id: int, body: SequenceUpdate, x_user_email: str | None = Header(default=None)):
    actor = resolve_current_user(x_user_email)
    if actor["role"] not in ("saraban_admin", "director"):
        raise HTTPException(status_code=403, detail="เฉพาะเจ้าหน้าที่สารบรรณหรือผู้อำนวยการเท่านั้นที่ปรับตั้งค่าเลขรันได้")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "last_number" in updates and int(updates["last_number"]) < 0:
        raise HTTPException(status_code=400, detail="เลขล่าสุดต้องไม่น้อยกว่า 0")
    updated = db.update_sequence(seq_id, updates, actor["email"])
    if not updated:
        raise HTTPException(status_code=404, detail="ไม่พบทะเบียนคุมที่ระบุ")
    db.add_audit_log(None, actor["email"], "sequence_updated", {"seq_id": seq_id, **updates})
    return {"sequence": updated}


@router.post("/allocate")
def allocate_number(body: AllocateNumberRequest, x_user_email: str | None = Header(default=None)):
    actor = resolve_current_user(x_user_email)
    if actor["role"] not in ("saraban_admin", "director", "deputy_director"):
        raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์ออกเลขสารบรรณ")
    try:
        seq = db.allocate_next_number(body.registry_key, body.year_be, actor["email"])
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    num_int = int(seq["last_number"])
    formatted = _format_registry_number(seq, num_int, is_circular=body.is_circular)
    db.add_audit_log(None, actor["email"], "number_allocated", {"registry_key": body.registry_key, "formatted": formatted})
    return {"sequence": seq, "number_int": num_int, "formatted_number": formatted}


def _format_registry_number(seq: dict[str, Any], num_int: int, is_circular: bool = False) -> str:
    prefix = seq.get("prefix", "")
    year_be = seq.get("year_be", 2569)
    num_str = str(num_int)
    if prefix.endswith("/"):
        return format_doc_number(prefix, num_str, is_circular=is_circular)
    if prefix:
        return format_doc_number(prefix, num_str, is_circular=is_circular, year_be=year_be)
    circ = "ว " if is_circular else ""
    return to_thai_digits(f"{circ}{num_str}/{year_be}")


@router.get("/export")
def export_registry_xlsx(x_user_email: str | None = Header(default=None)):
    resolve_current_user(x_user_email)
    docs = [d for d in db.list_documents() if d.get("doc_number")]

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "ทะเบียนคุมหนังสือ"
    ws.append(["ที่ (เลขที่หนังสือ)", "ประเภท", "ฝ่ายงาน", "เรื่อง", "สถานะ", "ผู้ร่าง", "วันที่ปรับปรุง"])
    for d in docs:
        ws.append([
            d.get("doc_number", ""),
            d.get("doc_type", ""),
            d.get("division_code", ""),
            d.get("subject", ""),
            d.get("status", ""),
            d.get("created_by", ""),
            d.get("updated_at", ""),
        ])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="cric_registry_export.xlsx"'},
    )
