"""Course Master Registry CRUD endpoints for Teaching Plan & Post-Teaching modules."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.db import db
from app.routers.auth import resolve_current_user

router = APIRouter(prefix="/v1/courses", tags=["courses"])


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
    instructor_name: str = ""
    instructor_phone: str = ""
    instructor_email: str | None = None


@router.get("")
def list_courses(mine_only: bool = False, x_user_email: str | None = Header(default=None)):
    user = resolve_current_user(x_user_email)
    owner = user.get("email") if mine_only else None
    return {"courses": db.list_courses(instructor_email=owner)}


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
