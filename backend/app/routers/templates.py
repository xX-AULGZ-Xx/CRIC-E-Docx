"""Custom {{var}} Mail-Merge Templates & 16 System Templates Management API."""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from app.config import ATTACHMENTS_DIR, CUSTOM_TEMPLATES_DIR, RENDERED_DIR
from app.db import db
from app.engine.mail_merge_engine import (
    _convert_xlsx_to_pdf_dual_pass,
    build_batch_sample_xlsx,
    generate_batch_mail_merge,
    parse_batch_rows,
    render_single_custom_template,
    scan_template_placeholders,
)
from app.engine.pdf_converter import convert_office_to_pdf, render_pdf_pages_to_png
from app.engine.template_resolver import (
    get_system_template_meta,
    list_system_templates,
    reset_system_template_override,
    resolve_system_template,
    save_system_template_override,
)
from app.routers.auth import resolve_current_user
from app.routers.settings import _require_admin, get_effective_org_profile

router = APIRouter(prefix="/v1/templates", tags=["templates"])

MAX_TEMPLATE_BYTES = 15 * 1024 * 1024  # 15 MB


class CustomTemplateUpdateRequest(BaseModel):
    name: str | None = None
    category: str | None = None
    description: str | None = None
    is_active: bool | None = None
    fields_schema: list[dict[str, Any]] | None = None


class CustomRenderRequest(BaseModel):
    data: dict[str, Any] = {}
    convert_pdf: bool = True
    preview_key: str | None = None


class CustomSaveRequest(BaseModel):
    id: str | None = None
    division_code: str = "ฝบ."
    subject: str | None = None
    data: dict[str, Any] = {}


# ==============================================================================
# Custom {{var}} Mail-Merge Templates (User + Admin)
# ==============================================================================


@router.get("/custom")
def list_custom_templates(
    include_inactive: bool = Query(default=False),
    x_user_email: str | None = Header(default=None),
):
    user = resolve_current_user(x_user_email)
    is_admin = user.get("role") in ("saraban_admin", "director")
    active_only = not (include_inactive and is_admin)
    return {"templates": db.list_document_templates(active_only=active_only)}


@router.get("/custom/{template_id}")
def get_custom_template(template_id: str, x_user_email: str | None = Header(default=None)):
    user = resolve_current_user(x_user_email)
    tpl = db.get_document_template(template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="ไม่พบแม่แบบเอกสารที่ระบุ")
    if not tpl.get("is_active") and user.get("role") not in ("saraban_admin", "director"):
        raise HTTPException(status_code=403, detail="แม่แบบเอกสารนี้ถูกปิดใช้งานชั่วคราว")
    return {"template": tpl}


@router.post("/custom")
async def create_custom_template(
    file: UploadFile = File(...),
    name: str = Form(...),
    category: str = Form(default="ทั่วไป"),
    description: str = Form(default=""),
    is_active: bool = Form(default=True),
    x_user_email: str | None = Header(default=None),
):
    admin = _require_admin(x_user_email)
    raw_name = (file.filename or "template.docx").strip()
    ext = Path(raw_name).suffix.lower().lstrip(".")
    if ext not in ("docx", "xlsx"):
        raise HTTPException(status_code=400, detail="รองรับเฉพาะไฟล์ .docx และ .xlsx เท่านั้น")

    content = await file.read()
    if len(content) > MAX_TEMPLATE_BYTES:
        raise HTTPException(status_code=400, detail="ขนาดไฟล์ต้องไม่เกิน 15 MB")
    if len(content) < 512:
        raise HTTPException(status_code=400, detail="ไฟล์แม่แบบไม่สมบูรณ์หรือมีขนาดเล็กเกินไป")

    tpl_id = str(uuid.uuid4())
    storage_filename = f"tpl_{tpl_id}.{ext}"
    dest_path = CUSTOM_TEMPLATES_DIR / storage_filename
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    dest_path.write_bytes(content)

    try:
        schema = scan_template_placeholders(dest_path, ext)
    except Exception as exc:
        dest_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"ไม่สามารถอ่านไฟล์แม่แบบได้: {exc}") from exc

    saved = db.upsert_document_template(
        {
            "id": tpl_id,
            "name": name.strip() or Path(raw_name).stem,
            "category": category.strip() or "ทั่วไป",
            "description": description.strip(),
            "file_type": ext,
            "storage_filename": storage_filename,
            "fields_schema": schema,
            "is_active": is_active,
            "created_by": admin["email"],
        },
        admin["email"],
    )
    db.add_audit_log(
        None,
        admin["email"],
        "custom_template_created",
        {"template_id": tpl_id, "name": saved["name"], "file_type": ext, "placeholders": len(schema)},
    )
    return {"template": saved, "detected_count": len(schema)}


