"""Document validation, rendering (.docx + .pdf preview), workflow, signing, and file serving."""

from __future__ import annotations

import re
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import RENDERED_DIR
from app.db import db
from app.engine.generate_doc import generate_document_with_report, inject_order_catchwords_if_multipage
from app.engine.pdf_converter import convert_docx_to_pdf, render_pdf_pages_to_png
from app.engine.mail_merge_engine import render_single_custom_template
from app.engine.sp_engine import generate_sp_bundle
from app.engine.teaching_engine import (
    generate_course_syllabus,
    generate_lesson_plan,
    generate_online_teaching_report,
    generate_post_teaching_normal,
)
from app.engine.thai_utils import current_buddhist_year
from app.engine.validate_doc import validate_document
from app.routers.auth import resolve_current_user
from app.routers.registry import _format_registry_number
from app.routers.settings import get_effective_linter_rules, get_effective_org_profile
from app.services.notifier import notify_workflow_event

router = APIRouter(prefix="/v1", tags=["documents"])

DOC_TYPE_LABELS: dict[str, str] = {
    "memo": "บันทึกข้อความ",
    "external": "หนังสือภายนอก",
    "order": "คำสั่ง",
    "announcement": "ประกาศ",
    "agenda": "ระเบียบวาระ",
    "minutes": "รายงานประชุม",
    "sp_bundle": "จัดซื้อ/สผ.",
    "course_syllabus": "โครงการสอน",
    "lesson_plan": "แผนการสอน",
    "post_teaching_normal": "หลังสอนปกติ",
    "post_teaching_online": "หลังสอนออนไลน์",
    "custom_template": "แม่แบบกำหนดเอง",
    "vehicle_request": "ขอใช้รถ",
    "official_travel": "ขอไปราชการ",
    "repair_request": "แจ้งซ่อม",
    "overload_teaching": "ขอเบิกค่าสอนเกินภาระงาน",
    "internship_supervision": "นิเทศฝึกงาน",
    "home_visit": "รายงานเยี่ยมบ้าน",
    "project_summary": "สรุปโครงการ",
    "single_plan_summary": "สรุปแผนเดี่ยว",
}


def _serialize_dashboard_doc(doc: dict[str, Any], step_role: str | None = None) -> dict[str, Any]:
    item: dict[str, Any] = {
        "id": str(doc["id"]),
        "doc_type": str(doc.get("doc_type") or ""),
        "division_code": str(doc.get("division_code") or ""),
        "doc_number": str(doc.get("doc_number") or ""),
        "subject": str(doc.get("subject") or ""),
        "status": str(doc.get("status") or "draft"),
        "created_by": str(doc.get("created_by") or ""),
        "updated_at": str(doc.get("updated_at") or ""),
        "docx_path": str(doc.get("docx_path") or ""),
    }
    if step_role:
        item["step_role"] = step_role
    return item


