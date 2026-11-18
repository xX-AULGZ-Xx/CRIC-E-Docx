"""Procurement & Training Project Bundle Engine (สผ 2-69)."""

from __future__ import annotations

import copy
import datetime as _dt
import zipfile
from pathlib import Path
from typing import Any

import docx
from docx.enum.text import WD_UNDERLINE
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt
import openpyxl
from openpyxl.styles import Alignment, Font
from openpyxl.worksheet.pagebreak import Break

from app.config import TEMPLATES_DIR
from app.engine.pdf_converter import convert_office_to_pdf, render_pdf_pages_to_png
from app.engine.template_resolver import resolve_system_template
from app.engine.thai_baht import baht_text
from app.engine.thai_utils import current_buddhist_year, format_thai_date, to_thai_digits

SP_TEMPLATES_DIR = TEMPLATES_DIR / "sp"


def _set_para_text(para: Any, new_text: str, font_size_pt: float | None = None) -> None:
    """Replace all text inside a paragraph while preserving first run formatting."""
    if not para.runs:
        r = para.add_run(new_text)
        if font_size_pt:
            r.font.size = Pt(font_size_pt)
        return
    first = para.runs[0]
    first.text = new_text
    if font_size_pt:
        first.font.size = Pt(font_size_pt)
    for r in para.runs[1:]:
        r.text = ""


def _set_mixed_style_runs(
    para: Any,
    segments: list[tuple[str, bool, float]],
    font_name: str = "TH SarabunIT๙",
) -> None:
    """Replace paragraph runs with explicit per-segment bold and font size (including Thai complex-script w:szCs/w:bCs)."""
    for child in list(para._element):
        if child.tag.endswith("}r") or child.tag.endswith("}hyperlink") or child.tag.endswith("}proofErr"):
            para._element.remove(child)
    for txt, is_bold, size_pt in segments:
        r = para.add_run(txt)
        r.font.name = font_name
        r.font.bold = is_bold
        r.font.size = Pt(size_pt)
        r_pr = r._r.get_or_add_rPr()
        r_fonts = r_pr.find(qn("w:rFonts"))
        if r_fonts is None:
            r_fonts = OxmlElement("w:rFonts")
            r_pr.insert(0, r_fonts)
        r_fonts.set(qn("w:ascii"), font_name)
        r_fonts.set(qn("w:hAnsi"), font_name)
        r_fonts.set(qn("w:cs"), font_name)
        sz_val = str(int(round(size_pt * 2)))
        for tag in ("w:sz", "w:szCs"):
            el = r_pr.find(qn(tag))
            if el is None:
                el = OxmlElement(tag)
                r_pr.append(el)
            el.set(qn("w:val"), sz_val)
        for tag in ("w:b", "w:bCs"):
            el = r_pr.find(qn(tag))
            if el is None:
                el = OxmlElement(tag)
                r_pr.append(el)
            if is_bold:
                if qn("w:val") in el.attrib:
                    del el.attrib[qn("w:val")]
            else:
                el.set(qn("w:val"), "0")


def _set_cell_text(cell: Any, new_text: str) -> None:
    """Replace cell text cleanly preserving first paragraph/run font styling."""
    if not cell.paragraphs:
        cell.text = new_text
        return
    p0 = cell.paragraphs[0]
    _set_para_text(p0, new_text)
    for p in cell.paragraphs[1:]:
        _set_para_text(p, "")


def _fmt_num(val: float | int, use_thai: bool = False) -> str:
    n = float(val)
    if abs(n - round(n)) < 1e-6:
        s = f"{int(round(n)):,}"
    else:
        s = f"{n:,.2f}"
    return to_thai_digits(s, preserve_latin_tokens=False) if use_thai else s


def _compute_items(raw_items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], float]:
    items: list[dict[str, Any]] = []
    grand_total = 0.0
    for idx, it in enumerate(raw_items, start=1):
        name = str(it.get("name") or "").strip()
        if not name:
            continue
        qty = float(it.get("qty") or 0)
        unit_price = float(it.get("unit_price") or 0)
        line_total = round(qty * unit_price, 2)
        grand_total += line_total
        items.append(
            {
                "idx": idx,
                "name": name,
                "spec": str(it.get("spec") or "").strip(),
                "qty": qty,
                "unit": str(it.get("unit") or "ชิ้น").strip(),
                "unit_price": unit_price,
                "line_total": line_total,
                "note": str(it.get("note") or "").strip(),
            }
        )
    return items, round(grand_total, 2)