@router.put("/custom/{template_id}")
def update_custom_template(
    template_id: str,
    body: CustomTemplateUpdateRequest,
    x_user_email: str | None = Header(default=None),
):
    admin = _require_admin(x_user_email)
    existing = db.get_document_template(template_id)
    if not existing:
        raise HTTPException(status_code=404, detail="ไม่พบแม่แบบเอกสารที่ระบุ")

    patch: dict[str, Any] = {"id": template_id}
    if body.name is not None:
        patch["name"] = body.name
    if body.category is not None:
        patch["category"] = body.category
    if body.description is not None:
        patch["description"] = body.description
    if body.is_active is not None:
        patch["is_active"] = body.is_active
    if body.fields_schema is not None:
        patch["fields_schema"] = body.fields_schema

    saved = db.upsert_document_template(patch, admin["email"])
    db.add_audit_log(None, admin["email"], "custom_template_updated", {"template_id": template_id, "name": saved["name"]})
    return {"template": saved}


@router.post("/custom/{template_id}/file")
async def replace_custom_template_file(
    template_id: str,
    file: UploadFile = File(...),
    rescan: bool = Form(default=True),
    x_user_email: str | None = Header(default=None),
):
    admin = _require_admin(x_user_email)
    existing = db.get_document_template(template_id)
    if not existing:
        raise HTTPException(status_code=404, detail="ไม่พบแม่แบบเอกสารที่ระบุ")

    raw_name = (file.filename or "template.docx").strip()
    ext = Path(raw_name).suffix.lower().lstrip(".")
    if ext not in ("docx", "xlsx"):
        raise HTTPException(status_code=400, detail="รองรับเฉพาะไฟล์ .docx และ .xlsx เท่านั้น")

    content = await file.read()
    if len(content) > MAX_TEMPLATE_BYTES:
        raise HTTPException(status_code=400, detail="ขนาดไฟล์ต้องไม่เกิน 15 MB")

    new_filename = f"tpl_{template_id}.{ext}"
    dest_path = CUSTOM_TEMPLATES_DIR / new_filename
    dest_path.write_bytes(content)

    try:
        scanned_schema = scan_template_placeholders(dest_path, ext)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"ไม่สามารถอ่านไฟล์แม่แบบใหม่ได้: {exc}") from exc

    # Remove old file if extension changed
    old_filename = existing.get("storage_filename")
    if old_filename and old_filename != new_filename:
        (CUSTOM_TEMPLATES_DIR / old_filename).unlink(missing_ok=True)

    # Merge new detected fields while preserving previous labels/settings where keys match
    merged_schema = scanned_schema
    if rescan:
        old_by_id = {(f.get("group", "main"), f.get("key")): f for f in (existing.get("fields_schema_json") or [])}
        merged_schema = [old_by_id.get((f.get("group", "main"), f.get("key")), f) for f in scanned_schema]
    else:
        merged_schema = existing.get("fields_schema_json") or scanned_schema

    saved = db.upsert_document_template(
        {
            "id": template_id,
            "file_type": ext,
            "storage_filename": new_filename,
            "fields_schema": merged_schema,
        },
        admin["email"],
    )
    db.add_audit_log(None, admin["email"], "custom_template_file_replaced", {"template_id": template_id, "file_type": ext})
    return {"template": saved, "detected_count": len(scanned_schema)}


@router.delete("/custom/{template_id}")
def delete_custom_template(template_id: str, x_user_email: str | None = Header(default=None)):
    admin = _require_admin(x_user_email)
    existing = db.get_document_template(template_id)
    if not existing:
        raise HTTPException(status_code=404, detail="ไม่พบแม่แบบเอกสารที่ระบุ")
    if existing.get("storage_filename"):
        (CUSTOM_TEMPLATES_DIR / existing["storage_filename"]).unlink(missing_ok=True)
    db.delete_document_template(template_id)
    db.add_audit_log(None, admin["email"], "custom_template_deleted", {"template_id": template_id, "name": existing["name"]})
    return {"ok": True}


@router.get("/custom/{template_id}/download")
def download_custom_template_source(template_id: str, x_user_email: str | None = Header(default=None)):
    resolve_current_user(x_user_email)
    tpl = db.get_document_template(template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="ไม่พบแม่แบบเอกสารที่ระบุ")
    src = CUSTOM_TEMPLATES_DIR / tpl["storage_filename"]
    if not src.exists():
        raise HTTPException(status_code=404, detail="ไม่พบไฟล์แม่แบบในระบบ")
    download_name = f"{tpl['name']}.{tpl['file_type']}"
    return FileResponse(path=src, filename=download_name)


