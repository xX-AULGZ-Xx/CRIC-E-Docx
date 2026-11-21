"""Generate ready-to-print Thai official .docx documents from JSON payloads."""

from __future__ import annotations

import argparse
from contextvars import ContextVar
import json
import sys
from pathlib import Path
from typing import Any

import docx
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Cm, Pt, RGBColor

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from thai_utils import (  # noqa: E402
    current_buddhist_year,
    format_doc_number,
    format_thai_date,
    to_thai_digits,
)
from validate_doc import validate_document  # noqa: E402


def _tpl_path(rel_name: str) -> str:
    try:
        from app.engine.template_resolver import resolve_system_template
        return str(resolve_system_template(rel_name))
    except Exception:
        return str(SKILL_DIR / "resources" / "templates" / rel_name)

FONT_NAME = "TH Sarabun New"
ALLOWED_FONTS = {"TH Sarabun New", "TH SarabunIT๙"}
_ACTIVE_FONT: ContextVar[str] = ContextVar("active_font", default=FONT_NAME)
RED_STAMP = RGBColor(0xC0, 0x00, 0x00)


def resolve_font_family(value: str | None) -> str:
    if value and value.strip() in ALLOWED_FONTS:
        return value.strip()
    return FONT_NAME


def load_defaults() -> dict[str, Any]:
    defaults_path = SKILL_DIR / "resources" / "org_defaults.json"
    with defaults_path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def merge_org(defaults: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    org = json.loads(json.dumps(defaults))
    override = payload.get("org_override") or {}
    for k, v in override.items():
        org[k] = v
    return org


def set_run_font(
    run,
    size_pt: float = 16,
    bold: bool = False,
    italic: bool = False,
    underline: bool = False,
    color_rgb: RGBColor | None = None,
    font_name: str | None = None,
) -> None:
    font_name = font_name or _ACTIVE_FONT.get()
    run.font.name = font_name
    run.font.size = Pt(size_pt)
    run.bold = bold
    run.italic = italic
    run.underline = underline
    if color_rgb is not None:
        run.font.color.rgb = color_rgb
    rPr = run._r.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.insert(0, rFonts)
    rFonts.set(qn("w:ascii"), font_name)
    rFonts.set(qn("w:hAnsi"), font_name)
    rFonts.set(qn("w:cs"), font_name)
    rFonts.set(qn("w:hint"), "cs")
    if rPr.find(qn("w:cs")) is None:
        rPr.append(OxmlElement("w:cs"))
    for tag, flag in (("w:bCs", bold), ("w:iCs", italic)):
        el = rPr.find(qn(tag))
        if el is None:
            el = OxmlElement(tag)
            rPr.append(el)
        el.set(qn("w:val"), "1" if flag else "0")
    szCs = rPr.find(qn("w:szCs"))
    if szCs is None:
        szCs = OxmlElement("w:szCs")
        rPr.append(szCs)
    szCs.set(qn("w:val"), str(int(round(size_pt * 2))))


def clear_paragraph_runs(p) -> None:
    p_el = p._element
    pPr = p_el.find(qn("w:pPr"))
    if pPr is not None:
        pStyle = pPr.find(qn("w:pStyle"))
        if pStyle is not None:
            pPr.remove(pStyle)
        p_rPr = pPr.find(qn("w:rPr"))
        if p_rPr is not None:
            pPr.remove(p_rPr)
    for child in list(p_el):
        if child.tag != qn("w:pPr"):
            p_el.remove(child)


def set_paragraph_text(
    p,
    segments: list[tuple[str, float, bool, bool]],
    alignment: WD_ALIGN_PARAGRAPH | None = None,
    before_pt: float | None = None,
    after_pt: float | None = 0,
    first_line_cm: float | None = None,
    left_indent_cm: float | None = None,
    tab_stops: list[tuple[WD_TAB_ALIGNMENT, float]] | None = None,
) -> None:
    clear_paragraph_runs(p)
    if alignment is not None:
        p.alignment = alignment
    pf = p.paragraph_format
    pf.line_spacing = 1.0
    if before_pt is not None:
        pf.space_before = Pt(before_pt)
    if after_pt is not None:
        pf.space_after = Pt(after_pt)
    if first_line_cm is not None:
        pf.first_line_indent = Cm(first_line_cm)
    if left_indent_cm is not None:
        pf.left_indent = Cm(left_indent_cm)
    if tab_stops is not None:
        pf.tab_stops.clear_all()
        for tab_align, cm_pos in tab_stops:
            pf.tab_stops.add_tab_stop(Cm(cm_pos), tab_align)
    for text, size_pt, bold, underline in segments:
        run = p.add_run(text)
        set_run_font(run, size_pt=size_pt, bold=bold, underline=underline)


def insert_paragraph_after(ref_p):
    new_p = OxmlElement("w:p")
    ref_p._element.addnext(new_p)
    return docx.text.paragraph.Paragraph(new_p, ref_p._parent)


def remove_paragraph(p) -> None:
    el = p._element
    parent = el.getparent()
    if parent is not None:
        parent.remove(el)


def remove_borderless_table_borders(table) -> None:
    tblPr = table._tbl.tblPr
    borders = parse_xml(
        f'<w:tblBorders {nsdecls("w")}>'
        '<w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
        '<w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
        '<w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
        '<w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
        '<w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
        '<w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
        "</w:tblBorders>"
    )
    tblPr.append(borders)


def apply_speed_and_secrecy(doc: docx.Document, speed: str, secrecy: str) -> None:
    """Apply red urgency stamp (first page top-left) and secrecy stamp (all pages top/bottom center)."""
    speed = (speed or "").strip()
    secrecy = (secrecy or "").strip()
    if not speed and not secrecy:
        return

    sec = doc.sections[0]
    sec.header_distance = Cm(0.75)
    sec.footer_distance = Cm(0.75)
    sec.different_first_page_header_footer = bool(speed)

    def _populate_header(header_obj, left_text: str, center_text: str) -> None:
        for p in list(header_obj.paragraphs)[1:]:
            remove_paragraph(p)
        tbl = header_obj.add_table(rows=1, cols=3, width=Cm(16.0))
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        remove_borderless_table_borders(tbl)
        widths = (Cm(5.0), Cm(6.0), Cm(5.0))
        for idx, cell in enumerate(tbl.rows[0].cells):
            cell.width = widths[idx]
        if left_text:
            p_left = tbl.rows[0].cells[0].paragraphs[0]
            p_left.alignment = WD_ALIGN_PARAGRAPH.LEFT
            r_left = p_left.add_run(left_text)
            set_run_font(r_left, size_pt=18, bold=True, color_rgb=RED_STAMP)
        if center_text:
            p_mid = tbl.rows[0].cells[1].paragraphs[0]
            p_mid.alignment = WD_ALIGN_PARAGRAPH.CENTER
            r_mid = p_mid.add_run(center_text)
            set_run_font(r_mid, size_pt=18, bold=True, color_rgb=RED_STAMP)
        # Clear empty default paragraph above table so header stays compact
        first_p = header_obj.paragraphs[0]
        if not first_p.text:
            remove_paragraph(first_p)

    if speed:
        _populate_header(sec.first_page_header, speed, secrecy)
        if secrecy:
            _populate_header(sec.header, "", secrecy)
    elif secrecy:
        _populate_header(sec.header, "", secrecy)

    if secrecy:
        for ftr in ([sec.first_page_footer, sec.footer] if sec.different_first_page_header_footer else [sec.footer]):
            p_ftr = ftr.paragraphs[0]
            clear_paragraph_runs(p_ftr)
            p_ftr.alignment = WD_ALIGN_PARAGRAPH.CENTER
            r_ftr = p_ftr.add_run(secrecy)
            set_run_font(r_ftr, size_pt=18, bold=True, color_rgb=RED_STAMP)


def _add_signature_block(
    after_p,
    name: str,
    title: str,
    tab_cm: float = 10.5,
    signature_image_path: str | Path | None = None,
):
    """Append 4 blank Enter lines (or signature PNG overlay) + centered (name) and title."""
    cur = after_p
    sig_path = Path(signature_image_path) if signature_image_path else None
    if sig_path and sig_path.exists():
        cur = insert_paragraph_after(cur)
        set_paragraph_text(cur, [("", 16, False, False)], before_pt=6, after_pt=0)
        cur.paragraph_format.keep_with_next = True
        cur = insert_paragraph_after(cur)
        set_paragraph_text(
            cur,
            [("\t", 16, False, False)],
            alignment=WD_ALIGN_PARAGRAPH.LEFT,
            before_pt=0,
            after_pt=0,
            tab_stops=[(WD_TAB_ALIGNMENT.CENTER, tab_cm)],
        )
        img_run = cur.add_run()
        img_run.add_picture(str(sig_path), height=Cm(1.35))
        cur.paragraph_format.keep_with_next = True
    else:
        for _ in range(4):
            cur = insert_paragraph_after(cur)
            set_paragraph_text(cur, [("", 16, False, False)], before_pt=0, after_pt=0)
            cur.paragraph_format.keep_with_next = True

    clean_name = to_thai_digits(name.strip()) if name else ""
    name_line = f"\t({clean_name})" if clean_name else "\t(\t\t)"
    cur = insert_paragraph_after(cur)
    set_paragraph_text(
        cur,
        [(name_line, 16, False, False)],
        alignment=WD_ALIGN_PARAGRAPH.LEFT,
        before_pt=0,
        after_pt=0,
        first_line_cm=0,
        left_indent_cm=0,
        tab_stops=[(WD_TAB_ALIGNMENT.CENTER, tab_cm)],
    )
    if title:
        cur.paragraph_format.keep_with_next = True
        cur = insert_paragraph_after(cur)
        set_paragraph_text(
            cur,
            [(f"\t{to_thai_digits(title.strip())}", 16, False, False)],
            alignment=WD_ALIGN_PARAGRAPH.LEFT,
            before_pt=0,
            after_pt=0,
            first_line_cm=0,
            left_indent_cm=0,
            tab_stops=[(WD_TAB_ALIGNMENT.CENTER, tab_cm)],
        )
    return cur


def _normalize_body_paragraphs(items: list[str] | str) -> list[str]:
    if isinstance(items, str):
        items = [line.strip() for line in items.split("\n") if line.strip()]
    return [to_thai_digits(p.strip()) for p in items if p and p.strip()]


def build_memo(payload: dict[str, Any], org: dict[str, Any]) -> docx.Document:
    doc = docx.Document(_tpl_path("memo.docx"))
    paras = doc.paragraphs

    # Remove template body/signature paragraphs from P06 onward; keep P00..P05 intact
    for p in list(paras[6:]):
        remove_paragraph(p)

    # Resolve division name & code
    div_code = to_thai_digits((payload.get("division_code") or "").strip())
    div_info = org.get("divisions", {}).get(div_code, {})
    div_name = (payload.get("division_name") or div_info.get("name") or "").strip()
    unit_name = (payload.get("unit_name") or "").strip()
    org_name = org["organization_name"]
    dept_label = " ".join(part for part in (unit_name, div_name, org_name) if part)

    raw_num = (payload.get("doc_number") or "").strip()
    is_circular = bool(payload.get("is_circular", False))
    if raw_num:
        doc_no = format_doc_number(div_code, raw_num, is_circular=is_circular) if "/" not in raw_num else to_thai_digits(
            f"{div_code} {raw_num}".strip()
        )
    else:
        doc_no = f"{div_code} ............./.............".strip()

    thai_date = format_thai_date(payload.get("date"))
    subject = to_thai_digits((payload.get("subject") or "").strip())
    to_text = to_thai_digits((payload.get("to") or org["director"]["title"]).strip())

    # P01: บันทึกข้อความ (29 pt bold, centered, line height 35 pt)
    set_paragraph_text(
        doc.paragraphs[1],
        [("บันทึกข้อความ", 29, True, False)],
        alignment=WD_ALIGN_PARAGRAPH.CENTER,
        before_pt=0,
        after_pt=0,
    )
    doc.paragraphs[1].paragraph_format.line_spacing = Pt(35)
    # P02: ส่วนราชการ (hanging indent at 2.7 cm)
    set_paragraph_text(
        doc.paragraphs[2],
        [("ส่วนราชการ\t", 20, True, False), (dept_label, 16, False, False)],
        left_indent_cm=2.7,
        first_line_cm=-2.7,
        tab_stops=[(WD_TAB_ALIGNMENT.LEFT, 2.7)],
    )
    # P03: ที่ ... วันที่ ...
    set_paragraph_text(
        doc.paragraphs[3],
        [
            ("ที่  ", 20, True, False),
            (doc_no, 16, False, False),
            ("\tวันที่  ", 20, True, False),
            (thai_date, 16, False, False),
        ],
        left_indent_cm=0,
        first_line_cm=0,
        tab_stops=[(WD_TAB_ALIGNMENT.LEFT, 7.5)],
    )
    # P04: เรื่อง (hanging indent at 1.35 cm)
    set_paragraph_text(
        doc.paragraphs[4],
        [("เรื่อง\t", 20, True, False), (subject, 16, False, False)],
        before_pt=0,
        after_pt=0,
        left_indent_cm=1.35,
        first_line_cm=-1.35,
        tab_stops=[(WD_TAB_ALIGNMENT.LEFT, 1.35)],
    )
    # P05: เรียน (align with เรื่อง at 1.35 cm)
    set_paragraph_text(
        doc.paragraphs[5],
        [(f"เรียน\t{to_text}", 16, False, False)],
        before_pt=6,
        after_pt=0,
        left_indent_cm=1.35,
        first_line_cm=-1.35,
        tab_stops=[(WD_TAB_ALIGNMENT.LEFT, 1.35)],
    )

    cur = doc.paragraphs[5]
    for para_text in _normalize_body_paragraphs(payload.get("paragraphs", [])):
        cur = insert_paragraph_after(cur)
        set_paragraph_text(
            cur,
            [(para_text, 16, False, False)],
            alignment=WD_ALIGN_PARAGRAPH.THAI_JUSTIFY,
            before_pt=6,
            after_pt=0,
            first_line_cm=2.5,
        )

    closing = to_thai_digits((payload.get("closing_purpose") or "").strip())
    if closing:
        cur = insert_paragraph_after(cur)
        set_paragraph_text(
            cur,
            [(closing, 16, False, False)],
            alignment=WD_ALIGN_PARAGRAPH.LEFT,
            before_pt=6,
            after_pt=0,
            first_line_cm=2.5,
        )

    signers = payload.get("signers") or [
        {"name": "", "title": "ตำแหน่ง"},
        {"name": "", "title": div_info.get("deputy_title", "รองผู้อำนวยการฝ่าย........")},
    ]
    for s in signers:
        cur = _add_signature_block(
            cur,
            s.get("name", ""),
            s.get("title", ""),
            signature_image_path=s.get("signature_image_path"),
        )

    apply_speed_and_secrecy(doc, payload.get("speed", ""), payload.get("secrecy", ""))
    return doc


def _enable_thai_page_numbers_header(doc: docx.Document) -> None:
    """Enable centered Thai-numeral page numbers in the header from page 2 onward."""
    for sec in doc.sections:
        sec.different_first_page_header_footer = True
        if not sec.header_distance or sec.header_distance < Cm(0.75):
            sec.header_distance = Cm(0.8)

        sect_pr = sec._sectPr
        for old in sect_pr.findall(qn("w:pgNumType")):
            sect_pr.remove(old)
        sect_pr.append(parse_xml(f'<w:pgNumType {nsdecls("w")} w:fmt="thai"/>'))

        hdr = sec.header
        if hdr.tables:
            p = hdr.add_paragraph()
        else:
            for extra in list(hdr.paragraphs)[1:]:
                remove_paragraph(extra)
            p = hdr.paragraphs[0]
            clear_paragraph_runs(p)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)

        for fld_type in ("begin", "instrText", "separate", "end"):
            run = p.add_run()
            set_run_font(run, size_pt=16)
            if fld_type == "begin":
                run._r.append(parse_xml(f'<w:fldChar {nsdecls("w")} w:fldCharType="begin"/>'))
            elif fld_type == "instrText":
                el = parse_xml(f'<w:instrText {nsdecls("w")} xml:space="preserve"> PAGE </w:instrText>')
                run._r.append(el)
            elif fld_type == "separate":
                run._r.append(parse_xml(f'<w:fldChar {nsdecls("w")} w:fldCharType="separate"/>'))
            else:
                run._r.append(parse_xml(f'<w:fldChar {nsdecls("w")} w:fldCharType="end"/>'))


