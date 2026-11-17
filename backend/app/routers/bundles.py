"""API endpoints for สผ. Procurement Bundles and Teaching/Post-Teaching Document Bundles."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from pydantic import BaseModel

from app.config import ATTACHMENTS_DIR, RENDERED_DIR
from app.db import db
from app.engine.sp_engine import generate_sp_bundle
from app.engine.teaching_engine import (
    generate_course_syllabus,
    generate_lesson_plan,
    generate_online_teaching_report,
    generate_post_teaching_normal,
)
from app.routers.auth import resolve_current_user
from app.routers.settings import get_effective_org_profile
from app.services.notifier import notify_workflow_event

router = APIRouter(prefix="/v1/bundles", tags=["bundles"])


class BundleRenderRequest(BaseModel):
    doc_type: str | None = None
    payload: dict[str, Any]
    convert_pdf: bool = True
    preview_key: str | None = None


class BundleSaveRequest(BaseModel):
    id: str | None = None
    doc_type: str | None = None
    subject: str | None = None
    division_code: str = "ฝว."
    payload: dict[str, Any]
    convert_pdf: bool = True


class BundleSubmitRequest(BaseModel):
    reviewer_email: str | None = None
    approver_email: str = "director@cric.ac.th"


def _safe_prefix(prefix_raw: str | None, fallback: str) -> str:
    if not prefix_raw:
        return fallback
    cleaned = "".join(c for c in prefix_raw if c.isalnum() or c in ("-", "_"))[:24]
    return f"preview_{cleaned or fallback}"


def _run_teaching_generator(doc_type: str, payload: dict[str, Any], prefix: str, org_profile: dict[str, Any], convert_pdf: bool) -> dict[str, Any]:
    if doc_type == "course_syllabus":
        return generate_course_syllabus(payload, RENDERED_DIR, prefix, org_profile, convert_pdf=convert_pdf)
    if doc_type == "lesson_plan":
        return generate_lesson_plan(payload, RENDERED_DIR, prefix, org_profile, convert_pdf=convert_pdf)
    if doc_type == "post_teaching_normal":
        return generate_post_teaching_normal(payload, RENDERED_DIR, prefix, org_profile, convert_pdf=convert_pdf)
    if doc_type == "post_teaching_online":
        return generate_online_teaching_report(payload, RENDERED_DIR, prefix, org_profile, convert_pdf=convert_pdf)
    raise HTTPException(status_code=400, detail=f"ไม่รองรับประเภทเอกสารการสอน: {doc_type}")


def _attach_instructor_signature(payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    out = dict(payload)
    if out.get("include_instructor_signature", True):
        sig_path = str(user.get("signature_storage_path") or "").strip()
        if sig_path and Path(sig_path).exists():
            sigs = dict(out.get("signatures") or {})
            sigs.setdefault("instructor", sig_path)
            out["signatures"] = sigs
    return out


def _save_bundle_document(
    user: dict[str, Any],
    doc_id: str | None,
    doc_type: str,
    subject: str,
    division_code: str,
    payload: dict[str, Any],
    render_res: dict[str, Any],
) -> dict[str, Any]:
    new_id = doc_id or str(uuid.uuid4())
    bundle_files = render_res.get("bundle_files") or []
    first = bundle_files[0] if bundle_files else {}
    stored_payload = {
        **payload,
        "type": doc_type,
        "bundle_files": bundle_files,
        "zip_url": render_res.get("zip_url", ""),
        "zip_filename": render_res.get("zip_filename", ""),
        "merged_pdf_url": render_res.get("merged_pdf_url", ""),
        "merged_pdf_filename": render_res.get("merged_pdf_filename", ""),
    }
    actor_tag = str(user.get("email") or user.get("username") or user.get("id") or "user")
    doc = db.save_document(
        {
            "id": new_id,
            "doc_type": doc_type,
            "division_code": division_code,
            "doc_number": str(payload.get("doc_number") or ""),
            "is_circular": False,
            "speed_level": "",
            "secrecy_level": "",
            "font_family": "TH Sarabun New",
            "subject": subject,
            "payload_json": stored_payload,
            "status": "draft",
            "docx_path": first.get("file_url") or render_res.get("zip_url") or "",
            "pdf_path": render_res.get("merged_pdf_url") or first.get("pdf_url") or "",
            "created_by": actor_tag,
        }
    )
    db.add_audit_log(new_id, actor_tag, "bundle_saved", {"doc_type": doc_type, "files": len(bundle_files)})
    doc["page_image_urls"] = first.get("page_image_urls") or []
    return doc


@router.post("/sp/render")
def render_sp_bundle(req: BundleRenderRequest, x_user_email: str | None = Header(default=None)):
    resolve_current_user(x_user_email)
    org_profile = get_effective_org_profile()
    prefix = _safe_prefix(req.preview_key, uuid.uuid4().hex[:8])
    return generate_sp_bundle(req.payload, RENDERED_DIR, prefix, org_profile, convert_pdf=req.convert_pdf)


@router.post("/sp/save")
def save_sp_bundle(req: BundleSaveRequest, x_user_email: str | None = Header(default=None)):
    user = resolve_current_user(x_user_email)
    doc_id = req.id or str(uuid.uuid4())
    org_profile = get_effective_org_profile()
    render_res = generate_sp_bundle(req.payload, RENDERED_DIR, f"doc_{doc_id}", org_profile, convert_pdf=req.convert_pdf)
    subject = req.subject or f"ชุดจัดซื้อวัสดุฝึก: {req.payload.get('project_name') or 'โครงการใหม่'}"
    doc = _save_bundle_document(user, doc_id, "sp_bundle", subject, req.division_code, req.payload, render_res)
    return {"document": doc, "render": render_res}


@router.post("/teaching/render")
def render_teaching_bundle(req: BundleRenderRequest, x_user_email: str | None = Header(default=None)):
    user = resolve_current_user(x_user_email)
    org_profile = get_effective_org_profile()
    doc_type = req.doc_type or str(req.payload.get("type") or "course_syllabus")
    prefix = _safe_prefix(req.preview_key, uuid.uuid4().hex[:8])
    enriched = _attach_instructor_signature(req.payload, user)
    return _run_teaching_generator(doc_type, enriched, prefix, org_profile, convert_pdf=req.convert_pdf)


@router.post("/teaching/save")
def save_teaching_bundle(req: BundleSaveRequest, x_user_email: str | None = Header(default=None)):
    user = resolve_current_user(x_user_email)
    doc_id = req.id or str(uuid.uuid4())
    org_profile = get_effective_org_profile()
    doc_type = req.doc_type or str(req.payload.get("type") or "course_syllabus")
    enriched = _attach_instructor_signature(req.payload, user)
    render_res = _run_teaching_generator(doc_type, enriched, f"doc_{doc_id}", org_profile, convert_pdf=req.convert_pdf)
    default_titles = {
        "course_syllabus": f"กำหนดการสอน {req.payload.get('course_code', '')} {req.payload.get('course_name', '')}".strip(),
        "lesson_plan": f"แผนการจัดการเรียนรู้ {req.payload.get('course_code', '')} {req.payload.get('course_name', '')}".strip(),
        "post_teaching_normal": f"รายงานบันทึกหลังการสอน สัปดาห์ที่ {req.payload.get('week_start', 1)}-{req.payload.get('week_end', 4)}",
        "post_teaching_online": f"รายงานการสอนออนไลน์ สัปดาห์ที่ {req.payload.get('week_number', 1)}",
    }
    subject = req.subject or default_titles.get(doc_type, "เอกสารงานสอน")
    doc = _save_bundle_document(user, doc_id, doc_type, subject, req.division_code, enriched, render_res)
    return {"document": doc, "render": render_res}


@router.post("/teaching/upload-photo")
async def upload_teaching_photo(file: UploadFile = File(...), x_user_email: str | None = Header(default=None)):
    user = resolve_current_user(x_user_email)
    ext = Path(file.filename or "").suffix.lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        raise HTTPException(status_code=400, detail="รองรับเฉพาะไฟล์ภาพ .jpg, .jpeg, .png หรือ .webp เท่านั้น")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="ขนาดรูปภาพต้องไม่เกิน 10 MB")
    fname = f"teach_{uuid.uuid4().hex[:12]}{ext}"
    ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)
    target = ATTACHMENTS_DIR / fname
    target.write_bytes(data)
    db.add_audit_log(None, str(user.get("email") or "user"), "teaching_photo_uploaded", {"filename": fname})
    return {"filename": fname, "original_name": file.filename}


@router.post("/{doc_id}/submit")
def submit_bundle_workflow(doc_id: str, body: BundleSubmitRequest, x_user_email: str | None = Header(default=None)):
    user = resolve_current_user(x_user_email)
    doc = db.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="ไม่พบเอกสารชุดที่ระบุ")
    steps: list[dict[str, str]] = []
    if body.reviewer_email:
        reviewer = db.get_user_by_email(body.reviewer_email)
        steps.append({"assignee_email": body.reviewer_email, "assignee_role": (reviewer or {}).get("role", "deputy_director")})
    approver = db.get_user_by_email(body.approver_email)
    steps.append({"assignee_email": body.approver_email, "assignee_role": (approver or {}).get("role", "director")})
    db.replace_approval_steps(doc_id, steps)
    new_status = "pending_review" if body.reviewer_email else "pending_approval"
    db.save_document({**doc, "status": new_status})
    actor_tag = str(user.get("email") or user.get("username") or "user")
    db.add_audit_log(doc_id, actor_tag, "submitted", {"steps": steps})
    updated = db.get_document(doc_id)
    if updated:
        notify_workflow_event("submitted", updated, actor_tag)
    return {"document": updated}
