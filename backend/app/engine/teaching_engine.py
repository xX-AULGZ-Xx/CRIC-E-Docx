"""Teaching Plans, Course Syllabus, Post-Teaching Reports, and Online Teaching Reports Engine (แผนการสอน 2-69)."""

from __future__ import annotations

import copy
import zipfile
from pathlib import Path
from typing import Any

import docx
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

from app.config import ATTACHMENTS_DIR, TEMPLATES_DIR
from app.engine.pdf_converter import convert_office_to_pdf, render_pdf_pages_to_png
from app.engine.template_resolver import resolve_system_template
from app.engine.thai_utils import current_buddhist_year, format_thai_date, to_thai_digits

TEACH_TEMPLATES_DIR = TEMPLATES_DIR / "teaching"


def _set_para_text(para: Any, text: str, font_name: str | None = None, font_size_pt: float | None = None) -> None:
    if not para.runs:
        r = para.add_run(text)
        if font_name:
            r.font.name = font_name
        if font_size_pt:
            r.font.size = Pt(font_size_pt)
        return
    r0 = para.runs[0]
    r0.text = text
    if font_name:
        r0.font.name = font_name
    if font_size_pt:
        r0.font.size = Pt(font_size_pt)
    for r in para.runs[1:]:
        r.text = ""


def _set_cell_text(cell: Any, text: str) -> None:
    if not cell.paragraphs:
        cell.text = text
        return
    _set_para_text(cell.paragraphs[0], text)
    for p in cell.paragraphs[1:]:
        _set_para_text(p, "")


def _sync_table_rows(table: Any, target_data_rows: int, header_rows: int = 1) -> None:
    """Resize data rows in a table by cloning the template data row or deleting extra rows."""
    while len(table.rows) - header_rows > target_data_rows:
        tr = table.rows[-1]._tr
        tr.getparent().remove(tr)
    if target_data_rows <= 0:
        return
    # Ensure at least one template data row exists to clone
    while len(table.rows) - header_rows < target_data_rows:
        base_tr = table.rows[-1]._tr
        new_tr = copy.deepcopy(base_tr)
        table._tbl.append(new_tr)


def _remove_para(para: Any) -> None:
    el = para._element
    parent = el.getparent()
    if parent is not None:
        parent.remove(el)


def _insert_para_before(anchor_para: Any, text: str, bold: bool = False, font_name: str = "TH SarabunPSK", size_pt: float = 16.0, left_indent_cm: float = 0.0) -> Any:
    new_p = docx.text.paragraph.Paragraph(OxmlElement("w:p"), anchor_para._parent)
    anchor_para._element.addprevious(new_p._element)
    if left_indent_cm:
        new_p.paragraph_format.left_indent = Cm(left_indent_cm)
    r = new_p.add_run(text)
    r.bold = bold
    r.font.name = font_name
    r.font.size = Pt(size_pt)
    return new_p


def _finalize_bundle(generated_paths: list[Path], out_dir: Path, prefix: str, labels: list[tuple[str, str]], zip_label: str, convert_pdf: bool) -> dict[str, Any]:
    bundle_files: list[dict[str, Any]] = []
    for (key, label), fpath in zip(labels, generated_paths):
        pdf_url = ""
        page_urls: list[str] = []
        pdf_error = ""
        if convert_pdf:
            try:
                pdf_path = convert_office_to_pdf(fpath, out_dir)
                pdf_url = f"/v1/files/rendered/{pdf_path.name}"
                pngs = render_pdf_pages_to_png(pdf_path, out_dir, prefix=fpath.stem)
                page_urls = [f"/v1/files/rendered/{p.name}" for p in pngs]
            except Exception as exc:
                pdf_error = str(exc)
        bundle_files.append(
            {
                "key": key,
                "label": label,
                "filename": fpath.name,
                "file_type": fpath.suffix.lstrip("."),
                "file_url": f"/v1/files/rendered/{fpath.name}",
                "pdf_url": pdf_url,
                "page_image_urls": page_urls,
                "pdf_error": pdf_error,
            }
        )

    zip_name = f"{prefix}_{zip_label}.zip"
    zip_path = out_dir / zip_name
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for p in generated_paths:
            zf.write(p, arcname=p.name)

    primary = bundle_files[0] if bundle_files else {}
    return {
        "bundle_files": bundle_files,
        "zip_filename": zip_name,
        "zip_url": f"/v1/files/rendered/{zip_name}",
        "docx_url": primary.get("file_url", ""),
        "pdf_url": primary.get("pdf_url", ""),
        "page_image_urls": primary.get("page_image_urls", []),
    }