def _split_thai_name_parts(full_name: str) -> tuple[str, str]:
    """Split a Thai full name into (title+first_name, last_name)."""
    cleaned = " ".join((full_name or "").strip().split())
    if not cleaned:
        return ("", "")
    parts = cleaned.split(" ")
    if len(parts) == 2:
        return (parts[0], parts[1])
    return (cleaned, "")


def _append_order_committee_table(doc: docx.Document, after_p, c_idx: int, members: list[dict[str, Any]]):
    """Insert a 4-column borderless member table aligned at 3.2 cm left indent with explicit dxa widths."""
    tbl = doc.add_table(rows=len(members), cols=4)
    tbl.autofit = False
    remove_borderless_table_borders(tbl)

    col_dxa = (539, 1871, 2098, 2551)  # 0.95, 3.30, 3.70, 4.50 cm (total 12.45 cm)
    total_dxa = sum(col_dxa)

    tbl_pr = tbl._tbl.tblPr
    for old_tag in ("w:tblW", "w:tblInd", "w:tblLayout", "w:tblCellMar"):
        for old in tbl_pr.findall(qn(old_tag)):
            tbl_pr.remove(old)
    tbl_pr.append(parse_xml(f'<w:tblW {nsdecls("w")} w:w="{total_dxa}" w:type="dxa"/>'))
    tbl_pr.append(parse_xml(f'<w:tblInd {nsdecls("w")} w:w="1814" w:type="dxa"/>'))
    tbl_pr.append(parse_xml(f'<w:tblLayout {nsdecls("w")} w:type="fixed"/>'))
    tbl_pr.append(
        parse_xml(
            f'<w:tblCellMar {nsdecls("w")}>'
            '<w:top w:w="0" w:type="dxa"/>'
            '<w:left w:w="15" w:type="dxa"/>'
            '<w:bottom w:w="0" w:type="dxa"/>'
            '<w:right w:w="15" w:type="dxa"/>'
            "</w:tblCellMar>"
        )
    )

    tbl_grid = tbl._tbl.tblGrid
    if tbl_grid is not None:
        for old_gc in list(tbl_grid.findall(qn("w:gridCol"))):
            tbl_grid.remove(old_gc)
        for w_dxa in col_dxa:
            tbl_grid.append(parse_xml(f'<w:gridCol {nsdecls("w")} w:w="{w_dxa}"/>'))

    c_th = to_thai_digits(str(c_idx))

    for m_idx, mem in enumerate(members, start=1):
        row = tbl.rows[m_idx - 1]
        tr_pr = row._tr.get_or_add_trPr()
        tr_pr.append(parse_xml(f'<w:cantSplit {nsdecls("w")}/>'))

        first = to_thai_digits((mem.get("first_name") or "").strip())
        last = to_thai_digits((mem.get("last_name") or "").strip())
        if not first and mem.get("name"):
            first, last = _split_thai_name_parts(to_thai_digits(str(mem.get("name") or "")))
        role = to_thai_digits((mem.get("role") or "").strip())
        item_no = f"{c_th}.{to_thai_digits(str(m_idx))}"
        values = (item_no, first, last, role)

        for col_i, val in enumerate(values):
            cell = row.cells[col_i]
            tc_pr = cell._tc.get_or_add_tcPr()
            for old_w in tc_pr.findall(qn("w:tcW")):
                tc_pr.remove(old_w)
            tc_pr.append(parse_xml(f'<w:tcW {nsdecls("w")} w:w="{col_dxa[col_i]}" w:type="dxa"/>'))
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 0.95
            run = p.add_run(val)
            set_run_font(run, size_pt=16, bold=False, underline=False)

    after_p._element.addnext(tbl._tbl)
    anchor = OxmlElement("w:p")
    tbl._tbl.addnext(anchor)
    return docx.text.paragraph.Paragraph(anchor, after_p._parent)