@router.get("/dashboard")
def get_dashboard_summary(x_user_email: str | None = Header(default=None)):
    user = resolve_current_user(x_user_email)
    user_identifiers = {
        str(v).strip().lower()
        for v in (user.get("email"), user.get("username"), user.get("id"))
        if v
    }
    is_admin_or_director = user.get("role") in ("saraban_admin", "director")

    docs = db.list_documents_with_pending_steps()
    counts = {
        "total": len(docs),
        "draft": 0,
        "pending_review": 0,
        "needs_revision": 0,
        "pending_approval": 0,
        "approved": 0,
        "numbered": 0,
    }
    type_counts: dict[str, int] = {}
    div_counts: dict[str, int] = {}

    waiting_my_action: list[dict[str, Any]] = []
    my_drafts_or_revisions: list[dict[str, Any]] = []
    waiting_numbering: list[dict[str, Any]] = []

    for doc in docs:
        status = str(doc.get("status") or "draft")
        if status in counts:
            counts[status] += 1
        elif status == "archived":
            counts["numbered"] += 1

        dtype = str(doc.get("doc_type") or "other")
        type_counts[dtype] = type_counts.get(dtype, 0) + 1

        dcode = str(doc.get("division_code") or "").strip() or "ส่วนกลาง"
        div_counts[dcode] = div_counts.get(dcode, 0) + 1

        pending_steps = doc.get("pending_steps") or []
        if pending_steps and status in ("pending_review", "pending_approval"):
            next_step = pending_steps[0]
            assignee = str(next_step.get("assignee_email") or "").strip().lower()
            if assignee in user_identifiers or (user.get("role") == "director" and status == "pending_approval"):
                waiting_my_action.append(_serialize_dashboard_doc(doc, step_role=str(next_step.get("assignee_role") or "")))

        creator = str(doc.get("created_by") or "").strip().lower()
        if creator in user_identifiers and status in ("draft", "needs_revision"):
            my_drafts_or_revisions.append(_serialize_dashboard_doc(doc))

        if is_admin_or_director and status == "approved" and not str(doc.get("doc_number") or "").strip():
            waiting_numbering.append(_serialize_dashboard_doc(doc))

    by_type = [
        {"key": k, "label": DOC_TYPE_LABELS.get(k, k), "count": v}
        for k, v in sorted(type_counts.items(), key=lambda x: -x[1])
    ]
    by_division = [
        {"code": k, "count": v}
        for k, v in sorted(div_counts.items(), key=lambda x: -x[1])
    ]

    sequences_out: list[dict[str, Any]] = []
    for seq in db.list_sequences():
        next_num = int(seq.get("last_number") or 0) + 1
        sequences_out.append({**seq, "next_formatted": _format_registry_number(seq, next_num)})

    courses_count = len(db.list_courses())
    custom_templates_count = len(db.list_document_templates(active_only=True))
    ai_enabled = bool(db.get_setting_json("ai_provider", {}).get("enabled", True))

    raw_logs = db.list_audit_logs(limit=40)
    if is_admin_or_director:
        recent_activity = raw_logs[:8]
    else:
        recent_activity = [l for l in raw_logs if str(l.get("actor_email") or "").strip().lower() in user_identifiers][:8]

    return {
        "counts": counts,
        "by_type": by_type,
        "by_division": by_division,
        "action_queue": {
            "waiting_my_action": waiting_my_action,
            "my_drafts_or_revisions": my_drafts_or_revisions,
            "waiting_numbering": waiting_numbering,
        },
        "recent_documents": [_serialize_dashboard_doc(d) for d in docs[:8]],
        "sequences": sequences_out,
        "resources": {
            "courses_count": courses_count,
            "custom_templates_count": custom_templates_count,
            "ai_copilot_enabled": ai_enabled,
        },
        "recent_activity": recent_activity,
    }


def _user_tag(u: dict[str, Any]) -> str:
    return str(u.get("email") or u.get("username") or u.get("id") or "user")


class RenderRequest(BaseModel):
    payload: dict[str, Any]
    convert_pdf: bool = True
    preview_key: str | None = None


class DocumentSaveRequest(BaseModel):
    id: str | None = None
    payload: dict[str, Any]


class SubmitWorkflowRequest(BaseModel):
    reviewer_email: str | None = None
    approver_email: str = "director@cric.ac.th"


class ApproveRequest(BaseModel):
    comment: str = ""
    stamp_signature: bool = True


class ReturnRequest(BaseModel):
    comment: str = "กรุณาแก้ไขตามข้อเสนอแนะ"


class NumberAllocateDocRequest(BaseModel):
    registry_key: str | None = None
    year_be: int | None = None


def _serialize_issues(issues: list[Any]) -> list[dict[str, str]]:
    return [{"level": i.level, "location": i.location, "message": i.message} for i in issues]


def _cleanup_stale_previews(max_age_seconds: int = 1800) -> None:
    cutoff = time.time() - max_age_seconds
    for f in RENDERED_DIR.glob("preview_*"):
        try:
            if f.is_file() and f.stat().st_mtime < cutoff:
                f.unlink()
        except OSError:
            pass