def _rewrite_list_section(doc: docx.Document, start_heading: str, end_heading: str, items: list[str], numbered: bool = True) -> None:
    """Replace paragraphs between start_heading and end_heading with provided lines."""
    ps = doc.paragraphs
    start_idx = next((i for i, p in enumerate(ps) if start_heading in p.text), None)
    end_idx = next((i for i, p in enumerate(ps) if end_heading in p.text and (start_idx is None or i > start_idx)), None)
    if start_idx is None or end_idx is None:
        return
    anchor = ps[end_idx]
    for p in ps[start_idx + 1 : end_idx]:
        _remove_para(p)
    lines = [str(x).strip() for x in items if str(x).strip()] or ["-"]
    for idx, line in enumerate(lines, start=1):
        txt = f"{idx}.  {line}" if numbered and not line[:2].isdigit() else line
        _insert_para_before(anchor, txt)


# ---------------------------------------------------------------------------
# 1. กำหนดการสอน (Course Syllabus)
# ---------------------------------------------------------------------------
def generate_course_syllabus(
    payload: dict[str, Any],
    out_dir: Path,
    prefix: str,
    org_profile: dict[str, Any],
    convert_pdf: bool = True,
) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = docx.Document(resolve_system_template("teaching/1_course_syllabus.docx"))

    code = payload.get("course_code") or "-"
    name = payload.get("course_name") or "-"
    credits = payload.get("credits") or "1-3-2"
    total_credits = payload.get("credit_summary") or credits
    level = payload.get("curriculum_level") or "ปวช."
    prereq = payload.get("prerequisite") or "วิชาชีพ"
    semester = payload.get("semester") or f"2/{current_buddhist_year()}"
    schedule = payload.get("schedule_text") or "-"
    instructor = payload.get("instructor_name") or "-"
    phone = payload.get("instructor_phone") or "-"
    email = payload.get("instructor_email") or "-"
    ref = payload.get("reference_text") or "Internet หัวข้อที่เกี่ยวข้อง"

    ps = doc.paragraphs
    _set_para_text(ps[2], "กำหนดการสอน (Course Syllabus)")
    _set_para_text(ps[3], f"รหัสวิชา : {code}\t\t\tชื่อวิชา : {name}")
    _set_para_text(ps[4], f"จำนวน : {total_credits}\t\t\tหลักสูตรการศึกษา (Course status) : {level}")
    _set_para_text(ps[5], f"ความรู้พื้นฐาน (Pre-requisite) : {prereq}")
    _set_para_text(ps[6], f"ภาคเรียนที่ (Semester) : {semester}\t\tวัน-เวลาที่เรียน : {schedule}")
    _set_para_text(ps[7], f"ชื่อผู้สอน (Instructor) : {instructor}\t\tโทรศัพท์ (Phone) : {phone}")
    _set_para_text(ps[8], f"อีเมล์ (E-Mail) : {email}")
    _set_para_text(ps[9], f"แหล่งค้นคว้าเพิ่มเติม (Reference) : {ref}")

    _rewrite_list_section(doc, "จุดประสงค์รายวิชา", "มาตรฐานรายวิชา", payload.get("objectives") or [])
    _rewrite_list_section(doc, "มาตรฐานรายวิชา", "คำอธิบายรายวิชา", payload.get("standards") or [])
    _rewrite_list_section(doc, "คำอธิบายรายวิชา", "ความรู้", [payload.get("description") or "-"], numbered=False)
    _rewrite_list_section(doc, "ความรู้", "ทักษะ", payload.get("knowledge") or [])
    _rewrite_list_section(doc, "ทักษะ", "คุณธรรม", payload.get("skills") or [])

    morals = payload.get("morals") or [
        "ความมีวินัย ตรงต่อเวลา และปฏิบัติงานตามกฎความปลอดภัยในห้องปฏิบัติการอย่างเคร่งครัด",
        "ความซื่อสัตย์สุจริต ความสนใจใฝ่รู้ และความรับผิดชอบต่อหน้าที่ที่ได้รับมอบหมาย",
    ]
    _rewrite_list_section(doc, "คุณธรรม", "ตัวชี้วัด", morals)

    # Clear extra sample indicators/strategies or use custom ones if provided
    strategies = payload.get("instructional_strategies") or [
        "การจัดการเรียนการสอนเชิงรุก (Active Learning) เน้นการลงมือปฏิบัติจริงตามสมรรถนะอาชีพ",
        "บูรณาการการแก้ปัญหาและการทำงานร่วมกันเป็นทีมควบคู่กับคุณธรรมจริยธรรมวิชาชีพ",
    ]
    _rewrite_list_section(doc, "วิธีการสอน", "เกณฑ์การประเมินผล", strategies, numbered=False)

    # Refresh weekly table header text
    for p in doc.paragraphs:
        if "รายละเอียดกำหนดการสอน" in p.text:
            total_hours = payload.get("total_hours") or 72
            weeks_cnt = len(payload.get("weekly_plan") or []) or 18
            _set_para_text(p, f"รายละเอียดกำหนดการสอน   ชื่อวิชา : {name}    {weeks_cnt}  สัปดาห์   {total_hours}  ชั่วโมง")
            break

    notes = payload.get("notes") or ["รายละเอียดการสอนปรับยืดหยุ่นได้ตามศักยภาพผู้เรียนและปฏิทินปฏิบัติการของวิทยาลัย"]
    p_notes_idx = next((i for i, p in enumerate(doc.paragraphs) if "หมายเหตุ" in p.text), None)
    if p_notes_idx is not None:
        for p in doc.paragraphs[p_notes_idx + 1 :]:
            _remove_para(p)
        for line in notes:
            p_new = doc.add_paragraph(f"\t{line}")
            for r in p_new.runs:
                r.font.name = "TH SarabunPSK"
                r.font.size = Pt(16)

    # Populate Table 1: 18-week schedule
    weeks = payload.get("weekly_plan") or []
    if len(doc.tables) > 1:
        t1 = doc.tables[1]
        _sync_table_rows(t1, max(1, len(weeks)), header_rows=1)
        for idx, wk in enumerate(weeks, start=1):
            row = t1.rows[idx]
            _set_cell_text(row.cells[0], str(wk.get("week") or idx))
            _set_cell_text(row.cells[1], str(wk.get("topic") or ""))
            _set_cell_text(row.cells[2], str(wk.get("activities") or ""))
            _set_cell_text(row.cells[3], str(wk.get("media") or ""))
            _set_cell_text(row.cells[4], str(wk.get("evaluation") or ""))
            _set_cell_text(row.cells[5], str(wk.get("competency") or ""))
        if not weeks:
            for c in range(6):
                _set_cell_text(t1.rows[1].cells[c], "-")

    fname = f"{prefix}_กำหนดการสอน_{code}.docx".replace("/", "-")
    fpath = out_dir / fname
    doc.save(fpath)
    return _finalize_bundle(
        [fpath],
        out_dir,
        prefix,
        [("syllabus", f"กำหนดการสอน ({code})")],
        f"กำหนดการสอน_{code}".replace("/", "-"),
        convert_pdf,
    )


