"""QA Indicator Data-Collection Tools Engine (32 .docx templates across 4 CRIC divisions)."""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Any

import docx
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Cm, Pt

from app.config import SIGNATURES_DIR, TEMPLATES_DIR
from app.engine.pdf_converter import convert_office_to_pdf, render_pdf_pages_to_png
from app.engine.thai_utils import current_buddhist_year, format_thai_date, to_thai_digits

QA_TEMPLATES_DIR = TEMPLATES_DIR / "qa_tools"
DEFAULT_FONT = "TH Sarabun New"
CHECKBOX_FONT = "DejaVu Sans"

_DIV_META_BY_FOLDER: dict[str, tuple[str, str]] = {
    "เอกสารส่ง ฝ่ายบริหารทรัพยากร": ("ฝบ.", "ฝ่ายบริหารทรัพยากร"),
    "เอกสารส่ง ฝ่ายวิชาการ": ("ฝว.", "ฝ่ายวิชาการ"),
    "เอกสารส่ง ฝ่ายพัฒนากิจการ นักเรียนนักศึกษา": ("ฝก.", "ฝ่ายพัฒนากิจการนักเรียน นักศึกษา"),
    "เอกสารส่ง ฝ่ายแผนงานและความร่วมมือ": ("ฝย.", "ฝ่ายแผนงานและความร่วมมือ"),
}

_UNIT_DISPLAY_FIX: dict[str, str] = {
    "งาครูที่ปรึกษา": "งานครูที่ปรึกษา",
    "งานศุนย์บ่มเพาะ": "งานศูนย์บ่มเพาะ",
}

_TITLE_BY_CODE: dict[str, str] = {
    "1.1.1": "การพัฒนาสมรรถนะผู้สำเร็จการศึกษาในหมวดวิชาสมรรถนะแกนกลาง",
    "1.1.2": "การประเมินมาตรฐานวิชาชีพ",
    "1.1.3": "การทดสอบหรือประเมินสมรรถนะภาษาต่างประเทศและสมรรถนะการใช้ดิจิทัลของผู้สำเร็จการศึกษา",
    "1.2.1": "การพัฒนาสมรรถนะผู้สำเร็จการศึกษาในหมวดวิชาสมรรถนะวิชาชีพ",
    "1.2.2": "การประกวดหรือแข่งขันทักษะวิชาพื้นฐาน ทักษะวิชาชีพ ทักษะอื่น ๆ",
    "1.2.3": "สมรรถนะในการเป็นผู้ประกอบการหรือประกอบอาชีพอิสระ",
    "1.2.4": "การทดสอบหรือประเมินสมรรถนะบุคคลของผู้สำเร็จการศึกษาตามมาตรฐานอาชีพ",
    "1.2.5": "การมีงานทำและศึกษาต่อของผู้สำเร็จการศึกษา",
    "1.2.6": "ความพึงพอใจของหน่วยงาน สถานประกอบการ หรือผู้ใช้ต่อคุณภาพของผู้สำเร็จการศึกษา",
    "1.3.1": "การพัฒนาคุณธรรม จริยธรรม และคุณลักษณะที่พึงประสงค์ของผู้สำเร็จการศึกษา",
    "1.3.2": "การประเมินคุณลักษณะที่พึงประสงค์ของผู้สำเร็จการศึกษา",
    "1.3.3": "การดูแลช่วยเหลือและแนะแนวผู้สำเร็จการศึกษา",
    "2.1.1": "การบริหารจัดการหลักสูตรฐานสมรรถนะอย่างเป็นระบบ",
    "2.1.2": "การพัฒนาหลักสูตรฐานสมรรถนะ โดยการปรับปรุงรายวิชาเดิม หรือกำหนดรายวิชาเพิ่มเติม",
    "2.2.1": "การพัฒนาคุณภาพแผนการจัดการเรียนรู้ที่เน้นผู้เรียนเป็นสำคัญ",
    "2.2.2": "การนำแผนการจัดการเรียนรู้ที่เน้นผู้เรียนเป็นสำคัญไปใช้ในการจัดการเรียนการสอน",
    "2.2.3": "การส่งเสริมให้ผู้เรียนได้ฝึกประสบการณ์สมรรถนะวิชาชีพหรือฝึกอาชีพ",
    "2.2.4": "การจัดการเรียนการสอนด้วยเทคนิควิธีการสอนที่หลากหลาย",
    "2.2.5": "การบริหารจัดการชั้นเรียนที่เหมาะสม",
    "2.2.6": "การพัฒนาตนเองและพัฒนาวิชาชีพ",
    "2.2.7": "การใช้เทคโนโลยีดิจิทัลเพื่อการจัดการเรียนการสอน",
    "2.3.1": "การบริหารจัดการสถานศึกษาแบบมีส่วนร่วม",
    "2.3.2": "การพัฒนาระบบดูแลช่วยเหลือผู้เรียน",
    "2.3.3": "การบริหารจัดการระบบข้อมูลและสารสนเทศเพื่อการบริหารจัดการสถานศึกษา",
    "2.3.4": "การพัฒนาอาคารสถานที่ ห้องเรียน ห้องปฏิบัติการ โรงฝึกงาน หรืองานฟาร์ม",
    "2.3.5": "การพัฒนาระบบสาธารณูปโภคพื้นฐาน",
    "2.3.6": "การพัฒนาแหล่งเรียนรู้และศูนย์วิทยบริการ",
    "2.3.7": "การนำผลการประกันคุณภาพการศึกษาไปใช้ในการพัฒนาสถานศึกษาอย่างต่อเนื่อง",
    "2.4.1": "การบริหารจัดการสถานศึกษาตามนโยบายที่หน่วยงานต้นสังกัดมอบหมาย",
    "3.1.1": "การบริการชุมชนหรือจิตอาสา",
    "3.1.2": "การจัดการอาชีวศึกษาเชิงบูรณาการ",
    "3.1.3": "การระดมทรัพยากรเพื่อการจัดการเรียนการสอน",
}

