"""Course Master Registry CRUD endpoints for Teaching Plan & Post-Teaching modules."""

from __future__ import annotations

import base64
import io
import json
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx
from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.db import db
from app.routers.ai import _resolve_provider_config
from app.routers.auth import resolve_current_user
from app.services.timetable_parser import (
    build_timetable_template_xlsx,
    normalize_course_item,
    parse_csv_or_text_timetable,
    parse_html_sornor02,
    parse_xlsx_timetable,
)

router = APIRouter(prefix="/v1/courses", tags=["courses"])

CAPTCHA_HINTS = ("captcha", "recaptcha", "g-recaptcha", "turnstile", "hcaptcha", "รหัสภาพ", "verify you are human")


class TimetableImportItem(BaseModel):
    course_code: str
    course_name: str
    t_hours: int = 1
    p_hours: int = 3
    credit_num: int = 2
    credits: str = ""
    curriculum_level: str = "ปวช."
    student_group: str = ""
    total_students: int = 0
    schedule_text: str = ""
    room: str = ""
    semester: str = "2/2569"


class TimetableImportRequest(BaseModel):
    items: list[TimetableImportItem]


class Sornor02ImportRequest(BaseModel):
    url: str
    auth_mode: str = "none"  # none | cookie | credentials
    username: str = ""
    password: str = ""
    cookie_header: str = ""
    default_semester: str = "2/2569"


async def _extract_timetable_via_gemini(content: bytes, mime_type: str, default_semester: str) -> list[dict[str, Any]]:
    cfg = _resolve_provider_config()
    api_key = cfg.get("api_key", "")
    if cfg.get("provider") != "gemini" or not api_key:
        raise HTTPException(
            status_code=400,
            detail="ยังไม่ได้ตั้งค่า Gemini API Key สำหรับอ่านรูปภาพตารางสอน กรุณาตั้งค่าในหน้าตั้งค่าระบบ หรือใช้วิธีอัปโหลด Excel/CSV/HTML หรือวางข้อความแทน",
        )

    b64_data = base64.b64encode(content).decode("ascii")
    prompt = (
        "ถอดรายการรายวิชาจากตารางสอน/ตารางเรียน ศธ.02 ในไฟล์นี้ให้เป็น JSON object รูปแบบ "
        '{"items": [{"course_code": "20100-1001", "course_name": "ชื่อวิชา", "t_hours": 1, "p_hours": 3, '
        '"credit_num": 2, "student_group": "ปวช.1/1", "schedule_text": "จันทร์ 1-4", "room": "421", '
        f'"total_students": 0, "semester": "{default_semester}"}}]}}. '
        "ตอบเป็น JSON เท่านั้น"
    )
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{cfg['model']}:generateContent?key={api_key}"
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {"inline_data": {"mime_type": mime_type, "data": b64_data}},
                ]
            }
        ],
        "generationConfig": {"responseMimeType": "application/json"},
    }
    async with httpx.AsyncClient(timeout=45.0) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        data = resp.json()
    text = data["candidates"][0]["content"]["parts"][0]["text"]
    parsed = json.loads(text)
    raw_items = parsed.get("items", []) if isinstance(parsed, dict) else (parsed if isinstance(parsed, list) else [])
    return [normalize_course_item(it, default_semester) for it in raw_items if isinstance(it, dict)]