def build_order(payload: dict[str, Any], org: dict[str, Any]) -> docx.Document:
    doc = docx.Document(_tpl_path("order.docx"))
    # Remove P08 (VML separator line) and P09+ so the order follows the clean CRIC format
    for p in list(doc.paragraphs[8:]):
        remove_paragraph(p)

    org_name = org["organization_name"]
    raw_no = (payload.get("order_number") or "").strip()
    is_circular = bool(payload.get("is_circular", False))
    if raw_no:
        if "/" in raw_no:
            order_no = to_thai_digits(f"ว {raw_no}" if is_circular and not raw_no.startswith("ว") else raw_no)
        else:
            order_no = format_doc_number("", raw_no, is_circular=is_circular)
    else:
        order_no = f"............../{to_thai_digits(str(current_buddhist_year()))}"

    subject = to_thai_digits((payload.get("subject") or "").strip())
    set_paragraph_text(doc.paragraphs[5], [(f"คำสั่ง{org_name}", 16, False, False)], alignment=WD_ALIGN_PARAGRAPH.CENTER, before_pt=6)
    set_paragraph_text(doc.paragraphs[6], [(f"ที่  {order_no}", 16, False, False)], alignment=WD_ALIGN_PARAGRAPH.CENTER)
    set_paragraph_text(doc.paragraphs[7], [(f"เรื่อง  {subject}", 16, False, False)], alignment=WD_ALIGN_PARAGRAPH.CENTER, after_pt=6)

    cur = doc.paragraphs[7]
    body_paras = _normalize_body_paragraphs(payload.get("paragraphs", []))
    for idx, para_text in enumerate(body_paras):
        cur = insert_paragraph_after(cur)
        set_paragraph_text(
            cur,
            [(para_text, 16, False, False)],
            alignment=WD_ALIGN_PARAGRAPH.THAI_JUSTIFY,
            before_pt=12 if idx == 0 else 6,
            after_pt=0,
            first_line_cm=2.5,
        )

    committees = payload.get("committees") or []
    for c_idx, comm in enumerate(committees, start=1):
        if not isinstance(comm, dict):
            continue
        c_title = to_thai_digits((comm.get("title") or "").strip())
        c_duties = to_thai_digits((comm.get("duties") or "").strip())
        c_duty_items = [to_thai_digits(str(d).strip()) for d in (comm.get("duty_items") or []) if str(d).strip()]
        c_members = [m for m in (comm.get("members") or []) if isinstance(m, dict) and ((m.get("first_name") or "").strip() or (m.get("name") or "").strip())]

        if c_title:
            cur = insert_paragraph_after(cur)
            set_paragraph_text(
                cur,
                [(f"{to_thai_digits(str(c_idx))}. {c_title}", 16, True, False)],
                alignment=WD_ALIGN_PARAGRAPH.LEFT,
                before_pt=8,
                after_pt=0,
                first_line_cm=2.5,
            )
            cur.paragraph_format.keep_with_next = True

        if c_duties:
            cur = insert_paragraph_after(cur)
            set_paragraph_text(
                cur,
                [("มีหน้าที่", 16, True, True), (f"  {c_duties}", 16, False, False)],
                alignment=WD_ALIGN_PARAGRAPH.THAI_JUSTIFY,
                before_pt=2,
                after_pt=2,
                first_line_cm=2.5,
            )

        if c_members:
            cur = _append_order_committee_table(doc, cur, c_idx, c_members)
            cur.paragraph_format.space_before = Pt(0)
            cur.paragraph_format.space_after = Pt(0)

        for d_idx, d_item in enumerate(c_duty_items, start=1):
            cur = insert_paragraph_after(cur)
            set_paragraph_text(
                cur,
                [(f"({to_thai_digits(str(d_idx))}) {d_item}", 16, False, False)],
                alignment=WD_ALIGN_PARAGRAPH.THAI_JUSTIFY,
                before_pt=2,
                after_pt=0,
                first_line_cm=2.5,
            )

    eff_line = to_thai_digits((payload.get("effective_line") or "ทั้งนี้ ตั้งแต่บัดนี้เป็นต้นไป").strip())
    cur = insert_paragraph_after(cur)
    set_paragraph_text(
        cur,
        [(eff_line, 16, False, False)],
        alignment=WD_ALIGN_PARAGRAPH.THAI_JUSTIFY if len(eff_line) > 55 else WD_ALIGN_PARAGRAPH.LEFT,
        before_pt=6,
        after_pt=0,
        first_line_cm=2.5,
    )

    order_date = format_thai_date(payload.get("order_date"), include_be_prefix=True)
    cur = insert_paragraph_after(cur)
    set_paragraph_text(
        cur,
        [(f"สั่ง ณ วันที่ {order_date}", 16, False, False)],
        alignment=WD_ALIGN_PARAGRAPH.LEFT,
        before_pt=12,
        after_pt=0,
        left_indent_cm=5.0,
    )

    signer = payload.get("signer") or org["director"]
    _add_signature_block(
        cur,
        signer.get("name", ""),
        signer.get("title", ""),
        signature_image_path=signer.get("signature_image_path"),
    )
    apply_speed_and_secrecy(doc, payload.get("speed", ""), payload.get("secrecy", ""))
    _enable_thai_page_numbers_header(doc)
    return doc