def _attach_page_images(doc_dict: dict[str, Any]) -> dict[str, Any]:
    doc_id = doc_dict.get("id", "")
    prefix = f"doc_{doc_id}"
    pages = sorted(RENDERED_DIR.glob(f"{prefix}_page-*.png"))
    if not pages and doc_dict.get("pdf_path"):
        pdf_file = RENDERED_DIR / Path(doc_dict["pdf_path"]).name
        if pdf_file.exists():
            pages = render_pdf_pages_to_png(pdf_file, RENDERED_DIR, prefix=prefix)
    urls = [f"/v1/files/rendered/{p.name}" for p in pages]
    if not urls:
        bundle_files = (doc_dict.get("payload_json") or {}).get("bundle_files") or []
        if bundle_files and isinstance(bundle_files[0], dict):
            urls = bundle_files[0].get("page_image_urls") or []
    doc_dict["page_image_urls"] = urls
    return doc_dict


def _render_to_storage(payload: dict[str, Any], base_name: str, convert_pdf: bool = True) -> dict[str, Any]:
    doc_type = str(payload.get("type") or "")
    org_profile = get_effective_org_profile()

    if doc_type == "custom_template":
        template_id = str(payload.get("template_id") or "")
        tpl = db.get_document_template(template_id)
        if not tpl:
            raise ValueError(f"ไม่พบแม่แบบเอกสารรหัส '{template_id}'")
        res = render_single_custom_template(
            tpl,
            payload.get("data") or {},
            RENDERED_DIR,
            base_name,
            org_profile,
            convert_pdf=convert_pdf,
        )
        return {
            **res,
            "validation": [],
            "error_count": 0,
            "warning_count": 0,
        }

    if doc_type in ("sp_bundle", "course_syllabus", "lesson_plan", "post_teaching_normal", "post_teaching_online"):
        if doc_type == "sp_bundle":
            bres = generate_sp_bundle(payload, RENDERED_DIR, base_name, org_profile, convert_pdf=convert_pdf)
        elif doc_type == "course_syllabus":
            bres = generate_course_syllabus(payload, RENDERED_DIR, base_name, org_profile, convert_pdf=convert_pdf)
        elif doc_type == "lesson_plan":
            bres = generate_lesson_plan(payload, RENDERED_DIR, base_name, org_profile, convert_pdf=convert_pdf)
        elif doc_type == "post_teaching_normal":
            bres = generate_post_teaching_normal(payload, RENDERED_DIR, base_name, org_profile, convert_pdf=convert_pdf)
        else:
            bres = generate_online_teaching_report(payload, RENDERED_DIR, base_name, org_profile, convert_pdf=convert_pdf)
        bundle_files = bres.get("bundle_files") or []
        first = bundle_files[0] if bundle_files else {}
        return {
            "docx_filename": first.get("filename", ""),
            "pdf_filename": Path(first["pdf_url"]).name if first.get("pdf_url") else "",
            "docx_url": first.get("file_url") or bres.get("zip_url", ""),
            "pdf_url": bres.get("merged_pdf_url") or first.get("pdf_url", ""),
            "page_image_urls": first.get("page_image_urls", []),
            "pdf_error": first.get("pdf_error", ""),
            "font_used": "TH Sarabun New",
            "issues": [],
            "valid": True,
            "bundle_files": bundle_files,
            "zip_url": bres.get("zip_url", ""),
            "zip_filename": bres.get("zip_filename", ""),
            "merged_pdf_url": bres.get("merged_pdf_url", ""),
            "merged_pdf_filename": bres.get("merged_pdf_filename", ""),
        }

    docx_path = RENDERED_DIR / f"{base_name}.docx"
    linter = get_effective_linter_rules()
    issues, font_used = generate_document_with_report(
        payload,
        docx_path,
        validate=True,
        org_defaults_override=org_profile,
        extra_misspellings=linter.get("custom_misspellings"),
        extra_forbidden=linter.get("custom_forbidden_phrases"),
    )
    pdf_name = ""
    pdf_error = ""
    page_urls: list[str] = []
    if convert_pdf:
        try:
            pdf_path = convert_docx_to_pdf(docx_path, RENDERED_DIR)
            if (payload.get("type") or "").strip().lower() == "order":
                if inject_order_catchwords_if_multipage(docx_path, pdf_path, font_family=font_used):
                    pdf_path = convert_docx_to_pdf(docx_path, RENDERED_DIR)
            pdf_name = pdf_path.name
            pngs = render_pdf_pages_to_png(pdf_path, RENDERED_DIR, prefix=base_name)
            page_urls = [f"/v1/files/rendered/{p.name}" for p in pngs]
        except Exception as exc:
            pdf_error = str(exc)

    return {
        "docx_filename": docx_path.name,
        "pdf_filename": pdf_name,
        "docx_url": f"/v1/files/rendered/{docx_path.name}",
        "pdf_url": f"/v1/files/rendered/{pdf_name}" if pdf_name else "",
        "page_image_urls": page_urls,
        "pdf_error": pdf_error,
        "font_family": font_used,
        "validation": _serialize_issues(issues),
        "error_count": sum(1 for i in issues if i.level == "ERROR"),
        "warning_count": sum(1 for i in issues if i.level == "WARNING"),
    }


