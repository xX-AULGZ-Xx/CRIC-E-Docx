from __future__ import annotations

import os
import tempfile
import zipfile
from pathlib import Path

import docx
import openpyxl
from fastapi.testclient import TestClient

os.environ["DATABASE_URL"] = f"sqlite:///{(Path(tempfile.gettempdir()) / 'cric_edocx_bundles_test.db').as_posix()}"

from app.config import RENDERED_DIR  # noqa: E402
from app.engine.sp_engine import _create_xlsx_preview_copy  # noqa: E402
from app.engine.thai_baht import baht_text  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)


def test_baht_text_conversion():
    assert baht_text(0) == "ศูนย์บาทถ้วน"
    assert baht_text(1600) == "หนึ่งพันหกร้อยบาทถ้วน"
    assert baht_text(21) == "ยี่สิบเอ็ดบาทถ้วน"
    assert baht_text(101.25) == "หนึ่งร้อยเอ็ดบาทยี่สิบห้าสตางค์"


def test_sp_bundle_render_formulas_zip_and_workflow():
    payload = {
        "project_name": "จัดซื้อวัสดุฝึกปฏิบัติการเขียนโปรแกรม",
        "doc_number": "ฝว. 99/2569",
        "budget_year_be": 2570,
        "department_name": "แผนกวิชาเทคโนโลยีสารสนเทศ",
        "division_name": "ฝ่ายวิชาการ",
        "level_label": "ปวช.2",
        "student_count": 20,
        "semester_label": "2/2569",
        "doc_date": "2026-11-16",
        "start_date": "2026-11-20",
        "end_date": "2027-02-20",
        "sp1_subject": "ขออนุมัติจัดซื้อวัสดุฝึกปฏิบัติการเฉพาะทาง",
        "expense_category": "service",
        "expense_label": "ค่าจ้างเหมาปฏิบัติการ",
        "change_flags": {
            "additional": True,
            "modify_budget": True,
            "other": True,
            "other_text": "ปรับแผนเร่งด่วน",
        },
        "old_budget": "2,500",
        "new_budget": "3,150",
        "requester_name": "นายสมชาย ใจดี",
        "dept_head_name": "นางสาววิไล พัฒนา",
        "deputy_name": "นางสาวอรวรรณ แสงดาว",
        "deputy_title": "รองผู้อำนวยการฝ่ายวิชาการ (รักษาการ)",
        "tor_chair_name": "นายประธาน ร่างทีโออาร์",
        "include_urgent_po": True,
        "items": [
            {"name": "สายสัญญาณ UTP Cat6", "spec": "ยาว 100 เมตร", "qty": 2, "unit": "กล่อง", "unit_price": 1200, "note": ""},
            {"name": "หัว RJ45", "spec": "แพ็ค 10 ชิ้น", "qty": 5, "unit": "แพ็ค", "unit_price": 150, "note": ""},
        ],
    }

    r = client.post(
        "/v1/bundles/sp/render",
        headers={"X-User-Email": "academic@cric.ac.th"},
        json={"payload": payload, "convert_pdf": False, "preview_key": "testsp"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["grand_total"] == 3150.0
    assert data["grand_total_thai_text"] == "สามพันหนึ่งร้อยห้าสิบบาทถ้วน"
    assert len(data["bundle_files"]) == 5

    # Verify 1_approval_memo.docx keeps bold 20pt ONLY on labels and 16pt regular on values
    approval_file = RENDERED_DIR / data["bundle_files"][0]["filename"]
    assert approval_file.exists()
    doc_approval = docx.Document(approval_file)
    for p_idx in (2, 3, 4):
        runs = [r for r in doc_approval.paragraphs[p_idx].runs if r.text]
        assert runs[0].bold is True and runs[0].font.size.pt == 20.0
        assert runs[-1].bold is False and runs[-1].font.size.pt == 16.0
    approval_txt = "\n".join(p.text for p in doc_approval.paragraphs)
    assert "๙๙/๒๕๖๙" in approval_txt
    assert "☑ เพิ่มเติมโครงการ/กิจกรรม" in approval_txt
    assert "งบประมาณเดิม ๒,๕๐๐ บาท" in approval_txt
    assert "ค่าจ้างเหมาปฏิบัติการ" in approval_txt
    assert "รองผู้อำนวยการฝ่ายวิชาการ (รักษาการ)" in approval_txt

    # Verify 2-ใบสผ1.docx preserves template P03, checkboxes, Box 1-7 signers, and R30 decimal summary
    sp1_file = RENDERED_DIR / data["bundle_files"][1]["filename"]
    assert sp1_file.exists()
    doc_sp1 = docx.Document(sp1_file)
    assert "วันที่" not in doc_sp1.paragraphs[3].text
    assert "☑" in doc_sp1.paragraphs[6].text
    t0_left = doc_sp1.tables[0].rows[0].cells[0].text
    t0_right = doc_sp1.tables[0].rows[0].cells[1].text
    assert "นางสาววิไล พัฒนา" in t0_left
    assert "✓" in t0_left and "วิชาการ" in t0_left
    assert "☑" in t0_right and "เฉพาะเจาะจง" in t0_right
    r30_left = doc_sp1.tables[1].rows[-1].cells[0].text
    r30_total = doc_sp1.tables[1].rows[-1].cells[5].text
    assert "รวมเงิน" in r30_left
    assert "๓,๑๕๐.๐๐" in r30_total
    assert doc_sp1.paragraphs[12].paragraph_format.page_break_before is True
    assert len(doc_sp1.paragraphs) == 16

    # Verify generated .xlsx preserves formulas & ZIP download works
    plan_file = RENDERED_DIR / data["bundle_files"][2]["filename"]
    tor_file = RENDERED_DIR / data["bundle_files"][3]["filename"]
    assert plan_file.exists() and tor_file.exists()

    wb_plan = openpyxl.load_workbook(plan_file, data_only=False)
    ws_plan = wb_plan.active
    assert ws_plan["C24"].value == "สายสัญญาณ UTP Cat6"
    assert ws_plan["T24"].value == "=Q24*L24"
    assert ws_plan["C70"].value == "=BAHTTEXT(T70)"
    assert ws_plan.sheet_properties.pageSetUpPr.fitToPage is True
    assert ws_plan.page_setup.fitToWidth == 1
    assert ws_plan.page_setup.fitToHeight == 1
    assert "$A$1:$W$40" in str(ws_plan.print_area)

    wb_tor = openpyxl.load_workbook(tor_file, data_only=False)
    ws_tor = wb_tor.active
    assert ws_tor["B22"].value == "สายสัญญาณ UTP Cat6"
    assert ws_tor["B23"].value == "หัว RJ45"
    assert ws_tor["G24"].value == "=SUM(G22:G23)"
    assert ws_tor["C24"].value == "=BAHTTEXT(G24)"
    assert ws_tor.sheet_properties.pageSetUpPr.fitToPage is True
    assert ws_tor.page_setup.fitToWidth == 1
    assert ws_tor.page_setup.fitToHeight == 2
    assert "$A$1:$H$77" in str(ws_tor.print_area)
    assert ws_tor["A22"].font.color.rgb.endswith("000000")

    # Verify Dual-Pass preview copies eliminate =BAHTTEXT (no #NAME? in LibreOffice Calc) & use Thai numerals
    computed_items = [
        {"idx": 1, "name": "สายสัญญาณ UTP Cat6", "spec": "ยาว 100 เมตร", "qty": 2, "unit": "กล่อง", "unit_price": 1200, "line_total": 2400.0, "note": ""},
        {"idx": 2, "name": "หัว RJ45", "spec": "แพ็ค 10 ชิ้น", "qty": 5, "unit": "แพ็ค", "unit_price": 150, "line_total": 750.0, "note": ""},
    ]
    pv_plan = _create_xlsx_preview_copy(plan_file, "plan", computed_items, 3150.0)
    pv_tor = _create_xlsx_preview_copy(tor_file, "tor", computed_items, 3150.0)
    try:
        ws_pvp = openpyxl.load_workbook(pv_plan).active
        assert ws_pvp["C40"].value == "สามพันหนึ่งร้อยห้าสิบบาทถ้วน"
        assert ws_pvp["T24"].value == "๒,๔๐๐.๐๐"
        ws_pvt = openpyxl.load_workbook(pv_tor).active
        assert ws_pvt["C24"].value == "สามพันหนึ่งร้อยห้าสิบบาทถ้วน"
        assert ws_pvt["G24"].value == "๓,๑๕๐"
    finally:
        pv_plan.unlink(missing_ok=True)
        pv_tor.unlink(missing_ok=True)

    zip_resp = client.get(data["zip_url"] + "?download=1")
    assert zip_resp.status_code == 200
    assert "application/zip" in zip_resp.headers["content-type"]
    zpath = RENDERED_DIR / data["zip_filename"]
    with zipfile.ZipFile(zpath, "r") as zf:
        assert len(zf.namelist()) == 5

    # Save & submit SP bundle to /approvals (PDF+Calc rendering tested directly in Docker)
    s_res = client.post(
        "/v1/bundles/sp/save",
        headers={"X-User-Email": "academic@cric.ac.th"},
        json={"division_code": "ฝว.", "payload": payload, "convert_pdf": False},
    )
    assert s_res.status_code == 200
    doc_id = s_res.json()["document"]["id"]

    sub_res = client.post(
        f"/v1/bundles/{doc_id}/submit",
        headers={"X-User-Email": "academic@cric.ac.th"},
        json={"reviewer_email": "orawan@cric.ac.th", "approver_email": "director@cric.ac.th"},
    )
    assert sub_res.status_code == 200
    assert sub_res.json()["document"]["status"] == "pending_review"


def test_courses_teaching_4_modes_and_photo_upload():
    # Starts clean (no seeded personal courses unless created by test)
    c_create = client.post(
        "/v1/courses",
        headers={"X-User-Email": "academic@cric.ac.th"},
        json={
            "course_code": "21910-9999",
            "course_name": "วิชาระบบอัตโนมัติทดสอบ",
            "curriculum_level": "ปวช.2",
            "credits": "1-3-2",
            "objectives": ["เข้าใจหลักการพื้นฐาน"],
            "standards": ["ปฏิบัติงานได้ถูกต้อง"],
            "description": "ศึกษาและปฏิบัติเกี่ยวกับระบบอัตโนมัติ",
            "weekly_plan": [
                {
                    "week": 1,
                    "topic": "ความรู้เบื้องต้น",
                    "activities": "บรรยายและฝึกปฏิบัติ",
                    "media": "สไลด์",
                    "evaluation": "ใบงานที่ 1",
                    "competency": "อธิบายโครงสร้างได้",
                    "theory_hours": 1,
                    "practice_hours": 3,
                }
            ],
            "morals": ["มีวินัยและความรับผิดชอบ"],
            "indicators": ["ผ่านเกณฑ์ร้อยละ 80"],
        },
    )
    assert c_create.status_code == 200
    course = c_create.json()["course"]
    course_id = course["id"]
    assert course.get("indicators") == ["ผ่านเกณฑ์ร้อยละ 80"]

    import io, docx as _docx

    # 1. Course syllabus (2-col metadata table, non-colliding middle sections, zero networking leftovers, 4-pos approval block)
    r1 = client.post(
        "/v1/bundles/teaching/render",
        headers={"X-User-Email": "academic@cric.ac.th"},
        json={"doc_type": "course_syllabus", "convert_pdf": False, "payload": course},
    )
    assert r1.status_code == 200 and len(r1.json()["bundle_files"]) == 1
    d1 = _docx.Document(io.BytesIO(client.get(r1.json()["bundle_files"][0]["file_url"]).content))
    assert d1.sections[0].right_margin.cm >= 1.4
    d1_para_txt = "\n".join(p.text for p in d1.paragraphs)
    d1_all_txt = d1_para_txt + "\n".join(c.text for t in d1.tables for row in t.rows for c in row.cells)
    for required_heading in ("ตัวชี้วัด", "เกณฑ์การให้คะแนน", "วิธีการสอน", "เกณฑ์การประเมินผล", "การมอบหมายงาน", "การตรวจสอบและอนุมัติกำหนดการสอน"):
        assert required_heading in d1_para_txt
    assert "ผ่านเกณฑ์ร้อยละ 80" in d1_para_txt
    assert "Course Syllabus)Course Syllabus" not in d1_para_txt
    assert "ผู้จัดทำกำหนดการสอน" in d1_all_txt
    assert "Cisco Packet Tracer" not in d1_all_txt and "TIA/EIA" not in d1_all_txt and "ช่างเทคนิคเครือข่าย" not in d1_all_txt
    assert len(d1.tables) >= 4  # meta_tbl + grade_tbl + weekly_tbl + approval_tbl

    # 2. Lesson plan (true A4 + no stale Cisco networking defaults + structured weekly table + approval block)
    r2 = client.post(
        "/v1/bundles/teaching/render",
        headers={"X-User-Email": "academic@cric.ac.th"},
        json={"doc_type": "lesson_plan", "convert_pdf": False, "payload": course},
    )
    assert r2.status_code == 200 and len(r2.json()["bundle_files"]) == 1
    d2 = _docx.Document(io.BytesIO(client.get(r2.json()["bundle_files"][0]["file_url"]).content))
    assert abs(d2.sections[0].page_width.cm - 21.0) < 0.2 and abs(d2.sections[0].page_height.cm - 29.7) < 0.2
    all_d2_txt = "\n".join(p.text for p in d2.paragraphs) + "\n".join(
        c.text for t in d2.tables for row in t.rows for c in row.cells
    )
    assert "Cisco Packet Tracer" not in all_d2_txt and "RJ-45" not in all_d2_txt
    assert len(d2.tables) >= 7  # T0..T4 + weekly table + approval block

    # 3. Post-teaching normal (cover memo + 1 subject sheet -> 2 files + merged PDF + zip + checkbox note)
    r3 = client.post(
        "/v1/bundles/teaching/render",
        headers={"X-User-Email": "academic@cric.ac.th"},
        json={
            "doc_type": "post_teaching_normal",
            "convert_pdf": True,
            "payload": {
                "doc_number": "ฝว. 12/2569",
                "department_name": "แผนกวิชาเทคโนโลยีธุรกิจดิจิทัล",
                "week_start": 1,
                "week_end": 4,
                "instructor_name": "ครูทดสอบ",
                "dept_head_name": "หัวหน้าแผนกทดสอบ",
                "subjects": [
                    {
                        "course_code": "21910-9999",
                        "course_name": "วิชาระบบอัตโนมัติทดสอบ",
                        "unit_title": "หน่วยที่ 1",
                        "student_group": "692191001",
                        "total_students": 10,
                        "passed_students": 10,
                        "assessment_suitable": False,
                        "assessment_note": "รอปรับเกณฑ์ใบงาน",
                    }
                ],
            },
        },
    )
    assert r3.status_code == 200 and len(r3.json()["bundle_files"]) == 2
    assert r3.json()["merged_pdf_url"]
    assert client.get(r3.json()["merged_pdf_url"]).content[:4] == b"%PDF"
    d3a = _docx.Document(io.BytesIO(client.get(r3.json()["bundle_files"][0]["file_url"]).content))
    assert any(r.bold and "วันที่" in r.text for r in d3a.paragraphs[3].runs)
    assert d3a.paragraphs[3].runs[-1].bold is False
    d3a_sig_txt = "\n".join(c.text for row in d3a.tables[3].rows for c in row.cells)
    assert "หัวหน้างานพัฒนาหลักสูตรการเรียนการสอน" not in d3a_sig_txt
    assert "ผู้รายงาน" in d3a.tables[3].rows[0].cells[0].text
    assert "หัวหน้าแผนกวิชาเทคโนโลยีธุรกิจดิจิทัล" in d3a.tables[3].rows[0].cells[1].text
    assert "รองผู้อำนวยการ ฝ่ายวิชาการ" in d3a.tables[3].rows[1].cells[0].text
    d3b = _docx.Document(io.BytesIO(client.get(r3.json()["bundle_files"][1]["file_url"]).content))
    assert abs(d3b.sections[0].page_width.cm - 21.0) < 0.2
    assert "รอปรับเกณฑ์ใบงาน" in "\n".join(c.text for t in d3b.tables for r in t.rows for c in r.cells)
    sub_tbl_blank = d3b.tables[0].rows[2].cells[0].tables[0]
    assert sub_tbl_blank.rows[1].cells[5].text.strip() == "ปรับปรุง"
    for item_i in range(8):
        for col_i in range(1, 6):
            assert sub_tbl_blank.rows[2 + item_i].cells[col_i].text.strip() == ""

    # 3b. Post-teaching normal with selected attitude_ratings + custom item 8 label
    r3_sel = client.post(
        "/v1/bundles/teaching/render",
        headers={"X-User-Email": "academic@cric.ac.th"},
        json={
            "doc_type": "post_teaching_normal",
            "convert_pdf": False,
            "payload": {
                "doc_number": "ฝว. 13/2569",
                "department_name": "แผนกวิชาเทคโนโลยีธุรกิจดิจิทัล",
                "week_start": 1,
                "week_end": 4,
                "instructor_name": "ครูทดสอบ",
                "dept_head_name": "หัวหน้าแผนกทดสอบ",
                "subjects": [
                    {
                        "course_code": "21910-9999",
                        "course_name": "วิชาระบบอัตโนมัติทดสอบ",
                        "unit_title": "หน่วยที่ 1",
                        "student_group": "692191001",
                        "total_students": 10,
                        "passed_students": 10,
                        "attitude_ratings": [5, 4, 3, 2, 1, 0, 4, 5],
                        "attitude_other_label": "การแต่งกายเรียบร้อย",
                    }
                ],
            },
        },
    )
    assert r3_sel.status_code == 200
    d3b_sel = _docx.Document(io.BytesIO(client.get(r3_sel.json()["bundle_files"][1]["file_url"]).content))
    sub_tbl_sel = d3b_sel.tables[0].rows[2].cells[0].tables[0]
    assert "8. การแต่งกายเรียบร้อย" in sub_tbl_sel.rows[9].cells[0].text
    expected_cols = [1, 2, 3, 4, 5, None, 2, 1]
    for item_i, exp_col in enumerate(expected_cols):
        for col_i in range(1, 6):
            cell_txt = sub_tbl_sel.rows[2 + item_i].cells[col_i].text.strip()
            assert cell_txt == ("✓" if col_i == exp_col else "")

    # 4. Upload PNG photo and render Online Teaching Report (framed tables + 2-col photo grid)
    png_1x1 = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xdc\xccY\xe7\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    up = client.post(
        "/v1/bundles/teaching/upload-photo",
        headers={"X-User-Email": "academic@cric.ac.th"},
        files={"file": ("proof.png", png_1x1, "image/png")},
    )
    assert up.status_code == 200
    photo_name = up.json()["filename"]

    r4 = client.post(
        "/v1/bundles/teaching/render",
        headers={"X-User-Email": "academic@cric.ac.th"},
        json={
            "doc_type": "post_teaching_online",
            "convert_pdf": False,
            "payload": {
                "week_number": 1,
                "department_name": "แผนกวิชาเทคโนโลยีธุรกิจดิจิทัล",
                "instructor_name": "ครูทดสอบ",
                "sessions": [
                    {
                        "date_text": "16 พฤศจิกายน 2569",
                        "course_label": "21910-9999 วิชาระบบอัตโนมัติทดสอบ",
                        "time_text": "13.00 - 15.00",
                        "class_level": "ปวช.2",
                        "major_name": "เทคโนโลยีฯ",
                        "total_students": 10,
                        "present_students": 9,
                    }
                ],
                "online_sections": [
                    {
                        "course_code": "21910-9999",
                        "course_name": "วิชาระบบอัตโนมัติทดสอบ",
                        "total_students": 10,
                        "present_students": 9,
                        "tools": ["Meet", "Line"],
                        "topics": ["บทนำระบบอัตโนมัติ"],
                        "outcomes": ["อธิบายหลักการได้"],
                        "photo_filenames": [photo_name],
                    }
                ],
            },
        },
    )
    assert r4.status_code == 200 and len(r4.json()["bundle_files"]) == 1
    d4 = _docx.Document(io.BytesIO(client.get(r4.json()["bundle_files"][0]["file_url"]).content))
    assert len(d4.tables) >= 9  # cover tables + framed online section boxes + photo grid
    assert len(d4.inline_shapes) >= 1

    # 5. Teaching save -> submit -> approve stamps director PNG signature cleanly
    dir_sig_up = client.post(
        "/v1/auth/signature",
        headers={"X-User-Email": "director@cric.ac.th"},
        files={"file": ("dirsig.png", png_1x1, "image/png")},
    )
    assert dir_sig_up.status_code == 200
    saved_t = client.post(
        "/v1/bundles/teaching/save",
        headers={"X-User-Email": "academic@cric.ac.th"},
        json={"doc_type": "lesson_plan", "convert_pdf": False, "payload": course},
    )
    assert saved_t.status_code == 200
    tid = saved_t.json()["document"]["id"]
    assert client.post(f"/v1/bundles/{tid}/submit", headers={"X-User-Email": "academic@cric.ac.th"}, json={"reviewer_email": None, "approver_email": "director@cric.ac.th"}).status_code == 200
    app_t = client.post(f"/v1/documents/{tid}/approve", headers={"X-User-Email": "director@cric.ac.th"}, json={"comment": "อนุมัติแผน", "stamp_signature": True})
    assert app_t.status_code == 200
    assert app_t.json()["document"]["payload_json"]["signatures"].get("director")

    # AI draft endpoints offline fallback smoke test
    ai_sp = client.post(
        "/v1/ai/draft-sp",
        headers={"X-User-Email": "academic@cric.ac.th"},
        json={"project_name": "จัดซื้อสาย LAN", "budget_hint": 2000},
    )
    assert ai_sp.status_code == 200 and len(ai_sp.json()["items"]) >= 1

    ai_teach = client.post(
        "/v1/ai/draft-teaching",
        headers={"X-User-Email": "academic@cric.ac.th"},
        json={"mode": "course_plan", "course_code": "21910-9999", "course_name": "ระบบอัตโนมัติ"},
    )
    assert ai_teach.status_code == 200 and len(ai_teach.json()["weekly_plan"]) == 18
    assert ai_teach.json().get("equipment") and ai_teach.json().get("rubric") and ai_teach.json().get("morals")

    ai_post = client.post(
        "/v1/ai/draft-teaching",
        headers={"X-User-Email": "academic@cric.ac.th"},
        json={"mode": "post_teaching", "course_code": "21910-9999", "course_name": "ระบบอัตโนมัติ"},
    )
    assert ai_post.status_code == 200 and ai_post.json().get("weekly_attendance") and ai_post.json().get("evaluation_summary")

    # Cleanup course
    del_res = client.delete(f"/v1/courses/{course_id}", headers={"X-User-Email": "academic@cric.ac.th"})
    assert del_res.status_code == 200


def test_division_forms_render_save_and_links():
    import io
    import docx as _docx

    links_res = client.get("/v1/bundles/division-links")
    assert links_res.status_code == 200
    assert "project_system_url" in links_res.json()["links"]

    samples = [
        ("vehicle_request", "ฝบ.", {"purpose": "ประชุมวิชาการ", "destination": "เชียงใหม่", "passengers": [{"name": "นาย ก", "position": "ครู"}]}),
        ("official_travel", "ฝบ.", {"subject": "อบรม AI", "destination": "กรุงเทพฯ", "allowance_amount": 500, "lodging_amount": 1000}),
        ("overload_teaching", "ฝว.", {"semester": "2/2569", "courses": [{"course_code": "21910-1001", "course_name": "เขียนโปรแกรม", "extra_hours": 4, "rate_per_hour": 200}]}),
        ("internship_supervision", "ฝว.", {"company_name": "บริษัท เทค จำกัด", "students": [{"student_id": "662191001", "name": "นาย ข", "result": "ดีมาก"}]}),
        ("home_visit", "ฝก.", {"student_name": "นาย ค", "guardian_name": "นาง ง", "living_condition": "อบอุ่น"}),
        ("project_summary", "ฝย.", {"project_name": "โครงการพัฒนาดิจิทัล", "budget_allocated": 10000, "budget_spent": 8500, "kpis": [{"indicator": "ร้อยละผู้ผ่าน", "target": "80%", "actual": "90%"}]}),
        ("single_plan_summary", "ฝย.", {"plan_name": "แผนพัฒนาห้องปฏิบัติการ", "activities": [{"activity": "ปรับปรุงระบบเครือข่าย", "target": "1 ห้อง", "result": "แล้วเสร็จ", "percent": "100%"}]}),
    ]

    for form_type, div_code, payload in samples:
        r = client.post(
            "/v1/bundles/forms/render",
            headers={"X-User-Email": "academic@cric.ac.th"},
            json={"form_type": form_type, "division_code": div_code, "convert_pdf": False, "payload": payload},
        )
        assert r.status_code == 200, f"{form_type} failed: {r.text}"
        body = r.json()
        assert body["form_type"] == form_type
        doc = _docx.Document(io.BytesIO(client.get(body["docx_url"]).content))
        assert len(doc.paragraphs) >= 5
        if form_type == "overload_teaching":
            all_txt = "\n".join(p.text for p in doc.paragraphs)
            assert "แปดร้อยบาทถ้วน" in all_txt

    save_r = client.post(
        "/v1/bundles/forms/save",
        headers={"X-User-Email": "academic@cric.ac.th"},
        json={"form_type": "vehicle_request", "division_code": "ฝบ.", "subject": "ขอใช้รถประชุม", "convert_pdf": False, "payload": {"purpose": "ประชุม", "destination": "พะเยา"}},
    )
    assert save_r.status_code == 200
    assert save_r.json()["document"]["doc_type"] == "vehicle_request"


def test_qa_tools_32_catalog_schema_and_render():
    import io
    import docx as _docx

    cat = client.get("/v1/bundles/qa-tools")
    assert cat.status_code == 200
    tools = cat.json()["tools"]
    assert len(tools) == 32
    assert any(t["code"] == "2.2.6" and t["division_code"] == "ฝบ." for t in tools)

    sch = client.get("/v1/bundles/qa-tools/2.2.6")
    assert sch.status_code == 200
    data = sch.json()
    assert data["code"] == "2.2.6" and data["table_count"] >= 4
    first_tbl = data["tables"][0]
    tick_key = first_tbl["rows"][0]["cells"][2]["key"]

    r = client.post(
        "/v1/bundles/qa-tools/2.2.6/render",
        headers={"X-User-Email": "academic@cric.ac.th"},
        json={
            "convert_pdf": False,
            "payload": {
                "reporter_name": "นางสาวขนิษฐา สุใจยา",
                "academic_year": "ปีการศึกษา 2569",
                "cell_values": {tick_key: "✓"},
            },
        },
    )
    assert r.status_code == 200
    rendered_doc = _docx.Document(io.BytesIO(client.get(r.json()["docx_url"]).content))
    assert "✓" in rendered_doc.tables[0].rows[2].cells[2].text

    sv = client.post(
        "/v1/bundles/qa-tools/2.2.6/save",
        headers={"X-User-Email": "academic@cric.ac.th"},
        json={"convert_pdf": False, "payload": {"reporter_name": "ครูทดสอบ", "cell_values": {tick_key: "✓"}}},
    )
    assert sv.status_code == 200
    assert sv.json()["document"]["doc_type"] == "qa_2.2.6"


def test_timetable_template_parse_sornor02_and_batch_import(monkeypatch):
    import io

    import httpx
    import openpyxl

    headers = {"X-User-Email": "academic@cric.ac.th"}

    # 1. Download template .xlsx
    tpl_res = client.get("/v1/courses/timetable-template", headers=headers)
    assert tpl_res.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(tpl_res.content))
    assert wb.active.cell(1, 1).value == "รหัสวิชา"

    # 2. Parse uploaded .xlsx template
    xlsx_parse = client.post(
        "/v1/courses/parse-timetable",
        headers=headers,
        files={"file": ("timetable.xlsx", tpl_res.content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"default_semester": "2/2569"},
    )
    assert xlsx_parse.status_code == 200
    xlsx_items = xlsx_parse.json()["items"]
    assert len(xlsx_items) >= 2
    assert xlsx_items[0]["course_code"] == "20100-1001"
    assert xlsx_items[0]["total_students"] == 28

    # 3. Parse pasted ศธ.02 HTML grid + student count
    sornor_html = """
    <html><body>
      <table>
        <tr><th>วัน/คาบ</th><th>1</th><th>2</th><th>3</th></tr>
        <tr><td>จันทร์</td><td colspan="2">20901-2005 การเขียนโปรแกรมเบื้องต้น 1-3-2 ปวช.1/2 ห้อง 422</td><td></td></tr>
      </table>
      <table>
        <tr><td>66209010001</td><td>นายทดสอบ หนึ่ง</td></tr>
        <tr><td>66209010002</td><td>นางสาวทดสอบ สอง</td></tr>
      </table>
    </body></html>
    """
    html_parse = client.post(
        "/v1/courses/parse-timetable",
        headers=headers,
        data={"raw_text": sornor_html, "default_semester": "2/2569"},
    )
    assert html_parse.status_code == 200
    html_items = html_parse.json()["items"]
    assert len(html_items) == 1
    assert html_items[0]["course_code"] == "20901-2005"
    assert "จันทร์" in html_items[0]["schedule_text"]
    assert html_items[0]["total_students"] == 2

    # 4. Direct ศธ.02 web connector (mocked httpx) - success & CAPTCHA detection
    class _MockResp:
        def __init__(self, text: str, url: str = "https://std2018.vec.go.th/timetable"):
            self.text = text
            self.url = url

    async def _fake_get_ok(self, url, **kwargs):
        return _MockResp(sornor_html, url)

    monkeypatch.setattr(httpx.AsyncClient, "get", _fake_get_ok)
    web_res = client.post(
        "/v1/courses/import-sornor02",
        headers=headers,
        json={"url": "https://std2018.vec.go.th/timetable", "auth_mode": "none", "default_semester": "2/2569"},
    )
    assert web_res.status_code == 200
    assert web_res.json()["items"][0]["course_code"] == "20901-2005"

    async def _fake_get_captcha(self, url, **kwargs):
        return _MockResp('<form><div class="g-recaptcha">กรุณากรอกรหัสภาพ</div></form>', url)

    monkeypatch.setattr(httpx.AsyncClient, "get", _fake_get_captcha)
    cap_res = client.post(
        "/v1/courses/import-sornor02",
        headers=headers,
        json={"url": "https://std2018.vec.go.th/login", "auth_mode": "none"},
    )
    assert cap_res.status_code == 400
    assert "CAPTCHA" in cap_res.json()["detail"]

    # 5. Batch import & deduplication
    imp1 = client.post("/v1/courses/import", headers=headers, json={"items": html_items})
    assert imp1.status_code == 200
    assert len(imp1.json()["imported"]) == 1

    imp2 = client.post("/v1/courses/import", headers=headers, json={"items": html_items})
    assert imp2.status_code == 200
    assert len(imp2.json()["imported"]) == 0
    assert imp2.json()["skipped_count"] == 1


def test_cric_pdf_timetable_parser_and_metadata():
    headers = {"X-User-Email": "academic@cric.ac.th"}
    cric_pdf_text = """
วิทยาลัยการอาชีพเชียงราย
ภาคเรียน 2/2569
ผู้สอน นายณัฐพงศ์ มะโนวัง
แผนกวิชา เทคโนโลยีธุรกิจดิจิทัล
รหัสวิชา ชื่อรายวิชา ท. ป. น. ช.
21910-2013 ระบบเครือข่ายคอมพิวเตอร\uf70e 1 3 2 8
31910-2022 การพัฒนาโปรแกรมบนอุปกรณ์เคลื่อนที่แบบพกพา 2 2 3 4
PLC ชุมชนการเรียนรู้ทางวิชาชีพ (PLC) 2
วันจันทร์ 31910-2022
2205
เทคโนโลยีฯ.ปวส1/1,เทคโนโลยีฯ.ปวส1/2 (ม.6)
วันอังคาร 21910-2013 21910-2013
2204 สถานประกอบการ
เทคโนโลยีฯ.ปวช.3 เทคโนโลยีฯ.ปวช.1/2 (ทวิภาคี)
วันพุธ 21910-2013
สถานประกอบการ
เทคโนโลยีฯ.ปวช.1/2 (ทวิภาคี)
(นายจักรพันธ์ พัวพันพัฒนา) (นางสาวยุพิน ศิริขันแก้ว)
หัวหน้างานพัฒนาหลักสูตรฯ รองผู้อำนวยการฝ่ายวิชาการ
ตารางสอนภาคเรียนที่ 2 ปีการศึกษา 2569
สาขาวิชา เทคโนโลยีสารสนเทศ
21910-2013 ระบบเครือข่ายคอมพิวเตอร์ 1-3-2
31910-2022 การพัฒนาโปรแกรมบนอุปกรณ์เคลื่อนที่แบบพกพา 2-2-3
วัน คาบเรียน เวลาเรียน กลุ่มเรียน รหัสวิชา ชื่อวิชา ห้อง ใน นอก
จันทร์ 1 - 4 08:10 - 12:10 693191001 31910-2022 การพัฒนาโปรแกรมบนอุปกรณ์เคลื่อนที่แบบพ
กพา ห้องปฏิบัติการคอมพิว
เตอร์กราฟิก - -
จันทร์ 1 - 4 08:10 - 12:10 693191002 31910-2022 การพัฒนาโปรแกรมบนอุปกรณ์เคลื่อนที่แบบพ
กพา ห้องปฏิบัติการคอมพิว
เตอร์กราฟิก - -
จันทร์ 11 - 12 19:00 - 21:00 PLC ชุมชนการเรียนรู้ทางวิชาชีพ (PLC) - -
อังคาร 1 - 4 08:10 - 12:10 672191001 21910-2013 ระบบเครือข่ายคอมพิวเตอร์ ห้องปฏิบัติการเครือข่า
ยคอมพิวเตอร์ - -
อังคาร 11 - 12 19:00 - 21:00 692191002 21910-2013 ระบบเครือข่ายคอมพิวเตอร์ สถานประกอบการ - -
พุธ 11 - 12 19:00 - 21:00 692191002 21910-2013 ระบบเครือข่ายคอมพิวเตอร์ สถานประกอบการ - -
รวมชั่วโมงสอนในเวลา 0 รวมชั่วโมงสอนนอกเวลา 0 รวมจำนวนชั่วโมงที่สอน 43
"""
    res = client.post(
        "/v1/courses/parse-timetable",
        headers=headers,
        data={"raw_text": cric_pdf_text, "default_semester": "2/2569"},
    )
    assert res.status_code == 200
    body = res.json()
    meta = body["metadata"]
    assert meta["semester"] == "2/2569"
    assert meta["instructor_name"] == "นายณัฐพงศ์ มะโนวัง"
    assert meta["department_name"] == "เทคโนโลยีธุรกิจดิจิทัล"
    assert meta["major_name"] == "เทคโนโลยีสารสนเทศ"
    assert meta["curriculum_head_name"] == "นายจักรพันธ์ พัวพันพัฒนา"
    assert meta["deputy_academic_name"] == "นางสาวยุพิน ศิริขันแก้ว"

    items = body["items"]
    # 31910-2022 (merged 2 co-taught groups), PLC (special), 21910-2013 (regular 672191001), 21910-2013 (ทวิภาคี 692191002)
    assert len(items) == 4
    mob = next(i for i in items if i["course_code"] == "31910-2022")
    assert "693191001" in mob["student_group"] and "693191002" in mob["student_group"]
    assert mob["system_type"] == "ปกติ"
    assert mob["selected"] is True

    plc = next(i for i in items if i["course_code"] == "PLC")
    assert plc["is_special"] is True
    assert plc["selected"] is False

    net_items = [i for i in items if i["course_code"] == "21910-2013"]
    assert len(net_items) == 2
    reg = next(i for i in net_items if "672191001" in i["student_group"])
    assert reg["system_type"] == "ปกติ"
    assert "ทวิภาคี" not in reg["student_group"]
    dve = next(i for i in net_items if "692191002" in i["student_group"])
    assert dve["system_type"] == "ทวิภาคี"
    assert "อังคาร" in dve["schedule_text"] and "พุธ" in dve["schedule_text"]


def test_repair_request_form_render_and_save():
    import io
    import docx as _docx

    headers = {"X-User-Email": "academic@cric.ac.th"}
    payload = {
        "doc_number": "ฝบ. 123/2569",
        "doc_date": "2026-11-19",
        "department_name": "แผนกวิชาเทคโนโลยีธุรกิจดิจิทัล",
        "division_name": "ฝ่ายวิชาการ",
        "requester_name": "นายณัฐพงศ์ มะโนวัง",
        "requester_title": "ครู",
        "deputy_resource_name": "นางสาวอรวรรณ แสงดาว",
        "categories": ["ครุภัณฑ์", "ระบบไฟฟ้า-ประปา"],
        "other_category_text": "เครื่องปรับอากาศ",
        "items": [
            {
                "description": "เครื่องโปรเจคเตอร์",
                "cause": "เปิดไม่ติด",
                "quantity": 1,
                "unit": "เครื่อง",
                "location": "ห้อง 2205",
            },
            {
                "description": "ปลั๊กไฟติดผนัง",
                "cause": "ชำรุด/หลวม",
                "quantity": 2,
                "unit": "จุด",
                "location": "ห้อง 2204",
            },
        ],
        "include_photo_page": True,
    }
    r = client.post(
        "/v1/bundles/forms/render",
        headers=headers,
        json={"form_type": "repair_request", "payload": payload, "convert_pdf": False},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["form_type"] == "repair_request"
    doc_bytes = client.get(body["docx_url"]).content
    doc = _docx.Document(io.BytesIO(doc_bytes))
    full_text = "\n".join(p.text for p in doc.paragraphs)
    assert "☑ ครุภัณฑ์" in full_text
    assert "☑ ระบบไฟฟ้า-ประปา" in full_text
    assert "☐ สาธารณูปโภค" in full_text
    assert "☑ อื่นๆ เครื่องปรับอากาศ" in full_text
    assert "แนบรายละเอียดรูปภาพ" in full_text
    assert doc.tables[0].rows[1].cells[1].text.strip() == "เครื่องโปรเจคเตอร์"
    assert doc.tables[0].rows[2].cells[5].text.strip() == "ห้อง 2204"

    sv = client.post(
        "/v1/bundles/forms/save",
        headers=headers,
        json={
            "form_type": "repair_request",
            "division_code": "ฝบ.",
            "subject": "ขอแจ้งซ่อมบำรุง ห้อง 2205",
            "payload": payload,
            "convert_pdf": False,
        },
    )
    assert sv.status_code == 200
    assert sv.json()["document"]["doc_type"] == "repair_request"