_CHECKBOX_HEADER_TOKENS = (
    "ดำเนินการ",
    "ไม่ได้ดำเนินการ",
    "ไม่ดำเนินการ",
    "มี",
    "ไม่มี",
    "ผ่าน",
    "ไม่ผ่าน",
    "ปฏิบัติ",
    "ไม่ปฏิบัติ",
    "บรรลุ",
    "ไม่บรรลุ",
    "มากที่สุด",
    "มาก",
    "ปานกลาง",
    "น้อย",
    "ปรับปรุง",
    "ใช่",
    "ไม่ใช่",
)


def _apply_font(run: Any, font_name: str = DEFAULT_FONT, size_pt: float = 14.5, bold: bool = False) -> None:
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


def _extract_code_and_title(filename: str) -> tuple[str, str]:
    stem = Path(filename).stem.strip()
    m = re.match(r"^(\d+\.\d+\.\d+)\s*(.*)$", stem)
    if m:
        code = m.group(1)
        title = m.group(2).strip() or _TITLE_BY_CODE.get(code, code)
        return code, title
    return stem, _TITLE_BY_CODE.get(stem, stem)


@lru_cache(maxsize=1)
def _scan_qa_catalog() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    if not QA_TEMPLATES_DIR.exists():
        return items
    for fpath in sorted(QA_TEMPLATES_DIR.rglob("*.docx")):
        rel = fpath.relative_to(QA_TEMPLATES_DIR)
        parts = rel.parts
        div_folder = parts[0] if len(parts) >= 3 else ""
        unit_folder = parts[1] if len(parts) >= 3 else "ทั่วไป"
        div_code, div_name = _DIV_META_BY_FOLDER.get(div_folder, ("อื่นๆ", div_folder or "ทั่วไป"))
        unit_name = _UNIT_DISPLAY_FIX.get(unit_folder, unit_folder)
        code, title = _extract_code_and_title(fpath.name)
        items.append(
            {
                "code": code,
                "title": title,
                "filename": fpath.name,
                "division_code": div_code,
                "division_name": div_name,
                "unit_name": unit_name,
                "path": str(fpath),
            }
        )
    items.sort(key=lambda x: [int(p) if p.isdigit() else 0 for p in x["code"].split(".")])
    return items


def list_qa_tools() -> list[dict[str, Any]]:
    return [
        {k: v for k, v in item.items() if k != "path"}
        for item in _scan_qa_catalog()
    ]


def _resolve_qa_path(code: str) -> dict[str, Any]:
    for item in _scan_qa_catalog():
        if item["code"] == code:
            return item
    raise FileNotFoundError(f"ไม่พบเครื่องมือตัวชี้วัดรหัส {code}")


def _is_checkbox_header(hdr_text: str) -> bool:
    h = re.sub(r"\s+", "", hdr_text).strip()
    if not h or h in ("การดำเนินการ", "รายการ", "หัวข้อ", "กิจกรรม", "ลำดับ", "ที่"):
        return False
    return h in _CHECKBOX_HEADER_TOKENS