def _extract_pdf_text(content: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tf:
        tf.write(content)
        tmp_path = Path(tf.name)
    try:
        res = subprocess.run(
            ["pdftotext", "-layout", str(tmp_path), "-"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        return res.stdout or ""
    except Exception:
        return ""
    finally:
        tmp_path.unlink(missing_ok=True)


def _contains_captcha(html_text: str) -> bool:
    low = html_text.lower()
    return any(hint in low for hint in CAPTCHA_HINTS)


class CourseUpsertRequest(BaseModel):
    id: str | None = None
    course_code: str
    course_name: str
    curriculum_level: str = "ปวช."
    credits: str = "1-3-2 (2 หน่วยกิต 4 ชั่วโมง)"
    semester: str = "2/2569"
    schedule_text: str = ""
    prerequisite: str = "วิชาชีพ"
    reference_text: str = "Internet และเอกสารประกอบการสอน"
    department_name: str = ""
    division_name: str = "ฝ่ายวิชาการ"
    objectives: list[str] = []
    standards: list[str] = []
    description: str = ""
    knowledge: list[str] = []
    skills: list[str] = []
    weekly_plan: list[dict[str, Any]] = []
    equipment: list[dict[str, Any]] = []
    assessment: list[dict[str, Any]] = []
    rubric: list[dict[str, Any]] = []
    morals: list[str] = []
    indicators: list[str] = []
    evaluation_criteria: list[str] = []
    instructional_strategies: list[str] = []
    curriculum_analysis: str = ""
    qualification_link: str = ""
    credit_summary: str = ""
    notes: list[str] = []
    instructor_name: str = ""
    instructor_phone: str = ""
    instructor_email: str | None = None


@router.get("")
def list_courses(mine_only: bool = False, x_user_email: str | None = Header(default=None)):
    user = resolve_current_user(x_user_email)
    owner = user.get("email") if mine_only else None
    return {"courses": db.list_courses(instructor_email=owner)}


@router.get("/timetable-template")
def download_timetable_template():
    xlsx_bytes = build_timetable_template_xlsx()
    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="timetable_template.xlsx"'},
    )


@router.post("/parse-timetable")
async def parse_timetable(
    file: UploadFile | None = File(default=None),
    raw_text: str = Form(default=""),
    default_semester: str = Form(default="2/2569"),
    x_user_email: str | None = Header(default=None),
):
    resolve_current_user(x_user_email)
    warnings: list[str] = []

    if file is not None and file.filename:
        fname = file.filename.lower()
        content = await file.read()
        if fname.endswith(".xlsx"):
            items, warnings = parse_xlsx_timetable(content, default_semester)
            return {"items": items, "source": "excel", "warnings": warnings}
        if fname.endswith((".html", ".htm")):
            html_str = content.decode("utf-8", errors="replace")
            items, warnings = parse_html_sornor02(html_str, default_semester)
            return {"items": items, "source": "sornor02_html", "warnings": warnings}
        if fname.endswith((".csv", ".txt", ".tsv")):
            text_str = content.decode("utf-8-sig", errors="replace")
            items, warnings = parse_csv_or_text_timetable(text_str, default_semester)
            return {"items": items, "source": "csv", "warnings": warnings}
        if fname.endswith(".pdf"):
            pdf_text = _extract_pdf_text(content)
            if pdf_text.strip():
                items, warnings = parse_csv_or_text_timetable(pdf_text, default_semester)
                if items:
                    return {"items": items, "source": "pdf_text", "warnings": warnings}
            items = await _extract_timetable_via_gemini(content, "application/pdf", default_semester)
            return {"items": items, "source": "ai_vision", "warnings": warnings}
        if fname.endswith((".png", ".jpg", ".jpeg", ".webp")):
            mime = file.content_type or ("image/png" if fname.endswith(".png") else "image/jpeg")
            items = await _extract_timetable_via_gemini(content, mime, default_semester)
            return {"items": items, "source": "ai_vision", "warnings": warnings}
        raise HTTPException(status_code=400, detail="รองรับเฉพาะไฟล์ .xlsx, .csv, .html, .pdf, .png, .jpg, .webp")

    if raw_text.strip():
        items, warnings = parse_csv_or_text_timetable(raw_text, default_semester)
        source = "sornor02_html" if ("<table" in raw_text.lower() or "<tr" in raw_text.lower()) else "text"
        return {"items": items, "source": source, "warnings": warnings}

    raise HTTPException(status_code=400, detail="กรุณาอัปโหลดไฟล์ตารางสอน หรือวางข้อความจากตาราง/ศธ.02")


@router.post("/import-sornor02")
async def import_from_sornor02(
    body: Sornor02ImportRequest,
    x_user_email: str | None = Header(default=None),
):
    resolve_current_user(x_user_email)
    url = body.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL ของระบบ ศธ.02 ต้องขึ้นต้นด้วย http:// หรือ https://")

    headers = {"User-Agent": "CRIC-EDocx-TimetableImporter/1.0"}
    if body.auth_mode == "cookie" and body.cookie_header.strip():
        headers["Cookie"] = body.cookie_header.strip()

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=20.0, verify=True) as client:
            if body.auth_mode == "credentials":
                if not body.username.strip() or not body.password:
                    raise HTTPException(status_code=400, detail="กรุณาระบุชื่อผู้ใช้และรหัสผ่าน ศธ.02")
                login_page = await client.get(url, headers=headers)
                if _contains_captcha(login_page.text):
                    raise HTTPException(
                        status_code=400,
                        detail="หน้าเว็บ ศธ.02 มีระบบยืนยันตัวตน (CAPTCHA) กรุณาล็อกอินในเบราว์เซอร์แล้ว Export เป็นไฟล์ HTML/PDF หรือคัดลอกตารางมาวางแทน",
                    )
                # Attempt standard HTML form post if login form detected
                action_m = re.search(r'<form[^>]*action=["\']([^"\']*)["\']', login_page.text, re.IGNORECASE)
                if "<input" in login_page.text.lower() and "password" in login_page.text.lower():
                    post_url = urljoin(str(login_page.url), action_m.group(1)) if action_m else str(login_page.url)
                    user_field_m = re.search(r'<input[^>]*name=["\']([^"\']*(?:user|login|id|code)[^"\']*)["\']', login_page.text, re.IGNORECASE)
                    pass_field_m = re.search(r'<input[^>]*type=["\']password["\'][^>]*name=["\']([^"\']+)["\']|<input[^>]*name=["\']([^"\']+)["\'][^>]*type=["\']password["\']', login_page.text, re.IGNORECASE)
                    u_key = user_field_m.group(1) if user_field_m else "username"
                    p_key = (pass_field_m.group(1) or pass_field_m.group(2)) if pass_field_m else "password"
                    resp = await client.post(post_url, data={u_key: body.username.strip(), p_key: body.password}, headers=headers)
                else:
                    resp = login_page
            else:
                resp = await client.get(url, headers=headers)
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"ไม่สามารถเชื่อมต่อเว็บ ศธ.02 ได้: {exc}") from exc

    html_text = resp.text
    if _contains_captcha(html_text):
        raise HTTPException(
            status_code=400,
            detail="เว็บ ศธ.02 ติดการตรวจสอบ CAPTCHA กรุณาล็อกอินผ่านเบราว์เซอร์แล้วบันทึกหน้าเว็บ (.html) หรือคัดลอกตารางมาวางแทน",
        )

    items, warnings = parse_html_sornor02(html_text, body.default_semester)
    if not items:
        raise HTTPException(
            status_code=400,
            detail="ไม่พบตารางรายวิชาจากหน้าเว็บที่ดึงมา (อาจต้องล็อกอินก่อน หรือหน้าเว็บใช้โครงสร้างเฉพาะ) แนะนำให้คัดลอกตารางหรือบันทึกไฟล์ .html/.pdf จากหน้า ศธ.02 มาอัปโหลดแทน",
        )
    return {"items": items, "source": "sornor02_web", "warnings": warnings}