@router.post("/validate")
def validate_payload(body: RenderRequest, x_user_email: str | None = Header(default=None)):
    resolve_current_user(x_user_email)
    org_profile = get_effective_org_profile()
    linter = get_effective_linter_rules()
    with tempfile.TemporaryDirectory() as tmp:
        tmp_docx = Path(tmp) / "check.docx"
        issues, font_used = generate_document_with_report(
            body.payload,
            tmp_docx,
            validate=True,
            org_defaults_override=org_profile,
            extra_misspellings=linter.get("custom_misspellings"),
            extra_forbidden=linter.get("custom_forbidden_phrases"),
        )
        return {
            "font_family": font_used,
            "validation": _serialize_issues(issues),
            "error_count": sum(1 for i in issues if i.level == "ERROR"),
            "warning_count": sum(1 for i in issues if i.level == "WARNING"),
        }


@router.post("/render")
def render_preview(body: RenderRequest, x_user_email: str | None = Header(default=None)):
    resolve_current_user(x_user_email)
    _cleanup_stale_previews()
    safe_key = re.sub(r"[^A-Za-z0-9_-]", "", body.preview_key or "")[:32]
    token = f"preview_{safe_key}" if safe_key else f"preview_{uuid.uuid4().hex[:12]}"
    try:
        return _render_to_storage(body.payload, token, convert_pdf=body.convert_pdf)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _user_can_view_document(user: dict[str, Any], doc: dict[str, Any]) -> bool:
    role = str(user.get("role") or "")
    if role in ("director", "saraban_admin"):
        return True
    user_idents = {str(user.get("email") or "").strip().lower(), str(user.get("username") or "").strip().lower()} - {""}
    created_by = str(doc.get("created_by") or "").strip().lower()
    if created_by and created_by in user_idents:
        return True
    steps = doc.get("approval_steps") or []
    for st in steps:
        if isinstance(st, dict) and str(st.get("assignee_email") or st.get("approver_email") or "").strip().lower() in user_idents:
            return True
    user_divs = {str(d).strip() for d in (user.get("division_codes") or []) if str(d).strip()}
    if user.get("division_code"):
        user_divs.add(str(user["division_code"]).strip())
    doc_div = str(doc.get("division_code") or "").strip()
    return bool(doc_div and doc_div in user_divs)