def _fill_sp1_approval_memo(
    payload: dict[str, Any],
    items: list[dict[str, Any]],
    grand_total: float,
    out_path: Path,
    org_profile: dict[str, Any],
) -> None:
    doc = docx.Document(resolve_system_template("sp/1_approval_memo.docx"))
    org_name = org_profile.get("organization_name") or "วิทยาลัยการอาชีพเชียงราย"
    division = payload.get("division_name") or "ฝ่ายวิชาการ"
    department = payload.get("department_name") or "แผนกวิชา"
    project_name = payload.get("project_name") or ""
    budget_year = str(payload.get("budget_year_be") or (current_buddhist_year() + 1))
    doc_date = format_thai_date(payload.get("doc_date"))
    doc_no = payload.get("doc_number") or ".........................../..........."
    dir_title = (org_profile.get("director") or {}).get("title") or f"ผู้อำนวยการ{org_name}"

    total_th = _fmt_num(grand_total, use_thai=True)
    total_word = baht_text(grand_total)
    use_service = payload.get("expense_category") == "service"

    ps = doc.paragraphs
    _set_mixed_style_runs(
        ps[2],
        [
            ("ส่วนราชการ  ", True, 20.0),
            (to_thai_digits(f"{division}   {org_name}"), False, 16.0),
        ],
    )
    _set_mixed_style_runs(
        ps[3],
        [
            ("ที่  ", True, 20.0),
            (to_thai_digits(f"{doc_no}\t\t\t"), False, 16.0),
            ("วันที่  ", True, 20.0),
            (to_thai_digits(doc_date), False, 16.0),
        ],
    )
    _set_mixed_style_runs(
        ps[4],
        [
            ("เรื่อง  ", True, 20.0),
            ("ขออนุมัติดำเนินงานและขออนุมัติค่าใช้จ่าย ตามโครงการ/แผนปฏิบัติราชการ", False, 16.0),
        ],
    )
    _set_para_text(ps[5], to_thai_digits(f"        ประจำปีงบประมาณ พ.ศ. {budget_year}"))
    _set_para_text(ps[7], f"เรียน  {dir_title}")
    _set_para_text(ps[8], f"\tด้วย {department}  {division}")
    _set_para_text(ps[9], to_thai_digits(f"๑. มีความประสงค์ขออนุมัติดำเนินโครงการ {project_name}"))

    flags = payload.get("change_flags") or {}
    cb = lambda k: "☑" if flags.get(k) else "☐"
    _set_para_text(ps[10], f"\t๒. มีความประสงค์ขอปรับเปลี่ยนโครงการ\t{cb('additional')} เพิ่มเติมโครงการ/กิจกรรม")
    _set_para_text(ps[11], f"\t\t\t\t\t{cb('modify_activity')} เปลี่ยนแปลงโครงการ/กิจกรรม")
    _set_para_text(ps[12], f"\t\t\t\t\t{cb('modify_budget')} เปลี่ยนแปลงงบประมาณ")
    old_b = payload.get("old_budget") or "...................."
    new_b = payload.get("new_budget") or "...................."
    _set_para_text(ps[13], to_thai_digits(f"\t\t\t\t\t     งบประมาณเดิม {old_b} บาท"))
    _set_para_text(ps[14], to_thai_digits(f"\t\t\t\t\t     งบประมาณที่ขอเปลี่ยนแปลง {new_b} บาท"))
    _set_para_text(ps[15], f"\t\t\t\t\t\t{cb('modify_period')} เปลี่ยนแปลงระยะเวลาดำเนินการ")
    _set_para_text(ps[16], f"\t\t\t\t\t\t{cb('improve_efficiency')} เป็นการเพิ่มประสิทธิภาพการดำเนินงาน")
    other_txt = flags.get("other_text") or ".............................................."
    _set_para_text(ps[17], f"\t\t\t\t\t\t{cb('other')} อื่น ๆ {other_txt}")

    objs = payload.get("objectives") or [f"จัดซื้อวัสดุฝึก{project_name}" if project_name else ""]
    for i in range(3):
        val = objs[i] if i < len(objs) and objs[i].strip() else "..............................................................................................................."
        _set_para_text(ps[19 + i], to_thai_digits(f"\t\t     {i + 1}. {val}"))

    expense_label = payload.get("expense_label") or f"ค่าวัสดุ ({project_name})"
    if use_service:
        expense_label = payload.get("expense_label") or f"ค่าใช้สอย/จ้างเหมา ({project_name})"
    _set_para_text(ps[23], to_thai_digits(f"\t\t     ๑. {expense_label}\tเป็นเงิน  {total_th}  บาท"))
    _set_para_text(ps[24], "\t\t     ๒. ............................................................\tเป็นเงิน  ....................  บาท")
    _set_para_text(ps[25], to_thai_digits(f"\t\t     รวมเป็นเงินทั้งสิ้น\t\tเป็นเงิน  {total_th}  บาท"))
    _set_para_text(ps[26], f"\t\t\t\t\t\t({total_word})")

    req_name = payload.get("requester_name") or "............................................................"
    req_title = payload.get("requester_title") or "ผู้รับผิดชอบโครงการ"
    dep_name = payload.get("deputy_name") or "............................................................"
    dep_title = payload.get("deputy_title") or f"รองผู้อำนวยการ{division}"

    _set_para_text(ps[32], f"\t\t\t\t\t\t({req_name})")
    _set_para_text(ps[33], f"\t\t\t\t\t\t{req_title}")
    _set_para_text(ps[38], f"\t\t\t\t\t\t({dep_name})")
    _set_para_text(ps[39], f"\t\t\t\t\t\t{dep_title}")

    doc.save(out_path)


