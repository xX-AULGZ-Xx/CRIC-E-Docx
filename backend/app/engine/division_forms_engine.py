"""Division-specific Official Document Forms Engine (7 forms across 4 CRIC divisions)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import docx
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Cm, Pt

from app.config import ATTACHMENTS_DIR, SIGNATURES_DIR
from app.engine.pdf_converter import convert_office_to_pdf, render_pdf_pages_to_png
from app.engine.template_resolver import resolve_system_template
from app.engine.thai_baht import baht_text
from app.engine.thai_utils import current_buddhist_year, format_thai_date, to_thai_digits

DEFAULT_FONT = "TH Sarabun New"

FORM_TITLES: dict[str, str] = {
    "vehicle_request": "แบบขออนุญาตใช้รถยนต์ราชการ",
    "official_travel": "แบบขออนุญาตไปราชการ",
    "repair_request": "บันทึกข้อความแจ้งซ่อมบำรุง",
    "overload_teaching": "แบบขอเบิกค่าสอนเกินภาระงาน",
    "internship_supervision": "รายงานการนิเทศฝึกงานนักเรียน นักศึกษา",
    "home_visit": "แบบรายงานการเยี่ยมบ้านนักเรียน นักศึกษา",
    "project_summary": "รายงานสรุปผลการดำเนินงานโครงการ",
    "single_plan_summary": "รายงานสรุปผลการดำเนินงานแผนปฏิบัติการรายบุคคล (แผนเดี่ยว)",
}


def _apply_font(run: Any, font_name: str = DEFAULT_FONT, size_pt: float = 15.5, bold: bool = False) -> None:
    run.font.name = font_name
    run.font.size = Pt(size_pt)
    run.font.bold = bold
    r_pr = run._r.get_or_add_rPr()
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
        if bold:
            if qn("w:val") in el.attrib:
                del el.attrib[qn("w:val")]
        else:
            el.set(qn("w:val"), "0")


def _new_a4_doc() -> docx.Document:
    doc = docx.Document()
    sec = doc.sections[0]
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    sec.top_margin = Cm(1.8)
    sec.bottom_margin = Cm(1.5)
    sec.left_margin = Cm(2.2)
    sec.right_margin = Cm(1.8)
    return doc


def _add_p(
    doc: docx.Document,
    text: str = "",
    size_pt: float = 15.5,
    bold: bool = False,
    align: WD_ALIGN_PARAGRAPH = WD_ALIGN_PARAGRAPH.LEFT,
    before_pt: float = 2.0,
    after_pt: float = 2.0,
    indent_cm: float = 0.0,
) -> Any:
    p = doc.add_paragraph()
    p.alignment = align
    p.paragraph_format.space_before = Pt(before_pt)
    p.paragraph_format.space_after = Pt(after_pt)
    if indent_cm:
        p.paragraph_format.first_line_indent = Cm(indent_cm)
    if text:
        _apply_font(p.add_run(text), size_pt=size_pt, bold=bold)
    return p


def _add_kv_line(doc: docx.Document, label: str, value: str, indent_cm: float = 0.0) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    if indent_cm:
        p.paragraph_format.first_line_indent = Cm(indent_cm)
    _apply_font(p.add_run(f"{label}  "), size_pt=15.5, bold=True)
    _apply_font(p.add_run(value or "-"), size_pt=15.5, bold=False)


def _style_grid(table: Any, col_widths_cm: list[float], header_bg: str = "F1F5F9") -> None:
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    tbl_pr = table._tbl.tblPr
    if tbl_pr is not None:
        for old in tbl_pr.findall(qn("w:tblBorders")):
            tbl_pr.remove(old)
        tbl_pr.append(
            parse_xml(
                f'<w:tblBorders {nsdecls("w")}>'
                f'<w:top w:val="single" w:sz="6" w:space="0" w:color="000000"/>'
                f'<w:left w:val="single" w:sz="6" w:space="0" w:color="000000"/>'
                f'<w:bottom w:val="single" w:sz="6" w:space="0" w:color="000000"/>'
                f'<w:right w:val="single" w:sz="6" w:space="0" w:color="000000"/>'
                f'<w:insideH w:val="single" w:sz="4" w:space="0" w:color="334155"/>'
                f'<w:insideV w:val="single" w:sz="4" w:space="0" w:color="334155"/>'
                f"</w:tblBorders>"
            )
        )
    for r_idx, row in enumerate(table.rows):
        tr_pr = row._tr.get_or_add_trPr()
        if tr_pr.find(qn("w:cantSplit")) is None:
            tr_pr.append(OxmlElement("w:cantSplit"))
        if r_idx == 0 and tr_pr.find(qn("w:tblHeader")) is None:
            tr_pr.append(OxmlElement("w:tblHeader"))
        for c_idx, cell in enumerate(row.cells):
            if c_idx < len(col_widths_cm):
                cell.width = Cm(col_widths_cm[c_idx])
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            tc_pr = cell._tc.get_or_add_tcPr()
            for old in tc_pr.findall(qn("w:tcMar")):
                tc_pr.remove(old)
            tc_pr.append(
                parse_xml(
                    f'<w:tcMar {nsdecls("w")}>'
                    f'<w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/>'
                    f'<w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/>'
                    f"</w:tcMar>"
                )
            )
            if r_idx == 0:
                for old in tc_pr.findall(qn("w:shd")):
                    tc_pr.remove(old)
                tc_pr.append(parse_xml(f'<w:shd {nsdecls("w")} w:fill="{header_bg}"/>'))


def _set_cell(cell: Any, text: str, bold: bool = False, align: WD_ALIGN_PARAGRAPH = WD_ALIGN_PARAGRAPH.LEFT, size_pt: float = 14.5) -> None:
    p = cell.paragraphs[0]
    p.text = ""
    p.alignment = align
    p.paragraph_format.space_before = Pt(1)
    p.paragraph_format.space_after = Pt(1)
    _apply_font(p.add_run(str(text)), size_pt=size_pt, bold=bold)


def _add_table(doc: docx.Document, headers: list[str], rows_data: list[list[tuple[str, WD_ALIGN_PARAGRAPH]]], col_widths_cm: list[float]) -> None:
    tbl = doc.add_table(rows=1 + max(1, len(rows_data)), cols=len(headers))
    for i, hdr in enumerate(headers):
        _set_cell(tbl.rows[0].cells[i], hdr, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, size_pt=14.5)
    if not rows_data:
        for i in range(len(headers)):
            _set_cell(tbl.rows[1].cells[i], "-", align=WD_ALIGN_PARAGRAPH.CENTER)
    else:
        for r_idx, row_vals in enumerate(rows_data, start=1):
            for c_idx, (val, al) in enumerate(row_vals):
                _set_cell(tbl.rows[r_idx].cells[c_idx], val, align=al)
    _style_grid(tbl, col_widths_cm)


def _resolve_sig(val: Any) -> Path | None:
    if not val or not isinstance(val, str):
        return None
    p = Path(val)
    if p.exists():
        return p
    cand = SIGNATURES_DIR / p.name
    return cand if cand.exists() else None


def _add_signatures(
    doc: docx.Document,
    left_label: str,
    left_name: str,
    left_title: str,
    right_label: str,
    right_name: str,
    right_title: str,
    left_sig: Path | None = None,
) -> None:
    _add_p(doc, "", before_pt=10, after_pt=2)
    tbl = doc.add_table(rows=1, cols=2)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl_pr = tbl._tbl.tblPr
    if tbl_pr is not None:
        tbl_pr.append(
            parse_xml(
                f'<w:tblBorders {nsdecls("w")}>'
                f'<w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/>'
                f'<w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/>'
                f"</w:tblBorders>"
            )
        )
    for col_idx, (lbl, nm, ttl, sig_p) in enumerate(
        [(left_label, left_name, left_title, left_sig), (right_label, right_name, right_title, None)]
    ):
        c = tbl.rows[0].cells[col_idx]
        c.width = Cm(8.5)
        p0 = c.paragraphs[0]
        p0.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _apply_font(p0.add_run(lbl), size_pt=15.0, bold=True)
        p1 = c.add_paragraph()
        p1.alignment = WD_ALIGN_PARAGRAPH.CENTER
        if sig_p is not None:
            try:
                p1.add_run().add_picture(str(sig_p), height=Cm(1.0))
            except Exception:
                _apply_font(p1.add_run("ลงชื่อ................................................"), size_pt=15.0)
        else:
            _apply_font(p1.add_run("ลงชื่อ................................................"), size_pt=15.0)
        p2 = c.add_paragraph()
        p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _apply_font(p2.add_run(f"({nm or '................................................'})"), size_pt=15.0)
        if ttl:
            p3 = c.add_paragraph()
            p3.alignment = WD_ALIGN_PARAGRAPH.CENTER
            _apply_font(p3.add_run(ttl), size_pt=15.0)


def _add_memo_header(doc: docx.Document, title: str, payload: dict[str, Any], org_profile: dict[str, Any]) -> None:
    org_name = org_profile.get("organization_name") or "วิทยาลัยการอาชีพเชียงราย"
    division = payload.get("division_name") or "ฝ่ายบริหารทรัพยากร"
    unit = payload.get("department_name") or payload.get("unit_name") or ""
    doc_no = payload.get("doc_number") or "...................................."
    doc_date = format_thai_date(payload.get("doc_date"))
    dir_title = (org_profile.get("director") or {}).get("title") or f"ผู้อำนวยการ{org_name}"

    _add_p(doc, org_name, size_pt=18.0, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, before_pt=0, after_pt=0)
    _add_p(doc, title, size_pt=18.0, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, before_pt=0, after_pt=6)
    _add_kv_line(doc, "ส่วนราชการ", to_thai_digits(f"{unit}  {division}  {org_name}".strip()))
    _add_kv_line(doc, "ที่", to_thai_digits(f"{doc_no}          วันที่  {doc_date}"))
    _add_kv_line(doc, "เรียน", dir_title)


def _replace_para_text(para: Any, text: str, font_name: str = "TH SarabunPSK", size_pt: float = 16.0, bold: bool = False) -> None:
    for r in list(para.runs):
        r._element.getparent().remove(r._element)
    run = para.add_run(text)
    _apply_font(run, font_name=font_name, size_pt=size_pt, bold=bold)


def _remove_paragraph(para: Any) -> None:
    el = para._element
    parent = el.getparent()
    if parent is not None:
        parent.remove(el)


def _build_repair_request_doc(payload: dict[str, Any], org_profile: dict[str, Any]) -> docx.Document:
    tpl_path = resolve_system_template("repair_request.docx")
    doc = docx.Document(str(tpl_path))
    paras = doc.paragraphs

    org_name = org_profile.get("organization_name") or "วิทยาลัยการอาชีพเชียงราย"
    doc_no = str(payload.get("doc_number") or "").strip()
    be_year = to_thai_digits(str(current_buddhist_year()))
    doc_no_text = to_thai_digits(doc_no) if doc_no else f"ฝบ.             /{be_year}"
    doc_date = format_thai_date(payload.get("doc_date"))

    # Paragraph 2: ส่วนราชการ
    if len(paras) > 2:
        _replace_para_text(paras[2], f"ส่วนราชการ  งานอาคารสถานที่ ฝ่ายบริหารทรัพยากร {org_name}", size_pt=16.0, bold=False)

    # Paragraph 3: ที่ ... วันที่ ...
    if len(paras) > 3:
        _replace_para_text(paras[3], f"ที่  {doc_no_text}\tวันที่  {doc_date}", size_pt=16.0, bold=False)

    # Paragraph 4: เรื่อง ขอแจ้งซ่อมบำรุง + Checkboxes
    cats = set(payload.get("categories") or [])
    other_txt = str(payload.get("other_category_text") or "").strip()
    cat_labels = ["ครุภัณฑ์", "ระบบไฟฟ้า-ประปา", "สาธารณูปโภค", "อาคารสิ่งก่อสร้าง"]
    marks = [f"{'☑' if c in cats else '☐'} {c}" for c in cat_labels]
    other_mark = "☑" if ("อื่นๆ" in cats or other_txt) else "☐"
    other_fill = other_txt if other_txt else "...................................................................................................................."
    if len(paras) > 4:
        _replace_para_text(
            paras[4],
            f"เรื่อง  ขอแจ้งซ่อมบำรุง  {'  '.join(marks)}\n\t  {other_mark} อื่นๆ {other_fill}",
            size_pt=16.0,
            bold=False,
        )

    # Paragraph 5: เรียน
    dir_title = (org_profile.get("director") or {}).get("title") or f"ผู้อำนวยการ{org_name}"
    if len(paras) > 5:
        _replace_para_text(paras[5], f"เรียน  {dir_title}", size_pt=16.0, bold=False)

    # Paragraph 6: ด้วย แผนก/งาน ... ฝ่าย ...
    dept = str(payload.get("department_name") or "").strip() or "................................................................"
    div_name = str(payload.get("division_name") or "").strip() or "....................................................."
    if len(paras) > 6:
        _replace_para_text(
            paras[6],
            f"\tด้วย แผนก/งาน {dept}  ฝ่าย {div_name}\nมีความประสงค์ที่จะขอแจ้งปรับปรุงซ่อมแซม/ซ่อมบำรุง โดยมีรายละเอียดเบื้องต้นดังนี้",
            size_pt=16.0,
            bold=False,
        )

    # Table 0: 6-column repair items table
    items = payload.get("items") or []
    if doc.tables:
        tbl = doc.tables[0]
        # Ensure enough data rows (template has 1 header + 5 data rows)
        while len(tbl.rows) < 1 + max(5, len(items)):
            tbl.add_row()
        for r_idx in range(1, len(tbl.rows)):
            item = items[r_idx - 1] if r_idx - 1 < len(items) else None
            row_cells = tbl.rows[r_idx].cells
            if item and any(str(item.get(k) or "").strip() for k in ("description", "cause", "location")):
                vals = [
                    (to_thai_digits(str(r_idx)), WD_ALIGN_PARAGRAPH.CENTER),
                    (str(item.get("description") or "-"), WD_ALIGN_PARAGRAPH.LEFT),
                    (str(item.get("cause") or "-"), WD_ALIGN_PARAGRAPH.LEFT),
                    (to_thai_digits(str(item.get("quantity") or "")), WD_ALIGN_PARAGRAPH.CENTER),
                    (str(item.get("unit") or ""), WD_ALIGN_PARAGRAPH.CENTER),
                    (str(item.get("location") or "-"), WD_ALIGN_PARAGRAPH.LEFT),
                ]
            else:
                vals = [("", WD_ALIGN_PARAGRAPH.CENTER)] * 6
            for c_idx, (val, al) in enumerate(vals):
                _set_cell(row_cells[c_idx], val, align=al, size_pt=15.0)

    # Signatures: requester & deputy_resource
    requester = str(payload.get("requester_name") or "").strip() or "                                        "
    requester_title = str(payload.get("requester_title") or "").strip() or "ตำแหน่งผู้แจ้ง"
    deputy_name = str(payload.get("deputy_resource_name") or "").strip() or "นางสาวอรวรรณ แสงดาว"
    deputy_title = str(payload.get("deputy_resource_title") or "").strip() or "รองผู้อำนวยการฝ่ายบริหารทรัพยากร"
    sigs = payload.get("signatures") if isinstance(payload.get("signatures"), dict) else {}
    req_sig = _resolve_sig(sigs.get("requester"))

    if req_sig and len(paras) > 10:
        paras[10].alignment = WD_ALIGN_PARAGRAPH.CENTER
        paras[10].add_run().add_picture(str(req_sig), width=Cm(3.0))
    if len(paras) > 11:
        _replace_para_text(paras[11], f"\t\t({requester})", size_pt=16.0)
    if len(paras) > 12:
        _replace_para_text(paras[12], f"\t\t\t\t\t\t\t{requester_title}", size_pt=16.0)
    if len(paras) > 16:
        _replace_para_text(paras[16], f"\t\t({deputy_name})", size_pt=16.0)
    if len(paras) > 17:
        _replace_para_text(paras[17], f"\t\t\t\t\t   {deputy_title}", size_pt=16.0)

    # Page 2: Photo attachment page
    photos = [p for p in (payload.get("photos") or []) if isinstance(p, dict) and p.get("filename")][:4]
    include_photo_page = bool(payload.get("include_photo_page", True)) or bool(photos)

    if not include_photo_page:
        for p in list(paras[18:]):
            _remove_paragraph(p)
    elif photos:
        # Clear blank placeholder lines after heading (paras[35]) and insert 2x2 photo grid
        for p in list(paras[36:]):
            _remove_paragraph(p)
        photo_tbl = doc.add_table(rows=2, cols=2)
        photo_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        for idx, ph in enumerate(photos):
            r_i, c_i = divmod(idx, 2)
            cell = photo_tbl.rows[r_i].cells[c_i]
            cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            img_path = ATTACHMENTS_DIR / Path(str(ph["filename"])).name
            if img_path.exists():
                cell.paragraphs[0].add_run().add_picture(str(img_path), width=Cm(7.5))
            cap_p = cell.add_paragraph()
            cap_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            _apply_font(cap_p.add_run(str(ph.get("caption") or f"รูปที่ {to_thai_digits(str(idx + 1))}")), font_name="TH SarabunPSK", size_pt=14.0)
        _style_grid(photo_tbl, [8.2, 8.2])

    return doc


def generate_division_form(
    form_type: str,
    payload: dict[str, Any],
    out_dir: Path,
    prefix: str,
    org_profile: dict[str, Any],
    convert_pdf: bool = True,
) -> dict[str, Any]:
    if form_type not in FORM_TITLES:
        raise ValueError(f"Unsupported division form_type: {form_type}")

    out_dir.mkdir(parents=True, exist_ok=True)
    if form_type == "repair_request":
        doc = _build_repair_request_doc(payload, org_profile)
        docx_path = out_dir / f"{prefix}_{form_type}.docx"
        doc.save(docx_path)
        pdf_path = convert_office_to_pdf(docx_path, out_dir) if convert_pdf else None
        png_paths = render_pdf_pages_to_png(pdf_path, out_dir, prefix=f"{prefix}_{form_type}") if pdf_path else []
        return {
            "form_type": form_type,
            "title": FORM_TITLES[form_type],
            "docx_path": docx_path,
            "pdf_path": pdf_path,
            "png_paths": png_paths,
        }

    doc = _new_a4_doc()
    org_name = org_profile.get("organization_name") or "วิทยาลัยการอาชีพเชียงราย"
    dir_name = (org_profile.get("director") or {}).get("name") or "................................................"
    dir_title = (org_profile.get("director") or {}).get("title") or f"ผู้อำนวยการ{org_name}"
    requester = payload.get("requester_name") or payload.get("instructor_name") or "ผู้ขออนุญาต"
    requester_title = payload.get("requester_title") or "ผู้รับผิดชอบ"
    dept_head = payload.get("dept_head_name") or ""
    sigs = payload.get("signatures") if isinstance(payload.get("signatures"), dict) else {}
    req_sig = _resolve_sig(sigs.get("requester") or sigs.get("instructor"))

    _add_memo_header(doc, FORM_TITLES[form_type], payload, org_profile)

    if form_type == "vehicle_request":
        purpose = payload.get("purpose") or "-"
        dest = payload.get("destination") or "-"
        travel_date = format_thai_date(payload.get("travel_date") or payload.get("doc_date"))
        time_range = to_thai_digits(f"{payload.get('time_start') or '08.30'} - {payload.get('time_end') or '16.30'} น.")
        vehicle_type = payload.get("vehicle_type") or "รถยนต์ราชการ (รถตู้/กระบะ)"
        plate = payload.get("license_plate") or "-"
        driver = payload.get("driver_name") or "ตามที่งานยานพาหนะจัดสรร"
        passengers = payload.get("passengers") or []
        _add_p(
            doc,
            to_thai_digits(
                f"ข้าพเจ้า {requester}  ตำแหน่ง {requester_title}  มีความประสงค์ขออนุญาตใช้รถยนต์ราชการ ({vehicle_type} ทะเบียน {plate}) "
                f"เพื่อไปปฏิบัติราชการ ณ {dest}  ในวันที่ {travel_date}  เวลา {time_range}  เพื่อ {purpose}"
            ),
            indent_cm=1.5,
        )
        _add_kv_line(doc, "พนักงานขับรถ", driver, indent_cm=1.5)
        rows = [
            [
                (to_thai_digits(str(i)), WD_ALIGN_PARAGRAPH.CENTER),
                (str(p.get("name") or "-"), WD_ALIGN_PARAGRAPH.LEFT),
                (str(p.get("position") or "-"), WD_ALIGN_PARAGRAPH.LEFT),
            ]
            for i, p in enumerate(passengers, start=1)
        ]
        _add_p(doc, "รายชื่อผู้ร่วมเดินทาง", bold=True, before_pt=4, after_pt=2)
        _add_table(doc, ["ลำดับ", "ชื่อ - สกุล", "ตำแหน่ง"], rows, [2.0, 8.5, 6.5])
        _add_signatures(doc, "ผู้ขออนุญาต", requester, requester_title, "ผู้พิจารณาอนุญาต", dir_name, dir_title, req_sig)

    elif form_type == "official_travel":
        subject = payload.get("subject") or "ขออนุญาตเดินทางไปราชการ"
        dest = payload.get("destination") or "-"
        start_d = format_thai_date(payload.get("start_date") or payload.get("doc_date"))
        end_d = format_thai_date(payload.get("end_date") or payload.get("doc_date"))
        vehicle = payload.get("vehicle") or "รถยนต์ราชการ / รถโดยสารประจำทาง"
        allowance = float(payload.get("allowance_amount") or 0)
        lodging = float(payload.get("lodging_amount") or 0)
        transport = float(payload.get("transport_amount") or 0)
        other_amt = float(payload.get("other_amount") or 0)
        total_amt = round(allowance + lodging + transport + other_amt, 2)
        travelers = payload.get("travelers") or [{"name": requester, "position": requester_title}]
        _add_kv_line(doc, "เรื่อง", subject)
        _add_p(
            doc,
            to_thai_digits(
                f"ด้วย {requester} ตำแหน่ง {requester_title} มีความประสงค์ขออนุญาตเดินทางไปราชการ ณ {dest} "
                f"ตั้งแต่วันที่ {start_d} ถึงวันที่ {end_d}  โดยพาหนะ {vehicle}"
            ),
            indent_cm=1.5,
        )
        rows = [
            [
                (to_thai_digits(str(i)), WD_ALIGN_PARAGRAPH.CENTER),
                (str(t.get("name") or "-"), WD_ALIGN_PARAGRAPH.LEFT),
                (str(t.get("position") or "-"), WD_ALIGN_PARAGRAPH.LEFT),
            ]
            for i, t in enumerate(travelers, start=1)
        ]
        _add_p(doc, "รายชื่อผู้เดินทางไปราชการ", bold=True, before_pt=4, after_pt=2)
        _add_table(doc, ["ลำดับ", "ชื่อ - สกุล", "ตำแหน่ง"], rows, [2.0, 8.5, 6.5])
        _add_p(
            doc,
            to_thai_digits(
                f"ประมาณการค่าใช้จ่าย: ค่าเบี้ยเลี้ยง {allowance:,.2f} บาท  ค่าที่พัก {lodging:,.2f} บาท  "
                f"ค่าพาหนะ {transport:,.2f} บาท  อื่นๆ {other_amt:,.2f} บาท  รวมทั้งสิ้น {total_amt:,.2f} บาท ({baht_text(total_amt)})"
            ),
            before_pt=6,
            bold=True,
        )
        _add_signatures(doc, "ผู้ขออนุญาต", requester, requester_title, "ผู้อนุมัติ", dir_name, dir_title, req_sig)

    elif form_type == "overload_teaching":
        semester = to_thai_digits(str(payload.get("semester") or f"2/{current_buddhist_year()}"))
        month_label = to_thai_digits(str(payload.get("month_label") or "พฤศจิกายน ๒๕๖๙"))
        base_hours = to_thai_digits(str(payload.get("base_load_hours") or 18))
        courses = payload.get("courses") or []
        _add_p(
            doc,
            to_thai_digits(
                f"ข้าพเจ้า {requester} ตำแหน่ง {requester_title} ภาคเรียนที่ {semester} ประจำเดือน {month_label} "
                f"(ภาระงานสอนปกติ {base_hours} คาบ/สัปดาห์) ขอเบิกค่าสอนเกินภาระงานดังรายการต่อไปนี้"
            ),
            indent_cm=1.5,
        )
        rows: list[list[tuple[str, WD_ALIGN_PARAGRAPH]]] = []
        total_money = 0.0
        for i, c in enumerate(courses, start=1):
            hrs = float(c.get("extra_hours") or 0)
            rate = float(c.get("rate_per_hour") or 200)
            amt = round(hrs * rate, 2)
            total_money += amt
            rows.append(
                [
                    (to_thai_digits(str(i)), WD_ALIGN_PARAGRAPH.CENTER),
                    (to_thai_digits(str(c.get("course_code") or "-")), WD_ALIGN_PARAGRAPH.CENTER),
                    (str(c.get("course_name") or "-"), WD_ALIGN_PARAGRAPH.LEFT),
                    (to_thai_digits(f"{hrs:g}"), WD_ALIGN_PARAGRAPH.CENTER),
                    (to_thai_digits(f"{rate:,.2f}"), WD_ALIGN_PARAGRAPH.RIGHT),
                    (to_thai_digits(f"{amt:,.2f}"), WD_ALIGN_PARAGRAPH.RIGHT),
                ]
            )
        _add_table(doc, ["ที่", "รหัสวิชา", "ชื่อวิชา", "คาบเกิน", "อัตรา/คาบ", "เป็นเงิน (บาท)"], rows, [1.2, 2.8, 6.2, 2.0, 2.3, 2.5])
        _add_p(doc, to_thai_digits(f"รวมขอเบิกทั้งสิ้น  {total_money:,.2f} บาท  ({baht_text(total_money)})"), bold=True, align=WD_ALIGN_PARAGRAPH.RIGHT, before_pt=4)
        _add_signatures(doc, "ผู้ขอเบิก", requester, requester_title, "ผู้รับรอง (หัวหน้าแผนก/งาน)", dept_head or "................................................", "หัวหน้าแผนกวิชา/งาน", req_sig)

    elif form_type == "internship_supervision":
        semester = to_thai_digits(str(payload.get("semester") or f"2/{current_buddhist_year()}"))
        company = payload.get("company_name") or "-"
        address = payload.get("company_address") or "-"
        mentor = payload.get("mentor_name") or "-"
        visit_date = format_thai_date(payload.get("visit_date") or payload.get("doc_date"))
        students = payload.get("students") or []
        summary = payload.get("supervision_summary") or "นักศึกษาปฏิบัติงานด้วยความตั้งใจ มีวินัย และปฏิบัติตามกฎระเบียบของสถานประกอบการ"
        suggestions = payload.get("suggestions") or "-"
        _add_kv_line(doc, "ภาคเรียน/ปีการศึกษา", f"{semester}   วันที่นิเทศ {visit_date}")
        _add_kv_line(doc, "สถานประกอบการ", f"{company}  ที่ตั้ง {address}")
        _add_kv_line(doc, "ผู้ควบคุมฝึก / พี่เลี้ยง", mentor)
        rows = [
            [
                (to_thai_digits(str(i)), WD_ALIGN_PARAGRAPH.CENTER),
                (to_thai_digits(str(s.get("student_id") or "-")), WD_ALIGN_PARAGRAPH.CENTER),
                (str(s.get("name") or "-"), WD_ALIGN_PARAGRAPH.LEFT),
                (str(s.get("result") or "ผ่านเกณฑ์ดี"), WD_ALIGN_PARAGRAPH.CENTER),
            ]
            for i, s in enumerate(students, start=1)
        ]
        _add_table(doc, ["ลำดับ", "รหัสนักศึกษา", "ชื่อ - สกุล", "ผลการนิเทศ"], rows, [1.5, 3.5, 8.0, 4.0])
        _add_kv_line(doc, "สรุปผลการนิเทศ", summary)
        _add_kv_line(doc, "ปัญหาและข้อเสนอแนะ", suggestions)
        _add_signatures(doc, "ครูผู้นิเทศ", requester, requester_title, "หัวหน้างานอาชีวศึกษาระบบทวิภาคี", dept_head or "................................................", "หัวหน้างานฯ", req_sig)

    elif form_type == "home_visit":
        student_name = payload.get("student_name") or "-"
        student_id = to_thai_digits(str(payload.get("student_id") or "-"))
        class_group = to_thai_digits(str(payload.get("student_group") or "-"))
        guardian = payload.get("guardian_name") or "-"
        guardian_phone = to_thai_digits(str(payload.get("guardian_phone") or "-"))
        address = payload.get("home_address") or "-"
        visit_date = format_thai_date(payload.get("visit_date") or payload.get("doc_date"))
        living_cond = payload.get("living_condition") or "-"
        behavior = payload.get("behavior_note") or "-"
        support_plan = payload.get("support_plan") or "-"
        _add_kv_line(doc, "วันที่เยี่ยมบ้าน", visit_date)
        _add_kv_line(doc, "ชื่อนักศึกษา", f"{student_name}  รหัสประจำตัว {student_id}  กลุ่มเรียน {class_group}")
        _add_kv_line(doc, "ผู้ปกครอง", f"{guardian}  โทรศัพท์ {guardian_phone}")
        _add_kv_line(doc, "ที่อยู่ปัจจุบัน", address)
        _add_table(
            doc,
            ["หัวข้อการประเมินเยี่ยมบ้าน", "รายละเอียดข้อมูลที่พบ"],
            [
                [("๑. สภาพความเป็นอยู่และเศรษฐกิจครอบครัว", WD_ALIGN_PARAGRAPH.LEFT), (living_cond, WD_ALIGN_PARAGRAPH.LEFT)],
                [("๒. พฤติกรรม ความประพฤติ และปัญหาที่พบ", WD_ALIGN_PARAGRAPH.LEFT), (behavior, WD_ALIGN_PARAGRAPH.LEFT)],
                [("๓. แนวทางการดูแลช่วยเหลือ / ส่งต่อ", WD_ALIGN_PARAGRAPH.LEFT), (support_plan, WD_ALIGN_PARAGRAPH.LEFT)],
            ],
            [6.5, 10.5],
        )
        _add_signatures(doc, "ครูที่ปรึกษาผู้เยี่ยมบ้าน", requester, requester_title, "ผู้ปกครองนักเรียน", guardian, "ผู้ให้ข้อมูล", req_sig)

    elif form_type == "project_summary":
        project_name = payload.get("project_name") or "-"
        project_code = to_thai_digits(str(payload.get("project_code") or "-"))
        budget_year = to_thai_digits(str(payload.get("budget_year_be") or current_buddhist_year() + 1))
        alloc = float(payload.get("budget_allocated") or 0)
        spent = float(payload.get("budget_spent") or 0)
        remain = round(alloc - spent, 2)
        kpis = payload.get("kpis") or []
        summary = payload.get("summary_note") or "-"
        problems = payload.get("problems_note") or "-"
        _add_kv_line(doc, "ชื่อโครงการ", f"{project_name} (รหัส {project_code})  ปีงบประมาณ พ.ศ. {budget_year}")
        _add_kv_line(
            doc,
            "สรุปงบประมาณ",
            to_thai_digits(f"ได้รับอนุมัติ {alloc:,.2f} บาท  ใช้จ่ายจริง {spent:,.2f} บาท  คงเหลือ {remain:,.2f} บาท"),
        )
        rows = [
            [
                (to_thai_digits(str(i)), WD_ALIGN_PARAGRAPH.CENTER),
                (str(k.get("indicator") or "-"), WD_ALIGN_PARAGRAPH.LEFT),
                (to_thai_digits(str(k.get("target") or "-")), WD_ALIGN_PARAGRAPH.CENTER),
                (to_thai_digits(str(k.get("actual") or "-")), WD_ALIGN_PARAGRAPH.CENTER),
            ]
            for i, k in enumerate(kpis, start=1)
        ]
        _add_table(doc, ["ที่", "ตัวชี้วัดความสำเร็จ (KPI)", "เป้าหมาย", "ผลที่ทำได้"], rows, [1.5, 8.5, 3.5, 3.5])
        _add_kv_line(doc, "สรุปผลการดำเนินงาน", summary)
        _add_kv_line(doc, "ปัญหา อุปสรรค และข้อเสนอแนะ", problems)
        _add_signatures(doc, "ผู้รับผิดชอบโครงการ", requester, requester_title, "หัวหน้างานวางแผนและงบประมาณ", dept_head or "................................................", "ผู้ตรวจรายงาน", req_sig)

    elif form_type == "single_plan_summary":
        plan_name = payload.get("plan_name") or "-"
        budget_year = to_thai_digits(str(payload.get("budget_year_be") or current_buddhist_year() + 1))
        activities = payload.get("activities") or []
        summary = payload.get("summary_note") or "-"
        _add_kv_line(doc, "ชื่อแผนปฏิบัติการ / แผนเดี่ยว", f"{plan_name}  ปีงบประมาณ พ.ศ. {budget_year}")
        rows = [
            [
                (to_thai_digits(str(i)), WD_ALIGN_PARAGRAPH.CENTER),
                (str(a.get("activity") or "-"), WD_ALIGN_PARAGRAPH.LEFT),
                (to_thai_digits(str(a.get("target") or "-")), WD_ALIGN_PARAGRAPH.CENTER),
                (to_thai_digits(str(a.get("result") or "-")), WD_ALIGN_PARAGRAPH.CENTER),
                (to_thai_digits(str(a.get("percent") or "100%")), WD_ALIGN_PARAGRAPH.CENTER),
            ]
            for i, a in enumerate(activities, start=1)
        ]
        _add_table(doc, ["ที่", "กิจกรรมตามแผน", "เป้าหมาย", "ผลการดำเนินงาน", "ร้อยละ"], rows, [1.2, 6.8, 3.0, 4.0, 2.0])
        _add_kv_line(doc, "สรุปผลภาพรวมและข้อเสนอแนะ", summary)
        _add_signatures(doc, "ผู้จัดทำแผน", requester, requester_title, "ผู้อำนวยการ", dir_name, dir_title, req_sig)

    docx_path = out_dir / f"{prefix}_{form_type}.docx"
    doc.save(docx_path)

    pdf_path: Path | None = None
    png_paths: list[Path] = []
    if convert_pdf:
        pdf_path = convert_office_to_pdf(docx_path, out_dir)
        png_paths = render_pdf_pages_to_png(pdf_path, out_dir, prefix=f"{prefix}_{form_type}")

    return {
        "form_type": form_type,
        "title": FORM_TITLES[form_type],
        "docx_path": docx_path,
        "pdf_path": pdf_path,
        "png_paths": png_paths,
    }