# ---------------------------------------------------------------------------
# 2. แผนการจัดการเรียนรู้ 18 สัปดาห์ (Lesson Plan)
# ---------------------------------------------------------------------------
def generate_lesson_plan(
    payload: dict[str, Any],
    out_dir: Path,
    prefix: str,
    org_profile: dict[str, Any],
    convert_pdf: bool = True,
) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = docx.Document(resolve_system_template("teaching/2_lesson_plan.docx"))

    code = payload.get("course_code") or "-"
    name = payload.get("course_name") or "-"
    level = payload.get("curriculum_level") or "ปวช."
    credits = payload.get("credits") or "1-3-2"
    std_link = payload.get("qualification_link") or "มาตรฐานคุณวุฒิอาชีวศึกษา"

    ps = doc.paragraphs
    _set_para_text(ps[0], f"แผนการจัดการเรียนรู้เชิงรุกมุ่งเน้นสมรรถนะ วิชา {name} (รหัสวิชา {code})")
    _set_para_text(ps[2], payload.get("curriculum_context") or f"การจัดการเรียนการสอนในหลักสูตร {level} รายวิชา {code} {name} ตามกรอบมาตรฐานคุณวุฒิอาชีวศึกษา")

    _rewrite_list_section(doc, "จุดประสงค์รายวิชา", "สมรรถนะรายวิชา", payload.get("objectives") or [])
    _rewrite_list_section(doc, "สมรรถนะรายวิชา", "คำอธิบายรายวิชา", payload.get("standards") or [])
    _rewrite_list_section(doc, "คำอธิบายรายวิชา", "การวิเคราะห์หน่วยการเรียนรู้", [payload.get("description") or "-"], numbered=False)

    # T0: Course Overview 5x2
    if len(doc.tables) > 0:
        t0 = doc.tables[0]
        _set_cell_text(t0.rows[1].cells[1], f"{code} {name}")
        _set_cell_text(t0.rows[2].cells[1], level)
        _set_cell_text(t0.rows[3].cells[1], credits)
        _set_cell_text(t0.rows[4].cells[1], std_link)

    # T1: 18-week summary table
    weeks = payload.get("weekly_plan") or []
    if len(doc.tables) > 1:
        t1 = doc.tables[1]
        _sync_table_rows(t1, max(1, len(weeks)), header_rows=1)
        for idx, wk in enumerate(weeks, start=1):
            row = t1.rows[idx]
            th_h = int(wk.get("theory_hours") or 1)
            pr_h = int(wk.get("practice_hours") or 3)
            _set_cell_text(row.cells[0], str(wk.get("week") or idx))
            _set_cell_text(row.cells[1], str(wk.get("topic") or ""))
            _set_cell_text(row.cells[2], str(th_h))
            _set_cell_text(row.cells[3], str(pr_h))
            _set_cell_text(row.cells[4], str(th_h + pr_h))
            _set_cell_text(row.cells[5], str(wk.get("evaluation") or ""))

    # T2: Equipment & Tools
    equipment = payload.get("equipment") or []
    if len(doc.tables) > 2 and equipment:
        t2 = doc.tables[2]
        _sync_table_rows(t2, len(equipment), header_rows=1)
        for idx, eq in enumerate(equipment, start=1):
            row = t2.rows[idx]
            _set_cell_text(row.cells[0], str(eq.get("category") or ""))
            _set_cell_text(row.cells[1], str(eq.get("item") or ""))
            _set_cell_text(row.cells[2], str(eq.get("purpose") or ""))

    # T3: Assessment domains
    assessment = payload.get("assessment") or []
    if len(doc.tables) > 3 and assessment:
        t3 = doc.tables[3]
        _sync_table_rows(t3, len(assessment), header_rows=1)
        for idx, a in enumerate(assessment, start=1):
            row = t3.rows[idx]
            _set_cell_text(row.cells[0], str(a.get("domain") or ""))
            _set_cell_text(row.cells[1], str(a.get("weight") or ""))
            _set_cell_text(row.cells[2], str(a.get("method") or ""))
            _set_cell_text(row.cells[3], str(a.get("criteria") or ""))

    # T4: Rubric
    rubric = payload.get("rubric") or []
    if len(doc.tables) > 4 and rubric:
        t4 = doc.tables[4]
        _sync_table_rows(t4, len(rubric), header_rows=1)
        for idx, rb in enumerate(rubric, start=1):
            row = t4.rows[idx]
            _set_cell_text(row.cells[0], str(rb.get("dimension") or ""))
            _set_cell_text(row.cells[1], str(rb.get("level4") or ""))
            _set_cell_text(row.cells[2], str(rb.get("level3") or ""))
            _set_cell_text(row.cells[3], str(rb.get("level2") or ""))
            _set_cell_text(row.cells[4], str(rb.get("level1") or ""))

    # Replace P19..end (old weekly lesson blocks) cleanly with new weekly plans
    detail_idx = next((i for i, p in enumerate(doc.paragraphs) if "รายละเอียดแผนการจัดกิจกรรมการเรียนรู้รายสัปดาห์" in p.text), None)
    if detail_idx is not None:
        for p in doc.paragraphs[detail_idx + 1 :]:
            _remove_para(p)
        for idx, wk in enumerate(weeks, start=1):
            w_num = wk.get("week") or idx
            p_h = doc.add_paragraph()
            r = p_h.add_run(f"สัปดาห์ที่ {w_num}: {wk.get('topic') or ''}")
            r.bold = True
            r.font.name = "TH Sarabun New"
            r.font.size = Pt(16)

            fields = [
                ("หัวข้อการจัดการเรียนรู้", wk.get("subtopics") or wk.get("topic") or "-"),
                ("จุดประสงค์เชิงพฤติกรรม", wk.get("behavioral_objectives") or wk.get("competency") or "-"),
                ("กิจกรรมการจัดการเรียนรู้", wk.get("activities") or "-"),
                ("สื่อ อุปกรณ์ และแหล่งเรียนรู้", wk.get("media") or "-"),
                ("ภาระงานและการประเมินผล", wk.get("evaluation") or "-"),
            ]
            for label, val in fields:
                p_f = doc.add_paragraph()
                r1 = p_f.add_run(f"{label}: ")
                r1.bold = True
                r1.font.name = "TH Sarabun New"
                r1.font.size = Pt(16)
                r2 = p_f.add_run(str(val))
                r2.font.name = "TH Sarabun New"
                r2.font.size = Pt(16)

    fname = f"{prefix}_แผนการจัดการเรียนรู้_{code}.docx".replace("/", "-")
    fpath = out_dir / fname
    doc.save(fpath)
    return _finalize_bundle(
        [fpath],
        out_dir,
        prefix,
        [("lesson_plan", f"แผนการจัดการเรียนรู้ ({code})")],
        f"แผนการสอน_{code}".replace("/", "-"),
        convert_pdf,
    )