@router.get("/documents")
def list_documents(
    status: str | None = None,
    division_code: str | None = None,
    x_user_email: str | None = Header(default=None),
):
    user = resolve_current_user(x_user_email)
    all_visible = [
        _attach_page_images(d)
        for d in db.list_documents(status=status, division_code=None)
        if _user_can_view_document(user, d)
    ]
    division_counts: dict[str, dict[str, int]] = {
        code: {"total": 0, "pending": 0} for code in ("ฝบ.", "ฝว.", "ฝก.", "ฝย.")
    }
    for d in all_visible:
        dc = str(d.get("division_code") or "").strip()
        if dc in division_counts:
            division_counts[dc]["total"] += 1
            if d.get("status") in ("pending_review", "pending_approval"):
                division_counts[dc]["pending"] += 1

    if division_code:
        docs = [d for d in all_visible if str(d.get("division_code") or "").strip() == division_code.strip()]
    else:
        docs = all_visible
    return {"documents": docs, "division_counts": division_counts}


@router.get("/documents/{doc_id}")
def get_document(doc_id: str, x_user_email: str | None = Header(default=None)):
    resolve_current_user(x_user_email)
    doc = db.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="ไม่พบเอกสารที่ระบุ")
    return {"document": _attach_page_images(doc), "audit_logs": db.list_audit_logs(doc_id)}


@router.post("/documents")
def save_document(body: DocumentSaveRequest, x_user_email: str | None = Header(default=None)):
    user = resolve_current_user(x_user_email)
    payload = body.payload
    doc_type = (payload.get("type") or "").strip().lower()
    if not doc_type:
        raise HTTPException(status_code=400, detail="กรุณาระบุประเภทเอกสาร (type)")

    doc_id = body.id or str(uuid.uuid4())
    render_res = _render_to_storage(payload, f"doc_{doc_id}", convert_pdf=True)

    saved = db.save_document(
        {
            "id": doc_id,
            "doc_type": doc_type,
            "division_code": payload.get("division_code", ""),
            "doc_number": payload.get("doc_number") or payload.get("order_number") or "",
            "is_circular": bool(payload.get("is_circular", False)),
            "speed_level": payload.get("speed", ""),
            "secrecy_level": payload.get("secrecy", ""),
            "font_family": render_res["font_family"],
            "subject": payload.get("subject") or payload.get("meeting_title") or "(ไม่มีชื่อเรื่อง)",
            "payload_json": payload,
            "status": "draft",
            "docx_path": render_res["docx_url"],
            "pdf_path": render_res["pdf_url"],
            "created_by": _user_tag(user),
        }
    )
    db.add_audit_log(doc_id, _user_tag(user), "saved_draft", {"error_count": render_res["error_count"]})
    return {"document": _attach_page_images(saved), "render": render_res}


@router.post("/documents/{doc_id}/submit")
def submit_for_approval(doc_id: str, body: SubmitWorkflowRequest, x_user_email: str | None = Header(default=None)):
    user = resolve_current_user(x_user_email)
    doc = db.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="ไม่พบเอกสารที่ระบุ")

    steps = []
    if body.reviewer_email:
        reviewer = db.get_user_by_email(body.reviewer_email)
        steps.append(
            {
                "assignee_email": body.reviewer_email.lower(),
                "assignee_role": (reviewer or {}).get("role", "deputy_director"),
            }
        )
    approver = db.get_user_by_email(body.approver_email)
    steps.append(
        {
            "assignee_email": body.approver_email.lower(),
            "assignee_role": (approver or {}).get("role", "director"),
        }
    )
    db.replace_approval_steps(doc_id, steps)
    new_status = "pending_review" if body.reviewer_email else "pending_approval"
    updated = db.save_document({**doc, "status": new_status})
    db.add_audit_log(doc_id, user["email"], "submitted", {"steps": steps})
    final_doc = db.get_document(doc_id) or updated
    notify_workflow_event("submitted", final_doc, user["email"])
    return {"document": _attach_page_images(final_doc)}


