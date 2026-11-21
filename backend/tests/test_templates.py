from __future__ import annotations

import io
import os
import struct
import tempfile
import zipfile
import zlib
from pathlib import Path

import docx
import openpyxl
from fastapi.testclient import TestClient

os.environ["DATABASE_URL"] = f"sqlite:///{(Path(tempfile.gettempdir()) / 'cric_edocx_templates_test.db').as_posix()}"

from app.config import CUSTOM_TEMPLATES_DIR, RENDERED_DIR  # noqa: E402
from app.engine.mail_merge_engine import scan_template_placeholders  # noqa: E402
from app.engine.template_resolver import override_path_for, reset_system_template_override  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)


def _make_split_run_docx_bytes() -> bytes:
    """Create a .docx where placeholders are deliberately split across multiple XML runs."""
    doc = docx.Document()
    hdr_p = doc.sections[0].header.paragraphs[0]
    hdr_p.text = "หัวกระดาษ {{org_name}}"

    # Deliberately split {{ชื่อเรื่อง}} and {{วันที่}} across runs
    p1 = doc.add_paragraph()
    p1.add_run("เรื่อง {{ชื่อ")
    p1.add_run("เรื่อง}} ลงวันที่ {{")
    p1.add_run("วันที่}}")

    p2 = doc.add_paragraph("งบประมาณ {{budget}} บาท ({{budget_bahttext}})")
    p3 = doc.add_paragraph("ภาพประกอบ: {{img:photo}}")

    tbl = doc.add_table(rows=2, cols=3)
    tbl.cell(0, 0).text = "ลำดับ"
    tbl.cell(0, 1).text = "รายการ"
    tbl.cell(0, 2).text = "จำนวน"
    tbl.cell(1, 0).text = "{{items.idx}}"
    tbl.cell(1, 1).text = "{{items.ชื่อรายการ}}"
    tbl.cell(1, 2).text = "{{items.qty}}"

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _make_sample_xlsx_bytes() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "ใบรายการ"
    ws["A1"] = "หน่วยงาน: {{org_name}}"
    ws["A2"] = "โครงการ {{project_title}}"
    ws["A3"] = "ลำดับ"
    ws["B3"] = "รายการ"
    ws["C3"] = "จำนวนเงิน"
    ws["A4"] = "{{items.idx}}"
    ws["B4"] = "{{items.detail}}"
    ws["C4"] = "{{items.cost}}"
    ws["A5"] = "รวมงบ {{amount}} ({{amount_bahttext}})"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _make_png_bytes() -> bytes:
    """Create a valid minimal 4x4 RGB PNG without requiring Pillow."""
    w, h = 4, 4
    raw = b"".join(b"\x00" + b"\x1e\x40\xaf" * w for _ in range(h))

    def _chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + _chunk(b"IDAT", zlib.compress(raw))
        + _chunk(b"IEND", b"")
    )


