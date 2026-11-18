"""Automated API tests for CRIC E-Docx FastAPI backend."""

from __future__ import annotations

import base64
import os
import tempfile
from pathlib import Path

_TEST_TMP = tempfile.TemporaryDirectory()
os.environ["STORAGE_DIR"] = _TEST_TMP.name
os.environ["DATABASE_URL"] = f"sqlite:///{(Path(_TEST_TMP.name) / 'test.db').as_posix()}"

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
HEADERS = {"X-User-Email": "saraban@cric.ac.th"}

# Tiny valid 1x1 transparent PNG
TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_validate_detects_thai_errors_and_clean_passes():
    bad = client.post(
        "/v1/validate",
        headers=HEADERS,
        json={
            "payload": {
                "type": "memo",
                "division_code": "ฝบ.",
                "doc_number": "1/2569",
                "subject": "ขออนุญาติทดสอบระบบ",
                "paragraphs": ["ผลปรากฎว่าบริษัทฯ มีค่าใช้จ่ายอาทิเช่น 100 บาท"],
                "closing_purpose": "จึงเรียนมาเพื่อโปรดพิจารณา",
            }
        },
    )
    assert bad.status_code == 200
    data = bad.json()
    assert data["error_count"] >= 4

    good = client.post(
        "/v1/validate",
        headers=HEADERS,
        json={
            "payload": {
                "type": "memo",
                "division_code": "ฝบ.",
                "doc_number": "1/2569",
                "date": "2026-11-16",
                "subject": "ขออนุญาตทดสอบระบบ",
                "paragraphs": ["ด้วยฝ่ายบริหารทรัพยากร มีความประสงค์ขออนุญาตทดสอบระบบร่างเอกสาร"],
                "closing_purpose": "จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ",
                "signers": [{"name": "นางสาวขนิษฐา สุใจยา", "title": "หัวหน้างานบริหารงานทั่วไป"}],
            }
        },
    )
    assert good.status_code == 200
    assert good.json()["error_count"] == 0