def build_announcement(payload: dict[str, Any], org: dict[str, Any]) -> docx.Document:
    doc = docx.Document(_tpl_path("announcement.docx"))
    for sec in doc.sections:
        sec.top_margin = Cm(1.5)
        sec.bottom_margin = Cm(1.5)
    for p in list(doc.paragraphs[8:]):
        remove_paragraph(p)

    org_name = org["organization_name"]
    subject = to_thai_digits((payload.get("subject") or "").strip())
    set_paragraph_text(doc.paragraphs[5], [(f"ประกาศ{org_name}", 16, False, False)], alignment=WD_ALIGN_PARAGRAPH.CENTER, before_pt=6)
    set_paragraph_text(doc.paragraphs[6], [(f"เรื่อง  {subject}", 16, False, False)], alignment=WD_ALIGN_PARAGRAPH.CENTER)

    cur = doc.paragraphs[7]  # VML horizontal line
    body_paras = _normalize_body_paragraphs(payload.get("paragraphs", []))
    for idx, para_text in enumerate(body_paras):
        cur = insert_paragraph_after(cur)
        set_paragraph_text(
            cur,
            [(para_text, 16, False, False)],
            alignment=WD_ALIGN_PARAGRAPH.THAI_JUSTIFY,
            before_pt=12 if idx == 0 else 6,
            after_pt=0,
            first_line_cm=2.5,
        )

    closing = to_thai_digits((payload.get("closing_line") or "จึงประกาศให้ทราบโดยทั่วกัน").strip())
    cur = insert_paragraph_after(cur)
    set_paragraph_text(
        cur,
        [(closing, 16, False, False)],
        alignment=WD_ALIGN_PARAGRAPH.LEFT,
        before_pt=6,
        after_pt=0,
        first_line_cm=2.5,
    )

    announce_date = format_thai_date(payload.get("announce_date"), include_be_prefix=True)
    cur = insert_paragraph_after(cur)
    set_paragraph_text(
        cur,
        [(f"ประกาศ ณ วันที่ {announce_date}", 16, False, False)],
        alignment=WD_ALIGN_PARAGRAPH.LEFT,
        before_pt=12,
        after_pt=0,
        left_indent_cm=5.0,
    )

    signer = payload.get("signer") or org["director"]
    _add_signature_block(
        cur,
        signer.get("name", ""),
        signer.get("title", ""),
        signature_image_path=signer.get("signature_image_path"),
    )
    apply_speed_and_secrecy(doc, payload.get("speed", ""), payload.get("secrecy", ""))
    return doc