def _apply_signer_stamp_to_payload(payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    sig_path = user.get("signature_storage_path") or ""
    if not sig_path or not Path(sig_path).exists():
        return payload
    new_payload = dict(payload)
    doc_type = new_payload.get("type", "")
    if doc_type == "memo":
        signers = list(new_payload.get("signers") or [])
        matched = False
        for s in signers:
            if user["full_name"] in (s.get("name") or "") or user["role"] == "deputy_director":
                s["signature_image_path"] = sig_path
                matched = True
        if not matched:
            signers.append({"name": user["full_name"], "title": user["position_title"], "signature_image_path": sig_path})
        new_payload["signers"] = signers
    elif doc_type in ("order", "announcement", "external"):
        signer = dict(new_payload.get("signer") or {"name": user["full_name"], "title": user["position_title"]})
        signer["signature_image_path"] = sig_path
        new_payload["signer"] = signer
    elif doc_type in ("course_syllabus", "lesson_plan", "post_teaching_normal", "post_teaching_online"):
        sigs = dict(new_payload.get("signatures") or {})
        role = str(user.get("role") or "")
        full_name = str(user.get("full_name") or "")
        if role == "director":
            sigs["director"] = sig_path
        elif role == "deputy_director":
            sigs["deputy_academic"] = sig_path
        elif full_name and full_name in str(new_payload.get("curriculum_head_name") or ""):
            sigs["curriculum_head"] = sig_path
        elif role == "unit_head" or (full_name and full_name in str(new_payload.get("dept_head_name") or "")):
            sigs["dept_head"] = sig_path
        else:
            sigs["dept_head"] = sig_path
        new_payload["signatures"] = sigs
    return new_payload


@router.post("/documents/{doc_id}/approve")
def approve_document(doc_id: str, body: ApproveRequest, x_user_email: str | None = Header(default=None)):
    user = resolve_current_user(x_user_email)
    doc = db.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="ไม่พบเอกสารที่ระบุ")

    pending = [s for s in doc.get("approval_steps", []) if s["action"] == "pending"]
    if pending:
        current_step = pending[0]
        if current_step["assignee_email"] != user["email"] and user["role"] != "director":
            raise HTTPException(status_code=403, detail=f"เอกสารนี้อยู่ระหว่างรอ {current_step['assignee_email']} พิจารณา")
        db.record_step_action(current_step["id"], "approved", body.comment)

    payload = doc["payload_json"]
    if body.stamp_signature:
        payload = _apply_signer_stamp_to_payload(payload, user)

    render_res = _render_to_storage(payload, f"doc_{doc_id}", convert_pdf=True)
    if render_res.get("bundle_files"):
        payload["bundle_files"] = render_res["bundle_files"]
        payload["zip_url"] = render_res.get("zip_url", "")
        payload["zip_filename"] = render_res.get("zip_filename", "")
        payload["merged_pdf_url"] = render_res.get("merged_pdf_url", "")
        payload["merged_pdf_filename"] = render_res.get("merged_pdf_filename", "")
    has_more_steps = len(pending) > 1
    new_status = "pending_approval" if has_more_steps else "approved"
    db.save_document(
        {
            **doc,
            "payload_json": payload,
            "status": new_status,
            "docx_path": render_res["docx_url"],
            "pdf_path": render_res["pdf_url"],
        }
    )
    db.add_audit_log(doc_id, _user_tag(user), "approved", {"comment": body.comment, "stamped": body.stamp_signature})
    updated_doc = db.get_document(doc_id)
    if updated_doc:
        notify_workflow_event("approved", updated_doc, _user_tag(user), body.comment)
    return {"document": _attach_page_images(updated_doc) if updated_doc else None, "render": render_res}


@router.post("/documents/{doc_id}/return")
def return_document(doc_id: str, body: ReturnRequest, x_user_email: str | None = Header(default=None)):
    user = resolve_current_user(x_user_email)
    doc = db.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="ไม่พบเอกสารที่ระบุ")
    pending = [s for s in doc.get("approval_steps", []) if s["action"] == "pending"]
    if pending:
        db.record_step_action(pending[0]["id"], "returned", body.comment)
    db.save_document({**doc, "status": "needs_revision"})
    db.add_audit_log(doc_id, _user_tag(user), "returned", {"comment": body.comment})
    final_doc = db.get_document(doc_id)
    if final_doc:
        notify_workflow_event("returned", final_doc, _user_tag(user), body.comment)
    return {"document": _attach_page_images(final_doc) if final_doc else None}


