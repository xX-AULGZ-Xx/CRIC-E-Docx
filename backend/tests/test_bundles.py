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
        "budget_year_be": 2570,
        "department_name": "แผนกวิชาเทคโนโลยีสารสนเทศ",
        "division_name": "ฝ่ายวิชาการ",
        "level_label": "ปวช.2",
        "student_count": 20,
        "semester_label": "2/2569",
        "doc_date": "2026-11-16",
        "start_date": "2026-11-20",
        "end_date": "2027-02-20",
        "requester_name": "นายสมชาย ใจดี",
        "dept_head_name": "นางสาววิไล พัฒนา",
        "deputy_name": "นางสาวอรวรรณ แสงดาว",
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