def _extract_table_captions(doc: docx.Document) -> list[str]:
    """Walk document body XML elements in order to pair each <w:tbl> with its nearest preceding non-empty paragraph."""
    captions: list[str] = []
    last_text = ""
    for child in doc.element.body:
        tag = child.tag.split("}")[-1]
        if tag == "p":
            txt = "".join(child.itertext()).strip()
            if txt and "ตัวอย่างเครื่องมือ" not in txt and not (set(txt) <= {".", "…", " ", "\t", "_"}):
                last_text = txt
        elif tag == "tbl":
            captions.append(last_text or f"ตารางที่ {len(captions) + 1}")
    return captions


def inspect_qa_tool_schema(code: str) -> dict[str, Any]:
    meta = _resolve_qa_path(code)
    doc = docx.Document(meta["path"])
    captions = _extract_table_captions(doc)
    tables_out: list[dict[str, Any]] = []

    for t_idx, tbl in enumerate(doc.tables):
        if len(tbl.rows) < 2:
            continue
        raw_rows = [[c.text.strip() for c in r.cells] for r in tbl.rows]
        ncols = max(len(r) for r in raw_rows)
        if ncols < 2:
            continue

        # Detect 1-row vs 2-row merged header
        r0 = raw_rows[0]
        r1 = raw_rows[1] if len(raw_rows) > 1 else []
        has_two_headers = False
        if len(raw_rows) > 2 and any(r0[i] == r0[i + 1] and r0[i] for i in range(len(r0) - 1)):
            has_two_headers = True
        header_row_count = 2 if has_two_headers else 1

        headers: list[str] = []
        col_types: list[str] = []
        for c_i in range(ncols):
            h0 = r0[c_i] if c_i < len(r0) else ""
            h1 = r1[c_i] if has_two_headers and c_i < len(r1) else ""
            hdr = h1 if (has_two_headers and h1 and h1 != h0) else (h0 or h1 or f"คอลัมน์ {c_i + 1}")
            headers.append(hdr)
            col_types.append("checkbox" if _is_checkbox_header(hdr) else "text")

        rows_out: list[dict[str, Any]] = []
        for r_idx in range(header_row_count, len(tbl.rows)):
            row_cells = tbl.rows[r_idx].cells
            seen_tc: set[int] = set()
            cells_out: list[dict[str, Any]] = []
            for c_idx, cell in enumerate(row_cells):
                tc_id = id(cell._tc)
                if tc_id in seen_tc:
                    continue
                seen_tc.add(tc_id)
                val = cell.text.strip()
                ctype = col_types[c_idx] if c_idx < len(col_types) else "text"
                is_index_col = c_idx == 0 and bool(re.match(r"^[\d๑-๙.]+$", val))
                is_placeholder = val == "" or set(val) <= {".", "…", " "}
                editable = (ctype == "checkbox") or is_placeholder or (c_idx > 0 and not is_index_col)
                cells_out.append(
                    {
                        "key": f"{t_idx}:{r_idx}:{c_idx}",
                        "c_idx": c_idx,
                        "type": ctype,
                        "value": val,
                        "editable": editable,
                    }
                )
            if cells_out:
                rows_out.append({"r_idx": r_idx, "cells": cells_out})

        tables_out.append(
            {
                "t_idx": t_idx,
                "caption": captions[t_idx] if t_idx < len(captions) else f"ตารางที่ {t_idx + 1}",
                "headers": headers,
                "col_types": col_types,
                "rows": rows_out,
            }
        )

    return {
        "code": meta["code"],
        "title": meta["title"],
        "division_code": meta["division_code"],
        "division_name": meta["division_name"],
        "unit_name": meta["unit_name"],
        "table_count": len(tables_out),
        "tables": tables_out,
    }


def _write_cell_value(cell: Any, text: str, is_tick: bool = False) -> None:
    if not cell.paragraphs:
        cell.text = text
        return
    p0 = cell.paragraphs[0]
    p0.text = ""
    for extra in list(cell.paragraphs)[1:]:
        el = extra._element
        parent = el.getparent()
        if parent is not None:
            parent.remove(el)
    if is_tick:
        p0.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _apply_font(p0.add_run(text), font_name=CHECKBOX_FONT, size_pt=12.0, bold=True)
    else:
        _apply_font(p0.add_run(text), font_name=DEFAULT_FONT, size_pt=14.0, bold=False)