def build_external(payload: dict[str, Any], org: dict[str, Any]) -> docx.Document:
    doc = docx.Document(_tpl_path("external.docx"))
    # Keep P00..P08 (Garuda, spacing, header block, เรื่อง, เรียน) and remove P09 onward
    for p in list(doc.paragraphs[9:]):
        remove_paragraph(p)

    doc_no = format_doc_number(
        org["doc_number_prefix"],
        payload.get("doc_number", ""),
        is_circular=bool(payload.get("is_circular", False)),
    )
    addr = [to_thai_digits(line) for line in org.get("address_lines", [])]
    addr_1 = addr[0] if len(addr) > 0 else ""
    addr_2 = addr[1] if len(addr) > 1 else ""

    thai_date = format_thai_date(payload.get("date"))
    subject = to_thai_digits((payload.get("subject") or "").strip())
    to_text = to_thai_digits((payload.get("to") or "").strip())

    # P03: ที่ ... \t ชื่อหน่วยงาน (right column aligned at 10.5 cm)
    set_paragraph_text(
        doc.paragraphs[3],
        [(f"ที่ {doc_no}\t{org['organization_name']}", 16, False, False)],
        left_indent_cm=0,
        first_line_cm=0,
        tab_stops=[(WD_TAB_ALIGNMENT.LEFT, 10.5)],
    )
    set_paragraph_text(doc.paragraphs[4], [(addr_1, 16, False, False)], left_indent_cm=10.5, first_line_cm=0)
    set_paragraph_text(doc.paragraphs[5], [(addr_2, 16, False, False)], left_indent_cm=10.5, first_line_cm=0)
    set_paragraph_text(
        doc.paragraphs[6],
        [(f"\t{thai_date}", 16, False, False)],
        before_pt=6,
        left_indent_cm=0,
        first_line_cm=0,
        tab_stops=[(WD_TAB_ALIGNMENT.LEFT, 8.5)],
    )
    set_paragraph_text(
        doc.paragraphs[7],
        [(f"เรื่อง\t{subject}", 16, False, False)],
        before_pt=6,
        left_indent_cm=1.35,
        first_line_cm=-1.35,
        tab_stops=[(WD_TAB_ALIGNMENT.LEFT, 1.35)],
    )
    set_paragraph_text(
        doc.paragraphs[8],
        [(f"เรียน\t{to_text}", 16, False, False)],
        before_pt=6,
        left_indent_cm=1.35,
        first_line_cm=-1.35,
        tab_stops=[(WD_TAB_ALIGNMENT.LEFT, 1.35)],
    )

    cur = doc.paragraphs[8]

    # Optional อ้างถึง (hanging indent at 1.6 cm)
    ref = payload.get("reference")
    if ref:
        ref_str = to_thai_digits(ref.strip()) if isinstance(ref, str) else "\n".join(to_thai_digits(str(x)) for x in ref)
        cur = insert_paragraph_after(cur)
        set_paragraph_text(
            cur,
            [(f"อ้างถึง\t{ref_str}", 16, False, False)],
            before_pt=6,
            left_indent_cm=1.6,
            first_line_cm=-1.6,
            tab_stops=[(WD_TAB_ALIGNMENT.LEFT, 1.6)],
        )

    # Optional สิ่งที่ส่งมาด้วย (hanging indent at 2.7 cm)
    attachments = payload.get("attachments") or []
    if isinstance(attachments, str):
        attachments = [attachments] if attachments.strip() else []
    attachments = [to_thai_digits(a.strip()) for a in attachments if a and a.strip()]
    if len(attachments) == 1:
        cur = insert_paragraph_after(cur)
        set_paragraph_text(
            cur,
            [(f"สิ่งที่ส่งมาด้วย\t{attachments[0]}", 16, False, False)],
            before_pt=6,
            left_indent_cm=2.7,
            first_line_cm=-2.7,
            tab_stops=[(WD_TAB_ALIGNMENT.LEFT, 2.7)],
        )
    elif len(attachments) > 1:
        for idx, item in enumerate(attachments, start=1):
            cur = insert_paragraph_after(cur)
            if idx == 1:
                set_paragraph_text(
                    cur,
                    [(f"สิ่งที่ส่งมาด้วย\t{to_thai_digits(str(idx))}. {item}", 16, False, False)],
                    before_pt=6,
                    left_indent_cm=2.7,
                    first_line_cm=-2.7,
                    tab_stops=[(WD_TAB_ALIGNMENT.LEFT, 2.7)],
                )
            else:
                set_paragraph_text(
                    cur,
                    [(f"{to_thai_digits(str(idx))}. {item}", 16, False, False)],
                    before_pt=0,
                    left_indent_cm=2.7,
                    first_line_cm=0,
                )

    for para_text in _normalize_body_paragraphs(payload.get("paragraphs", [])):
        cur = insert_paragraph_after(cur)
        set_paragraph_text(
            cur,
            [(para_text, 16, False, False)],
            alignment=WD_ALIGN_PARAGRAPH.THAI_JUSTIFY,
            before_pt=6,
            after_pt=0,
            first_line_cm=2.5,
        )

    closing = to_thai_digits((payload.get("closing_purpose") or "").strip())
    if closing:
        cur = insert_paragraph_after(cur)
        set_paragraph_text(
            cur,
            [(closing, 16, False, False)],
            alignment=WD_ALIGN_PARAGRAPH.LEFT,
            before_pt=6,
            after_pt=0,
            first_line_cm=2.5,
        )

    salutation = to_thai_digits((payload.get("salutation") or "ขอแสดงความนับถือ").strip())
    cur = insert_paragraph_after(cur)
    set_paragraph_text(
        cur,
        [(f"\t{salutation}", 16, False, False)],
        before_pt=12,
        after_pt=0,
        tab_stops=[(WD_TAB_ALIGNMENT.CENTER, 10.5)],
    )
    cur.paragraph_format.keep_with_next = True

    signer = payload.get("signer") or org["director"]
    cur = _add_signature_block(
        cur,
        signer.get("name", ""),
        signer.get("title", ""),
        signature_image_path=signer.get("signature_image_path"),
    )

    # Contact block at bottom
    contact = payload.get("contact") or {}
    unit = to_thai_digits((contact.get("unit") or "งานบริหารงานทั่วไป").strip())
    div = to_thai_digits((contact.get("division") or "ฝ่ายบริหารทรัพยากร").strip())
    phone = to_thai_digits((contact.get("phone_fax") or org.get("phone_fax", "")).strip())
    esaraban = to_thai_digits((contact.get("esaraban_name") or org.get("esaraban_name", org["organization_name"])).strip())
    email = (contact.get("email") or org.get("email", "")).strip()

    for _ in range(3):
        cur = insert_paragraph_after(cur)
        set_paragraph_text(cur, [("", 16, False, False)])

    contact_lines = [
        f"{unit} : {div}" if unit and div else (unit or div),
        f"โทร/โทรสาร {phone}" if phone else "",
        f"สารบรรณอิเล็กทรอนิกส์: {esaraban}" if esaraban else "",
        f"E-mail: {email}" if email else "",
    ]
    for line in contact_lines:
        if line:
            cur = insert_paragraph_after(cur)
            set_paragraph_text(cur, [(line, 16, False, False)], before_pt=0, after_pt=0)

    apply_speed_and_secrecy(doc, payload.get("speed", ""), payload.get("secrecy", ""))
    return doc