def test_render_both_fonts_all_types():
    samples = [
        {
            "type": "memo",
            "font_family": "TH SarabunIT๙",
            "division_code": "ฝว.",
            "doc_number": "2/2569",
            "date": "2026-11-16",
            "subject": "ขออนุมัติจัดการอบรม",
            "paragraphs": ["ด้วยฝ่ายวิชาการ มีความประสงค์จัดอบรมพัฒนาบุคลากร"],
            "closing_purpose": "จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ",
            "signers": [{"name": "เจ้าหน้าที่ฝ่ายวิชาการ", "title": "หัวหน้างาน"}],
        },
        {
            "type": "external",
            "font_family": "TH Sarabun New",
            "doc_number": "101",
            "is_circular": True,
            "speed": "ด่วนมาก",
            "date": "2026-11-16",
            "subject": "ขอความอนุเคราะห์วิทยากร",
            "to": "ผู้อำนวยการวิทยาลัยเทคนิคเชียงราย",
            "paragraphs": ["ด้วยวิทยาลัยการอาชีพเชียงราย มีความประสงค์ขอความอนุเคราะห์วิทยากร"],
            "closing_purpose": "จึงเรียนมาเพื่อโปรดพิจารณาอนุเคราะห์ด้วย จะเป็นพระคุณ",
        },
    ]
    for payload in samples:
        r = client.post(
            "/v1/render",
            headers=HEADERS,
            json={"payload": payload, "convert_pdf": False, "preview_key": "slot1"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["error_count"] == 0
        assert body["font_family"] == payload["font_family"]
        assert body["docx_filename"] == "preview_slot1.docx"
        dl_inline = client.get(body["docx_url"])
        assert dl_inline.status_code == 200
        assert "inline" in dl_inline.headers.get("content-disposition", "")
        dl_attach = client.get(body["docx_url"] + "?download=1")
        assert dl_attach.status_code == 200
        assert "attachment" in dl_attach.headers.get("content-disposition", "")
        assert len(dl_attach.content) > 5000
        if payload["type"] == "memo":
            import io
            import docx as _docx

            memo_doc = _docx.Document(io.BytesIO(dl_attach.content))
            assert memo_doc.paragraphs[5].text.startswith("เรียน\t")
            assert len(memo_doc.paragraphs[5].paragraph_format.tab_stops) == 1
            assert abs(memo_doc.paragraphs[5].paragraph_format.tab_stops[0].position.cm - 1.35) < 0.05


def test_registry_config_and_full_workflow_with_signature():
    # 1. Sync panel users
    sync_r = client.post("/v1/auth/sync-panel", headers=HEADERS)
    assert sync_r.status_code == 200
    assert sync_r.json()["synced_count"] >= 4

    # 2. Upload director signature PNG
    up_r = client.post(
        "/v1/auth/signature",
        headers={"X-User-Email": "director@cric.ac.th"},
        files={"file": ("director_sig.png", TINY_PNG, "image/png")},
    )
    assert up_r.status_code == 200

    # 3. Configure registry sequence (saraban_admin updates starting number)
    seqs = client.get("/v1/registry/sequences", headers=HEADERS).json()["sequences"]
    memo_seq = next(s for s in seqs if s["registry_key"] == "memo_ฝบ.")
    upd = client.put(
        f"/v1/registry/sequences/{memo_seq['id']}",
        headers=HEADERS,
        json={"last_number": 9},
    )
    assert upd.status_code == 200
    assert upd.json()["sequence"]["last_number"] == 9

    # 4. Save draft -> submit -> director approve & stamp signature -> saraban number
    save_r = client.post(
        "/v1/documents",
        headers={"X-User-Email": "academic@cric.ac.th"},
        json={
            "payload": {
                "type": "memo",
                "division_code": "ฝบ.",
                "date": "2026-11-16",
                "subject": "ขออนุมัติใช้งานระบบร่างเอกสารออนไลน์",
                "paragraphs": ["ด้วยฝ่ายบริหารทรัพยากร มีความประสงค์ขออนุมัติใช้งานระบบร่างเอกสารออนไลน์"],
                "closing_purpose": "จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ",
                "signers": [{"name": "นายยุทธการ ตั้งปัญญาศักดิ์", "title": "ผู้อำนวยการวิทยาลัยการอาชีพเชียงราย"}],
            }
        },
    )
    assert save_r.status_code == 200
    doc_id = save_r.json()["document"]["id"]

    sub_r = client.post(
        f"/v1/documents/{doc_id}/submit",
        headers={"X-User-Email": "academic@cric.ac.th"},
        json={"approver_email": "director@cric.ac.th"},
    )
    assert sub_r.status_code == 200
    assert sub_r.json()["document"]["status"] == "pending_approval"

    app_r = client.post(
        f"/v1/documents/{doc_id}/approve",
        headers={"X-User-Email": "director@cric.ac.th"},
        json={"comment": "อนุมัติ", "stamp_signature": True},
    )
    assert app_r.status_code == 200
    assert app_r.json()["document"]["status"] == "approved"

    num_r = client.post(
        f"/v1/documents/{doc_id}/number",
        headers=HEADERS,
        json={"registry_key": "memo_ฝบ.", "year_be": 2569},
    )
    assert num_r.status_code == 200
    numbered_doc = num_r.json()["document"]
    assert numbered_doc["status"] == "numbered"
    assert "๑๐/๒๕๖๙" in numbered_doc["doc_number"]

    # 5. Export Excel registry
    exp_r = client.get("/v1/registry/export", headers=HEADERS)
    assert exp_r.status_code == 200
    assert len(exp_r.content) > 1000


def test_ai_settings_and_offline_fallback():
    put_r = client.put(
        "/v1/ai/settings",
        headers=HEADERS,
        json={"provider": "local", "model": "llama3.1", "base_url": "http://localhost:11434/v1"},
    )
    assert put_r.status_code == 200
    get_r = client.get("/v1/ai/settings", headers=HEADERS)
    assert get_r.status_code == 200
    assert get_r.json()["provider"] == "local"

    draft_r = client.post(
        "/v1/ai/draft",
        headers=HEADERS,
        json={"doc_type": "memo", "prompt": "จัดอบรม AI สำหรับครู 30 คน", "division_name": "ฝ่ายวิชาการ", "purpose": "ขออนุมัติ"},
    )
    assert draft_r.status_code == 200
    assert "๓๐" in "".join(draft_r.json()["paragraphs"])

    polish_r = client.post(
        "/v1/ai/polish",
        headers=HEADERS,
        json={"paragraphs": ["ขออนุญาติจัดอบรมอาทิเช่น 10 เรื่อง"], "closing_purpose": "จึงเรียนมาเพื่อโปรดพิจารณา"},
    )
    assert polish_r.status_code == 200
    polished = polish_r.json()["paragraphs"][0]
    assert "อนุญาต" in polished and "๑๐" in polished and "อาทิเช่น" not in polished

    # Admin-only toggle off -> blocks AI endpoints with 403 and updates /v1/settings/public
    drafter_hdr = {"X-User-Email": "academic@cric.ac.th"}
    assert client.put("/v1/ai/enabled", headers=drafter_hdr, json={"enabled": False}).status_code == 403

    try:
        off_r = client.put("/v1/ai/enabled", headers=HEADERS, json={"enabled": False})
        assert off_r.status_code == 200 and off_r.json()["enabled"] is False
        assert client.get("/v1/settings/public", headers=drafter_hdr).json()["ai_copilot_enabled"] is False
        assert client.post("/v1/ai/draft", headers=drafter_hdr, json={"doc_type": "memo", "prompt": "test"}).status_code == 403
        assert client.post("/v1/ai/polish", headers=drafter_hdr, json={"paragraphs": ["ทดสอบ"]}).status_code == 403
        assert client.post("/v1/ai/draft-sp", headers=drafter_hdr, json={"project_name": "test"}).status_code == 403
        assert client.post("/v1/ai/draft-teaching", headers=drafter_hdr, json={"mode": "course_plan", "course_name": "test"}).status_code == 403
        assert client.post("/v1/ai/fill-template", headers=drafter_hdr, json={"template_name": "test", "fields_schema": [], "prompt": "test"}).status_code == 403
    finally:
        on_r = client.put("/v1/ai/enabled", headers=HEADERS, json={"enabled": True})
        assert on_r.status_code == 200 and on_r.json()["enabled"] is True
        assert client.get("/v1/settings/public", headers=drafter_hdr).json()["ai_copilot_enabled"] is True


def test_admin_settings_rbac_masking_org_linter_and_users():
    # 1. RBAC: drafter must receive 403 on admin endpoints
    drafter_hdr = {"X-User-Email": "academic@cric.ac.th"}
    assert client.get("/v1/settings/admin", headers=drafter_hdr).status_code == 403
    assert client.get("/v1/settings/public", headers=drafter_hdr).status_code == 200

    # 2. Secret Masking & Preservation
    upd_int = client.put(
        "/v1/settings/integrations",
        headers=HEADERS,
        json={
            "sso_issuer": "https://sso.cric.ac.th",
            "sso_client_id": "cric-edocx-app",
            "sso_client_secret": "super-secret-xyz9",
            "allowed_domain": "cric.ac.th",
            "auth_dev_mode": True,
            "panel_api_url": "https://panel.cric.ac.th/api",
            "panel_api_token": "panel-tok-abc1",
        },
    )
    assert upd_int.status_code == 200
    adm = client.get("/v1/settings/admin", headers=HEADERS).json()
    assert adm["integrations"]["sso_client_secret_info"]["has_secret"] is True
    assert adm["integrations"]["sso_client_secret_info"]["masked_preview"] == "••••xyz9"
    assert "super-secret-xyz9" not in str(adm)

    # Re-save with blank secret -> preserves existing secret
    client.put(
        "/v1/settings/integrations",
        headers=HEADERS,
        json={
            "sso_issuer": "https://sso.cric.ac.th",
            "sso_client_id": "cric-edocx-app",
            "sso_client_secret": "",
            "allowed_domain": "cric.ac.th",
            "auth_dev_mode": True,
            "panel_api_url": "https://panel.cric.ac.th/api",
            "panel_api_token": "",
        },
    )
    adm2 = client.get("/v1/settings/admin", headers=HEADERS).json()
    assert adm2["integrations"]["sso_client_secret_info"]["masked_preview"] == "••••xyz9"

    # 3. Dynamic org_profile update reflected in generated .docx
    from app.db import db
    prev_org = db.get_setting_json("org_profile", {})
    try:
        org_upd = client.put(
            "/v1/settings/org-profile",
            headers=HEADERS,
            json={
                "organization_name": "วิทยาลัยการอาชีพเชียงราย",
                "address_lines": ["324 หมู่ 13 ต.ท่าสาย", "อ.เมือง จ.เชียงราย 57000"],
                "doc_number_prefix": "ศธ 0622.05/",
                "phone_fax": "0 5377 4589",
                "esaraban_name": "วิทยาลัยการอาชีพเชียงราย",
                "email": "saraban@cric.ac.th",
                "director": {"name": "นายทดสอบ ผู้บริหารใหม่", "title": "ผู้อำนวยการวิทยาลัยการอาชีพเชียงราย"},
                "divisions": {
                    "ฝบ.": {"name": "ฝ่ายบริหารทรัพยากร", "deputy_title": "รองผู้อำนวยการฝ่ายบริหารทรัพยากร"},
                    "ฝพ.": {"name": "ฝ่ายพัฒนาพิเศษ", "deputy_title": "รองผู้อำนวยการฝ่ายพัฒนาพิเศษ"},
                },
            },
        )
        assert org_upd.status_code == 200
        pub = client.get("/v1/settings/public", headers=drafter_hdr).json()
        assert "ฝพ." in pub["org_profile"]["divisions"]

        # Render an order and verify new director name appears in generated .docx
        ren = client.post(
            "/v1/render",
            headers=HEADERS,
            json={
                "convert_pdf": False,
                "payload": {
                    "type": "order",
                    "order_number": "1/2569",
                    "subject": "ทดสอบผู้ลงนามใหม่",
                    "paragraphs": ["ด้วยวิทยาลัยการอาชีพเชียงราย มีคำสั่งทดสอบ"],
                    "order_date": "2026-11-16",
                },
            },
        )
        assert ren.status_code == 200
        docx_bytes = client.get(ren.json()["docx_url"]).content
        import io, docx as _docx
        d_obj = _docx.Document(io.BytesIO(docx_bytes))
        full_txt = "\n".join(p.text for p in d_obj.paragraphs)
        assert "นายทดสอบ ผู้บริหารใหม่" in full_txt
    finally:
        db.set_setting("org_profile", prev_org, "test-restore")

    # 4. Custom Linter Rules
    l_upd = client.put(
        "/v1/settings/linter-and-defaults",
        headers=HEADERS,
        json={
            "default_font": "TH Sarabun New",
            "auto_preview_default": True,
            "custom_misspellings": {"เทสผิด": "เทสถูก"},
            "custom_forbidden_phrases": ["คำต้องห้ามเฉพาะ"],
        },
    )
    assert l_upd.status_code == 200
    val_r = client.post(
        "/v1/validate",
        headers=HEADERS,
        json={
            "payload": {
                "type": "memo",
                "division_code": "ฝบ.",
                "doc_number": "1/2569",
                "subject": "ทดสอบคำต้องห้าม",
                "paragraphs": ["ข้อความนี้มีคำว่า เทสผิด และ คำต้องห้ามเฉพาะ อยู่ด้วย"],
                "closing_purpose": "จึงเรียนมาเพื่อโปรดทราบ",
            }
        },
    )
    assert val_r.status_code == 200
    msgs = " | ".join(i["message"] for i in val_r.json()["validation"])
    assert "เทสผิด" in msgs and "คำต้องห้ามเฉพาะ" in msgs

    # 5. User CRUD + Admin Signature + Audit + Diagnostics + Cleanup
    cu = client.post(
        "/v1/auth/users",
        headers=HEADERS,
        json={
            "email": "newstaff@cric.ac.th",
            "full_name": "นางสาวทดสอบ ระบบ",
            "position_title": "เจ้าหน้าที่พัสดุ",
            "division_code": "ฝบ.",
            "role": "unit_head",
        },
    )
    assert cu.status_code == 200
    uu = client.put(
        "/v1/auth/users/newstaff@cric.ac.th",
        headers=HEADERS,
        json={"role": "deputy_director", "is_active": True},
    )
    assert uu.status_code == 200
    assert uu.json()["user"]["role"] == "deputy_director"

    sig_up = client.post(
        "/v1/auth/users/newstaff@cric.ac.th/signature",
        headers=HEADERS,
        files={"file": ("sig.png", TINY_PNG, "image/png")},
    )
    assert sig_up.status_code == 200

    logs = client.get("/v1/settings/audit-logs?q=org_profile", headers=HEADERS)
    assert logs.status_code == 200 and len(logs.json()["logs"]) >= 1

    diag = client.get("/v1/settings/diagnostics", headers=HEADERS)
    assert diag.status_code == 200 and "db_backend" in diag.json()

    cln = client.post("/v1/settings/cleanup-previews", headers=HEADERS)
    assert cln.status_code == 200 and cln.json()["ok"] is True


def test_user_profile_self_update_rbac_and_signature_lifecycle():
    drafter_h = {"X-User-Email": "drafter1@cric.ac.th"}

    # 1. Self-update profile fields cleanly + ensure role/is_active cannot be escalated
    upd = client.put(
        "/v1/auth/me",
        headers=drafter_h,
        json={
            "full_name": "นายทดสอบ โปรไฟล์",
            "position_title": "ครู คศ.1",
            "division_code": "ฝว.",
            "unit_name": "แผนกวิชาช่างไฟฟ้ากำลัง",
            "phone": "053-711-000",
            "default_reviewer_email": "orawan@cric.ac.th",
            "role": "director",
            "is_active": False,
        },
    )
    assert upd.status_code == 200
    prof = upd.json()["user"]
    assert prof["full_name"] == "นายทดสอบ โปรไฟล์"
    assert prof["position_title"] == "ครู คศ.1"
    assert prof["division_code"] == "ฝว."
    assert prof["unit_name"] == "แผนกวิชาช่างไฟฟ้ากำลัง"
    assert prof["phone"] == "053-711-000"
    assert prof["default_reviewer_email"] == "orawan@cric.ac.th"
    assert prof["role"] == "drafter"
    assert prof["is_active"] in (True, 1)

    # 2. Empty full_name rejected with 400
    bad = client.put("/v1/auth/me", headers=drafter_h, json={"full_name": "   "})
    assert bad.status_code == 400

    # 3. Signature lifecycle: missing -> 404 -> upload -> GET 200 PNG -> DELETE -> 404
    miss = client.get("/v1/auth/me/signature", headers=drafter_h)
    assert miss.status_code == 404

    up = client.post(
        "/v1/auth/signature",
        headers=drafter_h,
        files={"file": ("my_sig.png", TINY_PNG, "image/png")},
    )
    assert up.status_code == 200

    got = client.get("/v1/auth/me/signature", headers=drafter_h)
    assert got.status_code == 200
    assert got.content.startswith(b"\x89PNG")

    rem = client.delete("/v1/auth/signature", headers=drafter_h)
    assert rem.status_code == 200 and rem.json()["ok"] is True

    after_del = client.get("/v1/auth/me/signature", headers=drafter_h)
    assert after_del.status_code == 404


def test_dashboard_summary_role_queues_and_counts():
    academic_h = {"X-User-Email": "academic@cric.ac.th"}
    orawan_h = {"X-User-Email": "orawan@cric.ac.th"}
    saraban_h = {"X-User-Email": "saraban@cric.ac.th"}

    # Save & submit a memo assigned to orawan@cric.ac.th
    save_r = client.post(
        "/v1/documents",
        headers=academic_h,
        json={
            "payload": {
                "type": "memo",
                "division_code": "ฝว.",
                "date": "2026-11-17",
                "subject": "ทดสอบคิวงานแดชบอร์ด",
                "paragraphs": ["ด้วยฝ่ายวิชาการ ขอทดสอบการแสดงผลคิวงานในหน้าแดชบอร์ด"],
                "closing_purpose": "จึงเรียนมาเพื่อโปรดพิจารณา",
                "signers": [{"name": "เจ้าหน้าที่ฝ่ายวิชาการ", "title": "หัวหน้างาน"}],
            }
        },
    )
    assert save_r.status_code == 200
    doc_id = save_r.json()["document"]["id"]

    # While still draft -> academic sees it in my_drafts_or_revisions
    dash_acad_draft = client.get("/v1/dashboard", headers=academic_h)
    assert dash_acad_draft.status_code == 200
    acad_draft_ids = [d["id"] for d in dash_acad_draft.json()["action_queue"]["my_drafts_or_revisions"]]
    assert doc_id in acad_draft_ids

    # Submit to orawan -> orawan sees it in waiting_my_action
    sub_r = client.post(
        f"/v1/documents/{doc_id}/submit",
        headers=academic_h,
        json={"reviewer_email": "orawan@cric.ac.th", "approver_email": "director@cric.ac.th"},
    )
    assert sub_r.status_code == 200

    dash_orawan = client.get("/v1/dashboard", headers=orawan_h)
    assert dash_orawan.status_code == 200
    orawan_body = dash_orawan.json()
    assert doc_id in [d["id"] for d in orawan_body["action_queue"]["waiting_my_action"]]
    assert orawan_body["counts"]["total"] >= 1
    assert len(orawan_body["sequences"]) >= 1
    assert "next_formatted" in orawan_body["sequences"][0]

    # Step 1: Orawan approves -> moves to pending_approval & visible to director
    step1_r = client.post(
        f"/v1/documents/{doc_id}/approve",
        headers=orawan_h,
        json={"comment": "ผ่านการตรวจ", "stamp_signature": False},
    )
    assert step1_r.status_code == 200
    dash_dir = client.get("/v1/dashboard", headers={"X-User-Email": "director@cric.ac.th"})
    assert dash_dir.status_code == 200
    assert doc_id in [d["id"] for d in dash_dir.json()["action_queue"]["waiting_my_action"]]

    # Step 2: Director approves -> becomes approved & saraban sees it in waiting_numbering
    app_r = client.post(
        f"/v1/documents/{doc_id}/approve",
        headers={"X-User-Email": "director@cric.ac.th"},
        json={"comment": "อนุมัติ", "stamp_signature": False},
    )
    assert app_r.status_code == 200
    dash_saraban = client.get("/v1/dashboard", headers=saraban_h)
    assert dash_saraban.status_code == 200
    assert doc_id in [d["id"] for d in dash_saraban.json()["action_queue"]["waiting_numbering"]]


def test_notifications_workflow_crud_and_sse():
    academic_h = {"X-User-Email": "academic@cric.ac.th"}
    orawan_h = {"X-User-Email": "orawan@cric.ac.th"}
    saraban_h = {"X-User-Email": "saraban@cric.ac.th"}

    # 1. Create and submit doc -> orawan gets 'submitted' notification
    s = client.post(
        "/v1/documents",
        headers=academic_h,
        json={
            "payload": {
                "type": "memo",
                "division_code": "ฝว.",
                "date": "2026-11-17",
                "subject": "ทดสอบระบบแจ้งเตือน",
                "paragraphs": ["ด้วยฝ่ายวิชาการ ขอทดสอบการส่งแจ้งเตือนเรียลไทม์"],
                "closing_purpose": "จึงเรียนมาเพื่อโปรดพิจารณา",
                "signers": [{"name": "เจ้าหน้าที่ฝ่ายวิชาการ", "title": "หัวหน้างาน"}],
            }
        },
    )
    assert s.status_code == 200
    doc_id = s.json()["document"]["id"]

    sub = client.post(
        f"/v1/documents/{doc_id}/submit",
        headers=academic_h,
        json={"reviewer_email": "orawan@cric.ac.th", "approver_email": "director@cric.ac.th"},
    )
    assert sub.status_code == 200

    n_orawan = client.get("/v1/notifications?unread_only=true", headers=orawan_h)
    assert n_orawan.status_code == 200
    orawan_items = n_orawan.json()["notifications"]
    assert any(item["document_id"] == doc_id and item["event_type"] == "submitted" for item in orawan_items)
    first_notif_id = orawan_items[0]["id"]

    # 2. Mark single read + SSE stream snapshot test
    mr = client.post(f"/v1/notifications/{first_notif_id}/read", headers=orawan_h)
    assert mr.status_code == 200 and mr.json()["ok"] is True

    sse_r = client.get("/v1/notifications/stream?once=true", headers=orawan_h)
    assert sse_r.status_code == 200
    assert sse_r.headers["content-type"].startswith("text/event-stream")
    assert "event: snapshot" in sse_r.text

    # 3. Return doc -> academic gets 'returned' notification -> mark all read -> delete
    ret = client.post(f"/v1/documents/{doc_id}/return", headers=orawan_h, json={"comment": "แก้ไขวันที่"})
    assert ret.status_code == 200
    n_acad = client.get("/v1/notifications", headers=academic_h)
    assert n_acad.status_code == 200
    acad_items = n_acad.json()["notifications"]
    returned_notif = next((i for i in acad_items if i["document_id"] == doc_id and i["event_type"] == "returned"), None)
    assert returned_notif is not None
    assert "แก้ไขวันที่" in returned_notif["message"]

    ra = client.post("/v1/notifications/read-all", headers=academic_h)
    assert ra.status_code == 200 and ra.json()["unread_count"] == 0

    dl = client.delete(f"/v1/notifications/{returned_notif['id']}", headers=academic_h)
    assert dl.status_code == 200 and dl.json()["ok"] is True

    # 4. Resubmit & approve both steps -> saraban gets 'approved' ready-for-numbering notification
    client.post(f"/v1/documents/{doc_id}/submit", headers=academic_h, json={"reviewer_email": None, "approver_email": "director@cric.ac.th"})
    client.post(f"/v1/documents/{doc_id}/approve", headers={"X-User-Email": "director@cric.ac.th"}, json={"comment": "อนุมัติ", "stamp_signature": False})
    n_saraban = client.get("/v1/notifications", headers=saraban_h)
    assert any(i["document_id"] == doc_id and i["event_type"] == "approved" for i in n_saraban.json()["notifications"])