def render_qa_tool(
    code: str,
    payload: dict[str, Any],
    out_dir: Path,
    prefix: str,
    org_profile: dict[str, Any],
    convert_pdf: bool = True,
) -> dict[str, Any]:
    meta = _resolve_qa_path(code)
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = docx.Document(meta["path"])

    cell_values = payload.get("cell_values") if isinstance(payload.get("cell_values"), dict) else {}
    for key, val in cell_values.items():
        parts = str(key).split(":")
        if len(parts) != 3 or not all(p.isdigit() for p in parts):
            continue
        t_idx, r_idx, c_idx = int(parts[0]), int(parts[1]), int(parts[2])
        if 0 <= t_idx < len(doc.tables):
            tbl = doc.tables[t_idx]
            if 0 <= r_idx < len(tbl.rows) and 0 <= c_idx < len(tbl.rows[r_idx].cells):
                s_val = str(val or "")
                _write_cell_value(tbl.rows[r_idx].cells[c_idx], s_val, is_tick=(s_val.strip() == "✓"))

    reporter_name = str(payload.get("reporter_name") or "").strip()
    reporter_title = str(payload.get("reporter_title") or "ผู้รายงานข้อมูล").strip()
    academic_year = str(payload.get("academic_year") or f"ปีการศึกษา {current_buddhist_year()}").strip()
    report_date = format_thai_date(payload.get("doc_date"))
    sigs = payload.get("signatures") if isinstance(payload.get("signatures"), dict) else {}
    sig_raw = sigs.get("instructor") or sigs.get("requester")
    sig_path: Path | None = None
    if isinstance(sig_raw, str) and sig_raw:
        p_cand = Path(sig_raw)
        if p_cand.exists():
            sig_path = p_cand
        elif (SIGNATURES_DIR / p_cand.name).exists():
            sig_path = SIGNATURES_DIR / p_cand.name

    if reporter_name:
        p_meta = doc.add_paragraph()
        p_meta.paragraph_format.space_before = Pt(12)
        p_meta.paragraph_format.space_after = Pt(4)
        _apply_font(
            p_meta.add_run(to_thai_digits(f"ข้อมูลประจำ{academic_year}  |  วันที่จัดทำรายงาน {report_date}  |  {org_profile.get('organization_name') or 'วิทยาลัยการอาชีพเชียงราย'}")),
            size_pt=14.0,
            bold=False,
        )

        sig_tbl = doc.add_table(rows=1, cols=2)
        sig_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        tbl_pr = sig_tbl._tbl.tblPr
        if tbl_pr is not None:
            tbl_pr.append(
                parse_xml(
                    f'<w:tblBorders {nsdecls("w")}>'
                    f'<w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/>'
                    f'<w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/>'
                    f"</w:tblBorders>"
                )
            )
        c_left = sig_tbl.rows[0].cells[0]
        c_left.width = Cm(8.5)
        c_right = sig_tbl.rows[0].cells[1]
        c_right.width = Cm(8.5)
        p_r0 = c_right.paragraphs[0]
        p_r0.alignment = WD_ALIGN_PARAGRAPH.CENTER
        if sig_path is not None:
            try:
                p_r0.add_run().add_picture(str(sig_path), height=Cm(1.0))
            except Exception:
                _apply_font(p_r0.add_run("ลงชื่อ................................................"), size_pt=15.0)
        else:
            _apply_font(p_r0.add_run("ลงชื่อ................................................"), size_pt=15.0)
        p_r1 = c_right.add_paragraph()
        p_r1.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _apply_font(p_r1.add_run(f"({reporter_name})"), size_pt=15.0)
        p_r2 = c_right.add_paragraph()
        p_r2.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _apply_font(p_r2.add_run(reporter_title), size_pt=15.0)

    safe_code = code.replace(".", "_")
    docx_path = out_dir / f"{prefix}_qa_{safe_code}.docx"
    doc.save(docx_path)

    pdf_path: Path | None = None
    png_paths: list[Path] = []
    if convert_pdf:
        pdf_path = convert_office_to_pdf(docx_path, out_dir)
        png_paths = render_pdf_pages_to_png(pdf_path, out_dir, prefix=f"{prefix}_qa_{safe_code}")

    return {
        "code": code,
        "title": f"{code} {meta['title']}",
        "division_code": meta["division_code"],
        "docx_path": docx_path,
        "pdf_path": pdf_path,
        "png_paths": png_paths,
    }