@router.get("/custom/{template_id}/batch-sample.xlsx")
def download_batch_sample(template_id: str, x_user_email: str | None = Header(default=None)):
    resolve_current_user(x_user_email)
    tpl = db.get_document_template(template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="ไม่พบแม่แบบเอกสารที่ระบุ")
    xlsx_bytes = build_batch_sample_xlsx(tpl)
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="sample_{template_id[:8]}.xlsx"'},
    )


@router.post("/custom/{template_id}/upload-image")
async def upload_custom_template_image(
    template_id: str,
    file: UploadFile = File(...),
    x_user_email: str | None = Header(default=None),
):
    resolve_current_user(x_user_email)
    tpl = db.get_document_template(template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="ไม่พบแม่แบบเอกสารที่ระบุ")
    ext = Path(file.filename or "img.png").suffix.lower() or ".png"
    if ext not in (".png", ".jpg", ".jpeg", ".webp"):
        raise HTTPException(status_code=400, detail="รองรับเฉพาะไฟล์รูปภาพ .png, .jpg, .webp เท่านั้น")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="ขนาดรูปภาพต้องไม่เกิน 10 MB")
    fname = f"tplimg_{uuid.uuid4().hex[:12]}{ext}"
    (ATTACHMENTS_DIR / fname).write_bytes(content)
    return {"filename": fname, "original_name": file.filename or fname}


@router.post("/custom/{template_id}/render")
def render_custom_template(
    template_id: str,
    body: CustomRenderRequest,
    x_user_email: str | None = Header(default=None),
):
    user = resolve_current_user(x_user_email)
    tpl = db.get_document_template(template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="ไม่พบแม่แบบเอกสารที่ระบุ")
    if not tpl.get("is_active") and user.get("role") not in ("saraban_admin", "director"):
        raise HTTPException(status_code=403, detail="แม่แบบเอกสารนี้ถูกปิดใช้งานชั่วคราว")

    safe_key = "".join(ch for ch in (body.preview_key or "") if ch.isalnum() or ch in ("_", "-"))[:24]
    base_name = f"preview_tpl_{safe_key}" if safe_key else f"preview_tpl_{uuid.uuid4().hex[:10]}"
    org_profile = get_effective_org_profile()
    try:
        return render_single_custom_template(tpl, body.data, RENDERED_DIR, base_name, org_profile, convert_pdf=body.convert_pdf)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/custom/{template_id}/save")
def save_custom_template_document(
    template_id: str,
    body: CustomSaveRequest,
    x_user_email: str | None = Header(default=None),
):
    user = resolve_current_user(x_user_email)
    tpl = db.get_document_template(template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="ไม่พบแม่แบบเอกสารที่ระบุ")
    if not tpl.get("is_active") and user.get("role") not in ("saraban_admin", "director"):
        raise HTTPException(status_code=403, detail="แม่แบบเอกสารนี้ถูกปิดใช้งานชั่วคราว")

    doc_id = body.id or str(uuid.uuid4())
    # Derive meaningful subject from user input or first non-empty text field
    first_text = next((str(v).strip() for k, v in (body.data or {}).items() if k != "items" and isinstance(v, (str, int, float)) and str(v).strip()), "")
    subject = (body.subject or "").strip() or (f"{tpl['name']}: {first_text[:80]}" if first_text else tpl["name"])

    org_profile = get_effective_org_profile()
    render_res = render_single_custom_template(tpl, body.data, RENDERED_DIR, f"doc_{doc_id}", org_profile, convert_pdf=True)

    payload = {
        "type": "custom_template",
        "template_id": template_id,
        "template_name": tpl["name"],
        "file_type": tpl["file_type"],
        "division_code": body.division_code or user.get("division_code") or "ฝบ.",
        "subject": subject,
        "data": body.data,
    }
    saved = db.save_document(
        {
            "id": doc_id,
            "doc_type": "custom_template",
            "division_code": payload["division_code"],
            "doc_number": str((body.data or {}).get("doc_number") or ""),
            "is_circular": False,
            "speed_level": "",
            "secrecy_level": "",
            "font_family": render_res.get("font_family", "TH SarabunPSK"),
            "subject": subject,
            "payload_json": payload,
            "status": "draft",
            "docx_path": render_res.get("docx_url", ""),
            "pdf_path": render_res.get("pdf_url", ""),
            "created_by": user["email"],
        }
    )
    saved["page_image_urls"] = render_res.get("page_image_urls", [])
    db.add_audit_log(doc_id, user["email"], "saved_custom_template_doc", {"template_id": template_id, "subject": subject})
    return {"document": saved, "render": render_res}


