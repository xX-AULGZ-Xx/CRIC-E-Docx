"""Teaching Plans, Course Syllabus, Post-Teaching Reports, and Online Teaching Reports Engine (แผนการสอน 2-69)."""

from __future__ import annotations

import copy
import re
import subprocess
import zipfile
from pathlib import Path
from typing import Any

import docx
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Cm, Pt

from app.config import ATTACHMENTS_DIR, TEMPLATES_DIR
from app.engine.pdf_converter import convert_office_to_pdf, render_pdf_pages_to_png
from app.engine.template_resolver import resolve_system_template
from app.engine.thai_utils import current_buddhist_year, format_thai_date, to_thai_digits

TEACH_TEMPLATES_DIR = TEMPLATES_DIR / "teaching"
DEFAULT_FONT = "TH Sarabun New"
CHECKBOX_FONT = "DejaVu Sans"
_THAI_TOKEN_RE = re.compile(r"([☑☐✓])")


def _apply_run_font(run: Any, font_name: str = DEFAULT_FONT, size_pt: float | None = 16.0, bold: bool | None = None) -> None:
    rpr = run._element.get_or_add_rPr()
    if bold is not None:
        run.bold = bold
        for old_b in rpr.findall(qn("w:bCs")):
            rpr.remove(old_b)
        if bold:
            rpr.append(OxmlElement("w:bCs"))
    if font_name:
        run.font.name = font_name
    if size_pt:
        run.font.size = Pt(size_pt)
        half_pt = str(int(round(size_pt * 2)))
        for tag in ("w:sz", "w:szCs"):
            for old_s in rpr.findall(qn(tag)):
                rpr.remove(old_s)
            el = OxmlElement(tag)
            el.set(qn("w:val"), half_pt)
            rpr.append(el)
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.insert(0, rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        rfonts.set(qn(attr), font_name)
    rfonts.set(qn("w:hint"), "cs")


def _set_a4_section(
    doc: docx.Document,
    top_cm: float = 1.5,
    bottom_cm: float = 1.5,
    left_cm: float = 2.0,
    right_cm: float = 1.5,
) -> None:
    """Normalize every teaching document to standard A4 (21.0 x 29.7 cm) with safe printable margins."""
    for sec in doc.sections:
        sec.page_width = Cm(21.0)
        sec.page_height = Cm(29.7)
        sec.top_margin = Cm(top_cm)
        sec.bottom_margin = Cm(bottom_cm)
        sec.left_margin = Cm(left_cm)
        sec.right_margin = Cm(right_cm)


def _set_para_text(
    para: Any,
    text: str,
    font_name: str | None = None,
    font_size_pt: float | None = None,
    bold: bool | None = None,
) -> None:
    # Remove non-run wrappers (e.g., <w:hyperlink>, <w:proofErr>) so stale template fragments never linger
    for child in list(para._element):
        if child.tag not in (qn("w:pPr"), qn("w:r")):
            para._element.remove(child)
    if not para.runs:
        r = para.add_run(text)
        _apply_run_font(r, font_name or DEFAULT_FONT, font_size_pt, bold=bold)
        return
    r0 = para.runs[0]
    r0.text = text
    if font_name or font_size_pt or bold is not None:
        _apply_run_font(r0, font_name or r0.font.name or DEFAULT_FONT, font_size_pt, bold=bold)
    for r in para.runs[1:]:
        r.text = ""


def _add_mixed_runs(
    para: Any,
    text: str,
    font_name: str = DEFAULT_FONT,
    size_pt: float = 15.0,
    bold: bool = False,
) -> None:
    """Render checkbox symbols (☑/☐/✓) in DejaVu Sans so Word and Linux LibreOffice never render missing glyphs."""
    parts = _THAI_TOKEN_RE.split(str(text))
    for part in parts:
        if not part:
            continue
        r = para.add_run(part)
        if part in ("☑", "☐", "✓"):
            _apply_run_font(r, CHECKBOX_FONT, max(11.0, size_pt - 2.0), bold=False)
        else:
            _apply_run_font(r, font_name, size_pt, bold=bold)


def _set_cell_lines(
    cell: Any,
    lines: list[tuple[str, bool]],
    font_name: str = DEFAULT_FONT,
    size_pt: float = 14.5,
    align: WD_ALIGN_PARAGRAPH | None = None,
) -> None:
    for p in list(cell.paragraphs)[1:]:
        _remove_para(p)
    p0 = cell.paragraphs[0]
    p0.text = ""
    for idx, (txt, is_bold) in enumerate(lines):
        p = p0 if idx == 0 else cell.add_paragraph()
        p.paragraph_format.space_before = Pt(1)
        p.paragraph_format.space_after = Pt(1)
        if align is not None:
            p.alignment = align
        _add_mixed_runs(p, txt, font_name=font_name, size_pt=size_pt, bold=is_bold)


def _set_cell_text(
    cell: Any,
    text: str,
    font_name: str | None = None,
    size_pt: float | None = None,
    bold: bool | None = None,
) -> None:
    if not cell.paragraphs:
        cell.text = text
        return
    lines = str(text).split("\n")
    _set_para_text(cell.paragraphs[0], lines[0], font_name=font_name, font_size_pt=size_pt, bold=bold)
    for p in list(cell.paragraphs)[1:]:
        _remove_para(p)
    for extra in lines[1:]:
        p = cell.add_paragraph()
        p.paragraph_format.space_before = Pt(1)
        p.paragraph_format.space_after = Pt(1)
        _add_mixed_runs(p, extra, font_name=font_name or DEFAULT_FONT, size_pt=size_pt or 14.5, bold=bool(bold))


def _set_row_cant_split(row: Any) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    if tr_pr.find(qn("w:cantSplit")) is None:
        tr_pr.append(OxmlElement("w:cantSplit"))


def _set_row_header(row: Any) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    if tr_pr.find(qn("w:tblHeader")) is None:
        tr_pr.append(OxmlElement("w:tblHeader"))


def _shade_cell(cell: Any, hex_color: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    for old in tc_pr.findall(qn("w:shd")):
        tc_pr.remove(old)
    tc_pr.append(parse_xml(f'<w:shd {nsdecls("w")} w:fill="{hex_color}"/>'))


def _set_cell_margins(cell: Any, top_dxa: int = 80, bottom_dxa: int = 80, left_dxa: int = 120, right_dxa: int = 120) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    for old in tc_pr.findall(qn("w:tcMar")):
        tc_pr.remove(old)
    tc_mar = parse_xml(
        f'<w:tcMar {nsdecls("w")}>'
        f'<w:top w:w="{top_dxa}" w:type="dxa"/>'
        f'<w:left w:w="{left_dxa}" w:type="dxa"/>'
        f'<w:bottom w:w="{bottom_dxa}" w:type="dxa"/>'
        f'<w:right w:w="{right_dxa}" w:type="dxa"/>'
        f"</w:tcMar>"
    )
    tc_pr.append(tc_mar)


def _style_table(
    table: Any,
    col_widths_cm: list[float] | None = None,
    border_color: str = "64748B",
    header_repeat: bool = True,
) -> None:
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    tbl_pr = table._tbl.tblPr
    if tbl_pr is not None:
        for old in tbl_pr.findall(qn("w:tblBorders")):
            tbl_pr.remove(old)
        borders = parse_xml(
            f'<w:tblBorders {nsdecls("w")}>'
            f'<w:top w:val="single" w:sz="4" w:space="0" w:color="{border_color}"/>'
            f'<w:left w:val="single" w:sz="4" w:space="0" w:color="{border_color}"/>'
            f'<w:bottom w:val="single" w:sz="4" w:space="0" w:color="{border_color}"/>'
            f'<w:right w:val="single" w:sz="4" w:space="0" w:color="{border_color}"/>'
            f'<w:insideH w:val="single" w:sz="4" w:space="0" w:color="{border_color}"/>'
            f'<w:insideV w:val="single" w:sz="4" w:space="0" w:color="{border_color}"/>'
            f"</w:tblBorders>"
        )
        tbl_pr.append(borders)
        if col_widths_cm:
            total_dxa = int(sum(col_widths_cm) * 567)
            for tag_name in ("w:tblW", "w:tblLayout"):
                for old in tbl_pr.findall(qn(tag_name)):
                    tbl_pr.remove(old)
            tbl_pr.append(parse_xml(f'<w:tblW {nsdecls("w")} w:w="{total_dxa}" w:type="dxa"/>'))
            tbl_pr.append(parse_xml(f'<w:tblLayout {nsdecls("w")} w:type="fixed"/>'))
    if col_widths_cm:
        old_grid = table._tbl.find(qn("w:tblGrid"))
        if old_grid is not None:
            table._tbl.remove(old_grid)
        new_grid = OxmlElement("w:tblGrid")
        for w_cm in col_widths_cm:
            gc = OxmlElement("w:gridCol")
            gc.set(qn("w:w"), str(int(w_cm * 567)))
            new_grid.append(gc)
        table._tbl.insert(1, new_grid)
    for ri, row in enumerate(table.rows):
        _set_row_cant_split(row)
        if header_repeat and ri == 0:
            _set_row_header(row)
        if col_widths_cm:
            seen_tcs: set[int] = set()
            for ci, cell in enumerate(row.cells):
                tc_id = id(cell._tc)
                if tc_id in seen_tcs or ci >= len(col_widths_cm):
                    continue
                seen_tcs.add(tc_id)
                span_w_cm = sum(
                    col_widths_cm[j]
                    for j in range(ci, len(col_widths_cm))
                    if j < len(row.cells) and row.cells[j]._tc is cell._tc
                )
                cell.width = Cm(span_w_cm)
                tc_pr = cell._tc.get_or_add_tcPr()
                for old_w in tc_pr.findall(qn("w:tcW")):
                    tc_pr.remove(old_w)
                tc_pr.append(parse_xml(f'<w:tcW {nsdecls("w")} w:w="{int(span_w_cm * 567)}" w:type="dxa"/>'))


def _clear_table_borders(table: Any) -> None:
    tbl_pr = table._tbl.tblPr
    if tbl_pr is not None:
        for old in tbl_pr.findall(qn("w:tblBorders")):
            tbl_pr.remove(old)
        borders = parse_xml(
            f'<w:tblBorders {nsdecls("w")}>'
            f'<w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
            f'<w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
            f'<w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
            f'<w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
            f'<w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
            f'<w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
            f"</w:tblBorders>"
        )
        tbl_pr.append(borders)


def _sync_table_rows(table: Any, target_data_rows: int, header_rows: int = 1) -> None:
    """Resize data rows in a table by cloning the template data row or deleting extra rows."""
    while len(table.rows) - header_rows > target_data_rows:
        tr = table.rows[-1]._tr
        tr.getparent().remove(tr)
    if target_data_rows <= 0:
        return
    while len(table.rows) - header_rows < target_data_rows:
        base_tr = table.rows[-1]._tr
        new_tr = copy.deepcopy(base_tr)
        table._tbl.append(new_tr)


def _remove_para(para: Any) -> None:
    el = para._element
    parent = el.getparent()
    if parent is not None:
        parent.remove(el)


def _insert_para_before(
    anchor_para: Any,
    text: str,
    bold: bool = False,
    font_name: str = DEFAULT_FONT,
    size_pt: float = 16.0,
    left_indent_cm: float = 0.0,
) -> Any:
    new_p = docx.text.paragraph.Paragraph(OxmlElement("w:p"), anchor_para._parent)
    anchor_para._element.addprevious(new_p._element)
    if left_indent_cm:
        new_p.paragraph_format.left_indent = Cm(left_indent_cm)
    r = new_p.add_run(text)
    _apply_run_font(r, font_name, size_pt, bold=bold)
    return new_p


def _resolve_sig_path(raw: Any) -> Path | None:
    if not raw:
        return None
    p = Path(str(raw))
    return p if p.exists() and p.is_file() else None


def _populate_signer_cell(
    cell: Any,
    name: str,
    title_lines: list[str],
    sig_path: Path | None = None,
    role_suffix: str = "",
    font_name: str = "TH SarabunIT๙",
    size_pt: float = 15.0,
) -> None:
    """Fill a signature cell with an embedded PNG (if available) or dotted signature line + name + title."""
    for p in list(cell.paragraphs)[1:]:
        _remove_para(p)
    p0 = cell.paragraphs[0]
    p0.text = ""
    p0.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p0.paragraph_format.space_before = Pt(2)
    p0.paragraph_format.space_after = Pt(1)
    if sig_path is not None:
        try:
            r_img = p0.add_run()
            r_img.add_picture(str(sig_path), height=Cm(1.05))
            if role_suffix:
                r_sfx = p0.add_run(f" {role_suffix}")
                _apply_run_font(r_sfx, font_name, size_pt)
        except Exception:
            r_dot = p0.add_run(f"ลงชื่อ..........................................{role_suffix}")
            _apply_run_font(r_dot, font_name, size_pt)
    else:
        r_dot = p0.add_run(f"ลงชื่อ..........................................{role_suffix}")
        _apply_run_font(r_dot, font_name, size_pt)

    p_name = cell.add_paragraph()
    p_name.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_name.paragraph_format.space_before = Pt(0)
    p_name.paragraph_format.space_after = Pt(0)
    _apply_run_font(p_name.add_run(f"({name})"), font_name, size_pt)

    for tl in title_lines:
        if not tl:
            continue
        p_t = cell.add_paragraph()
        p_t.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_t.paragraph_format.space_before = Pt(0)
        p_t.paragraph_format.space_after = Pt(0)
        _apply_run_font(p_t.add_run(tl), font_name, size_pt)


def _apply_cover_signatures(
    doc: docx.Document,
    payload: dict[str, Any],
    org_profile: dict[str, Any],
    department: str,
    division: str,
    instructor: str,
    position: str,
) -> None:
    sigs = payload.get("signatures") if isinstance(payload.get("signatures"), dict) else {}
    dir_name = (org_profile.get("director") or {}).get("name") or "............................................................"
    dir_title = (org_profile.get("director") or {}).get("title") or "ผู้อำนวยการวิทยาลัยการอาชีพเชียงราย"

    # P16..P18: Director block
    ps = doc.paragraphs
    if len(ps) > 18:
        dir_sig = _resolve_sig_path(sigs.get("director"))
        ps[16].text = ""
        ps[16].alignment = WD_ALIGN_PARAGRAPH.CENTER
        if dir_sig is not None:
            try:
                ps[16].add_run().add_picture(str(dir_sig), height=Cm(1.05))
            except Exception:
                _apply_run_font(ps[16].add_run("ลงชื่อ........................................................."), "TH SarabunIT๙", 16.0)
        else:
            _apply_run_font(ps[16].add_run("ลงชื่อ........................................................."), "TH SarabunIT๙", 16.0)
        _set_para_text(ps[17], f"({dir_name})", font_name="TH SarabunIT๙", font_size_pt=16.0)
        _set_para_text(ps[18], dir_title, font_name="TH SarabunIT๙", font_size_pt=16.0)

    # T3: Replace merged 3-col template signature grid cleanly with a balanced 2x2 borderless table
    if len(doc.tables) > 3:
        old_t3 = doc.tables[3]
        dept_head = payload.get("dept_head_name") or ".........................................................."
        curr_head = payload.get("curriculum_head_name") or ".........................................................."
        deputy_acad = payload.get("deputy_academic_name") or ".........................................................."

        new_tbl = doc.add_table(rows=2, cols=2)
        _clear_table_borders(new_tbl)
        new_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        for row in new_tbl.rows:
            _set_row_cant_split(row)
            for c in row.cells:
                c.width = Cm(8.0)
                _set_cell_margins(c, 50, 50, 40, 40)

        _populate_signer_cell(
            new_tbl.rows[0].cells[0],
            instructor,
            [f"ตำแหน่ง {position}"],
            sig_path=_resolve_sig_path(sigs.get("instructor")),
            role_suffix="ผู้รายงาน",
            size_pt=14.5,
        )
        _populate_signer_cell(
            new_tbl.rows[0].cells[1],
            dept_head,
            [f"หัวหน้า{department}"],
            sig_path=_resolve_sig_path(sigs.get("dept_head")),
            size_pt=14.5,
        )
        _populate_signer_cell(
            new_tbl.rows[1].cells[0],
            curr_head,
            ["หัวหน้างานพัฒนาหลักสูตรการเรียนการสอน"],
            sig_path=_resolve_sig_path(sigs.get("curriculum_head")),
            size_pt=14.5,
        )
        _populate_signer_cell(
            new_tbl.rows[1].cells[1],
            deputy_acad,
            [f"รองผู้อำนวยการ{division}"],
            sig_path=_resolve_sig_path(sigs.get("deputy_academic")),
            size_pt=14.5,
        )
        old_t3._element.addprevious(new_tbl._element)
        parent = old_t3._element.getparent()
        if parent is not None:
            parent.remove(old_t3._element)


def _append_lesson_approval_block(
    doc: docx.Document,
    payload: dict[str, Any],
    org_profile: dict[str, Any],
    heading: str = "การตรวจสอบและอนุมัติแผนการจัดการเรียนรู้",
    preparer_label: str = "ผู้จัดทำแผนการจัดการเรียนรู้",
) -> None:
    sigs = payload.get("signatures") if isinstance(payload.get("signatures"), dict) else {}
    instructor = payload.get("instructor_name") or "ครูผู้สอน"
    position = payload.get("instructor_title") or "ครู"
    department = payload.get("department_name") or "แผนกวิชา"
    division = payload.get("division_name") or "ฝ่ายวิชาการ"
    dept_head = payload.get("dept_head_name") or ".........................................................."
    curr_head = payload.get("curriculum_head_name") or ".........................................................."
    deputy_acad = payload.get("deputy_academic_name") or ".........................................................."
    dir_name = (org_profile.get("director") or {}).get("name") or ".........................................................."
    dir_title = (org_profile.get("director") or {}).get("title") or "ผู้อำนวยการวิทยาลัยการอาชีพเชียงราย"

    p_hdr = doc.add_paragraph()
    p_hdr.paragraph_format.space_before = Pt(14)
    p_hdr.paragraph_format.space_after = Pt(6)
    p_hdr.paragraph_format.keep_with_next = True
    _apply_run_font(p_hdr.add_run(heading), DEFAULT_FONT, 16.0, bold=True)

    tbl = doc.add_table(rows=3, cols=2)
    _clear_table_borders(tbl)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    for row in tbl.rows:
        _set_row_cant_split(row)
        for cell in row.cells:
            cell.width = Cm(8.6)
            _set_cell_margins(cell, top_dxa=90, bottom_dxa=90, left_dxa=80, right_dxa=80)

    _populate_signer_cell(
        tbl.rows[0].cells[0],
        instructor,
        [f"ตำแหน่ง {position} ({department})", preparer_label],
        sig_path=_resolve_sig_path(sigs.get("instructor")),
        font_name=DEFAULT_FONT,
        size_pt=15.0,
    )
    _populate_signer_cell(
        tbl.rows[0].cells[1],
        dept_head,
        [f"หัวหน้า{department}", "ผู้ตรวจระดับแผนกวิชา"],
        sig_path=_resolve_sig_path(sigs.get("dept_head")),
        font_name=DEFAULT_FONT,
        size_pt=15.0,
    )
    _populate_signer_cell(
        tbl.rows[1].cells[0],
        curr_head,
        ["หัวหน้างานพัฒนาหลักสูตรการเรียนการสอน"],
        sig_path=_resolve_sig_path(sigs.get("curriculum_head")),
        font_name=DEFAULT_FONT,
        size_pt=15.0,
    )
    _populate_signer_cell(
        tbl.rows[1].cells[1],
        deputy_acad,
        [f"รองผู้อำนวยการ{division}"],
        sig_path=_resolve_sig_path(sigs.get("deputy_academic")),
        font_name=DEFAULT_FONT,
        size_pt=15.0,
    )

    # Merge bottom row for Director
    dir_cell = tbl.rows[2].cells[0].merge(tbl.rows[2].cells[1])
    _populate_signer_cell(
        dir_cell,
        dir_name,
        [dir_title, "ผู้อนุมัติ"],
        sig_path=_resolve_sig_path(sigs.get("director")),
        font_name=DEFAULT_FONT,
        size_pt=15.0,
    )


def _merge_pdfs_poppler(pdf_paths: list[Path], out_dir: Path, out_filename: str) -> Path | None:
    if len(pdf_paths) < 2:
        return None
    out_path = out_dir / out_filename
    try:
        subprocess.run(
            ["pdfunite", *[str(p) for p in pdf_paths], str(out_path)],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        return out_path if out_path.exists() else None
    except Exception:
        return None


def _finalize_bundle(
    generated_paths: list[Path],
    out_dir: Path,
    prefix: str,
    labels: list[tuple[str, str]],
    zip_label: str,
    convert_pdf: bool,
) -> dict[str, Any]:
    bundle_files: list[dict[str, Any]] = []
    converted_pdfs: list[Path] = []
    for (key, label), fpath in zip(labels, generated_paths):
        pdf_url = ""
        page_urls: list[str] = []
        pdf_error = ""
        if convert_pdf:
            try:
                pdf_path = convert_office_to_pdf(fpath, out_dir)
                converted_pdfs.append(pdf_path)
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

    merged_pdf_url = ""
    merged_pdf_filename = ""
    if convert_pdf and len(converted_pdfs) >= 2:
        merged_name = f"{prefix}_{zip_label}_รวมชุด.pdf"
        merged_path = _merge_pdfs_poppler(converted_pdfs, out_dir, merged_name)
        if merged_path is not None:
            merged_pdf_filename = merged_path.name
            merged_pdf_url = f"/v1/files/rendered/{merged_path.name}"

    zip_name = f"{prefix}_{zip_label}.zip"
    zip_path = out_dir / zip_name
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for p in generated_paths:
            zf.write(p, arcname=p.name)
        if merged_pdf_filename:
            zf.write(out_dir / merged_pdf_filename, arcname=merged_pdf_filename)

    primary = bundle_files[0] if bundle_files else {}
    return {
        "bundle_files": bundle_files,
        "zip_filename": zip_name,
        "zip_url": f"/v1/files/rendered/{zip_name}",
        "merged_pdf_filename": merged_pdf_filename,
        "merged_pdf_url": merged_pdf_url,
        "docx_url": primary.get("file_url", ""),
        "pdf_url": primary.get("pdf_url", ""),
        "page_image_urls": primary.get("page_image_urls", []),
    }


def _rewrite_list_section(
    doc: docx.Document,
    start_heading: str,
    end_heading: str,
    items: list[str],
    numbered: bool = True,
    font_name: str = DEFAULT_FONT,
) -> None:
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
        already_numbered = bool(re.match(r"^\s*\d+[\.\)]\s*", line))
        txt = f"{idx}.  {line}" if numbered and not already_numbered else line
        _insert_para_before(anchor, txt, font_name=font_name, size_pt=16.0)


def _ensure_heading_before_table(table: Any, heading: str) -> None:
    """Insert a crisp bold heading paragraph before a table so adjacent tables never visually fuse."""
    p_el = OxmlElement("w:p")
    table._element.addprevious(p_el)
    new_p = docx.text.paragraph.Paragraph(p_el, table._parent)
    new_p.paragraph_format.space_before = Pt(10)
    new_p.paragraph_format.space_after = Pt(4)
    new_p.paragraph_format.keep_with_next = True
    _apply_run_font(new_p.add_run(heading), DEFAULT_FONT, 16.0, bold=True)


def _plist(payload: dict[str, Any], key: str) -> list[Any]:
    """Read a list field supporting both canonical and *_json DB column keys."""
    val = payload.get(key)
    if val:
        return list(val)
    val_json = payload.get(f"{key}_json")
    return list(val_json) if val_json else []


def _set_kv_cell(cell: Any, label: str, val: str, size_pt: float = 15.5) -> None:
    """Write 'Label value' cleanly into a metadata grid cell with bold label."""
    for p in list(cell.paragraphs)[1:]:
        _remove_para(p)
    p = cell.paragraphs[0]
    p.text = ""
    p.paragraph_format.space_before = Pt(1)
    p.paragraph_format.space_after = Pt(1)
    _apply_run_font(p.add_run(f"{label} "), DEFAULT_FONT, size_pt, bold=True)
    _apply_run_font(p.add_run(str(val or "-")), DEFAULT_FONT, size_pt, bold=False)


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
    _set_a4_section(doc, top_cm=1.5, bottom_cm=1.5, left_cm=1.5, right_cm=1.5)  # 18.0 cm printable width

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
    ppr2 = ps[2]._element.pPr
    if ppr2 is not None:
        for old_ind in ppr2.findall(qn("w:ind")):
            ppr2.remove(old_ind)
    _set_para_text(ps[2], "กำหนดการสอน (Course Syllabus)", font_name=DEFAULT_FONT, font_size_pt=18.0, bold=True)
    ps[2].alignment = WD_ALIGN_PARAGRAPH.CENTER
    ps[2].paragraph_format.space_after = Pt(6)

    # Replace P03..P09 tab-misaligned lines cleanly with a borderless 2-column metadata grid (9.0 + 9.0 = 18.0 cm)
    meta_tbl = doc.add_table(rows=6, cols=2)
    _clear_table_borders(meta_tbl)
    meta_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    old_grid = meta_tbl._tbl.find(qn("w:tblGrid"))
    if old_grid is not None:
        meta_tbl._tbl.remove(old_grid)
    new_grid = OxmlElement("w:tblGrid")
    for w_cm in (9.0, 9.0):
        gc = OxmlElement("w:gridCol")
        gc.set(qn("w:w"), str(int(w_cm * 567)))
        new_grid.append(gc)
    meta_tbl._tbl.insert(1, new_grid)

    meta_pairs = [
        (("รหัสวิชา :", code), ("ชื่อวิชา :", name)),
        (("จำนวน :", total_credits), ("หลักสูตรการศึกษา :", level)),
        (("ภาคเรียนที่ :", semester), ("วัน-เวลาที่เรียน :", schedule)),
        (("ชื่อผู้สอน :", instructor), ("โทรศัพท์ (Phone) :", phone)),
        (("ความรู้พื้นฐาน :", prereq), ("อีเมล (E-Mail) :", email)),
    ]
    for r_idx, ((l1, v1), (l2, v2)) in enumerate(meta_pairs):
        _set_row_cant_split(meta_tbl.rows[r_idx])
        for c_idx, (lbl, val) in enumerate(((l1, v1), (l2, v2))):
            cell = meta_tbl.rows[r_idx].cells[c_idx]
            cell.width = Cm(9.0)
            _set_cell_margins(cell, 25, 25, 40, 40)
            _set_kv_cell(cell, lbl, val)

    ref_cell = meta_tbl.rows[5].cells[0].merge(meta_tbl.rows[5].cells[1])
    _set_row_cant_split(meta_tbl.rows[5])
    ref_cell.width = Cm(18.0)
    _set_cell_margins(ref_cell, 25, 45, 40, 40)
    _set_kv_cell(ref_cell, "แหล่งค้นคว้าเพิ่มเติม (Reference) :", ref)

    ps[3]._element.addprevious(meta_tbl._element)
    for p_old in ps[3:10]:
        _remove_para(p_old)

    # Rewrite every content section strictly inside non-overlapping heading boundaries
    _rewrite_list_section(doc, "จุดประสงค์รายวิชา", "มาตรฐานรายวิชา", _plist(payload, "objectives"))
    _rewrite_list_section(doc, "มาตรฐานรายวิชา", "คำอธิบายรายวิชา", _plist(payload, "standards"))
    _rewrite_list_section(doc, "คำอธิบายรายวิชา", "ความรู้", [payload.get("description") or "-"], numbered=False)
    _rewrite_list_section(
        doc,
        "ความรู้",
        "ทักษะ",
        _plist(payload, "knowledge") or [f"หลักการ ทฤษฎี และโครงสร้างองค์ประกอบพื้นฐานของรายวิชา {name}"],
    )
    _rewrite_list_section(
        doc,
        "ทักษะ",
        "คุณธรรม",
        _plist(payload, "skills") or [f"ปฏิบัติงานในรายวิชา {name} ตามขั้นตอนและมาตรฐานความปลอดภัยได้อย่างถูกต้อง"],
    )

    morals = _plist(payload, "morals") or [
        "ความมีวินัย ตรงต่อเวลา และปฏิบัติงานตามกฎความปลอดภัยในห้องปฏิบัติการอย่างเคร่งครัด",
        "ความซื่อสัตย์สุจริต ความสนใจใฝ่รู้ และความรับผิดชอบต่อหน้าที่ที่ได้รับมอบหมาย",
    ]
    _rewrite_list_section(doc, "คุณธรรม", "ตัวชี้วัด", morals)

    indicators = _plist(payload, "indicators") or [
        f"ผู้เรียนสามารถอธิบายหลักการและนำทักษะวิชา {name} ไปประยุกต์ใช้ในการปฏิบัติงานได้",
        "ผู้เรียนมีเวลาเรียนไม่น้อยกว่าร้อยละ 80 และส่งภาระงานครบถ้วนตามกำหนด",
        "ผู้เรียนผ่านเกณฑ์การประเมินผลสัมฤทธิ์รายวิชาตามเกณฑ์มาตรฐานของวิทยาลัย",
    ]
    _rewrite_list_section(doc, "ตัวชี้วัด", "เกณฑ์การให้คะแนน", indicators)

    assessment_rows = _plist(payload, "assessment")
    mark_lines = _plist(payload, "evaluation_criteria") or (
        [f"{a.get('domain', '')} ({a.get('method', '')})  สัดส่วน {a.get('weight', '')}".strip() for a in assessment_rows]
        if assessment_rows
        else [
            "ด้านคุณธรรม จริยธรรม และจิตพิสัย (เวลาเรียน วินัย ความรับผิดชอบ)  20%",
            "ด้านทักษะปฏิบัติการและภาระงาน (ใบงาน ชิ้นงาน แบบฝึกหัด)  40%",
            "การประเมินผลสัมฤทธิ์กลางภาคเรียน (ทฤษฎีและปฏิบัติ)  20%",
            "การประเมินผลสัมฤทธิ์ปลายภาคเรียน (ทฤษฎีและปฏิบัติ)  20%",
        ]
    )
    _rewrite_list_section(doc, "เกณฑ์การให้คะแนน", "วิธีการสอน", mark_lines)

    strategies = _plist(payload, "instructional_strategies") or [
        f"การจัดการเรียนการสอนเชิงรุก (Active Learning) สำหรับรายวิชา {name} เน้นให้ผู้เรียนคิดวิเคราะห์และลงมือปฏิบัติจริง",
        "บูรณาการการเรียนรู้แบบใช้ปัญหาเป็นฐาน (Problem-Based Learning) ควบคู่การทำงานเป็นทีม",
        "สาธิต ฝึกปฏิบัติตามใบงานจริง ประเมินผลตามสภาพจริง และทบทวนเสริมทักษะรายบุคคล",
    ]
    _rewrite_list_section(doc, "วิธีการสอน", "เกณฑ์การประเมินผล", strategies, numbered=False)

    work_assign = _plist(payload, "work_assignments") or [
        str(payload.get("work_assignments_text") or "").strip()
        or f"ผู้สอนมอบหมายให้ผู้เรียนศึกษาค้นคว้าเพิ่มเติมจากเอกสารประกอบการสอนและแหล่งเรียนรู้ที่เกี่ยวข้อง พร้อมจัดทำใบงานวิชา {name} เพื่อประเมินความก้าวหน้าอย่างสม่ำเสมอ"
    ]
    _rewrite_list_section(doc, "การมอบหมายงานให้นักศึกษาค้นคว้า", "รายละเอียดกำหนดการสอน", work_assign, numbered=False)

    weeks = _plist(payload, "weekly_plan")
    total_hours = payload.get("total_hours") or sum(
        int(w.get("theory_hours") or 1) + int(w.get("practice_hours") or 3) for w in weeks
    ) or 72
    weeks_cnt = len(weeks) or 18
    for p in doc.paragraphs:
        if "รายละเอียดกำหนดการสอน" in p.text:
            _set_para_text(
                p,
                f"รายละเอียดกำหนดการสอน   ชื่อวิชา : {name}    {weeks_cnt}  สัปดาห์   {total_hours}  ชั่วโมง",
                font_name=DEFAULT_FONT,
                font_size_pt=16.0,
                bold=True,
            )
            p.paragraph_format.space_before = Pt(10)
            p.paragraph_format.space_after = Pt(4)
            p.paragraph_format.keep_with_next = True
            break

    notes = payload.get("notes") or ["รายละเอียดการสอนปรับยืดหยุ่นได้ตามศักยภาพผู้เรียนและปฏิทินปฏิบัติการของวิทยาลัย"]
    p_notes_idx = next((i for i, p in enumerate(doc.paragraphs) if "หมายเหตุ" in p.text), None)
    if p_notes_idx is not None:
        for p in doc.paragraphs[p_notes_idx + 1 :]:
            _remove_para(p)
        for line in notes:
            p_new = doc.add_paragraph(str(line).strip())
            p_new.paragraph_format.left_indent = Cm(0.6)
            p_new.paragraph_format.space_before = Pt(1)
            p_new.paragraph_format.space_after = Pt(2)
            for r in p_new.runs:
                _apply_run_font(r, DEFAULT_FONT, 15.5)

    # Normalize heading typography across the entire document to unified TH Sarabun New Bold 16pt
    section_headings = (
        "จุดประสงค์รายวิชา",
        "มาตรฐานรายวิชา",
        "คำอธิบายรายวิชา",
        "ความรู้ นักศึกษามีความรู้",
        "ทักษะ",
        "คุณธรรม",
        "ตัวชี้วัด",
        "เกณฑ์การให้คะแนน",
        "วิธีการสอน",
        "เกณฑ์การประเมินผล",
        "การมอบหมายงาน",
        "หมายเหตุ",
    )
    for p in doc.paragraphs:
        txt = p.text.strip()
        if any(txt.startswith(h) for h in section_headings):
            _set_para_text(p, txt, font_name=DEFAULT_FONT, font_size_pt=16.0, bold=True)
            p.paragraph_format.space_before = Pt(8)
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.keep_with_next = True

    # Note: meta_tbl inserted at doc.tables[0]; template Grade table is now doc.tables[1], Schedule table is doc.tables[2]
    if len(doc.tables) > 1:
        grade_tbl = doc.tables[1]
        _style_table(grade_tbl, [2.1, 2.3, 4.3, 0.6, 2.1, 2.3, 4.3], border_color="64748B", header_repeat=True)
        for ri, row in enumerate(grade_tbl.rows):
            for ci, cell in enumerate(row.cells):
                _set_cell_margins(cell, 45, 45, 60, 60)
                if ci == 3:
                    _set_cell_text(cell, "", font_name=DEFAULT_FONT, size_pt=14.0)
                    continue
                txt = cell.text.strip().replace("ระดับผลการ เรียน", "ระดับผลการเรียน")
                align = WD_ALIGN_PARAGRAPH.CENTER if (ri == 0 or ci in (0, 1, 4, 5)) else WD_ALIGN_PARAGRAPH.LEFT
                if ri == 0:
                    _shade_cell(cell, "F1F5F9")
                _set_cell_text(cell, txt, font_name=DEFAULT_FONT, size_pt=14.5, bold=(ri == 0))
                cell.paragraphs[0].alignment = align

    if len(doc.tables) > 2:
        t1 = doc.tables[2]
        _sync_table_rows(t1, max(1, len(weeks)), header_rows=1)
        for ci, cell in enumerate(t1.rows[0].cells):
            _shade_cell(cell, "E2E8F0")
            _set_cell_margins(cell, 60, 60, 70, 70)
            _set_cell_text(cell, cell.text.strip(), font_name=DEFAULT_FONT, size_pt=14.5, bold=True)
            cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
        for idx, wk in enumerate(weeks, start=1):
            row = t1.rows[idx]
            vals = [
                str(wk.get("week") or idx),
                str(wk.get("topic") or ""),
                str(wk.get("activities") or ""),
                str(wk.get("media") or ""),
                str(wk.get("evaluation") or ""),
                str(wk.get("competency") or ""),
            ]
            for ci, val in enumerate(vals):
                _set_cell_margins(row.cells[ci], 55, 55, 70, 70)
                _set_cell_text(row.cells[ci], val, font_name=DEFAULT_FONT, size_pt=14.0)
                if ci == 0:
                    row.cells[ci].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
        if not weeks:
            for c in range(6):
                _set_cell_text(t1.rows[1].cells[c], "-", font_name=DEFAULT_FONT, size_pt=14.0)
        _style_table(t1, [1.2, 3.6, 4.4, 2.8, 3.0, 3.0], border_color="475569", header_repeat=True)

    if payload.get("include_approval_block", True):
        _append_lesson_approval_block(
            doc,
            payload,
            org_profile,
            heading="การตรวจสอบและอนุมัติกำหนดการสอน",
            preparer_label="ผู้จัดทำกำหนดการสอน",
        )

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
    _set_a4_section(doc, top_cm=1.8, bottom_cm=1.8, left_cm=2.0, right_cm=1.8)  # 17.2 cm printable width

    code = payload.get("course_code") or "-"
    name = payload.get("course_name") or "-"
    level = payload.get("curriculum_level") or "ปวช."
    credits = payload.get("credits") or "1-3-2"
    std_link = payload.get("qualification_link") or "มาตรฐานคุณวุฒิอาชีวศึกษา พ.ศ. 2567"
    weeks = _plist(payload, "weekly_plan")
    weeks_cnt = len(weeks) or 18

    ps = doc.paragraphs
    _set_para_text(ps[0], f"แผนการจัดการเรียนรู้เชิงรุกมุ่งเน้นสมรรถนะ วิชา {name} (รหัสวิชา {code})", font_name=DEFAULT_FONT, font_size_pt=18.0, bold=True)
    _set_para_text(
        ps[2],
        payload.get("curriculum_context")
        or f"การจัดการเรียนการสอนในหลักสูตร {level} รายวิชา {code} {name} ตามกรอบมาตรฐานคุณวุฒิอาชีวศึกษา",
        font_name=DEFAULT_FONT,
        font_size_pt=16.0,
    )

    _rewrite_list_section(doc, "จุดประสงค์รายวิชา", "สมรรถนะรายวิชา", _plist(payload, "objectives"))
    _rewrite_list_section(doc, "สมรรถนะรายวิชา", "คำอธิบายรายวิชา", _plist(payload, "standards"))
    _rewrite_list_section(doc, "คำอธิบายรายวิชา", "การวิเคราะห์หน่วยการเรียนรู้", [payload.get("description") or "-"], numbered=False)

    # Clear leftover networking analysis paragraphs between heading and detail_idx
    analysis_idx = next((i for i, p in enumerate(doc.paragraphs) if "การวิเคราะห์หน่วยการเรียนรู้" in p.text), None)
    detail_idx = next((i for i, p in enumerate(doc.paragraphs) if "รายละเอียดแผนการจัดกิจกรรมการเรียนรู้รายสัปดาห์" in p.text), None)
    if analysis_idx is not None:
        _set_para_text(
            doc.paragraphs[analysis_idx],
            f"การวิเคราะห์หน่วยการเรียนรู้และตารางกระจายเวลาเรียน ({weeks_cnt} สัปดาห์)",
            font_name=DEFAULT_FONT,
            font_size_pt=16.0,
            bold=True,
        )
        if detail_idx is not None and detail_idx > analysis_idx + 1:
            for p in doc.paragraphs[analysis_idx + 1 : detail_idx]:
                _remove_para(p)
            analysis_text = (
                payload.get("curriculum_analysis")
                or f"จัดลำดับหน่วยการเรียนรู้รายวิชา {name} ({code}) รวม {weeks_cnt} สัปดาห์ "
                f"โดยบูรณาการความรู้ภาคทฤษฎีควบคู่การลงมือปฏิบัติจริงตามสมรรถนะวิชาชีพ"
            )
            _insert_para_before(doc.paragraphs[analysis_idx + 1], analysis_text, font_name=DEFAULT_FONT, size_pt=15.5)

    # T0: Course Overview 5x2
    if len(doc.tables) > 0:
        t0 = doc.tables[0]
        _set_cell_text(t0.rows[1].cells[1], f"{code} {name}", font_name=DEFAULT_FONT, size_pt=14.5)
        _set_cell_text(t0.rows[2].cells[1], level, font_name=DEFAULT_FONT, size_pt=14.5)
        _set_cell_text(t0.rows[3].cells[1], credits, font_name=DEFAULT_FONT, size_pt=14.5)
        _set_cell_text(t0.rows[4].cells[1], std_link, font_name=DEFAULT_FONT, size_pt=14.5)
        _style_table(t0, [5.2, 12.0], border_color="475569", header_repeat=True)

    # T1: 18-week summary table
    if len(doc.tables) > 1:
        t1 = doc.tables[1]
        _sync_table_rows(t1, max(1, len(weeks)), header_rows=1)
        for idx, wk in enumerate(weeks, start=1):
            row = t1.rows[idx]
            th_h = int(wk.get("theory_hours") or 1)
            pr_h = int(wk.get("practice_hours") or 3)
            _set_cell_text(row.cells[0], str(wk.get("week") or idx), font_name=DEFAULT_FONT, size_pt=14.0)
            _set_cell_text(row.cells[1], str(wk.get("topic") or ""), font_name=DEFAULT_FONT, size_pt=14.0)
            _set_cell_text(row.cells[2], str(th_h), font_name=DEFAULT_FONT, size_pt=14.0)
            _set_cell_text(row.cells[3], str(pr_h), font_name=DEFAULT_FONT, size_pt=14.0)
            _set_cell_text(row.cells[4], str(th_h + pr_h), font_name=DEFAULT_FONT, size_pt=14.0)
            _set_cell_text(row.cells[5], str(wk.get("evaluation") or ""), font_name=DEFAULT_FONT, size_pt=14.0)
        if not weeks:
            for c in range(6):
                _set_cell_text(t1.rows[1].cells[c], "-", font_name=DEFAULT_FONT, size_pt=14.0)
        _style_table(t1, [1.5, 6.2, 1.8, 1.8, 1.8, 4.1], border_color="475569", header_repeat=True)

    # Cleanly remove leftover P19..end weekly paragraphs BEFORE inserting T2..T4 headings!
    detail_idx = next((i for i, p in enumerate(doc.paragraphs) if "รายละเอียดแผนการจัดกิจกรรมการเรียนรู้รายสัปดาห์" in p.text), None)
    if detail_idx is not None:
        for p in doc.paragraphs[detail_idx:]:
            _remove_para(p)

    # T2: Equipment & Tools — always replace template networking defaults
    equipment = _plist(payload, "equipment") or [
        {"category": "เอกสารและสื่อการสอน", "item": f"เอกสารประกอบการสอน สไลด์ และใบงานวิชา {name}", "purpose": "ใช้อธิบายหลักการ ขั้นตอน และมอบหมายฝึกปฏิบัติ"},
        {"category": "เครื่องมือ/ห้องปฏิบัติการ", "item": f"ชุดฝึกปฏิบัติและเครื่องมือมาตรฐานประจำสาขาวิชา ({name})", "purpose": "ใช้ฝึกทักษะปฏิบัติงานจริงตามเกณฑ์สมรรถนะ"},
        {"category": "สื่อดิจิทัล/แหล่งเรียนรู้", "item": "ห้องเรียนออนไลน์ คู่มือมาตรฐานอาชีพ และกรณีศึกษา", "purpose": "ใช้ทบทวนความรู้ ค้นคว้าเพิ่มเติม และส่งชิ้นงาน"},
    ]
    if len(doc.tables) > 2:
        t2 = doc.tables[2]
        _ensure_heading_before_table(t2, "ทรัพยากร สื่อ อุปกรณ์ และแหล่งเรียนรู้")
        _sync_table_rows(t2, len(equipment), header_rows=1)
        for idx, eq in enumerate(equipment, start=1):
            row = t2.rows[idx]
            _set_cell_text(row.cells[0], str(eq.get("category") or ""), font_name=DEFAULT_FONT, size_pt=14.0)
            _set_cell_text(row.cells[1], str(eq.get("item") or ""), font_name=DEFAULT_FONT, size_pt=14.0)
            _set_cell_text(row.cells[2], str(eq.get("purpose") or ""), font_name=DEFAULT_FONT, size_pt=14.0)
        _style_table(t2, [4.2, 6.2, 6.8], border_color="475569", header_repeat=True)

    # T3: Assessment domains
    assessment = _plist(payload, "assessment") or [
        {"domain": "ด้านความรู้ (Cognitive Domain)", "weight": "30%", "method": "แบบทดสอบย่อย กลางภาค และปลายภาค", "criteria": f"อธิบายหลักการสำคัญของวิชา {name} ได้ตามเกณฑ์"},
        {"domain": "ด้านทักษะ (Psychomotor Domain)", "weight": "50%", "method": "ตรวจใบงาน การฝึกปฏิบัติ และชิ้นงาน", "criteria": "ปฏิบัติงานครบขั้นตอน ถูกต้อง และปลอดภัย"},
        {"domain": "ด้านจิตพิสัย (Affective Domain)", "weight": "20%", "method": "แบบสังเกตพฤติกรรม การเข้าเรียน ความรับผิดชอบ", "criteria": "มีเวลาเรียน >= 80% และส่งงานตรงเวลา"},
    ]
    if len(doc.tables) > 3:
        t3 = doc.tables[3]
        _ensure_heading_before_table(t3, "โครงสร้างการวัดและประเมินผล")
        _sync_table_rows(t3, len(assessment), header_rows=1)
        for idx, a in enumerate(assessment, start=1):
            row = t3.rows[idx]
            _set_cell_text(row.cells[0], str(a.get("domain") or ""), font_name=DEFAULT_FONT, size_pt=14.0)
            _set_cell_text(row.cells[1], str(a.get("weight") or ""), font_name=DEFAULT_FONT, size_pt=14.0)
            _set_cell_text(row.cells[2], str(a.get("method") or ""), font_name=DEFAULT_FONT, size_pt=14.0)
            _set_cell_text(row.cells[3], str(a.get("criteria") or ""), font_name=DEFAULT_FONT, size_pt=14.0)
        _style_table(t3, [4.2, 1.8, 5.4, 5.8], border_color="475569", header_repeat=True)

    # T4: Rubric — always replace template networking defaults
    rubric = _plist(payload, "rubric") or [
        {
            "dimension": f"1. ความรู้ความเข้าใจหลักการ ({name})",
            "level4": "อธิบายหลักการ เชื่อมโยงขั้นตอน และวิเคราะห์ปัญหาได้ครบถ้วน",
            "level3": "อธิบายหลักการและขั้นตอนสำคัญได้ถูกต้องเกือบทั้งหมด",
            "level2": "อธิบายได้บางส่วน ต้องได้รับคำแนะนำเพิ่มเติม",
            "level1": "ยังไม่สามารถอธิบายหลักการพื้นฐานได้",
        },
        {
            "dimension": "2. ทักษะการปฏิบัติงานตามใบงาน",
            "level4": "ปฏิบัติงานถูกต้อง แม่นยำ คล่องแคล่ว และเสร็จตามเวลา",
            "level3": "ปฏิบัติงานสำเร็จตามขั้นตอนหลัก อาจมีข้อบกพร่องเล็กน้อย",
            "level2": "ปฏิบัติงานได้บางขั้นตอน ต้องมีผู้สอนคอยกำกับดูแล",
            "level1": "ปฏิบัติงานไม่สำเร็จหรือเกิดข้อผิดพลาดสำคัญ",
        },
        {
            "dimension": "3. ความปลอดภัย ระเบียบวินัย และคุณธรรม",
            "level4": "ปฏิบัติตามกฎความปลอดภัย ดูแลเครื่องมือ และทำงานเป็นทีมดีเยี่ยม",
            "level3": "ปฏิบัติตามระเบียบและกฎความปลอดภัยอย่างสม่ำเสมอ",
            "level2": "ปฏิบัติตามระเบียบได้เป็นส่วนใหญ่ ต้องตักเตือนบ้าง",
            "level1": "ละเลยกฎความปลอดภัยหรือไม่รับผิดชอบต่อหน้าที่",
        },
    ]
    if len(doc.tables) > 4:
        t4 = doc.tables[4]
        _ensure_heading_before_table(t4, "เกณฑ์การประเมินสมรรถนะการปฏิบัติงาน (Rubric Scoring)")
        _sync_table_rows(t4, len(rubric), header_rows=1)
        for idx, rb in enumerate(rubric, start=1):
            row = t4.rows[idx]
            _set_cell_text(row.cells[0], str(rb.get("dimension") or ""), font_name=DEFAULT_FONT, size_pt=13.5)
            _set_cell_text(row.cells[1], str(rb.get("level4") or ""), font_name=DEFAULT_FONT, size_pt=13.5)
            _set_cell_text(row.cells[2], str(rb.get("level3") or ""), font_name=DEFAULT_FONT, size_pt=13.5)
            _set_cell_text(row.cells[3], str(rb.get("level2") or ""), font_name=DEFAULT_FONT, size_pt=13.5)
            _set_cell_text(row.cells[4], str(rb.get("level1") or ""), font_name=DEFAULT_FONT, size_pt=13.5)
        _style_table(t4, [3.6, 3.4, 3.4, 3.4, 3.4], border_color="475569", header_repeat=True)

    # Append crisp weekly section heading + structured weekly lesson plan tables AFTER T4
    if weeks:
        p_w_hdr = doc.add_paragraph()
        p_w_hdr.paragraph_format.space_before = Pt(12)
        p_w_hdr.paragraph_format.space_after = Pt(4)
        p_w_hdr.paragraph_format.keep_with_next = True
        _apply_run_font(
            p_w_hdr.add_run(f"รายละเอียดแผนการจัดกิจกรรมการเรียนรู้รายสัปดาห์ (สัปดาห์ที่ 1 - {weeks_cnt})"),
            DEFAULT_FONT,
            16.0,
            bold=True,
        )
        for idx, wk in enumerate(weeks, start=1):
            w_num = wk.get("week") or idx
            th_h = int(wk.get("theory_hours") or 1)
            pr_h = int(wk.get("practice_hours") or 3)
            spacer = doc.add_paragraph()
            spacer.paragraph_format.space_before = Pt(4)
            spacer.paragraph_format.space_after = Pt(2)
            spacer.paragraph_format.keep_with_next = True

            wt = doc.add_table(rows=6, cols=2)
            hdr_cell = wt.rows[0].cells[0].merge(wt.rows[0].cells[1])
            _shade_cell(hdr_cell, "E2E8F0")
            _set_cell_text(
                hdr_cell,
                f"สัปดาห์ที่ {w_num} : {wk.get('topic') or '-'}   (ทฤษฎี {th_h} ชม. / ปฏิบัติ {pr_h} ชม. / รวม {th_h + pr_h} ชม.)",
                font_name=DEFAULT_FONT,
                size_pt=15.0,
                bold=True,
            )

            rows_data = [
                ("หัวข้อ / สาระการเรียนรู้", wk.get("subtopics") or wk.get("topic") or "-"),
                ("จุดประสงค์เชิงพฤติกรรม", wk.get("behavioral_objectives") or wk.get("competency") or "-"),
                ("กิจกรรมการจัดการเรียนรู้", wk.get("activities") or "-"),
                ("สื่อ อุปกรณ์ และแหล่งเรียนรู้", wk.get("media") or "-"),
                ("ภาระงานและการประเมินผล", wk.get("evaluation") or "-"),
            ]
            for r_idx, (label, val) in enumerate(rows_data, start=1):
                c0, c1 = wt.rows[r_idx].cells[0], wt.rows[r_idx].cells[1]
                _shade_cell(c0, "F8FAFC")
                _set_cell_margins(c0, 60, 60, 100, 100)
                _set_cell_margins(c1, 60, 60, 100, 100)
                _set_cell_text(c0, label, font_name=DEFAULT_FONT, size_pt=14.5, bold=True)
                _set_cell_text(c1, str(val), font_name=DEFAULT_FONT, size_pt=14.5)
            _style_table(wt, [4.6, 12.6], border_color="64748B", header_repeat=False)

    _append_lesson_approval_block(doc, payload, org_profile)

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
    department = payload.get("department_name") or "แผนกวิชา"
    division = payload.get("division_name") or "ฝ่ายวิชาการ"
    doc_no = payload.get("doc_number") or "ฝว............/2569"
    doc_date = format_thai_date(payload.get("doc_date"))
    instructor = payload.get("instructor_name") or "ครูผู้สอน"
    position = payload.get("instructor_title") or "ครู"
    w_start = payload.get("week_start") or 1
    w_end = payload.get("week_end") or 4
    semester = payload.get("semester") or f"2/{current_buddhist_year()}"
    subjects = payload.get("subjects") or []
    sigs = payload.get("signatures") if isinstance(payload.get("signatures"), dict) else {}

    # 3a. Cover Memo
    memo_doc = docx.Document(resolve_system_template("teaching/3a_post_teaching_memo.docx"))
    _set_a4_section(memo_doc, top_cm=1.5, bottom_cm=1.5, left_cm=3.0, right_cm=2.0)

    ps = memo_doc.paragraphs
    _set_para_text(ps[2], f"ส่วนราชการ  {department}  {division}  {org_name}\t", font_name="TH SarabunIT๙", font_size_pt=16.0)
    _set_para_text(
        ps[3],
        f"ที่ {to_thai_digits(str(doc_no))}\tวันที่ {doc_date}\t",
        font_name="TH SarabunIT๙",
        font_size_pt=16.0,
    )
    _set_para_text(
        ps[6],
        to_thai_digits(
            f"\tข้าพเจ้า {instructor}  ตำแหน่ง {position} {department} "
            f"ขอรายงานการบันทึกหลังการสอน สัปดาห์ที่ {w_start} ถึง {w_end} ดังนี้"
        ),
        font_name="TH SarabunIT๙",
        font_size_pt=16.0,
    )

    if len(memo_doc.tables) > 0:
        _set_cell_text(
            memo_doc.tables[0].rows[0].cells[1],
            to_thai_digits(f"รายงานการบันทึกหลังการสอน สัปดาห์ที่ {w_start} ถึง {w_end}  ภาคเรียนที่ {semester}"),
            font_name="TH SarabunIT๙",
            size_pt=16.0,
        )
    if len(memo_doc.tables) > 1:
        dir_title = (org_profile.get("director") or {}).get("title") or f"ผู้อำนวยการ{org_name}"
        _set_cell_text(memo_doc.tables[1].rows[0].cells[1], dir_title, font_name="TH SarabunIT๙", size_pt=16.0)
    if len(memo_doc.tables) > 2:
        t2 = memo_doc.tables[2]
        _sync_table_rows(t2, max(1, len(subjects)), header_rows=1)
        for idx, sub in enumerate(subjects, start=1):
            row = t2.rows[idx]
            _set_cell_text(row.cells[0], to_thai_digits(str(idx)), font_name="TH SarabunIT๙", size_pt=15.0)
            _set_cell_text(row.cells[1], str(sub.get("course_code") or "-"), font_name="TH SarabunIT๙", size_pt=15.0)
            _set_cell_text(row.cells[2], str(sub.get("course_name") or "-"), font_name="TH SarabunIT๙", size_pt=15.0)
        _style_table(t2, [2.0, 4.2, 9.8], border_color="475569", header_repeat=True)

    _apply_cover_signatures(memo_doc, payload, org_profile, department, division, instructor, position)

    generated_paths: list[Path] = []
    labels: list[tuple[str, str]] = []
    memo_path = out_dir / f"{prefix}_บันทึกข้อความรายงานหลังสอน_สัปดาห์{w_start}-{w_end}.docx"
    memo_doc.save(memo_path)
    generated_paths.append(memo_path)
    labels.append(("memo", f"บันทึกข้อความปะหน้า (สัปดาห์ {w_start}-{w_end})"))

    # 3b. Per-subject Post-Teaching Sheet
    instr_sig = _resolve_sig_path(sigs.get("instructor"))
    dept_sig = _resolve_sig_path(sigs.get("dept_head"))
    dept_head = payload.get("dept_head_name") or ".........................................................."

    for idx, sub in enumerate(subjects, start=1):
        s_doc = docx.Document(resolve_system_template("teaching/3b_post_teaching_sheet.docx"))
        _set_a4_section(s_doc, top_cm=1.5, bottom_cm=1.5, left_cm=2.0, right_cm=1.5)  # 17.5 cm printable width

        code = sub.get("course_code") or f"subj{idx}"
        cname = sub.get("course_name") or "-"
        unit_title = sub.get("unit_title") or "-"
        group = sub.get("student_group") or "-"
        total_st = int(sub.get("total_students") or 0)
        passed_st = int(sub.get("passed_students") or total_st)
        pct = round((passed_st / total_st) * 100, 1) if total_st > 0 else 0
        pct_str = f"{int(pct)}" if pct == int(pct) else f"{pct}"
        weekly_att = sub.get("weekly_attendance") or f"สัปดาห์ที่ {w_start}-{w_end} เข้าเรียนครบ"
        eval_note = sub.get("evaluation_summary") or "ผ่านเกณฑ์การประเมินตามจุดประสงค์เชิงพฤติกรรม"
        problems = sub.get("problems") or "-"
        solutions = sub.get("solutions") or "-"

        left_lines: list[tuple[str, bool]] = [
            ("๑) ข้อสรุปหลังการสอน", True),
            ("    ๑.๑) จำนวนผู้เรียนที่ผ่านจุดประสงค์เชิงพฤติกรรม", True),
            (f"วิชา  {cname}  รหัสวิชา  {code}", False),
            (to_thai_digits(f"หน่วย/เรื่อง  {unit_title}"), False),
            (to_thai_digits(f"ตามเกณฑ์การประเมินผลผู้เรียน กลุ่ม {group}"), False),
            (to_thai_digits(str(weekly_att)), False),
            (to_thai_digits(f"ผ่านเกณฑ์ประเมิน {passed_st} จาก {total_st} คน  คิดเป็นร้อยละ {pct_str}"), True),
            ("    ๑.๒) ผลการประเมินผู้เรียน", True),
            (to_thai_digits(str(eval_note)), False),
            (to_thai_digits(f"๒) ปัญหาที่พบ  {problems}"), False),
            (to_thai_digits(f"๓) แนวทางแก้ปัญหา  {solutions}"), False),
        ]

        cb = lambda cond: "☑" if cond else "☐"
        content_ok = sub.get("content_completed", True)
        time_ok = sub.get("time_sufficient", True)
        media_ok = sub.get("media_suitable", True)
        act_ok = sub.get("activities_suitable", True)
        assess_ok = sub.get("assessment_suitable", True)
        other_note = sub.get("other_note") or "......................................................."

        right_lines: list[tuple[str, bool]] = [
            ("๑) สอนตามแผนการจัดการเรียนรู้", True),
            (f"     {cb(content_ok)} ครบตามเนื้อหา", False),
            (f"     {cb(not content_ok)} ไม่ครบ เนื่องจาก {sub.get('content_note') or '...............................'}", False),
            ("๒) เวลาที่ใช้สอน", True),
            (f"     {cb(time_ok)} พอเพียง", False),
            (f"     {cb(not time_ok)} ไม่พอเพียง เนื่องจาก {sub.get('time_note') or '.........................'}", False),
            ("๓) สื่อ/อุปกรณ์ที่ใช้ตามกำหนด", True),
            (f"     {cb(media_ok)} เหมาะสม", False),
            (f"     {cb(not media_ok)} ไม่เหมาะสม เนื่องจาก {sub.get('media_note') or '.......................'}", False),
            ("๔) กิจกรรมการสอน", True),
            (f"     {cb(act_ok)} เหมาะสม", False),
            (f"     {cb(not act_ok)} ไม่เหมาะสม เนื่องจาก {sub.get('activities_note') or '.......................'}", False),
            ("๕) เครื่องมือวัดและประเมินผล", True),
            (f"     {cb(assess_ok)} เหมาะสม", False),
            (f"     {cb(not assess_ok)} ไม่เหมาะสม เนื่องจาก {sub.get('assessment_note') or '.......................'}", False),
            (to_thai_digits(f"๖) อื่นๆ {other_note}"), True),
        ]

        if len(s_doc.tables) > 0:
            t0 = s_doc.tables[0]
            c0 = t0.rows[2].cells[0]
            if c0.tables:
                # Keep the template's nested attitude-evaluation sub-table between 1.2) and 2)
                pre_lines = left_lines[:-2]
                post_lines = left_lines[-2:]
                sub_tbl = c0.tables[0]
                for p in list(c0.paragraphs)[1:]:
                    _remove_para(p)
                p0 = c0.paragraphs[0]
                p0.text = ""
                for l_idx, (txt, is_b) in enumerate(pre_lines):
                    p = p0 if l_idx == 0 else docx.text.paragraph.Paragraph(OxmlElement("w:p"), c0)
                    if l_idx > 0:
                        sub_tbl._element.addprevious(p._element)
                    p.paragraph_format.space_before = Pt(1)
                    p.paragraph_format.space_after = Pt(1)
                    _add_mixed_runs(p, txt, font_name=DEFAULT_FONT, size_pt=14.5, bold=is_b)
                _style_table(sub_tbl, [3.3, 1.0, 0.9, 1.1, 0.9, 1.0], border_color="64748B", header_repeat=False)
                # Normalize attitude rubric headers and write user-selected ✓ ticks (default 0 = blank)
                if len(sub_tbl.rows) >= 10:
                    _set_cell_text(sub_tbl.rows[0].cells[0], "รายการ", font_name=DEFAULT_FONT, size_pt=13.0, bold=True)
                    sub_tbl.rows[0].cells[0].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
                    _set_cell_text(sub_tbl.rows[0].cells[1], "เกณฑ์การประเมิน", font_name=DEFAULT_FONT, size_pt=13.0, bold=True)
                    sub_tbl.rows[0].cells[1].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
                    for col_idx, hdr in enumerate(["มากที่สุด", "มาก", "ปานกลาง", "น้อย", "ปรับปรุง"], start=1):
                        _set_cell_text(sub_tbl.rows[1].cells[col_idx], hdr, font_name=DEFAULT_FONT, size_pt=13.0, bold=True)
                        sub_tbl.rows[1].cells[col_idx].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

                    raw_ratings = sub.get("attitude_ratings")
                    ratings: list[int] = []
                    if isinstance(raw_ratings, list):
                        for val in raw_ratings[:8]:
                            try:
                                iv = int(val)
                            except (TypeError, ValueError):
                                iv = 0
                            ratings.append(iv if 1 <= iv <= 5 else 0)
                    while len(ratings) < 8:
                        ratings.append(0)

                    other_label = str(sub.get("attitude_other_label") or "").strip()
                    sub_tbl.rows[9].cells[0].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.LEFT
                    _set_cell_text(
                        sub_tbl.rows[9].cells[0],
                        f"8. {other_label}" if other_label else "8. อื่นๆ.................................",
                        font_name=DEFAULT_FONT,
                        size_pt=13.0,
                        bold=False,
                    )

                    for item_idx in range(8):
                        r_row = sub_tbl.rows[2 + item_idx]
                        r_val = ratings[item_idx]
                        target_col = (6 - r_val) if 1 <= r_val <= 5 else None
                        for col_idx in range(1, 6):
                            c_tick = r_row.cells[col_idx]
                            if col_idx == target_col:
                                _set_cell_text(c_tick, "✓", font_name=CHECKBOX_FONT, size_pt=11.0, bold=True)
                            else:
                                _set_cell_text(c_tick, "", font_name=DEFAULT_FONT, size_pt=13.0, bold=False)
                            c_tick.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
                for txt, is_b in post_lines:
                    p_after = c0.add_paragraph()
                    p_after.paragraph_format.space_before = Pt(2)
                    p_after.paragraph_format.space_after = Pt(1)
                    _add_mixed_runs(p_after, txt, font_name=DEFAULT_FONT, size_pt=14.5, bold=is_b)
            else:
                _set_cell_lines(c0, left_lines, font_name=DEFAULT_FONT, size_pt=14.5)
            _set_cell_lines(t0.rows[2].cells[1], right_lines, font_name=DEFAULT_FONT, size_pt=14.5)
            _style_table(t0, [8.75, 8.75], border_color="334155", header_repeat=False)

        if len(s_doc.tables) > 1:
            t1_el = s_doc.tables[1]._element
            parent_el = t1_el.getparent()
            if parent_el is not None:
                parent_el.remove(t1_el)
        sig_tbl = s_doc.add_table(rows=1, cols=2)
        _clear_table_borders(sig_tbl)
        sig_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        _set_row_cant_split(sig_tbl.rows[0])
        for c in sig_tbl.rows[0].cells:
            c.width = Cm(8.75)
            _set_cell_margins(c, 120, 40, 60, 60)
        _populate_signer_cell(
            sig_tbl.rows[0].cells[0],
            instructor,
            [f"ตำแหน่ง {position}", doc_date],
            sig_path=instr_sig,
            role_suffix="ครูผู้สอน",
            font_name=DEFAULT_FONT,
            size_pt=14.5,
        )
        _populate_signer_cell(
            sig_tbl.rows[0].cells[1],
            dept_head,
            [f"หัวหน้า{department}"],
            sig_path=dept_sig,
            role_suffix="ผู้ตรวจสอบ",
            font_name=DEFAULT_FONT,
            size_pt=14.5,
        )

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
    _set_a4_section(doc, top_cm=1.5, bottom_cm=1.5, left_cm=3.0, right_cm=2.0)  # 16.0 cm printable width

    org_name = org_profile.get("organization_name") or "วิทยาลัยการอาชีพเชียงราย"
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
    _set_para_text(ps[2], f"ส่วนราชการ  {department}  {division}  {org_name}\t", font_name="TH SarabunIT๙", font_size_pt=16.0)
    _set_para_text(ps[3], f"ที่ {to_thai_digits(str(doc_no))}\tวันที่ {doc_date}\t", font_name="TH SarabunIT๙", font_size_pt=16.0)
    _set_para_text(
        ps[6],
        to_thai_digits(
            f"\tข้าพเจ้า {instructor}  ตำแหน่ง {position} {department} ขอรายงานการสอนออนไลน์ระหว่างวันที่ {date_range} ดังนี้"
        ),
        font_name="TH SarabunIT๙",
        font_size_pt=16.0,
    )

    # Trim everything after P18 (including B24 hidden page-break paragraph & template T5..end)
    body = doc.element.body
    children = list(body)
    if len(ps) > 18 and ps[18]._element in children:
        trim_start = children.index(ps[18]._element) + 1
    else:
        t5_el = doc.tables[5]._element if len(doc.tables) > 5 else None
        trim_start = children.index(t5_el) if t5_el is not None else len(children)
    for el in children[trim_start:]:
        if not el.tag.endswith("}sectPr"):
            body.remove(el)

    _set_cell_text(
        doc.tables[0].rows[0].cells[1],
        to_thai_digits(f"รายงานการสอนออนไลน์ สัปดาห์ที่ {week_no}  ภาคเรียนที่ {semester}"),
        font_name="TH SarabunIT๙",
        size_pt=16.0,
    )
    _set_cell_text(doc.tables[1].rows[0].cells[1], dir_title, font_name="TH SarabunIT๙", size_pt=16.0)

    sessions = payload.get("sessions") or []
    t2 = doc.tables[2]
    _sync_table_rows(t2, max(1, len(sessions)), header_rows=1)
    for idx, ses in enumerate(sessions, start=1):
        row = t2.rows[idx]
        total_st = int(ses.get("total_students") or 0)
        present_st = int(ses.get("present_students") or 0)
        pct = round((present_st / total_st) * 100) if total_st > 0 else 0
        _set_cell_text(row.cells[0], f"{to_thai_digits(str(ses.get('date_text') or '-'))}\n{ses.get('course_label') or '-'}", font_name="TH SarabunIT๙", size_pt=14.0)
        _set_cell_text(row.cells[1], to_thai_digits(str(ses.get("time_text") or "-")), font_name="TH SarabunIT๙", size_pt=14.0)
        _set_cell_text(row.cells[2], to_thai_digits(str(ses.get("class_level") or "-")), font_name="TH SarabunIT๙", size_pt=14.0)
        _set_cell_text(row.cells[3], str(ses.get("major_name") or "-"), font_name="TH SarabunIT๙", size_pt=14.0)
        _set_cell_text(row.cells[4], to_thai_digits(str(total_st)), font_name="TH SarabunIT๙", size_pt=14.0)
        _set_cell_text(row.cells[5], to_thai_digits(str(present_st)), font_name="TH SarabunIT๙", size_pt=14.0)
        _set_cell_text(row.cells[6], to_thai_digits(f"{pct}%"), font_name="TH SarabunIT๙", size_pt=14.0)
    if not sessions:
        for c in range(7):
            _set_cell_text(t2.rows[1].cells[c], "-", font_name="TH SarabunIT๙", size_pt=14.0)
    _style_table(t2, [3.8, 2.9, 2.1, 2.1, 1.7, 1.7, 1.7], border_color="475569", header_repeat=True)

    _apply_cover_signatures(doc, payload, org_profile, department, division, instructor, position)

    # Append framed card/table per online subject section (16.0 cm width)
    sections = payload.get("online_sections") or []
    cb = lambda cond: "☑" if cond else "☐"
    for sec in sections:
        doc.add_page_break()

        # Box 1: Title Header Table
        hdr_tbl = doc.add_table(rows=2, cols=1)
        _shade_cell(hdr_tbl.rows[0].cells[0], "E2E8F0")
        _set_cell_lines(
            hdr_tbl.rows[0].cells[0],
            [(f"แบบบันทึกหลังการสอนออนไลน์  {org_name}  (สัปดาห์ที่ {week_no})", True)],
            font_name=DEFAULT_FONT,
            size_pt=16.0,
            align=WD_ALIGN_PARAGRAPH.CENTER,
        )
        _set_cell_lines(
            hdr_tbl.rows[1].cells[0],
            [(f"ภาคเรียนที่ {semester}  |  รหัสวิชา {sec.get('course_code') or '-'}  วิชา {sec.get('course_name') or '-'}", True)],
            font_name=DEFAULT_FONT,
            size_pt=15.0,
            align=WD_ALIGN_PARAGRAPH.CENTER,
        )
        _style_table(hdr_tbl, [16.0], border_color="334155", header_repeat=False)

        total_st = int(sec.get("total_students") or 0)
        present_st = int(sec.get("present_students") or 0)
        absent_st = max(0, total_st - present_st)
        level_type = sec.get("level_type") or "ปวช."
        system_type = sec.get("system_type") or "ทวิภาคี"
        tools = set(sec.get("tools") or [])

        # Box 2: Metadata & Attendance Table
        meta_tbl = doc.add_table(rows=3, cols=2)
        _set_cell_lines(
            meta_tbl.rows[0].cells[0],
            [(f"ผู้สอน: {instructor}", False)],
            font_name=DEFAULT_FONT,
            size_pt=14.5,
        )
        _set_cell_lines(
            meta_tbl.rows[0].cells[1],
            [(f"แผนกวิชา: {sec.get('department_name') or department}", False)],
            font_name=DEFAULT_FONT,
            size_pt=14.5,
        )
        _set_cell_lines(
            meta_tbl.rows[1].cells[0],
            [(f"ระดับชั้น  {cb(level_type == 'ปวช.')} ปวช.   {cb(level_type == 'ปวส.')} ปวส.", False)],
            font_name=DEFAULT_FONT,
            size_pt=14.5,
        )
        _set_cell_lines(
            meta_tbl.rows[1].cells[1],
            [(f"กลุ่มเรียน {sec.get('student_group') or '-'}   ระบบ {cb(system_type == 'ปกติ')} ปกติ  {cb(system_type == 'ทวิภาคี')} ทวิภาคี", False)],
            font_name=DEFAULT_FONT,
            size_pt=14.5,
        )
        att_cell = meta_tbl.rows[2].cells[0].merge(meta_tbl.rows[2].cells[1])
        _set_cell_lines(
            att_cell,
            [
                (
                    f"สาขาวิชา: {sec.get('major_name') or department}   |   "
                    f"ผู้เรียนทั้งหมด {total_st} คน   เข้าเรียน {present_st} คน   ขาดเรียน {absent_st} คน   "
                    f"รายชื่อผู้ขาด: {sec.get('absent_names') or '-'}",
                    False,
                )
            ],
            font_name=DEFAULT_FONT,
            size_pt=14.5,
        )
        _style_table(meta_tbl, [8.0, 8.0], border_color="475569", header_repeat=False)

        # Box 3: Structured Items 1-4 Table
        topics = [t.strip() for t in (sec.get("topics") or []) if str(t).strip()] or ["-"]
        outcomes = [str(o).strip() for o in (sec.get("outcomes") or []) if str(o).strip()] or ["-"]

        body_tbl = doc.add_table(rows=4, cols=2)
        items_1_to_4: list[tuple[str, list[tuple[str, bool]]]] = [
            ("1. รายการสอน / หัวข้อเรื่อง", [(f"{ti}. {top}", False) for ti, top in enumerate(topics, start=1)]),
            (
                "2. โปรแกรม / สื่อ / แหล่งเรียนรู้",
                [
                    (
                        f"{cb('Google Classroom' in tools)} Google Classroom   "
                        f"{cb('Meet' in tools)} Meet   "
                        f"{cb('Zoom' in tools)} Zoom   "
                        f"{cb('Facebook' in tools)} Facebook   "
                        f"{cb('Line' in tools)} Line",
                        False,
                    ),
                    (f"อื่นๆ: {sec.get('other_tool') or '-'}", False),
                ],
            ),
            ("3. งานที่มอบหมาย", [(str(sec.get("assignment") or "-"), False)]),
            ("4. ผลการเรียนรู้ของผู้เรียน", [(f"{oi}. {outc}", False) for oi, outc in enumerate(outcomes, start=1)]),
        ]
        for r_idx, (lbl, lines) in enumerate(items_1_to_4):
            c0, c1 = body_tbl.rows[r_idx].cells[0], body_tbl.rows[r_idx].cells[1]
            _shade_cell(c0, "F8FAFC")
            _set_cell_margins(c0, 70, 70, 100, 100)
            _set_cell_margins(c1, 70, 70, 100, 100)
            _set_cell_lines(c0, [(lbl, True)], font_name=DEFAULT_FONT, size_pt=14.5)
            _set_cell_lines(c1, lines, font_name=DEFAULT_FONT, size_pt=14.5)
        _style_table(body_tbl, [4.5, 11.5], border_color="475569", header_repeat=False)

        # Box 4: 5. Problems & Solutions Table
        p_prob_hdr = doc.add_paragraph()
        p_prob_hdr.paragraph_format.space_before = Pt(6)
        p_prob_hdr.paragraph_format.space_after = Pt(2)
        p_prob_hdr.paragraph_format.keep_with_next = True
        _apply_run_font(p_prob_hdr.add_run("5. ปัญหาและแนวทางพัฒนาคุณภาพการเรียนรู้ของผู้เรียน"), DEFAULT_FONT, 15.0, bold=True)

        tbl_p = doc.add_table(rows=2, cols=2)
        _shade_cell(tbl_p.rows[0].cells[0], "F8FAFC")
        _shade_cell(tbl_p.rows[0].cells[1], "F8FAFC")
        _set_cell_text(tbl_p.rows[0].cells[0], "ปัญหา / อุปสรรคที่พบ", font_name=DEFAULT_FONT, size_pt=14.5, bold=True)
        _set_cell_text(tbl_p.rows[0].cells[1], "แนวทางพัฒนาคุณภาพการเรียนรู้ของผู้เรียน", font_name=DEFAULT_FONT, size_pt=14.5, bold=True)
        _set_cell_text(tbl_p.rows[1].cells[0], str(sec.get("problems") or "-"), font_name=DEFAULT_FONT, size_pt=14.5)
        _set_cell_text(tbl_p.rows[1].cells[1], str(sec.get("solutions") or "-"), font_name=DEFAULT_FONT, size_pt=14.5)
        _style_table(tbl_p, [8.0, 8.0], border_color="475569", header_repeat=False)

        # Box 5: 2-Column Photo Evidence Grid
        photo_names = sec.get("photo_filenames") or []
        valid_photos = [ATTACHMENTS_DIR / Path(fn).name for fn in photo_names if (ATTACHMENTS_DIR / Path(fn).name).exists()]
        if valid_photos:
            p_img_hdr = doc.add_paragraph()
            p_img_hdr.paragraph_format.space_before = Pt(6)
            p_img_hdr.paragraph_format.space_after = Pt(2)
            p_img_hdr.paragraph_format.keep_with_next = True
            _apply_run_font(
                p_img_hdr.add_run(f"ภาพถ่ายหลักฐานการสอน ({len(valid_photos)} ภาพ) - {sec.get('course_code') or ''} {sec.get('course_name') or ''}"),
                DEFAULT_FONT,
                15.0,
                bold=True,
            )
            num_rows = (len(valid_photos) + 1) // 2
            img_tbl = doc.add_table(rows=num_rows, cols=2)
            for pi, img_path in enumerate(valid_photos):
                r_idx = pi // 2
                c_idx = pi % 2
                cell = img_tbl.rows[r_idx].cells[c_idx]
                _set_cell_margins(cell, 80, 80, 80, 80)
                cell_p = cell.paragraphs[0]
                cell_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                try:
                    cell_p.add_run().add_picture(str(img_path), width=Cm(7.2))
                except Exception:
                    _apply_run_font(cell_p.add_run(f"[ไม่สามารถฝังไฟล์ภาพ {img_path.name}]"), DEFAULT_FONT, 13.5)
                cap_p = cell.add_paragraph()
                cap_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                cap_p.paragraph_format.space_before = Pt(2)
                cap_p.paragraph_format.space_after = Pt(0)
                _apply_run_font(cap_p.add_run(f"ภาพที่ {pi + 1}"), DEFAULT_FONT, 13.5)
            _style_table(img_tbl, [8.0, 8.0], border_color="64748B", header_repeat=False)

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