def build_agenda(payload: dict[str, Any], org: dict[str, Any]) -> docx.Document:
    doc = docx.Document(_tpl_path("agenda.docx"))
    for p in list(doc.paragraphs[1:]):
        remove_paragraph(p)

    title = to_thai_digits((payload.get("meeting_title") or "").strip())
    session = to_thai_digits((payload.get("session") or "๑/๒๕๖๙").strip())
    thai_date = format_thai_date(payload.get("date"))
    time_str = to_thai_digits((payload.get("time") or "๐๙.๐๐ น.").strip())
    location = to_thai_digits((payload.get("location") or org["organization_name"]).strip())

    set_paragraph_text(doc.paragraphs[0], [(f"ระเบียบวาระการประชุม{title}", 16, True, False)], alignment=WD_ALIGN_PARAGRAPH.CENTER)
    cur = doc.paragraphs[0]
    for line in (f"ครั้งที่ {session}", f"ในวันที่ {thai_date} เวลา {time_str}", f"ณ {location}"):
        cur = insert_paragraph_after(cur)
        set_paragraph_text(cur, [(line, 16, False, False)], alignment=WD_ALIGN_PARAGRAPH.CENTER)

    cur = insert_paragraph_after(cur)
    set_paragraph_text(cur, [("------------------------------------------------------------", 16, False, False)], alignment=WD_ALIGN_PARAGRAPH.CENTER, before_pt=6)

    def _add_agenda_section(num_th: str, heading: str, items: list[str], numbered: bool = False) -> None:
        nonlocal cur
        cur = insert_paragraph_after(cur)
        set_paragraph_text(
            cur,
            [(f"ระเบียบวาระที่ {num_th}", 16, False, True), (f"   {heading}", 16, False, False)],
            before_pt=6,
        )
        clean_items = [to_thai_digits(str(x).strip()) for x in items if str(x).strip()]
        if not clean_items:
            cur = insert_paragraph_after(cur)
            set_paragraph_text(cur, [("ไม่มี", 16, False, False)], left_indent_cm=2.5)
            return
        for idx, item in enumerate(clean_items, start=1):
            cur = insert_paragraph_after(cur)
            prefix = f"{num_th}.{to_thai_digits(str(idx))} " if numbered else ""
            set_paragraph_text(cur, [(f"{prefix}{item}", 16, False, False)], left_indent_cm=2.5, alignment=WD_ALIGN_PARAGRAPH.THAI_JUSTIFY)

    _add_agenda_section("๑", "เรื่องที่ประธานแจ้งที่ประชุมทราบ", payload.get("agenda_1") or [])

    ag2 = payload.get("agenda_2") or "ประธานเสนอให้ที่ประชุมพิจารณาร่างรายงานการประชุมครั้งที่ผ่านมา"
    _add_agenda_section("๒", "เรื่องรับรองรายงานการประชุม", [ag2] if isinstance(ag2, str) else ag2)

    _add_agenda_section("๓", "เรื่องที่เสนอให้ที่ประชุมทราบ", payload.get("agenda_3") or [], numbered=True)
    _add_agenda_section("๔", "เรื่องที่เสนอให้ที่ประชุมพิจารณา", payload.get("agenda_4") or [], numbered=True)
    _add_agenda_section("๕", "เรื่องอื่น ๆ (ถ้ามี)", payload.get("agenda_5") or [])

    cur = insert_paragraph_after(cur)
    set_paragraph_text(cur, [("---------------------------------------------", 16, False, False)], alignment=WD_ALIGN_PARAGRAPH.CENTER, before_pt=12)

    apply_speed_and_secrecy(doc, payload.get("speed", ""), payload.get("secrecy", ""))
    return doc