@router.post("/custom/{template_id}/batch")
async def batch_generate_custom_template(
    template_id: str,
    file: UploadFile = File(...),
    include_pdf: bool = Form(default=False),
    x_user_email: str | None = Header(default=None),
):
    user = resolve_current_user(x_user_email)
    tpl = db.get_document_template(template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="ไม่พบแม่แบบเอกสารที่ระบุ")
    if not tpl.get("is_active") and user.get("role") not in ("saraban_admin", "director"):
        raise HTTPException(status_code=403, detail="แม่แบบเอกสารนี้ถูกปิดใช้งานชั่วคราว")

    content = await file.read()
    if len(content) > MAX_TEMPLATE_BYTES:
        raise HTTPException(status_code=400, detail="ขนาดไฟล์ข้อมูลต้องไม่เกิน 15 MB")

    try:
        rows = parse_batch_rows(content, file.filename or "batch.xlsx", tpl.get("fields_schema_json") or [])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    org_profile = get_effective_org_profile()
    prefix = f"batch_{template_id[:8]}_{uuid.uuid4().hex[:8]}"
    res = generate_batch_mail_merge(tpl, rows, RENDERED_DIR, prefix, org_profile, include_pdf=include_pdf)
    db.add_audit_log(None, user["email"], "custom_template_batch_export", {"template_id": template_id, "rows": res["count"], "include_pdf": include_pdf})
    return res


# ==============================================================================
# Built-in 16 System Templates Management (Admin Only)
# ==============================================================================


@router.get("/system")
def list_admin_system_templates(x_user_email: str | None = Header(default=None)):
    _require_admin(x_user_email)
    return {"templates": list_system_templates()}


@router.get("/system/{key}/download")
def download_system_template(key: str, x_user_email: str | None = Header(default=None)):
    _require_admin(x_user_email)
    try:
        meta = get_system_template_meta(key)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    fpath = resolve_system_template(meta["rel_path"])
    if not fpath.exists():
        raise HTTPException(status_code=404, detail="ไม่พบไฟล์แม่แบบระบบในเครื่อง")
    return FileResponse(path=fpath, filename=Path(meta["rel_path"]).name)


@router.post("/system/{key}/preview")
def preview_system_template(key: str, x_user_email: str | None = Header(default=None)):
    _require_admin(x_user_email)
    try:
        meta = get_system_template_meta(key)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    fpath = resolve_system_template(meta["rel_path"])
    if not fpath.exists():
        raise HTTPException(status_code=404, detail="ไม่พบไฟล์แม่แบบระบบ")

    base_name = f"sys_prev_{key}"
    copy_target = RENDERED_DIR / f"{base_name}.{meta['file_type']}"
    shutil.copy2(fpath, copy_target)

    pdf_name = ""
    pdf_error = ""
    page_urls: list[str] = []
    try:
        if meta["file_type"] == "xlsx":
            pdf_path = _convert_xlsx_to_pdf_dual_pass(copy_target, RENDERED_DIR)
        else:
            pdf_path = convert_office_to_pdf(copy_target, RENDERED_DIR)
        pdf_name = pdf_path.name
        pngs = render_pdf_pages_to_png(pdf_path, RENDERED_DIR, prefix=base_name)
        page_urls = [f"/v1/files/rendered/{p.name}" for p in pngs]
    except Exception as exc:
        pdf_error = str(exc)

    return {
        "key": key,
        "name": meta["name"],
        "file_type": meta["file_type"],
        "docx_url": f"/v1/files/rendered/{copy_target.name}",
        "pdf_url": f"/v1/files/rendered/{pdf_name}" if pdf_name else "",
        "page_image_urls": page_urls,
        "pdf_error": pdf_error,
    }


@router.post("/system/{key}/upload")
async def upload_system_template_override(
    key: str,
    file: UploadFile = File(...),
    x_user_email: str | None = Header(default=None),
):
    admin = _require_admin(x_user_email)
    try:
        get_system_template_meta(key)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    content = await file.read()
    if len(content) > MAX_TEMPLATE_BYTES:
        raise HTTPException(status_code=400, detail="ขนาดไฟล์ต้องไม่เกิน 15 MB")

    try:
        save_system_template_override(key, content, filename=file.filename or "")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    db.add_audit_log(None, admin["email"], "system_template_overridden", {"key": key, "filename": file.filename})
    updated = next((t for t in list_system_templates() if t["key"] == key), None)
    return {"ok": True, "template": updated}


@router.post("/system/{key}/reset")
def reset_system_template(key: str, x_user_email: str | None = Header(default=None)):
    admin = _require_admin(x_user_email)
    try:
        get_system_template_meta(key)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    removed = reset_system_template_override(key)
    db.add_audit_log(None, admin["email"], "system_template_reset", {"key": key, "removed_override": removed})
    updated = next((t for t in list_system_templates() if t["key"] == key), None)
    return {"ok": True, "removed_override": removed, "template": updated}