# ---------------------------------------------------------------------------
# 3. บันทึกข้อความ + แบบบันทึกหลังการสอนปกติ (ราย 4 สัปดาห์)
# ---------------------------------------------------------------------------
def generate_post_teaching_normal(
    payload: dict[str, Any],
    out_dir: Path,
    prefix: str,
    org_profile: dict[str, Any],
    convert_pdf: bool = True,
) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    org_name = org_profile.get("organization_name") or "วิทยาลัยการอาชีพเชียงราย"
    dir_name = (org_profile.get("director") or {}).get("name") or "............................................................"
    dir_title = (org_profile.get("director") or {}).get("title") or f"ผู้อำนวยการ{org_name}"

    department = payload.get("department_name") or "แผนกวิชา"
    division = payload.get("division_name") or "ฝ่ายวิชาการ"
    doc_date = format_thai_date(payload.get("doc_date"))
    instructor = payload.get("instructor_name") or "ครูผู้สอน"
    position = payload.get("instructor_title") or "ครู"
    w_start = payload.get("week_start") or 1
    w_end = payload.get("week_end") or 4
    semester = payload.get("semester") or f"2/{current_buddhist_year()}"
    subjects = payload.get("subjects") or []

    # 3a. Cover Memo
    memo_doc = docx.Document(resolve_system_template("teaching/3a_post_teaching_memo.docx"))
    ps = memo_doc.paragraphs
    _set_para_text(ps[2], f"ส่วนราชการ  {department}  {division}  {org_name}\t")
    _set_para_text(ps[3], f"ที่\tวันที่ {doc_date}\t")
    _set_para_text(
        ps[6],
        f"\tข้าพเจ้า {instructor}  ตำแหน่ง {position} {department} "
        f"ขอรายงานการบันทึกหลังการสอน สัปดาห์ที่ {w_start} ถึง {w_end} ดังนี้",
    )
    _set_para_text(ps[17], f"({dir_name})")
    _set_para_text(ps[18], dir_title)

    if len(memo_doc.tables) > 0:
        _set_cell_text(memo_doc.tables[0].rows[0].cells[1], f"รายงานการบันทึกหลังการสอน สัปดาห์ที่ {w_start} ถึง {w_end}  ภาคเรียนที่ {semester}")
    if len(memo_doc.tables) > 1:
        _set_cell_text(memo_doc.tables[1].rows[0].cells[1], dir_title)
    if len(memo_doc.tables) > 2:
        t2 = memo_doc.tables[2]
        _sync_table_rows(t2, max(1, len(subjects)), header_rows=1)
        for idx, sub in enumerate(subjects, start=1):
            row = t2.rows[idx]
            _set_cell_text(row.cells[0], str(idx))
            _set_cell_text(row.cells[1], str(sub.get("course_code") or "-"))
            _set_cell_text(row.cells[2], str(sub.get("course_name") or "-"))
    if len(memo_doc.tables) > 3:
        t3 = memo_doc.tables[3]
        dept_head = payload.get("dept_head_name") or ".........................................................."
        curr_head = payload.get("curriculum_head_name") or ".........................................................."
        deputy_acad = payload.get("deputy_academic_name") or ".........................................................."
        _set_cell_text(t3.rows[0].cells[0], f"ลงชื่อ..........................................ผู้รายงาน\n({instructor})\nตำแหน่ง {position}")
        _set_cell_text(t3.rows[0].cells[2], f"ลงชื่อ......................................................\n({dept_head})\nหัวหน้า{department}")
        _set_cell_text(t3.rows[2].cells[0], f"ลงชื่อ......................................................\n({curr_head})\nหัวหน้างานพัฒนาหลักสูตรการเรียนการสอน")
        _set_cell_text(t3.rows[2].cells[2], f"ลงชื่อ......................................................\n({deputy_acad})\nรองผู้อำนวยการ{division}")

    generated_paths: list[Path] = []
    labels: list[tuple[str, str]] = []
    memo_path = out_dir / f"{prefix}_บันทึกข้อความรายงานหลังสอน_สัปดาห์{w_start}-{w_end}.docx"
    memo_doc.save(memo_path)
    generated_paths.append(memo_path)
    labels.append(("memo", f"บันทึกข้อความปะหน้า (สัปดาห์ {w_start}-{w_end})"))

    # 3b. Per-subject Post-Teaching Sheet
    for idx, sub in enumerate(subjects, start=1):
        s_doc = docx.Document(resolve_system_template("teaching/3b_post_teaching_sheet.docx"))
        code = sub.get("course_code") or f"subj{idx}"
        cname = sub.get("course_name") or "-"
        unit_title = sub.get("unit_title") or "-"
        group = sub.get("student_group") or "-"
        total_st = int(sub.get("total_students") or 0)
        passed_st = int(sub.get("passed_students") or total_st)
        pct = round((passed_st / total_st) * 100, 1) if total_st > 0 else 0
        pct_str = f"{int(pct)}" if pct == int(pct) else f"{pct}"
        weekly_att = sub.get("weekly_attendance") or f"สัปดาห์ที่ {w_start}-{w_end} เข้าเรียนครบ"
        eval_note = sub.get("evaluation_summary") or f"ผ่านเกณฑ์การประเมินตามจุดประสงค์เชิงพฤติกรรม"
        problems = sub.get("problems") or "-"
        solutions = sub.get("solutions") or "-"

        left_text = (
            "1) ข้อสรุปหลังการสอน\n"
            "    1.1) จำนวนผู้เรียนที่ผ่านจุดประสงค์เชิงพฤติกรรม\n"
            f"วิชา  {cname}  รหัสวิชา  {code}\n"
            f"หน่วย/เรื่อง  {unit_title}\n"
            f"ตามเกณฑ์การประเมินผลผู้เรียน กลุ่ม {group}\n"
            f"{weekly_att}\n\n"
            f"ผ่านเกณฑ์ประเมิน {passed_st} จาก {total_st} คน  คิดเป็นร้อยละ {pct_str}\n"
            f"    1.2) ผลการประเมินผู้เรียน\n{eval_note}\n"
            f"2) ปัญหาที่พบ  {problems}\n"
            f"3) แนวทางแก้ปัญหา  {solutions}"
        )

        cb = lambda cond: "☑" if cond else "☐"
        content_ok = sub.get("content_completed", True)
        time_ok = sub.get("time_sufficient", True)
        media_ok = sub.get("media_suitable", True)
        act_ok = sub.get("activities_suitable", True)
        assess_ok = sub.get("assessment_suitable", True)
        other_note = sub.get("other_note") or "......................................................."

        right_text = (
            "1) สอนตามแผนการจัดการเรียนรู้\n"
            f"     {cb(content_ok)} ครบตามเนื้อหา\n"
            f"     {cb(not content_ok)} ไม่ครบ เนื่องจาก {sub.get('content_note') or '...............................'}\n"
            "2) เวลาที่ใช้สอน\n"
            f"     {cb(time_ok)} พอเพียง\n"
            f"     {cb(not time_ok)} ไม่พอเพียง เนื่องจาก {sub.get('time_note') or '.........................'}\n"
            "3) สื่อ/อุปกรณ์ที่ใช้ตามกำหนด\n"
            f"     {cb(media_ok)} เหมาะสม\n"
            f"     {cb(not media_ok)} ไม่เหมาะสม เนื่องจาก {sub.get('media_note') or '.......................'}\n"
            "4) กิจกรรมการสอน\n"
            f"     {cb(act_ok)} เหมาะสม\n"
            f"     {cb(not act_ok)} ไม่เหมาะสม เนื่องจาก {sub.get('activities_note') or '.......................'}\n"
            "5) เครื่องมือวัดและประเมินผล\n"
            f"     {cb(assess_ok)} เหมาะสม\n"
            f"     {cb(not assess_ok)} ไม่เหมาะสม เนื่องจาก {sub.get('assessment_note') or '.......................'}\n"
            f"6) อื่นๆ {other_note}"
        )

        if len(s_doc.tables) > 0:
            _set_cell_text(s_doc.tables[0].rows[2].cells[0], left_text)
            _set_cell_text(s_doc.tables[0].rows[2].cells[1], right_text)
        if len(s_doc.tables) > 1:
            _set_cell_text(s_doc.tables[1].rows[0].cells[0], f"ลงชื่อ.....................................ครูผู้สอน\n({instructor})\n{doc_date}")

        safe_code = str(code).replace("/", "-")
        s_path = out_dir / f"{prefix}_หลังการสอน_{safe_code}_w{w_start}-{w_end}.docx"
        s_doc.save(s_path)
        generated_paths.append(s_path)
        labels.append((f"sheet_{idx}", f"{idx}. บันทึกหลังสอน {code} ({cname})"))

    return _finalize_bundle(
        generated_paths,
        out_dir,
        prefix,
        labels,
        f"หลังการสอน_สัปดาห์{w_start}-{w_end}",
        convert_pdf,
    )