@router.post("/import")
def batch_import_courses(
    body: TimetableImportRequest,
    x_user_email: str | None = Header(default=None),
):
    user = resolve_current_user(x_user_email)
    owner_email = user.get("email") or user.get("username") or "user@cric.ac.th"
    existing = db.list_courses(instructor_email=None)
    existing_keys = {
        (c.get("course_code", "").strip(), c.get("schedule_text", "").strip())
        for c in existing
    }

    imported: list[dict[str, Any]] = []
    skipped_count = 0
    for item in body.items:
        norm = normalize_course_item(item.model_dump(), item.semester)
        if not norm["course_code"] or not norm["course_name"]:
            skipped_count += 1
            continue
        dedup_key = (norm["course_code"], norm["schedule_text"])
        if dedup_key in existing_keys:
            skipped_count += 1
            continue
        course_payload = {
            "course_code": norm["course_code"],
            "course_name": norm["course_name"],
            "curriculum_level": norm["curriculum_level"],
            "credits": norm["credits"],
            "semester": norm["semester"],
            "schedule_text": norm["schedule_text"],
            "department_name": user.get("unit_name") or (user.get("units") or [""])[0] or "",
            "division_name": "ฝ่ายวิชาการ",
            "instructor_name": user.get("full_name", ""),
            "instructor_phone": user.get("phone", ""),
            "instructor_email": owner_email,
        }
        saved = db.upsert_course(course_payload, owner_email)
        existing_keys.add(dedup_key)
        imported.append(saved)

    if imported:
        db.add_audit_log(
            None,
            owner_email,
            "courses_batch_imported",
            {"count": len(imported), "skipped": skipped_count},
        )
    return {
        "imported": imported,
        "skipped_count": skipped_count,
        "courses": db.list_courses(instructor_email=None),
    }


@router.get("/{course_id}")
def get_course(course_id: str, x_user_email: str | None = Header(default=None)):
    resolve_current_user(x_user_email)
    course = db.get_course(course_id)
    if not course:
        raise HTTPException(status_code=404, detail="ไม่พบรายวิชาที่ระบุ")
    return {"course": course}


@router.post("")
def upsert_course(body: CourseUpsertRequest, x_user_email: str | None = Header(default=None)):
    user = resolve_current_user(x_user_email)
    if not body.course_code.strip() or not body.course_name.strip():
        raise HTTPException(status_code=400, detail="กรุณาระบุรหัสวิชาและชื่อวิชา")
    data = body.model_dump()
    if not data.get("instructor_name"):
        data["instructor_name"] = user.get("full_name", "")
    if not data.get("instructor_email"):
        data["instructor_email"] = user.get("email") or user.get("username") or "user@cric.ac.th"
    course = db.upsert_course(data, user.get("email") or "user")
    db.add_audit_log(None, user.get("email") or "user", "course_saved", {"course_code": course["course_code"]})
    return {"course": course}


@router.put("/{course_id}")
def update_course(course_id: str, body: CourseUpsertRequest, x_user_email: str | None = Header(default=None)):
    user = resolve_current_user(x_user_email)
    if not db.get_course(course_id):
        raise HTTPException(status_code=404, detail="ไม่พบรายวิชาที่ระบุ")
    data = body.model_dump()
    data["id"] = course_id
    if not data.get("instructor_email"):
        data["instructor_email"] = user.get("email") or "user"
    course = db.upsert_course(data, user.get("email") or "user")
    return {"course": course}


@router.delete("/{course_id}")
def delete_course(course_id: str, x_user_email: str | None = Header(default=None)):
    user = resolve_current_user(x_user_email)
    ok = db.delete_course(course_id)
    if not ok:
        raise HTTPException(status_code=404, detail="ไม่พบรายวิชาที่ระบุ")
    db.add_audit_log(None, user.get("email") or "user", "course_deleted", {"course_id": course_id})
    return {"ok": True}