def _toggle_run_sym(run: Any, checked: bool) -> bool:
    """Replace a <w:sym> checkbox inside a run with crisp Unicode ☑ / ☐ in DejaVu Sans (works in Word + Linux LibreOffice)."""
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    syms = run._element.findall(f".//{ns}sym")
    if not syms:
        return False
    for sym in syms:
        parent = sym.getparent()
        if parent is not None:
            parent.remove(sym)
    rpr = run._element.find(f"{ns}rPr")
    if rpr is None:
        rpr = OxmlElement("w:rPr")
        run._element.insert(0, rpr)
    rfonts = rpr.find(f"{ns}rFonts")
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.insert(0, rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        rfonts.set(qn(attr), "DejaVu Sans")
    t_el = OxmlElement("w:t")
    t_el.text = "☑" if checked else "☐"
    run._element.append(t_el)
    return True


def _set_cell_checkbox_list(paras: list[Any], states: list[bool]) -> None:
    """Update sequential <w:sym> boxes across a slice of paragraphs."""
    idx = 0
    for p in paras:
        for r in p.runs:
            ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
            if r._element.findall(f".//{ns}sym"):
                checked = states[idx] if idx < len(states) else False
                _toggle_run_sym(r, checked)
                idx += 1


def _pad_dot_line(name: str, width: int = 38) -> str:
    clean = (name or "").strip()
    if not clean:
        return "." * width
    rem = max(4, width - len(clean) - 2)
    return f" {clean} " + (" " * rem)


def _fill_sp2_purchase(
    payload: dict[str, Any],
    items: list[dict[str, Any]],
    grand_total: float,
    out_path: Path,
    org_profile: dict[str, Any],
) -> None:
    doc = docx.Document(resolve_system_template("sp/2_sp1_purchase.docx"))
    org_name = org_profile.get("organization_name") or "วิทยาลัยการอาชีพเชียงราย"
    department = (payload.get("department_name") or "").strip()
    division = (payload.get("division_name") or "ฝ่ายวิชาการ").strip()
    project_name = (payload.get("project_name") or "").strip()
    doc_date = format_thai_date(payload.get("doc_date"))
    req_kind = payload.get("request_kind") or "จัดซื้อ"
    mat_kind = payload.get("material_kind") or "วัสดุ"

    director_cfg = org_profile.get("director") or {}
    dir_name = director_cfg.get("name") or "ผู้อำนวยการ"
    dir_title = director_cfg.get("title") or f"ผู้อำนวยการ{org_name}"

    sp1_cfg = org_profile.get("sp1_signers") or {}
    plan_head = (payload.get("plan_head_name") or sp1_cfg.get("plan_head") or ".............................................").strip()
    deputy_plan = (payload.get("deputy_plan_name") or sp1_cfg.get("deputy_plan") or ".............................................").strip()
    supplies_head = (payload.get("supplies_head_name") or sp1_cfg.get("supplies_head") or ".............................................").strip()
    deputy_resource = (payload.get("deputy_resource_name") or sp1_cfg.get("deputy_resource") or ".............................................").strip()

    total_th = _fmt_num(grand_total, use_thai=True)
    total_dec_th = to_thai_digits(f"{grand_total:,.2f}", preserve_latin_tokens=False)
    total_word = baht_text(grand_total)
    count_th = to_thai_digits(str(len(items)), preserve_latin_tokens=False)
    req_name = (payload.get("requester_name") or "").strip() or ".................................."

    ps = doc.paragraphs

    # P03: ส่วนราชการ (ห้ามใส่วันที่ในบรรทัดนี้ตามแม่แบบ เพื่อให้คง 1 บรรทัดและหน้า 1 ไม่ล้น)
    if len(ps[3].runs) >= 2:
        ps[3].runs[1].text = f"\t{org_name}"
        for r in ps[3].runs[2:4]:
            r.text = ""
    else:
        _set_para_text(ps[3], f"ส่วนราชการ\t{org_name}\t\t\t")

    # P04: เรื่อง
    subject_line = payload.get("sp1_subject") or f"ขออนุมัติ{req_kind}" if req_kind != "จัดซื้อ" else "ขออนุมัติจัดซื้อ/จัดจ้าง"
    if len(ps[4].runs) >= 3:
        ps[4].runs[1].text = f"\t{subject_line}"
        ps[4].runs[2].text = ""

    # P05: เรียน
    if len(ps[5].runs) >= 2:
        ps[5].runs[1].text = f"   {dir_title}"
        for r in ps[5].runs[2:]:
            r.text = ""

    # P06: \tด้วยแผนกวิชา/งาน ... มีความประสงค์จะขอ จัดซื้อ [☑] วัสดุ [☐] ครุภัณฑ์ [☐] จัดจ้าง
    if len(ps[6].runs) >= 12:
        dept_text = department or "แผนกวิชา/งาน"
        ps[6].runs[0].text = "\tด้วย"
        ps[6].runs[1].text = dept_text
        ps[6].runs[2].text = ""
        ps[6].runs[3].text = ""
        ps[6].runs[4].text = "    "
        ps[6].runs[5].text = ""
        ps[6].runs[6].text = "\t"
        for idx_r in (7, 8, 9, 10):
            ps[6].runs[idx_r].text = ""
    _set_cell_checkbox_list(
        [ps[6]],
        [
            req_kind == "จัดซื้อ" and mat_kind == "วัสดุ",
            req_kind == "จัดซื้อ" and mat_kind == "ครุภัณฑ์",
            req_kind == "จัดจ้าง",
        ],
    )

    # P07: [☐] จ้างซ่อม เพื่อใช้ในงาน/โครงการ <project_name>
    _set_cell_checkbox_list([ps[7]], [req_kind == "จ้างซ่อม"])
    if len(ps[7].runs) >= 6:
        # Preserve runs[0] (sym), runs[1] (' จ้างซ่อม'), runs[2..3] spaces; replace runs[4+] cleanly
        for idx_r in range(4, len(ps[7].runs)):
            ps[7].runs[idx_r].text = ""
        ps[7].runs[4].text = (
            f"เพื่อใช้ในงาน/โครงการ    {to_thai_digits(project_name)}"
            if project_name
            else "เพื่อใช้ในงาน/โครงการ........................................................................................"
        )

    # P08: จำนวน ... รายการ รวมเป็นเงินทั้งสิ้น ... บาท ( ... ) (รักษาจุดไข่ปลาใต้ตัวเลข/ตัวหนังสือ)
    if len(ps[8].runs) >= 22:
        ps[8].runs[1].text = f"  {count_th}  "
        ps[8].runs[2].text = ""
        ps[8].runs[3].text = ""
        ps[8].runs[7].text = f"  {total_th}  "
        for idx_r in (8, 9, 10):
            ps[8].runs[idx_r].text = ""
        ps[8].runs[14].text = f" {total_word} "
        for idx_r in range(15, 21):
            ps[8].runs[idx_r].text = ""
    else:
        _set_para_text(ps[8], to_thai_digits(f"จำนวน   {count_th}   รายการ   รวมเป็นเงินทั้งสิ้น   {total_th}   บาท ( {total_word} )"))

    # P10 & P11: ชื่อผู้ขออนุมัติและวันที่
    if len(ps[10].runs) >= 7:
        ps[10].runs[5].text = req_name
        ps[10].runs[5].underline = None
    else:
        _set_para_text(ps[10], f"\t\t\t                  ({req_name})\t\t\t ")
    _set_para_text(ps[11], f"                                                {doc_date}")

    # T0: กรอบความเห็น ข้อ 1-7 (อยู่ครบหน้า 1)
    if len(doc.tables) > 0:
        t0 = doc.tables[0]
        c0_paras = t0.rows[0].cells[0].paragraphs
        c1_paras = t0.rows[0].cells[1].paragraphs

        dept_head = (payload.get("dept_head_name") or "").strip()
        deputy_name = (payload.get("deputy_name") or "").strip()

        # ข้อ 1: หัวหน้าแผนกวิชา
        if len(c0_paras) > 5:
            _set_para_text(c0_paras[5], f"       ({dept_head})" if dept_head else "       (.............................................)")

        # ข้อ 2: รองผู้อำนวยการฝ่าย (ติ๊กฝ่าย + ควรอนุมัติ)
        if len(c0_paras) > 12:
            has_v = "วิชาการ" in division
            has_r = "บริหาร" in division
            has_s = "กิจการ" in division or "นักศึกษา" in division
            has_p = "ยุทธ" in division or "แผน" in division
            m_v = "✓" if has_v else "  "
            m_r = "✓" if has_r else "  "
            m_s = "✓" if has_s else "  "
            m_p = "✓" if has_p else "  "
            _set_para_text(c0_paras[7], f"(  {m_v}  )  วิชาการ                       (  {m_r}  )  บริหารทรัพยากร")
            _set_para_text(c0_paras[8], f"(  {m_s}  )  กิจการนักเรียน นักศึกษา   (  {m_p}  ) ยุทธศาสตร์และแผนงาน")
            _set_para_text(c0_paras[9], f"(  {'✓' if any([has_v, has_r, has_s, has_p]) else '  '}  ) ควรอนุมัติตามเสนอ")
            _set_para_text(c0_paras[12], f"       ({deputy_name})" if deputy_name else "       (.............................................)")

        # ข้อ 3 & ข้อ 4: คงกล่องติ๊กว่างไว้ให้เจ้าหน้าที่ตรวจจริง, เติมชื่อผู้ลงนามจาก org_profile / payload
        for p in c0_paras[13:26]:
            _set_cell_checkbox_list([p], [False] * 8)
        for p in c0_paras:
            if "เจษฎา" in p.text or (p == c0_paras[27] if len(c0_paras) > 27 else False):
                _set_para_text(p, f"          ( {plan_head} )")
            elif "พุทธิพัชร์" in p.text or (p == c0_paras[32] if len(c0_paras) > 32 else False):
                _set_para_text(p, f"    ( {deputy_plan} )")

        # ข้อ 5: หัวหน้างานพัสดุ (วิธีจัดซื้อ + คณะกรรมการจัดซื้อ + คณะกรรมการตรวจรับ)
        pmethod = payload.get("purchase_method") or "specific"
        if len(c1_paras) > 3:
            _set_cell_checkbox_list(
                [c1_paras[2], c1_paras[3]],
                [pmethod == "open_bidding", pmethod == "selection", pmethod == "specific"],
            )
        proc_comm = payload.get("procurement_committee_members") or []
        insp_comm = payload.get("committee_members") or []
        if len(c1_paras) > 13:
            _set_para_text(c1_paras[6], to_thai_digits(f"  ๑.{_pad_dot_line(proc_comm[0] if len(proc_comm) > 0 else '', 36)} ประธานกรรมการ", False))
            _set_para_text(c1_paras[7], to_thai_digits(f"  ๒.{_pad_dot_line(proc_comm[1] if len(proc_comm) > 1 else '', 36)} กรรมการ", False))
            _set_para_text(c1_paras[8], to_thai_digits(f"  ๓.{_pad_dot_line(proc_comm[2] if len(proc_comm) > 2 else '', 36)} กรรมการ", False))
            _set_para_text(c1_paras[11], to_thai_digits(f"  ๑.{_pad_dot_line(insp_comm[0] if len(insp_comm) > 0 else '', 36)} ประธานกรรมการ", False))
            _set_para_text(c1_paras[12], to_thai_digits(f"  ๒.{_pad_dot_line(insp_comm[1] if len(insp_comm) > 1 else '', 36)} กรรมการ", False))
            _set_para_text(c1_paras[13], to_thai_digits(f"  ๓.{_pad_dot_line(insp_comm[2] if len(insp_comm) > 2 else '', 36)} กรรมการ", False))
        if len(c1_paras) > 16:
            _set_para_text(c1_paras[16], f"           ( {supplies_head} )")

        # ข้อ 6 & ข้อ 7: คงช่องติ๊กว่างสำหรับผู้บริหารสั่งการจริง, เติมชื่อจาก settings
        for p in c1_paras[18:]:
            _set_cell_checkbox_list([p], [False] * 4)
        if len(c1_paras) > 22:
            _set_para_text(c1_paras[22], f"    ( {deputy_resource} )")
        if len(c1_paras) > 32:
            _set_para_text(c1_paras[23], f"๗. {dir_title}")
            _set_para_text(c1_paras[31], f"                          ({dir_name})")
            _set_para_text(c1_paras[32], dir_title)

    # หน้า 2: P12 (หัวตาราง), T1 (บัญชีประมาณการ 29 แถว + แถวสรุป), P14-P15 (ผู้ขอซื้อ)
    ps[12].paragraph_format.page_break_before = True
    ps[12].paragraph_format.space_before = Pt(0)
    _set_para_text(ps[12], f"บัญชีประมาณการจัดซื้อ/จัดจ้างวัสดุ ฝ่าย/งาน ของ{org_name}")

    if len(doc.tables) > 1:
        t1 = doc.tables[1]
        max_rows = len(t1.rows) - 2  # rows 1..29
        if len(items) > max_rows:
            # แทรกแถวเพิ่มก่อนแถวสรุป (R30) โดยคงสไตล์แถวข้อมูล
            last_tr = t1.rows[-1]._tr
            sample_tr = t1.rows[1]._tr
            for _ in range(len(items) - max_rows):
                last_tr.addprevious(copy.deepcopy(sample_tr))
            max_rows = len(t1.rows) - 2

        for r_idx in range(1, max_rows + 1):
            row = t1.rows[r_idx]
            if r_idx <= len(items):
                it = items[r_idx - 1]
                _set_cell_text(row.cells[0], to_thai_digits(str(it["idx"]), False))
                _set_cell_text(row.cells[1], to_thai_digits(it["name"]))
                _set_cell_text(row.cells[2], _fmt_num(it["qty"], use_thai=True))
                _set_cell_text(row.cells[3], it["unit"])
                _set_cell_text(row.cells[4], _fmt_num(it["unit_price"], use_thai=True))
                _set_cell_text(row.cells[5], _fmt_num(it["line_total"], use_thai=True))
                _set_cell_text(row.cells[6], it["note"])
            else:
                for c in range(7):
                    _set_cell_text(row.cells[c], "")

        last_row = t1.rows[len(t1.rows) - 1]
        _set_cell_text(last_row.cells[0], f"ตัวหนังสือ    ( {total_word} )                 รวมเงิน")
        _set_cell_text(last_row.cells[5], total_dec_th)

    # P15: จัดตำแหน่งชื่อผู้ขอซื้อให้กึ่งกลางใต้ "ลงชื่อ........ผู้ขอซื้อ/ขอจ้าง" บนหน้า 2 และลบย่อหน้าว่างท้ายไฟล์กันหน้า 3 เกิน
    _set_para_text(ps[15], f"\t\t\t   ({req_name})")
    for extra_p in list(ps[16:]):
        if not extra_p.text.strip():
            el = extra_p._element
            parent = el.getparent()
            if parent is not None:
                parent.remove(el)

    doc.save(out_path)


def _configure_xlsx_print_setup(
    ws: Any,
    print_area: str,
    fit_height: int,
    row_breaks: list[int] | None = None,
) -> None:
    """Configure A4 portrait 1-page-wide print setup so LibreOffice Calc never clips right columns."""
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = ws.ORIENTATION_PORTRAIT
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = fit_height
    ws.page_setup.scale = None
    ws.print_area = print_area
    ws.row_breaks.brk = [Break(id=r) for r in (row_breaks or [])]
    ws.col_breaks.brk = []


def _copy_font_black(font_obj: Font | None, bold: bool | None = None, size: float | None = None) -> Font:
    return Font(
        name=(font_obj.name if font_obj and font_obj.name else "TH SarabunIT๙"),
        size=(size or (font_obj.size if font_obj and font_obj.size else 16)),
        bold=(bold if bold is not None else (font_obj.bold if font_obj else False)),
        color="000000",
    )


def _fill_sp3_training_xlsx(
    payload: dict[str, Any],
    items: list[dict[str, Any]],
    grand_total: float,
    out_path: Path,
    org_profile: dict[str, Any],
) -> None:
    wb = openpyxl.load_workbook(resolve_system_template("sp/3_training_plan.xlsx"))
    ws = wb.active

    org_name = org_profile.get("organization_name") or "วิทยาลัยการอาชีพเชียงราย"
    department = payload.get("department_name") or ""
    level_label = payload.get("level_label") or "ปวช."
    student_count = to_thai_digits(str(payload.get("student_count") or "0"), False)
    semester = to_thai_digits(str(payload.get("semester_label") or f"2/{current_buddhist_year()}"), False)
    project_name = payload.get("project_name") or ""
    start_date = format_thai_date(payload.get("start_date"))
    end_date = format_thai_date(payload.get("end_date"))
    doc_date = format_thai_date(payload.get("doc_date"))
    plan_source = payload.get("plan_source") or "ตามใบงาน / แผนการสอน"
    expected = payload.get("expected_outcome") or ""
    outcome_units = to_thai_digits(str(payload.get("outcome_units") or ""), False)

    ws["A3"] = f"ชื่อสถานศึกษา : {org_name}"
    ws["S3"] = department
    ws["S3"].alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
    ws["D4"] = level_label
    ws["H4"] = f"จำนวนนักเรียน : {student_count} คน"
    ws["P4"] = f"ภาคเรียนที่ {semester}"
    ws["H5"] = project_name
    ws["H5"].alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
    if len(project_name) > 45:
        ws.row_dimensions[5].height = 36

    sources = [
        ("C6", "ตามใบงาน / แผนการสอน"),
        ("C7", "ตามโครงการพัฒนาสถานศึกษา"),
        ("C8", "ตามโครงการผลิตเพื่อจำหน่าย"),
    ]
    for coord, label in sources:
        ws[coord] = "☑" if plan_source == label else "☐"

    ws["K6"] = f"วันเริ่มต้นการฝึก : {start_date}"
    ws["K7"] = f"วันสิ้นสุดการฝึก  : {end_date}"
    ws["M9"] = expected
    ws["M9"].alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws["U9"] = outcome_units or ""

    total_th = _fmt_num(grand_total, use_thai=True)
    ws["A11"] = " - ค่าใช้สอย.....................................บาท"
    ws["A12"] = " - ค่าตอบแทน................................บาท"
    ws["A13"] = f" - ค่าวัสดุ  {total_th}  บาท"
    ws["C14"] = f"รวม  {total_th}  บาท"

    req_name = payload.get("requester_name") or ""
    head_name = payload.get("dept_head_name") or ""
    ws["O15"] = f"({req_name})" if req_name else "      (..........................................................)"
    ws["O16"] = doc_date
    ws["O19"] = f"({head_name})" if head_name else "      (.......................................................)"
    ws["O20"] = doc_date

    committee = payload.get("committee_members") or []
    for i in range(3):
        val = committee[i] if i < len(committee) and committee[i].strip() else ".........................................................................."
        ws[f"A{18 + i}"] = to_thai_digits(f"{i + 1}. {val}", False) if committee else f"{i + 1}. {val}"

    # Clear & fill items: rows 24..38 (1..15) and rows 44..68 (16..40)
    data_rows = list(range(24, 39)) + list(range(44, 69))
    for slot_idx, r in enumerate(data_rows):
        if slot_idx < len(items):
            it = items[slot_idx]
            ws[f"C{r}"] = it["name"]
            ws[f"L{r}"] = it["qty"]
            ws[f"O{r}"] = it["unit"]
            ws[f"Q{r}"] = it["unit_price"]
            ws[f"W{r}"] = it["note"]
        else:
            ws[f"C{r}"] = None
            ws[f"L{r}"] = None
            ws[f"O{r}"] = None
            ws[f"Q{r}"] = None
            ws[f"W{r}"] = None
        ws[f"T{r}"] = f"=Q{r}*L{r}"

    # Fix carried-forward & page-2 grand total formulas cleanly
    ws["T39"] = "=SUM(T24:T38)"
    ws["T40"] = "=T39"
    ws["C40"] = "=BAHTTEXT(T40)"
    ws["T43"] = "=T39"
    ws["T69"] = "=SUM(T24:T38,T44:T68)"
    ws["T70"] = "=T69"
    ws["C70"] = "=BAHTTEXT(T70)"

    if len(items) <= 15:
        _configure_xlsx_print_setup(ws, "A1:W40", fit_height=1, row_breaks=[])
    else:
        _configure_xlsx_print_setup(ws, "A1:W70", fit_height=2, row_breaks=[40])

    wb.save(out_path)


def _fill_sp4_tor_xlsx(
    payload: dict[str, Any],
    items: list[dict[str, Any]],
    grand_total: float,
    out_path: Path,
    org_profile: dict[str, Any],
) -> None:
    wb = openpyxl.load_workbook(resolve_system_template("sp/4_tor.xlsx"))
    ws = wb.active

    # Remove accidental empty merge H65:K65 from template so LibreOffice doesn't stretch columns H..K
    for rng in list(ws.merged_cells.ranges):
        if str(rng) == "H65:K65":
            ws.unmerge_cells(str(rng))

    org_name = org_profile.get("organization_name") or "วิทยาลัยการอาชีพเชียงราย"
    department = payload.get("department_name") or "แผนกวิชา/งาน"
    project_name = payload.get("project_name") or ""
    budget_year = str(payload.get("budget_year_be") or (current_buddhist_year() + 1))
    delivery_days = int(payload.get("delivery_days") or 7)
    director_name = (org_profile.get("director") or {}).get("name") or "ผู้อำนวยการ"
    director_title = (org_profile.get("director") or {}).get("title") or f"ผู้อำนวยการ{org_name}"

    ws["A1"] = "ร่างรายละเอียดคุณลักษณะเฉพาะของพัสดุที่จะจัดซื้อ"
    ws["B4"] = (
        payload.get("tor_background")
        or f"ด้วย {department} มีความประสงค์จัดซื้อพัสดุเพื่อดำเนินงานโครงการ{project_name} ประจำปีงบประมาณ พ.ศ. {budget_year}"
    )
    ws["A5"] = "เพื่อเป็นการเพิ่มประสิทธิภาพการจัดการเรียนการสอนและการปฏิบัติงาน"
    ws["B7"] = (
        payload.get("tor_objective")
        or f"1. จัดซื้อพัสดุ{project_name} เพื่อสนับสนุนการเรียนการสอนและการดำเนินงานของ {department}"
    )

    # Expand item table starting at row 22 (template has 1 sample row at 22, total row at 23)
    num_items = max(1, len(items))
    extra = num_items - 1
    if extra > 0:
        shifted_merges = []
        for rng in list(ws.merged_cells.ranges):
            if rng.min_row >= 23:
                shifted_merges.append((rng.min_col, rng.min_row + extra, rng.max_col, rng.max_row + extra))
                ws.unmerge_cells(str(rng))
        ws.insert_rows(23, amount=extra)
        for mc, mr, xc, xr in shifted_merges:
            ws.merge_cells(start_column=mc, start_row=mr, end_column=xc, end_row=xr)

    template_row_style = [copy.copy(ws.cell(22, c)._style) for c in range(1, 8)]
    for i in range(num_items):
        r = 22 + i
        for c in range(1, 8):
            cell = ws.cell(r, c)
            cell._style = copy.copy(template_row_style[c - 1])
            # Override orange placeholder template color with black
            cell.font = _copy_font_black(cell.font, bold=False, size=16)
            cell.alignment = Alignment(
                horizontal=("center" if c in (1, 4, 5) else ("right" if c in (6, 7) else "left")),
                vertical="center",
                wrap_text=True,
            )
        if i < len(items):
            it = items[i]
            ws[f"A{r}"] = it["idx"]
            ws[f"B{r}"] = it["name"]
            ws[f"C{r}"] = it["spec"] or "-"
            ws[f"D{r}"] = it["qty"]
            ws[f"E{r}"] = it["unit"]
            ws[f"F{r}"] = it["unit_price"]
            ws[f"G{r}"] = f"=D{r}*F{r}"
            lines_needed = max(1, len(it["name"]) // 22 + 1, len(it["spec"] or "-") // 28 + 1)
            ws.row_dimensions[r].height = max(24, lines_needed * 20)
        else:
            ws[f"A{r}"] = 1
            ws[f"B{r}"] = "-"
            ws[f"C{r}"] = "-"
            ws[f"D{r}"] = 0
            ws[f"E{r}"] = "-"
            ws[f"F{r}"] = 0
            ws[f"G{r}"] = f"=D{r}*F{r}"

    total_row = 22 + num_items
    ws[f"A{total_row}"] = "รวมเป็นเงินทั้งสิ้น"
    ws[f"G{total_row}"] = f"=SUM(G22:G{total_row - 1})"
    ws[f"C{total_row}"] = f"=BAHTTEXT(G{total_row})"
    for c in range(1, 8):
        tc = ws.cell(total_row, c)
        tc.font = _copy_font_black(tc.font, bold=True, size=16)

    off = extra
    ws[f"B{25 + off}"] = f"กำหนดแล้วเสร็จ/ส่งมอบพัสดุ ภายใน {delivery_days} วัน นับแต่วันลงนามในสัญญาหรือวันสั่งซื้อสั่งจ้าง"
    total_fmt = _fmt_num(grand_total, use_thai=False)
    ws[f"B{29 + off}"] = f"7.1 วงเงินงบประมาณที่จะจัดซื้อ/จัดจ้าง  {total_fmt}"
    ws[f"B{30 + off}"] = f"7.2 ราคากลาง  {total_fmt}"
    ws[f"B{32 + off}"] = (
        f"ผู้ขายหรือผู้รับจ้างต้องส่งมอบพัสดุให้กับผู้ซื้อหรือผู้ว่าจ้างภายใน {delivery_days} วันทำการ "
        "นับแต่วันลงนามในสัญญาหรือวันสั่งซื้อสั่งจ้าง"
    )
    ws[f"B{37 + off}"] = f"ผู้รับจ้างจะต้องระมัดระวังการเกิดผลกระทบต่อทรัพย์สินและสถานที่ในพื้นที่จุดปฏิบัติงานที่เป็นทรัพย์สินของ {org_name}"

    chair = payload.get("tor_chair_name") or payload.get("requester_name") or ""
    m1 = payload.get("tor_member_1") or (payload.get("committee_members") or ["", ""])[0]
    m2 = payload.get("tor_member_2") or ((payload.get("committee_members") or ["", "", ""])[1] if len(payload.get("committee_members") or []) > 1 else "")
    ws[f"A{60 + off}"] = f"({chair})" if chair else "     (.....................................................)"
    ws[f"A{63 + off}"] = f"({m1})" if m1 else "     (......................................................)"
    ws[f"A{66 + off}"] = f"({m2})" if m2 else "     (.......................................................)"
    ws[f"D{69 + off}"] = f"คำสั่ง{director_title}"
    ws[f"D{74 + off}"] = f"({director_name})"
    ws[f"D{75 + off}"] = director_title
    ws[f"D{74 + off}"].font = _copy_font_black(ws[f"D{74 + off}"].font, bold=False, size=15)
    ws[f"D{75 + off}"].font = _copy_font_black(ws[f"D{75 + off}"].font, bold=False, size=15)

    # Enable wrap_text on long prose rows & constrain to 2 A4 pages cleanly
    for mr, xc in ((4, 7), (7, 7)):
        if all(
            not (rng.min_row <= mr <= rng.max_row and rng.min_col <= 2 and rng.max_col >= xc)
            for rng in ws.merged_cells.ranges
        ):
            ws.merge_cells(start_row=mr, start_column=2, end_row=mr, end_column=xc)
        ws.cell(mr, 2).alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
        txt = str(ws.cell(mr, 2).value or "")
        ws.row_dimensions[mr].height = max(24, ((len(txt) // 85) + 1) * 20)

    _configure_xlsx_print_setup(
        ws,
        f"A1:H{76 + off}",
        fit_height=2,
        row_breaks=[41 + off],
    )
    wb.save(out_path)


def _create_xlsx_preview_copy(
    src_xlsx: Path,
    kind: str,
    items: list[dict[str, Any]],
    grand_total: float,
) -> Path:
    """Create a temporary preview-only .xlsx with evaluated BAHTTEXT and Thai numerals for LibreOffice Calc."""
    preview_path = src_xlsx.with_name(f"{src_xlsx.stem}_preview_tmp.xlsx")
    wb = openpyxl.load_workbook(src_xlsx, data_only=False)
    ws = wb.active
    total_word = baht_text(grand_total)
    total_dec_th = to_thai_digits(f"{grand_total:,.2f}", preserve_latin_tokens=False)
    total_int_th = _fmt_num(grand_total, use_thai=True)

    if kind == "plan":
        page1_total = sum(it["line_total"] for it in items[:15])
        p1_dec_th = to_thai_digits(f"{page1_total:,.2f}", preserve_latin_tokens=False)
        p1_word = baht_text(page1_total)

        data_rows = list(range(24, 39)) + list(range(44, 69))
        for slot_idx, r in enumerate(data_rows):
            ws[f"A{r}"] = to_thai_digits(str(slot_idx + 1), False)
            if slot_idx < len(items):
                it = items[slot_idx]
                ws[f"L{r}"] = _fmt_num(it["qty"], use_thai=True)
                ws[f"Q{r}"] = to_thai_digits(f"{it['unit_price']:,.2f}", False)
                ws[f"T{r}"] = to_thai_digits(f"{it['line_total']:,.2f}", False)
            else:
                ws[f"T{r}"] = "-"

        ws["T39"] = p1_dec_th
        ws["T40"] = p1_dec_th
        ws["C40"] = p1_word
        ws["T43"] = p1_dec_th
        ws["T69"] = total_dec_th
        ws["T70"] = total_dec_th
        ws["C70"] = total_word
    elif kind == "tor":
        num_items = max(1, len(items))
        for i in range(num_items):
            r = 22 + i
            if i < len(items):
                it = items[i]
                ws[f"A{r}"] = to_thai_digits(str(it["idx"]), False)
                ws[f"D{r}"] = _fmt_num(it["qty"], use_thai=True)
                ws[f"F{r}"] = _fmt_num(it["unit_price"], use_thai=True)
                ws[f"G{r}"] = _fmt_num(it["line_total"], use_thai=True)
            else:
                ws[f"A{r}"] = "๑"
                ws[f"D{r}"] = "๐"
                ws[f"F{r}"] = "๐"
                ws[f"G{r}"] = "๐"
        total_row = 22 + num_items
        ws[f"C{total_row}"] = total_word
        ws[f"G{total_row}"] = total_int_th
        off = num_items - 1
        ws[f"B{29 + off}"] = f"7.1 วงเงินงบประมาณที่จะจัดซื้อ/จัดจ้าง  {total_int_th}"
        ws[f"B{30 + off}"] = f"7.2 ราคากลาง  {total_int_th}"

    wb.save(preview_path)
    return preview_path


def _fill_sp5_urgent_po(
    payload: dict[str, Any],
    items: list[dict[str, Any]],
    out_path: Path,
    org_profile: dict[str, Any],
) -> None:
    doc = docx.Document(resolve_system_template("sp/5_urgent_po.docx"))
    org_name = org_profile.get("organization_name") or "วิทยาลัยการอาชีพเชียงราย"
    doc_no = payload.get("doc_number") or "…………../………….."
    doc_date = format_thai_date(payload.get("doc_date"))
    project_name = payload.get("project_name") or ""
    req_name = payload.get("requester_name") or "……………………………………….."
    vendor = payload.get("urgent_po_vendor") or "…………………………………………."
    supplies_head = payload.get("supplies_head_name") or ".............................................."
    dir_name = (org_profile.get("director") or {}).get("name") or "………………….…………………….."

    ps = doc.paragraphs
    # Fill both top half (starts P2) and bottom half (starts P20)
    for base in (2, 20):
        _set_para_text(ps[base], to_thai_digits(f" เลขที่ {doc_no}"))
        _set_para_text(ps[base + 1], f"\t\t\t\t\tวันที่ {doc_date}")
        _set_para_text(ps[base + 3], f"\t\t\t{org_name}")
        _set_para_text(ps[base + 4], f"เรื่อง/โครงการ  {project_name}")
        _set_para_text(ps[base + 7], f"               ({req_name})               ({vendor})")
        _set_para_text(ps[base + 10], f"                 ({supplies_head})")
        _set_para_text(ps[base + 14], f"              ({dir_name})")

    for tbl in doc.tables[:2]:
        for r_idx in range(1, min(len(tbl.rows), 13)):
            row = tbl.rows[r_idx]
            if r_idx <= len(items):
                it = items[r_idx - 1]
                _set_cell_text(row.cells[0], to_thai_digits(str(it["idx"]), False))
                _set_cell_text(row.cells[1], to_thai_digits(it["name"]))
                _set_cell_text(row.cells[2], f"{_fmt_num(it['qty'], True)} {it['unit']}")
            else:
                for c in range(3):
                    _set_cell_text(row.cells[c], "")

    doc.save(out_path)


def generate_sp_bundle(
    payload: dict[str, Any],
    out_dir: Path,
    prefix: str,
    org_profile: dict[str, Any],
    convert_pdf: bool = True,
) -> dict[str, Any]:
    """Generate the complete 4- or 5-file สผ. bundle + PDF/PNG previews + ZIP."""
    out_dir.mkdir(parents=True, exist_ok=True)
    items, grand_total = _compute_items(payload.get("items") or [])

    specs = [
        ("memo", "1. บันทึกข้อความขออนุมัติดำเนินงาน", f"{prefix}_1_ขออนุมัติดำเนินงาน.docx", "docx"),
        ("sp1", "2. ใบ สผ.1 (พ. 101)", f"{prefix}_2_ใบสผ1.docx", "docx"),
        ("plan", "3. แผนโครงการฝึกฯ (.xlsx)", f"{prefix}_3_แผนโครงการฝึก.xlsx", "xlsx"),
        ("tor", "4. ร่าง TOR (.xlsx)", f"{prefix}_4_TOR.xlsx", "xlsx"),
    ]
    if payload.get("include_urgent_po"):
        specs.append(("urgent_po", "5. ใบสั่งซื้อชั่วคราว (เร่งด่วน)", f"{prefix}_5_ใบสั่งซื้อชั่วคราว.docx", "docx"))

    generated_paths: list[Path] = []
    bundle_files: list[dict[str, Any]] = []

    for key, label, fname, ext in specs:
        fpath = out_dir / fname
        if key == "memo":
            _fill_sp1_approval_memo(payload, items, grand_total, fpath, org_profile)
        elif key == "sp1":
            _fill_sp2_purchase(payload, items, grand_total, fpath, org_profile)
        elif key == "plan":
            _fill_sp3_training_xlsx(payload, items, grand_total, fpath, org_profile)
        elif key == "tor":
            _fill_sp4_tor_xlsx(payload, items, grand_total, fpath, org_profile)
        elif key == "urgent_po":
            _fill_sp5_urgent_po(payload, items, fpath, org_profile)
        generated_paths.append(fpath)

        pdf_url = ""
        page_urls: list[str] = []
        pdf_error = ""
        if convert_pdf:
            preview_tmp: Path | None = None
            try:
                src_for_pdf = fpath
                if ext == "xlsx" and key in ("plan", "tor"):
                    preview_tmp = _create_xlsx_preview_copy(fpath, key, items, grand_total)
                    src_for_pdf = preview_tmp
                raw_pdf = convert_office_to_pdf(src_for_pdf, out_dir)
                target_pdf = out_dir / f"{fpath.stem}.pdf"
                if raw_pdf != target_pdf:
                    if target_pdf.exists():
                        target_pdf.unlink()
                    raw_pdf.rename(target_pdf)
                pdf_url = f"/v1/files/rendered/{target_pdf.name}"
                pngs = render_pdf_pages_to_png(target_pdf, out_dir, prefix=fpath.stem)
                page_urls = [f"/v1/files/rendered/{p.name}" for p in pngs]
            except Exception as exc:
                pdf_error = str(exc)
            finally:
                if preview_tmp and preview_tmp.exists():
                    try:
                        preview_tmp.unlink()
                    except OSError:
                        pass

        bundle_files.append(
            {
                "key": key,
                "label": label,
                "filename": fname,
                "file_type": ext,
                "file_url": f"/v1/files/rendered/{fname}",
                "pdf_url": pdf_url,
                "page_image_urls": page_urls,
                "pdf_error": pdf_error,
            }
        )

    zip_name = f"{prefix}_ชุดสผ.zip"
    zip_path = out_dir / zip_name
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for p in generated_paths:
            zf.write(p, arcname=p.name)

    return {
        "grand_total": grand_total,
        "grand_total_thai_text": baht_text(grand_total),
        "item_count": len(items),
        "bundle_files": bundle_files,
        "zip_filename": zip_name,
        "zip_url": f"/v1/files/rendered/{zip_name}",
    }