# ---------------------------------------------------------------------------
# 4. รายงานการสอนออนไลน์รายสัปดาห์ + รูปหลักฐาน
# ---------------------------------------------------------------------------
def generate_online_teaching_report(
    payload: dict[str, Any],
    out_dir: Path,
    prefix: str,
    org_profile: dict[str, Any],
    convert_pdf: bool = True,
) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = docx.Document(resolve_system_template("teaching/4_online_teaching_report.docx"))

    org_name = org_profile.get("organization_name") or "วิทยาลัยการอาชีพเชียงราย"
    dir_name = (org_profile.get("director") or {}).get("name") or "ผู้อำนวยการ"
    dir_title = (org_profile.get("director") or {}).get("title") or f"ผู้อำนวยการ{org_name}"

    department = payload.get("department_name") or "แผนกวิชา"
    division = payload.get("division_name") or "ฝ่ายวิชาการ"
    doc_no = payload.get("doc_number") or "ฝว............/2569"
    doc_date = format_thai_date(payload.get("doc_date"))
    week_no = payload.get("week_number") or 1
    semester = payload.get("semester") or f"2/{current_buddhist_year()}"
    date_range = payload.get("date_range_text") or doc_date
    instructor = payload.get("instructor_name") or "ครูผู้สอน"
    position = payload.get("instructor_title") or "ครู"

    ps = doc.paragraphs
    _set_para_text(ps[2], f"ส่วนราชการ  {department}  {division}  {org_name}\t")
    _set_para_text(ps[3], f"ที่ {doc_no}\tวันที่ {doc_date}\t")
    _set_para_text(
        ps[6],
        f"\tข้าพเจ้า {instructor}  ตำแหน่ง {position} {department} ขอรายงานการสอนออนไลน์ระหว่างวันที่ {date_range} ดังนี้",
    )
    _set_para_text(ps[16], "ลงชื่อ.........................................................")
    _set_para_text(ps[17], f"({dir_name})")
    _set_para_text(ps[18], dir_title)

    # Trim existing template course sections (keep only cover memo up to P19 + T0..T4, then add sections programmatically)
    body = doc.element.body
    children = list(body)
    # Find element after P19 (index of P18 + 1 empty p) -> start removing from T5 (first "สัปดาห์ที่" box)
    t5_el = doc.tables[5]._element if len(doc.tables) > 5 else None
    if t5_el is not None:
        t5_idx = children.index(t5_el)
        for el in children[t5_idx:]:
            if not el.tag.endswith("}sectPr"):
                body.remove(el)

    # Cover tables
    _set_cell_text(doc.tables[0].rows[0].cells[1], f"รายงานการสอนออนไลน์ สัปดาห์ที่ {week_no}  ภาคเรียนที่ {semester}")
    _set_cell_text(doc.tables[1].rows[0].cells[1], dir_title)

    sessions = payload.get("sessions") or []
    t2 = doc.tables[2]
    _sync_table_rows(t2, max(1, len(sessions)), header_rows=1)
    for idx, ses in enumerate(sessions, start=1):
        row = t2.rows[idx]
        total_st = int(ses.get("total_students") or 0)
        present_st = int(ses.get("present_students") or 0)
        pct = round((present_st / total_st) * 100) if total_st > 0 else 0
        _set_cell_text(row.cells[0], f"{ses.get('date_text') or '-'}\n{ses.get('course_label') or '-'}")
        _set_cell_text(row.cells[1], str(ses.get("time_text") or "-"))
        _set_cell_text(row.cells[2], str(ses.get("class_level") or "-"))
        _set_cell_text(row.cells[3], str(ses.get("major_name") or "-"))
        _set_cell_text(row.cells[4], str(total_st))
        _set_cell_text(row.cells[5], str(present_st))
        _set_cell_text(row.cells[6], f"{pct}%")

    # Signatures on T3
    if len(doc.tables) > 3:
        t3 = doc.tables[3]
        dept_head = payload.get("dept_head_name") or ".........................................................."
        curr_head = payload.get("curriculum_head_name") or ".........................................................."
        deputy_acad = payload.get("deputy_academic_name") or ".........................................................."
        _set_cell_text(t3.rows[0].cells[0], f"ลงชื่อ..........................................ผู้รายงาน\n({instructor})\nตำแหน่ง {position}")
        _set_cell_text(t3.rows[0].cells[2], f"ลงชื่อ......................................................\n({dept_head})\nหัวหน้า{department}")
        _set_cell_text(t3.rows[2].cells[0], f"ลงชื่อ......................................................\n({curr_head})\nหัวหน้างานพัฒนาหลักสูตรการเรียนการสอน")
        _set_cell_text(t3.rows[2].cells[2], f"ลงชื่อ......................................................\n({deputy_acad})\nรองผู้อำนวยการ{division}")

    # Append clean per-subject online sections with uploaded screenshots
    sections = payload.get("online_sections") or []
    cb = lambda cond: " ✓ " if cond else "   "
    for idx, sec in enumerate(sections, start=1):
        doc.add_page_break()
        h1 = doc.add_paragraph()
        h1.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r_h1 = h1.add_run(f"แบบบันทึกหลังการสอนออนไลน์  {org_name}  (สัปดาห์ที่ {week_no})")
        r_h1.bold = True
        r_h1.font.name = "TH Sarabun New"
        r_h1.font.size = Pt(16)

        h2 = doc.add_paragraph()
        h2.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r_h2 = h2.add_run(
            f"ภาคเรียนที่ {semester}  |  รหัสวิชา {sec.get('course_code') or '-'}  วิชา {sec.get('course_name') or '-'}"
        )
        r_h2.bold = True
        r_h2.font.name = "TH Sarabun New"
        r_h2.font.size = Pt(15)

        total_st = int(sec.get("total_students") or 0)
        present_st = int(sec.get("present_students") or 0)
        absent_st = max(0, total_st - present_st)
        level_type = sec.get("level_type") or "ปวช."
        system_type = sec.get("system_type") or "ทวิภาคี"
        tools = set(sec.get("tools") or [])

        info_lines = [
            f"ผู้สอน: {instructor}   แผนกวิชา: {sec.get('department_name') or department}",
            f"ระดับชั้น ({cb(level_type == 'ปวช.')}) ปวช.   ({cb(level_type == 'ปวส.')}) ปวส.   กลุ่มเรียน {sec.get('student_group') or '-'}   ระบบ ({cb(system_type == 'ปกติ')}) ปกติ   ({cb(system_type == 'ทวิภาคี')}) ทวิภาคี",
            f"สาขาวิชา {sec.get('major_name') or department}   ผู้เรียนทั้งหมด {total_st} คน   เข้าเรียน {present_st} คน   ขาดเรียน {absent_st} คน   รายชื่อผู้ขาด: {sec.get('absent_names') or '-'}",
        ]
        for ln in info_lines:
            p_i = doc.add_paragraph(ln)
            for rr in p_i.runs:
                rr.font.name = "TH Sarabun New"
                rr.font.size = Pt(15)

        topics = [t.strip() for t in (sec.get("topics") or []) if str(t).strip()]
        p_t_hdr = doc.add_paragraph()
        rt = p_t_hdr.add_run("1. รายการสอน/หัวข้อเรื่อง")
        rt.bold = True
        rt.font.name = "TH Sarabun New"
        rt.font.size = Pt(15)
        for ti, top in enumerate(topics or ["-"], start=1):
            p_top = doc.add_paragraph(f"   {ti}. {top}")
            for rr in p_top.runs:
                rr.font.name = "TH Sarabun New"
                rr.font.size = Pt(15)

        p_tool = doc.add_paragraph(
            f"2. โปรแกรม/สื่อ/แหล่งเรียนรู้  ({cb('Google Classroom' in tools)}) Google Classroom  "
            f"({cb('Meet' in tools)}) Meet  ({cb('Zoom' in tools)}) Zoom  "
            f"({cb('Facebook' in tools)}) Facebook  ({cb('Line' in tools)}) Line  "
            f"อื่นๆ: {sec.get('other_tool') or '-'}"
        )
        for rr in p_tool.runs:
            rr.font.name = "TH Sarabun New"
            rr.font.size = Pt(15)

        p_assign = doc.add_paragraph(f"3. งานที่มอบหมาย: {sec.get('assignment') or '-'}")
        for rr in p_assign.runs:
            rr.font.name = "TH Sarabun New"
            rr.font.size = Pt(15)

        p_out_hdr = doc.add_paragraph()
        ro = p_out_hdr.add_run("4. ผลการเรียนรู้ของผู้เรียน")
        ro.bold = True
        ro.font.name = "TH Sarabun New"
        ro.font.size = Pt(15)
        for oi, outc in enumerate(sec.get("outcomes") or ["-"], start=1):
            p_o = doc.add_paragraph(f"   {oi}. {outc}")
            for rr in p_o.runs:
                rr.font.name = "TH Sarabun New"
                rr.font.size = Pt(15)

        p_prob_hdr = doc.add_paragraph()
        rp = p_prob_hdr.add_run("5. ปัญหาและแนวทางพัฒนาคุณภาพการเรียนรู้ของผู้เรียน")
        rp.bold = True
        rp.font.name = "TH Sarabun New"
        rp.font.size = Pt(15)
        tbl_p = doc.add_table(rows=2, cols=2)
        tbl_p.style = "Table Grid"
        tbl_p.rows[0].cells[0].text = "ปัญหา"
        tbl_p.rows[0].cells[1].text = "แนวทางพัฒนาคุณภาพการเรียนรู้ของผู้เรียน"
        tbl_p.rows[1].cells[0].text = sec.get("problems") or "-"
        tbl_p.rows[1].cells[1].text = sec.get("solutions") or "-"

        photo_names = sec.get("photo_filenames") or []
        valid_photos = [ATTACHMENTS_DIR / Path(fn).name for fn in photo_names if (ATTACHMENTS_DIR / Path(fn).name).exists()]
        if valid_photos:
            p_img_hdr = doc.add_paragraph()
            ri = p_img_hdr.add_run(f"ภาพการสอน ({len(valid_photos)} ภาพ) - {sec.get('course_code') or ''} {sec.get('course_name') or ''}")
            ri.bold = True
            ri.font.name = "TH Sarabun New"
            ri.font.size = Pt(15)
            img_tbl = doc.add_table(rows=len(valid_photos), cols=1)
            img_tbl.style = "Table Grid"
            for pi, img_path in enumerate(valid_photos):
                cell_p = img_tbl.rows[pi].cells[0].paragraphs[0]
                cell_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                try:
                    cell_p.add_run().add_picture(str(img_path), width=Cm(11.0))
                except Exception:
                    cell_p.add_run(f"[ไม่สามารถฝังไฟล์ภาพ {img_path.name}]")

    fpath = out_dir / f"{prefix}_รายงานสอนออนไลน์_สัปดาห์{week_no}.docx"
    doc.save(fpath)
    return _finalize_bundle(
        [fpath],
        out_dir,
        prefix,
        [("online_report", f"รายงานสอนออนไลน์ สัปดาห์ที่ {week_no}")],
        f"สอนออนไลน์_สัปดาห์{week_no}",
        convert_pdf,
    )