def build_minutes(payload: dict[str, Any], org: dict[str, Any]) -> docx.Document:
    doc = docx.Document(_tpl_path("minutes.docx"))
    for p in list(doc.paragraphs[1:]):
        remove_paragraph(p)

    title = to_thai_digits((payload.get("meeting_title") or "").strip())
    session = to_thai_digits((payload.get("session") or "๑/๒๕๖๙").strip())
    thai_date = format_thai_date(payload.get("date"))
    time_str = to_thai_digits((payload.get("time") or "๐๙.๐๐ น.").strip())
    location = to_thai_digits((payload.get("location") or org["organization_name"]).strip())

    set_paragraph_text(doc.paragraphs[0], [(f"รายงานการประชุม{title}", 16, True, False)], alignment=WD_ALIGN_PARAGRAPH.CENTER)
    cur = doc.paragraphs[0]
    for line in (f"ครั้งที่ {session}", f"ในวันที่ {thai_date} เวลา {time_str}", f"ณ {location}"):
        cur = insert_paragraph_after(cur)
        set_paragraph_text(cur, [(line, 16, False, False)], alignment=WD_ALIGN_PARAGRAPH.CENTER)

    cur = insert_paragraph_after(cur)
    set_paragraph_text(cur, [("------------------------------------------------------------", 16, False, False)], alignment=WD_ALIGN_PARAGRAPH.CENTER, before_pt=6)

    def _add_people_group(label: str, people: list[str]) -> None:
        nonlocal cur
        cur = insert_paragraph_after(cur)
        set_paragraph_text(cur, [(label, 16, True, False)], before_pt=6)
        for person in people:
            if str(person).strip():
                cur = insert_paragraph_after(cur)
                set_paragraph_text(cur, [(to_thai_digits(str(person).strip()), 16, False, False)], left_indent_cm=1.5)

    _add_people_group("ผู้มาประชุม", payload.get("attendees") or [])
    if payload.get("absentees"):
        _add_people_group("ผู้ไม่มาประชุม", payload["absentees"])
    if payload.get("participants"):
        _add_people_group("ผู้เข้าร่วมประชุม", payload["participants"])

    start_time = to_thai_digits((payload.get("start_time") or time_str).strip())
    cur = insert_paragraph_after(cur)
    set_paragraph_text(cur, [(f"เริ่มประชุมเวลา {start_time}", 16, False, False)], before_pt=6)

    cur = insert_paragraph_after(cur)
    set_paragraph_text(
        cur,
        [("ประธานกล่าวเปิดประชุมและดำเนินการประชุมตามระเบียบวาระต่าง ๆ ดังต่อไปนี้", 16, False, False)],
        before_pt=6,
        first_line_cm=2.5,
    )

    # วาระที่ 1
    cur = insert_paragraph_after(cur)
    set_paragraph_text(cur, [("ระเบียบวาระที่ ๑", 16, False, True), ("   เรื่องที่ประธานแจ้งที่ประชุมทราบ", 16, False, False)], before_pt=6)
    ag1 = payload.get("agenda_1") or []
    for item in ag1:
        cur = insert_paragraph_after(cur)
        set_paragraph_text(cur, [(to_thai_digits(str(item).strip()), 16, False, False)], left_indent_cm=2.5, alignment=WD_ALIGN_PARAGRAPH.THAI_JUSTIFY)
    cur = insert_paragraph_after(cur)
    set_paragraph_text(cur, [("ที่ประชุมรับทราบ", 16, False, False)], left_indent_cm=2.5)

    # วาระที่ 2
    cur = insert_paragraph_after(cur)
    set_paragraph_text(cur, [("ระเบียบวาระที่ ๒", 16, False, True), ("   เรื่องรับรองรายงานการประชุม", 16, False, False)], before_pt=6)
    ag2_draft = to_thai_digits((payload.get("agenda_2_draft") or "ร่างรายงานการประชุมครั้งที่ผ่านมา").strip())
    ag2_res = to_thai_digits((payload.get("agenda_2_resolution") or "ที่ประชุมพิจารณาแล้ว รับรองรายงานการประชุม").strip())
    cur = insert_paragraph_after(cur)
    set_paragraph_text(cur, [(f"ประธานเสนอให้ที่ประชุมพิจารณา{ag2_draft}", 16, False, False)], left_indent_cm=2.5, alignment=WD_ALIGN_PARAGRAPH.THAI_JUSTIFY)
    cur = insert_paragraph_after(cur)
    set_paragraph_text(cur, [(ag2_res, 16, False, False)], left_indent_cm=2.5)

    # วาระที่ 3
    cur = insert_paragraph_after(cur)
    set_paragraph_text(cur, [("ระเบียบวาระที่ ๓", 16, False, True), ("   เรื่องที่เสนอให้ที่ประชุมทราบ", 16, False, False)], before_pt=6)
    for idx, entry in enumerate(payload.get("agenda_3") or [], start=1):
        if isinstance(entry, dict):
            text = to_thai_digits((entry.get("item") or "").strip())
            note = to_thai_digits((entry.get("note") or "ที่ประชุมรับทราบ").strip())
        else:
            text = to_thai_digits(str(entry).strip())
            note = "ที่ประชุมรับทราบ"
        cur = insert_paragraph_after(cur)
        set_paragraph_text(cur, [(f"๓.{to_thai_digits(str(idx))} {text}", 16, False, False)], left_indent_cm=2.5, alignment=WD_ALIGN_PARAGRAPH.THAI_JUSTIFY)
        cur = insert_paragraph_after(cur)
        set_paragraph_text(cur, [(note, 16, False, False)], left_indent_cm=2.5)

    # วาระที่ 4
    cur = insert_paragraph_after(cur)
    set_paragraph_text(cur, [("ระเบียบวาระที่ ๔", 16, False, True), ("   เรื่องที่เสนอให้ที่ประชุมพิจารณา", 16, False, False)], before_pt=6)
    for idx, entry in enumerate(payload.get("agenda_4") or [], start=1):
        if isinstance(entry, dict):
            item_t = to_thai_digits((entry.get("item") or "").strip())
            detail = to_thai_digits((entry.get("detail") or "").strip())
            res = to_thai_digits((entry.get("resolution") or "").strip())
        else:
            item_t = to_thai_digits(str(entry).strip())
            detail = ""
            res = ""
        cur = insert_paragraph_after(cur)
        set_paragraph_text(cur, [(f"๔.{to_thai_digits(str(idx))} {item_t}", 16, False, False)], left_indent_cm=2.5, alignment=WD_ALIGN_PARAGRAPH.THAI_JUSTIFY)
        if detail:
            cur = insert_paragraph_after(cur)
            set_paragraph_text(cur, [(detail, 16, False, False)], left_indent_cm=2.5, alignment=WD_ALIGN_PARAGRAPH.THAI_JUSTIFY)
        if res:
            cur = insert_paragraph_after(cur)
            set_paragraph_text(cur, [(f"มติประชุม  {res}", 16, False, False)], left_indent_cm=2.5)

    # วาระที่ 5
    cur = insert_paragraph_after(cur)
    set_paragraph_text(cur, [("ระเบียบวาระที่ ๕", 16, False, True), ("   เรื่องอื่น ๆ (ถ้ามี)", 16, False, False)], before_pt=6)
    ag5 = payload.get("agenda_5") or {}
    if isinstance(ag5, list):
        ag5_items = ag5
        next_date = ""
    else:
        ag5_items = ag5.get("items") or []
        next_date = ag5.get("next_meeting_date") or ""
    for item in ag5_items:
        cur = insert_paragraph_after(cur)
        set_paragraph_text(cur, [(to_thai_digits(str(item).strip()), 16, False, False)], left_indent_cm=2.5, alignment=WD_ALIGN_PARAGRAPH.THAI_JUSTIFY)
    if next_date:
        cur = insert_paragraph_after(cur)
        set_paragraph_text(cur, [(f"ประธานนัดประชุมครั้งต่อไป ในวันที่ {format_thai_date(next_date)}", 16, False, False)], left_indent_cm=2.5)
    cur = insert_paragraph_after(cur)
    set_paragraph_text(cur, [("ประธานกล่าวปิดประชุม", 16, False, False)], left_indent_cm=2.5)

    end_time = to_thai_digits((payload.get("end_time") or "............ น.").strip())
    cur = insert_paragraph_after(cur)
    set_paragraph_text(cur, [(f"เลิกประชุมเวลา {end_time}", 16, False, False)], before_pt=6)

    # Recorder signature
    recorder = payload.get("recorder") or {"name": "", "title": "ผู้จดรายงานการประชุม"}
    cur = insert_paragraph_after(cur)
    set_paragraph_text(
        cur,
        [("\tลงลายมือชื่อ", 16, False, False)],
        before_pt=6,
        tab_stops=[(WD_TAB_ALIGNMENT.CENTER, 10.5)],
    )
    cur.paragraph_format.keep_with_next = True
    for _ in range(2):
        cur = insert_paragraph_after(cur)
        set_paragraph_text(cur, [("", 16, False, False)], before_pt=0, after_pt=0)
        cur.paragraph_format.keep_with_next = True
    rec_name = to_thai_digits((recorder.get("name") or "").strip())
    rec_title = to_thai_digits((recorder.get("title") or "ผู้จดรายงานการประชุม").strip())
    cur = insert_paragraph_after(cur)
    set_paragraph_text(
        cur,
        [(f"\t({rec_name})" if rec_name else "\t(............................................................)", 16, False, False)],
        before_pt=0,
        tab_stops=[(WD_TAB_ALIGNMENT.CENTER, 10.5)],
    )
    cur.paragraph_format.keep_with_next = True
    cur = insert_paragraph_after(cur)
    set_paragraph_text(
        cur,
        [(f"\t{rec_title}", 16, False, False)],
        tab_stops=[(WD_TAB_ALIGNMENT.CENTER, 10.5)],
    )

    apply_speed_and_secrecy(doc, payload.get("speed", ""), payload.get("secrecy", ""))
    return doc