def test_custom_template_lifecycle_rbac_mail_merge_batch_and_workflow():
    admin_hdr = {"X-User-Email": "saraban@cric.ac.th"}
    drafter_hdr = {"X-User-Email": "academic@cric.ac.th"}

    # Initially empty custom template list
    res_list = client.get("/v1/templates/custom", headers=drafter_hdr)
    assert res_list.status_code == 200

    # Drafter (403) cannot create custom templates or manage system templates
    docx_bytes = _make_split_run_docx_bytes()
    res_forbidden = client.post(
        "/v1/templates/custom",
        headers=drafter_hdr,
        data={"name": "ไม่อนุญาต"},
        files={"file": ("test.docx", docx_bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert res_forbidden.status_code == 403
    assert client.get("/v1/templates/system", headers=drafter_hdr).status_code == 403

    # Admin creates custom .docx template with auto-scanned split-run placeholders
    res_create = client.post(
        "/v1/templates/custom",
        headers=admin_hdr,
        data={"name": "แบบฟอร์มขออนุมัติวัสดุทดสอบ", "category": "พัสดุ", "description": "ทดสอบสแกน"},
        files={"file": ("test_split.docx", docx_bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert res_create.status_code == 200, res_create.text
    tpl = res_create.json()["template"]
    tpl_id = tpl["id"]
    schema = tpl["fields_schema_json"]
    keys = [f["key"] for f in schema]

    assert "ชื่อเรื่อง" in keys
    assert "วันที่" in keys
    assert "budget" in keys
    assert "budget_bahttext" not in keys  # computed automatically, no duplicate input
    assert "org_name" not in keys  # system variable auto-filled
    assert "img:photo" in keys
    assert any(f["group"] == "items" and f["key"] == "ชื่อรายการ" for f in schema)

    # Upload an image for {{img:photo}}
    res_img = client.post(
        f"/v1/templates/custom/{tpl_id}/upload-image",
        headers=drafter_hdr,
        files={"file": ("sample.png", _make_png_bytes(), "image/png")},
    )
    assert res_img.status_code == 200
    img_filename = res_img.json()["filename"]

    # AI Autofill offline fallback
    res_ai = client.post(
        "/v1/ai/fill-template",
        headers=drafter_hdr,
        json={
            "template_id": tpl_id,
            "template_name": tpl["name"],
            "fields_schema": schema,
            "prompt": "จัดซื้อหมึกพิมพ์สีดำและกระดาษ A4",
        },
    )
    assert res_ai.status_code == 200
    assert isinstance(res_ai.json().get("fields"), dict)

    # Render single document by drafter (convert_pdf=False for fast unit test determinism)
    render_payload = {
        "data": {
            "ชื่อเรื่อง": "ขออนุมัติจัดซื้ออุปกรณ์สำนักงาน",
            "วันที่": "2026-11-17",
            "budget": 2500,
            "img:photo": img_filename,
            "items": [
                {"ชื่อรายการ": "กระดาษ A4", "qty": 10},
                {"ชื่อรายการ": "หมึกพิมพ์", "qty": 2},
                {"ชื่อรายการ": "แฟ้มเอกสาร", "qty": 15},
            ],
        },
        "convert_pdf": False,
        "preview_key": "unit_test_tpl",
    }
    res_render = client.post(f"/v1/templates/custom/{tpl_id}/render", headers=drafter_hdr, json=render_payload)
    assert res_render.status_code == 200, res_render.text
    out_docx_name = res_render.json()["docx_filename"]
    out_doc = docx.Document(str(RENDERED_DIR / out_docx_name))
    full_txt = "\n".join(p.text for p in out_doc.paragraphs)
    hdr_txt = out_doc.sections[0].header.paragraphs[0].text

    assert "ขออนุมัติจัดซื้ออุปกรณ์สำนักงาน" in full_txt
    assert "วิทยาลัยการอาชีพเชียงราย" in hdr_txt
    assert "สองพันห้าร้อยบาทถ้วน" in full_txt
    # Check 3 cloned item rows + 1 header row = 4 rows, including auto items.idx
    assert len(out_doc.tables[0].rows) == 4
    assert out_doc.tables[0].cell(1, 0).text == "1"
    assert out_doc.tables[0].cell(3, 0).text == "3"
    assert out_doc.tables[0].cell(3, 1).text == "แฟ้มเอกสาร"
    # Check embedded picture in document inline shapes
    assert len(out_doc.inline_shapes) >= 1

    # Batch Sample download + Batch Mail-Merge 3 rows -> .ZIP
    res_sample = client.get(f"/v1/templates/custom/{tpl_id}/batch-sample.xlsx", headers=drafter_hdr)
    assert res_sample.status_code == 200
    wb_sample = openpyxl.load_workbook(io.BytesIO(res_sample.content))
    ws_s = wb_sample.active
    headers = [ws_s.cell(row=1, column=c).value for c in range(1, ws_s.max_column + 1)]
    assert "ชื่อเรื่อง" in headers

    # Build 3 rows Excel for batch
    wb_batch = openpyxl.Workbook()
    ws_b = wb_batch.active
    ws_b.append(["ชื่อเรื่อง", "วันที่", "budget"])
    ws_b.append(["เอกสารชุดที่ 1", "2026-11-17", 1000])
    ws_b.append(["เอกสารชุดที่ 2", "2026-11-18", 2000])
    ws_b.append(["เอกสารชุดที่ 3", "2026-11-19", 3000])
    batch_buf = io.BytesIO()
    wb_batch.save(batch_buf)

    res_batch = client.post(
        f"/v1/templates/custom/{tpl_id}/batch",
        headers=drafter_hdr,
        data={"include_pdf": "false"},
        files={"file": ("batch_3rows.xlsx", batch_buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert res_batch.status_code == 200, res_batch.text
    assert res_batch.json()["count"] == 3
    zip_file = RENDERED_DIR / res_batch.json()["zip_filename"]
    assert zip_file.exists()
    with zipfile.ZipFile(zip_file, "r") as zf:
        names = zf.namelist()
        assert len(names) == 3
        first_doc = docx.Document(io.BytesIO(zf.read(names[0])))
        assert "เอกสารชุดที่ 1" in "\n".join(p.text for p in first_doc.paragraphs)

    # Save & submit custom template document to approval + Saraban numbering workflow
    res_save = client.post(
        f"/v1/templates/custom/{tpl_id}/save",
        headers=drafter_hdr,
        json={"division_code": "ฝว.", "subject": "ขอจัดซื้อจาก Custom Template", "data": render_payload["data"]},
    )
    assert res_save.status_code == 200, res_save.text
    doc_id = res_save.json()["document"]["id"]
    assert res_save.json()["document"]["doc_type"] == "custom_template"

    assert client.post(
        f"/v1/documents/{doc_id}/submit",
        headers=drafter_hdr,
        json={"approver_email": "director@cric.ac.th"},
    ).status_code == 200
    assert client.post(
        f"/v1/documents/{doc_id}/approve",
        headers={"X-User-Email": "director@cric.ac.th"},
        json={"comment": "อนุมัติ", "stamp_signature": False},
    ).status_code == 200
    res_num = client.post(f"/v1/documents/{doc_id}/number", headers=admin_hdr, json={})
    assert res_num.status_code == 200, res_num.text
    assert res_num.json()["document"]["status"] == "numbered"

    # Cleanup custom template
    res_del = client.delete(f"/v1/templates/custom/{tpl_id}", headers=admin_hdr)
    assert res_del.status_code == 200
    assert not (CUSTOM_TEMPLATES_DIR / tpl["storage_filename"]).exists()


def test_xlsx_custom_template_mail_merge():
    admin_hdr = {"X-User-Email": "saraban@cric.ac.th"}
    xlsx_bytes = _make_sample_xlsx_bytes()
    res_create = client.post(
        "/v1/templates/custom",
        headers=admin_hdr,
        data={"name": "ตารางงบประมาณทดสอบ", "category": "การเงิน"},
        files={"file": ("budget.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert res_create.status_code == 200
    tpl = res_create.json()["template"]
    tpl_id = tpl["id"]
    try:
        res_render = client.post(
            f"/v1/templates/custom/{tpl_id}/render",
            headers=admin_hdr,
            json={
                "data": {
                    "project_title": "โครงการอบรม AI",
                    "amount": 3500,
                    "items": [
                        {"detail": "ค่าวิทยากร", "cost": 2000},
                        {"detail": "ค่าเอกสาร", "cost": 1500},
                    ],
                },
                "convert_pdf": False,
            },
        )
        assert res_render.status_code == 200, res_render.text
        out_wb = openpyxl.load_workbook(RENDERED_DIR / res_render.json()["docx_filename"])
        ws = out_wb.active
        assert "โครงการอบรม AI" in str(ws["A2"].value)
        assert ws["B4"].value == "ค่าวิทยากร"
        assert ws["B5"].value == "ค่าเอกสาร"
        assert ws["C5"].value == 1500
        assert "สามพันห้าร้อยบาทถ้วน" in str(ws["A6"].value)
        assert ws.sheet_properties.pageSetUpPr.fitToPage is True
    finally:
        client.delete(f"/v1/templates/custom/{tpl_id}", headers=admin_hdr)


def test_system_templates_catalog_validation_override_and_reset():
    admin_hdr = {"X-User-Email": "saraban@cric.ac.th"}
    res = client.get("/v1/templates/system", headers=admin_hdr)
    assert res.status_code == 200
    items = res.json()["templates"]
    assert len(items) == 18
    keys = {i["key"] for i in items}
    assert "repair_request" in keys
    assert "sp_3b_material_plan" in keys

    # Reject invalid structure: upload empty docx (0 tables) into sp_2_sp1_purchase (requires min_tables=1)
    bad_doc = docx.Document()
    bad_doc.add_paragraph("ไม่มีตาราง")
    bad_buf = io.BytesIO()
    bad_doc.save(bad_buf)
    res_bad = client.post(
        "/v1/templates/system/sp_2_sp1_purchase/upload",
        headers=admin_hdr,
        files={"file": ("bad.docx", bad_buf.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert res_bad.status_code == 400

    # Valid override on 'memo', verify override file created, then reset cleanly
    good_doc = docx.Document()
    good_doc.add_paragraph("บันทึกข้อความปรับแต่ง")
    good_buf = io.BytesIO()
    good_doc.save(good_buf)
    try:
        res_ok = client.post(
            "/v1/templates/system/memo/upload",
            headers=admin_hdr,
            files={"file": ("memo_custom.docx", good_buf.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        )
        assert res_ok.status_code == 200
        assert res_ok.json()["template"]["is_overridden"] is True
        assert override_path_for("memo.docx").exists()

        res_dl = client.get("/v1/templates/system/memo/download", headers=admin_hdr)
        assert res_dl.status_code == 200
        dl_doc = docx.Document(io.BytesIO(res_dl.content))
        assert "บันทึกข้อความปรับแต่ง" in dl_doc.paragraphs[0].text
    finally:
        res_reset = client.post("/v1/templates/system/memo/reset", headers=admin_hdr)
        assert res_reset.status_code == 200
        assert res_reset.json()["template"]["is_overridden"] is False
        assert not override_path_for("memo.docx").exists()