@router.post("/documents/{doc_id}/number")
def assign_saraban_number(doc_id: str, body: NumberAllocateDocRequest, x_user_email: str | None = Header(default=None)):
    user = resolve_current_user(x_user_email)
    if user["role"] not in ("saraban_admin", "director"):
        raise HTTPException(status_code=403, detail="เฉพาะเจ้าหน้าที่สารบรรณหรือผู้อำนวยการเท่านั้นที่ออกเลขจริงได้")
    doc = db.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="ไม่พบเอกสารที่ระบุ")

    doc_type = doc["doc_type"]
    div_code = doc.get("division_code") or doc["payload_json"].get("division_code", "ฝบ.")
    reg_key = body.registry_key
    if not reg_key:
        reg_key = f"memo_{div_code}" if doc_type in ("memo", "custom_template") else doc_type
    year_be = body.year_be or current_buddhist_year()

    try:
        seq = db.allocate_next_number(reg_key, year_be, _user_tag(user))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    num_int = int(seq["last_number"])
    formatted = _format_registry_number(seq, num_int, is_circular=bool(doc.get("is_circular", False)))

    payload = dict(doc["payload_json"])
    if doc_type == "order":
        payload["order_number"] = formatted
    elif doc_type == "external":
        payload["doc_number"] = str(num_int)
    elif doc_type in ("memo", "sp_bundle", "post_teaching_online", "post_teaching_normal", "custom_template"):
        circ_prefix = "ว " if doc.get("is_circular") else ""
        doc_no_str = f"{circ_prefix}{num_int}/{year_be}"
        payload["doc_number"] = doc_no_str
        if doc_type == "custom_template" and isinstance(payload.get("data"), dict):
            payload["data"] = {**payload["data"], "doc_number": doc_no_str, "เลขที่หนังสือ": doc_no_str}

    render_res = _render_to_storage(payload, f"doc_{doc_id}", convert_pdf=True)
    if render_res.get("bundle_files"):
        payload["bundle_files"] = render_res["bundle_files"]
        payload["zip_url"] = render_res.get("zip_url", "")
        payload["zip_filename"] = render_res.get("zip_filename", "")
        payload["merged_pdf_url"] = render_res.get("merged_pdf_url", "")
        payload["merged_pdf_filename"] = render_res.get("merged_pdf_filename", "")
    db.save_document(
        {
            **doc,
            "doc_number": formatted,
            "payload_json": payload,
            "status": "numbered",
            "docx_path": render_res["docx_url"],
            "pdf_path": render_res["pdf_url"],
        }
    )
    db.add_audit_log(doc_id, user["email"], "numbered", {"registry_key": reg_key, "doc_number": formatted})
    updated_doc = db.get_document(doc_id)
    if updated_doc:
        notify_workflow_event("numbered", updated_doc, user["email"])
    return {"document": _attach_page_images(updated_doc) if updated_doc else None, "render": render_res}


@router.get("/files/rendered/{filename}")
def download_rendered_file(filename: str, download: bool = False):
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    target = (RENDERED_DIR / filename).resolve()
    if not str(target).startswith(str(RENDERED_DIR.resolve())) or not target.exists():
        raise HTTPException(status_code=404, detail="ไม่พบไฟล์ที่ร้องขอ")

    ext = target.suffix.lower()
    if ext == ".pdf":
        media_type = "application/pdf"
    elif ext == ".png":
        media_type = "image/png"
    elif ext in (".jpg", ".jpeg"):
        media_type = "image/jpeg"
    elif ext == ".xlsx":
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    elif ext == ".zip":
        media_type = "application/zip"
    else:
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    encoded_name = quote(target.name)
    ascii_fallback = target.name.encode("ascii", "ignore").decode("ascii") or f"document{ext}"
    disp_type = "attachment" if download else "inline"
    return FileResponse(
        path=str(target),
        media_type=media_type,
        headers={
            "Content-Disposition": f"{disp_type}; filename=\"{ascii_fallback}\"; filename*=UTF-8''{encoded_name}"
        },
    )