BUILDERS = {
    "memo": build_memo,
    "order": build_order,
    "external": build_external,
    "announcement": build_announcement,
    "agenda": build_agenda,
    "minutes": build_minutes,
}


def generate_document(payload: dict[str, Any], output_path: Path, validate: bool = True) -> int:
    issues, _ = generate_document_with_report(payload, output_path, validate=validate)
    if validate:
        errors = [i for i in issues if i.level == "ERROR"]
        warnings = [i for i in issues if i.level == "WARNING"]
        for item in issues:
            print(f"[{item.level}] {item.location}: {item.message}")
        if not issues:
            print("[VALIDATE] PASS (0 errors, 0 warnings)")
        else:
            print(f"[VALIDATE] {len(errors)} error(s), {len(warnings)} warning(s)")
        return 1 if errors else 0
    return 0


def generate_document_with_report(
    payload: dict[str, Any],
    output_path: Path,
    validate: bool = True,
    org_defaults_override: dict[str, Any] | None = None,
    extra_misspellings: dict[str, str] | None = None,
    extra_forbidden: list[str] | None = None,
) -> tuple[list[Any], str]:
    doc_type = (payload.get("type") or "").strip().lower()
    if doc_type not in BUILDERS:
        raise ValueError(f"Unsupported document type '{doc_type}'. Expected one of: {', '.join(BUILDERS)}")

    font_family = resolve_font_family(payload.get("font_family"))
    token = _ACTIVE_FONT.set(font_family)
    try:
        defaults = load_defaults()
        if org_defaults_override:
            for k, v in org_defaults_override.items():
                if v is not None:
                    defaults[k] = v
        org = merge_org(defaults, payload)
        doc = BUILDERS[doc_type](payload, org)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        doc.save(str(output_path))
    finally:
        _ACTIVE_FONT.reset(token)

    issues = (
        validate_document(output_path, extra_misspellings=extra_misspellings, extra_forbidden=extra_forbidden)
        if validate
        else []
    )
    return issues, font_family


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Generate Thai official .docx from JSON payload")
    parser.add_argument("--input", type=Path, help="Path to JSON payload file (reads stdin if omitted)")
    parser.add_argument("--output", type=Path, help="Destination .docx path (default: output/<type>.docx)")
    parser.add_argument("--no-validate", action="store_true", help="Skip automatic validation")
    args = parser.parse_args()

    if args.input:
        raw = args.input.read_text(encoding="utf-8")
    else:
        raw = sys.stdin.read()

    payload = json.loads(raw)
    doc_type = (payload.get("type") or "document").strip().lower()
    out_path = args.output or (Path.cwd() / "output" / f"{doc_type}.docx")
    return generate_document(payload, out_path, validate=not args.no_validate)


if __name__ == "__main__":
    sys.exit(main())
