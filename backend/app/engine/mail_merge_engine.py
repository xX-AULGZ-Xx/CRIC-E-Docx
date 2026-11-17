"""Dynamic Mail-Merge & Batch Document Generation Engine for custom .docx / .xlsx templates."""

from __future__ import annotations

import copy
import csv
import io
import json
import re
import shutil
import zipfile
from pathlib import Path
from typing import Any

import docx
from docx.oxml import OxmlElement
from docx.shared import Cm
import openpyxl
from openpyxl.utils import get_column_letter

from app.config import ATTACHMENTS_DIR, CUSTOM_TEMPLATES_DIR
from app.engine.pdf_converter import convert_office_to_pdf, render_pdf_pages_to_png
from app.engine.thai_baht import baht_text
from app.engine.thai_utils import format_thai_date, to_thai_digits

PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_\.\:\u0E00-\u0E7F\- ]+?)\s*\}\}")
SYSTEM_AUTO_KEYS = {"org_name", "director_name", "director_title", "today_thai"}
MAX_BATCH_ROWS = 100


def _fmt_num(val: Any, use_thai: bool = True) -> str:
    if val is None or str(val).strip() == "":
        return ""
    try:
        raw_str = str(val).replace(",", "").strip()
        n = float(raw_str)
    except (TypeError, ValueError):
        s = str(val)
        return to_thai_digits(s) if use_thai else s
    if abs(n - round(n)) < 1e-6:
        s = f"{int(round(n)):,}"
    else:
        s = f"{n:,.2f}"
    return to_thai_digits(s, preserve_latin_tokens=False) if use_thai else s


def _to_number(val: Any) -> float | None:
    if val is None:
        return None
    s = str(val).replace(",", "").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _infer_field_meta(key: str) -> dict[str, Any]:
    """Infer sensible default Schema metadata from placeholder key name."""
    lower = key.lower()
    if key.startswith("img:"):
        clean = key[4:].strip()
        return {
            "key": key,
            "label": f"รูปภาพ ({clean})" if clean else "รูปภาพประกอบ",
            "field_type": "image",
            "required": False,
            "default_value": "",
            "options": [],
            "thai_digits": False,
            "group": "main",
        }

    is_item = key.startswith("items.")
    col_name = key[6:].strip() if is_item else key
    group = "items" if is_item else "main"
    col_lower = col_name.lower()

    if any(tok in col_lower for tok in ("date", "วันที่", "วัน/เดือน/ปี")):
        ftype = "date"
    elif any(tok in col_lower for tok in ("price", "amount", "qty", "total", "budget", "cost", "จำนวน", "ราคา", "บาท", "เงิน", "ชั่วโมง")):
        ftype = "number"
    elif any(tok in col_lower for tok in ("detail", "desc", "note", "remark", "reason", "รายละเอียด", "หมายเหตุ", "เนื้อหา", "เหตุผล", "วัตถุประสงค์")):
        ftype = "textarea"
    else:
        ftype = "text"

    return {
        "key": col_name if is_item else key,
        "label": col_name,
        "field_type": ftype,
        "required": False,
        "default_value": "",
        "options": [],
        "thai_digits": ftype in ("date",),
        "group": group,
    }


def _iter_docx_tables_recursive(tables: list[Any]):
    for tbl in tables:
        yield tbl
        for row in tbl.rows:
            for cell in row.cells:
                if cell.tables:
                    yield from _iter_docx_tables_recursive(cell.tables)


def _iter_docx_all_paragraphs(doc: Any):
    for p in doc.paragraphs:
        yield p
    for tbl in _iter_docx_tables_recursive(doc.tables):
        for row in tbl.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    yield p
    for sec in doc.sections:
        for hdr in (sec.header, sec.first_page_header, sec.even_page_header, sec.footer, sec.first_page_footer, sec.even_page_footer):
            if hdr is None:
                continue
            for p in hdr.paragraphs:
                yield p
            for tbl in _iter_docx_tables_recursive(hdr.tables):
                for row in tbl.rows:
                    for cell in row.cells:
                        for p in cell.paragraphs:
                            yield p
    # Also textboxes inside document body XML
    for txbx_p in doc.element.xpath(".//*[local-name()='txbxContent']//*[local-name()='p']"):
        yield docx.text.paragraph.Paragraph(txbx_p, doc)


def scan_template_placeholders(file_path: Path, file_type: str) -> list[dict[str, Any]]:
    """Scan a .docx or .xlsx file and return ordered field schema definitions for detected {{vars}}."""
    raw_keys: list[str] = []
    seen_raw: set[str] = set()

    def _collect_text(txt: str) -> None:
        if not txt or "{{" not in txt:
            return
        for m in PLACEHOLDER_RE.finditer(txt):
            k = re.sub(r"\s+", " ", m.group(1).strip())
            if k and k not in seen_raw:
                seen_raw.add(k)
                raw_keys.append(k)

    ftype = file_type.lower().lstrip(".")
    if ftype == "docx":
        doc = docx.Document(str(file_path))
        for p in _iter_docx_all_paragraphs(doc):
            _collect_text("".join(r.text or "" for r in p.runs) or p.text or "")
    elif ftype == "xlsx":
        wb = openpyxl.load_workbook(str(file_path), data_only=False)
        for ws in wb.worksheets:
            for row in ws.iter_rows(values_only=True):
                for val in row:
                    if isinstance(val, str) and not val.startswith("="):
                        _collect_text(val)
    else:
        raise ValueError(f"ไม่รองรับไฟล์ประเภท .{ftype}")

    schema_map: dict[tuple[str, str], dict[str, Any]] = {}
    ordered_keys: list[tuple[str, str]] = []

    for k in raw_keys:
        if k in SYSTEM_AUTO_KEYS:
            continue
        if k.endswith("_bahttext"):
            base_key = k[:-len("_bahttext")]
            is_item = base_key.startswith("items.")
            norm_base = base_key[6:].strip() if is_item else base_key
            grp = "items" if is_item else "main"
            map_id = (grp, norm_base)
            if map_id not in schema_map:
                meta = _infer_field_meta(base_key)
                meta["field_type"] = "number"
                schema_map[map_id] = meta
                ordered_keys.append(map_id)
            else:
                schema_map[map_id]["field_type"] = "number"
            continue

        if k in ("items.idx", "items.ลำดับ"):
            # Auto sequence number computed per row in prepare_merge_values
            continue

        meta = _infer_field_meta(k)
        map_id = (meta["group"], meta["key"])
        if map_id not in schema_map:
            schema_map[map_id] = meta
            ordered_keys.append(map_id)

    return [schema_map[mid] for mid in ordered_keys]


def prepare_merge_values(
    schema: list[dict[str, Any]],
    raw_data: dict[str, Any],
    org_profile: dict[str, Any] | None = None,
) -> tuple[dict[str, str], dict[str, Any], list[dict[str, Any]], set[str]]:
    """Build formatted string values, native numeric map, item rows, and image keys."""
    org = org_profile or {}
    text_values: dict[str, str] = {
        "org_name": str(org.get("organization_name") or "วิทยาลัยการอาชีพเชียงราย"),
        "director_name": str(org.get("director_name") or ""),
        "director_title": str(org.get("director_title") or "ผู้อำนวยการวิทยาลัยการอาชีพเชียงราย"),
        "today_thai": format_thai_date(None),
    }
    native_values: dict[str, Any] = dict(text_values)
    image_keys: set[str] = set()

    main_schema = [f for f in schema if f.get("group", "main") != "items"]
    items_schema = [f for f in schema if f.get("group") == "items"]
    schema_by_key = {f["key"]: f for f in main_schema}

    # Process schema-declared main fields
    for f in main_schema:
        k = f["key"]
        ftype = f.get("field_type", "text")
        thai_digits = bool(f.get("thai_digits", False))
        raw_val = raw_data.get(k)
        if raw_val is None or raw_val == "":
            raw_val = f.get("default_value", "")

        if ftype == "image" or k.startswith("img:"):
            image_keys.add(k)
            val_str = str(raw_val or "").strip()
            text_values[k] = val_str
            native_values[k] = val_str
            continue

        if ftype == "date":
            val_str = format_thai_date(str(raw_val)) if str(raw_val).strip() else ""
            if not thai_digits and val_str:
                # format_thai_date outputs Thai digits by default; keep Thai unless explicitly disabled
                pass
            text_values[k] = val_str
            native_values[k] = val_str
        elif ftype == "number":
            num = _to_number(raw_val)
            if num is not None:
                text_values[k] = _fmt_num(num, use_thai=thai_digits)
                text_values[f"{k}_bahttext"] = baht_text(num)
                native_values[k] = int(round(num)) if abs(num - round(num)) < 1e-6 else num
                native_values[f"{k}_bahttext"] = baht_text(num)
            else:
                s = str(raw_val or "")
                text_values[k] = s
                text_values[f"{k}_bahttext"] = ""
                native_values[k] = s
                native_values[f"{k}_bahttext"] = ""
        else:
            s = str(raw_val or "")
            if thai_digits and s:
                s = to_thai_digits(s)
            text_values[k] = s
            native_values[k] = s

    # Also support ad-hoc raw_data keys not in schema (except "items")
    for k, v in raw_data.items():
        if k == "items" or k in schema_by_key:
            continue
        if isinstance(v, (dict, list)):
            continue
        if k.startswith("img:"):
            image_keys.add(k)
        s = str(v if v is not None else "")
        text_values[k] = s
        native_values[k] = v if isinstance(v, (int, float)) else s

    # Process repeating items rows
    items_schema_map = {f["key"]: f for f in items_schema}
    raw_items = raw_data.get("items") or []
    prepared_items: list[dict[str, Any]] = []
    for idx, row in enumerate(raw_items, start=1):
        if not isinstance(row, dict):
            continue
        row_ctx: dict[str, Any] = {
            "items.idx": str(idx),
            "items.ลำดับ": to_thai_digits(str(idx)),
        }
        all_row_keys = set(items_schema_map.keys()) | set(row.keys())
        for col in all_row_keys:
            fmeta = items_schema_map.get(col, {})
            ftype = fmeta.get("field_type", "text")
            thai_digits = bool(fmeta.get("thai_digits", False))
            raw_v = row.get(col)
            if raw_v is None or raw_v == "":
                raw_v = fmeta.get("default_value", "")
            full_k = f"items.{col}"
            if col in ("idx", "ลำดับ") and (raw_v is None or str(raw_v).strip() == ""):
                continue
            if ftype == "date" and str(raw_v).strip():
                val_s = format_thai_date(str(raw_v))
                row_ctx[full_k] = val_s
                row_ctx[f"__native__{full_k}"] = val_s
            elif ftype == "number":
                num = _to_number(raw_v)
                if num is not None:
                    row_ctx[full_k] = _fmt_num(num, use_thai=thai_digits)
                    row_ctx[f"{full_k}_bahttext"] = baht_text(num)
                    row_ctx[f"__native__{full_k}"] = int(round(num)) if abs(num - round(num)) < 1e-6 else num
                else:
                    row_ctx[full_k] = str(raw_v or "")
                    row_ctx[f"{full_k}_bahttext"] = ""
                    row_ctx[f"__native__{full_k}"] = str(raw_v or "")
            else:
                s = str(raw_v or "")
                if thai_digits and s:
                    s = to_thai_digits(s)
                row_ctx[full_k] = s
                row_ctx[f"__native__{full_k}"] = s
        prepared_items.append(row_ctx)

    return text_values, native_values, prepared_items, image_keys


def _resolve_attachment_image(filename: str) -> Path | None:
    if not filename:
        return None
    safe_name = Path(filename).name
    p = ATTACHMENTS_DIR / safe_name
    if p.exists() and p.is_file():
        return p
    return None


def _replace_text_span_in_runs(para: Any, values_map: dict[str, str], image_keys: set[str]) -> None:
    """Replace {{var}} across run boundaries while preserving run formatting and embedding {{img:var}}."""
    runs = list(para.runs)
    if not runs:
        return
    full_text = "".join(r.text or "" for r in runs)
    if "{{" not in full_text:
        return

    # Pass 1: text-only placeholders (reverse order so earlier spans remain valid)
    matches = list(PLACEHOLDER_RE.finditer(full_text))
    text_spans: list[tuple[int, int, str]] = []
    img_placeholders: list[str] = []

    for m in matches:
        key = re.sub(r"\s+", " ", m.group(1).strip())
        if key in image_keys or key.startswith("img:"):
            img_name = values_map.get(key, "")
            img_path = _resolve_attachment_image(img_name)
            if img_path is not None:
                img_placeholders.append(key)
                continue
            # If no valid uploaded image, replace placeholder with empty string
            text_spans.append((m.start(), m.end(), ""))
        else:
            text_spans.append((m.start(), m.end(), str(values_map.get(key, ""))))

    # Map each run to character range
    run_ranges: list[tuple[Any, int, int]] = []
    pos = 0
    for r in runs:
        txt = r.text or ""
        run_ranges.append((r, pos, pos + len(txt)))
        pos += len(txt)

    for m_start, m_end, rep_text in reversed(text_spans):
        first_idx = None
        last_idx = None
        for idx, (_, r_start, r_end) in enumerate(run_ranges):
            if r_start == r_end:
                continue
            if first_idx is None and r_end > m_start and r_start <= m_start:
                first_idx = idx
            if r_start < m_end and r_end >= m_end:
                last_idx = idx
                break
        if first_idx is None or last_idx is None:
            continue

        r_first, f_start, _ = run_ranges[first_idx]
        r_last, l_start, _ = run_ranges[last_idx]
        prefix = (r_first.text or "")[: m_start - f_start]
        suffix = (r_last.text or "")[m_end - l_start :]
        if first_idx == last_idx:
            r_first.text = prefix + rep_text + suffix
        else:
            r_first.text = prefix + rep_text
            for mid_idx in range(first_idx + 1, last_idx):
                run_ranges[mid_idx][0].text = ""
            r_last.text = suffix

    # Pass 2: embed images cleanly one-by-one (recomputing offsets each time)
    for img_key in img_placeholders:
        img_path = _resolve_attachment_image(values_map.get(img_key, ""))
        if not img_path:
            continue
        cur_runs = list(para.runs)
        cur_text = "".join(r.text or "" for r in cur_runs)
        target_match = None
        for m in PLACEHOLDER_RE.finditer(cur_text):
            if re.sub(r"\s+", " ", m.group(1).strip()) == img_key:
                target_match = m
                break
        if not target_match:
            continue

        m_start, m_end = target_match.start(), target_match.end()
        cur_ranges: list[tuple[Any, int, int]] = []
        p_pos = 0
        for r in cur_runs:
            t = r.text or ""
            cur_ranges.append((r, p_pos, p_pos + len(t)))
            p_pos += len(t)

        first_idx = last_idx = None
        for idx, (_, rs, re_pos) in enumerate(cur_ranges):
            if rs == re_pos:
                continue
            if first_idx is None and re_pos > m_start and rs <= m_start:
                first_idx = idx
            if rs < m_end and re_pos >= m_end:
                last_idx = idx
                break
        if first_idx is None or last_idx is None:
            continue

        r_first, f_start, _ = cur_ranges[first_idx]
        r_last, l_start, _ = cur_ranges[last_idx]
        prefix = (r_first.text or "")[: m_start - f_start]
        suffix = (r_last.text or "")[m_end - l_start :]

        if first_idx == last_idx:
            r_first.text = prefix
        else:
            r_first.text = prefix
            for mid_idx in range(first_idx + 1, last_idx):
                cur_ranges[mid_idx][0].text = ""
            r_last.text = suffix

        # Add picture into a dedicated run positioned right after r_first
        pic_run = para.add_run()
        pic_run.add_picture(str(img_path), width=Cm(5.0))
        r_first._r.addnext(pic_run._r)
        if first_idx == last_idx and suffix:
            suf_run = para.add_run(suffix)
            pic_run._r.addnext(suf_run._r)


def _expand_docx_repeating_rows(doc: Any, prepared_items: list[dict[str, Any]], base_values: dict[str, str], image_keys: set[str]) -> None:
    """Clone and fill repeating table rows containing {{items.*}} placeholders."""
    for tbl in _iter_docx_tables_recursive(doc.tables):
        template_rows: list[Any] = []
        for row in tbl.rows:
            row_txt = "".join(
                "".join(r.text or "" for r in p.runs) or p.text or ""
                for cell in row.cells
                for p in cell.paragraphs
            )
            if "{{items." in row_txt or re.search(r"\{\{\s*items\.", row_txt):
                template_rows.append(row)

        if not template_rows:
            continue

        for tmpl_row in template_rows:
            if len(prepared_items) <= 1:
                row_ctx = {**base_values, **(prepared_items[0] if prepared_items else {})}
                for cell in tmpl_row.cells:
                    for p in cell.paragraphs:
                        _replace_text_span_in_runs(p, row_ctx, image_keys)
                    for nested_tbl in _iter_docx_tables_recursive(cell.tables):
                        for nr in nested_tbl.rows:
                            for nc in nr.cells:
                                for np in nc.paragraphs:
                                    _replace_text_span_in_runs(np, row_ctx, image_keys)
                continue

            # Clone rows right after tmpl_row
            cloned_trs = [tmpl_row._tr]
            anchor = tmpl_row._tr
            for _ in range(1, len(prepared_items)):
                new_tr = copy.deepcopy(tmpl_row._tr)
                anchor.addnext(new_tr)
                anchor = new_tr
                cloned_trs.append(new_tr)

            for tr_el, item_ctx in zip(cloned_trs, prepared_items):
                row_obj = docx.table._Row(tr_el, tbl)
                merged_ctx = {**base_values, **item_ctx}
                for cell in row_obj.cells:
                    for p in cell.paragraphs:
                        _replace_text_span_in_runs(p, merged_ctx, image_keys)
                    for nested_tbl in _iter_docx_tables_recursive(cell.tables):
                        for nr in nested_tbl.rows:
                            for nc in nr.cells:
                                for np in nc.paragraphs:
                                    _replace_text_span_in_runs(np, merged_ctx, image_keys)


def render_docx_mail_merge(
    template_path: Path,
    schema: list[dict[str, Any]],
    raw_data: dict[str, Any],
    out_path: Path,
    org_profile: dict[str, Any] | None = None,
) -> Path:
    doc = docx.Document(str(template_path))
    text_values, _, prepared_items, image_keys = prepare_merge_values(schema, raw_data, org_profile)

    _expand_docx_repeating_rows(doc, prepared_items, text_values, image_keys)

    for p in _iter_docx_all_paragraphs(doc):
        _replace_text_span_in_runs(p, text_values, image_keys)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(out_path))
    return out_path


def _replace_xlsx_cell_value(cell: Any, text_values: dict[str, str], native_values: dict[str, Any], is_item_row: bool = False) -> None:
    val = cell.value
    if not isinstance(val, str) or "{{" not in val or val.startswith("="):
        return
    stripped = val.strip()
    single_m = PLACEHOLDER_RE.fullmatch(stripped)
    if single_m:
        key = re.sub(r"\s+", " ", single_m.group(1).strip())
        native_lookup = f"__native__{key}" if is_item_row else key
        if native_lookup in native_values and isinstance(native_values[native_lookup], (int, float)):
            cell.value = native_values[native_lookup]
            return
        cell.value = text_values.get(key, "")
        return

    def _sub(m: re.Match[str]) -> str:
        key = re.sub(r"\s+", " ", m.group(1).strip())
        return str(text_values.get(key, ""))

    cell.value = PLACEHOLDER_RE.sub(_sub, val)


def _copy_cell_style(src: Any, dst: Any) -> None:
    if src.has_style:
        dst.font = copy.copy(src.font)
        dst.fill = copy.copy(src.fill)
        dst.border = copy.copy(src.border)
        dst.alignment = copy.copy(src.alignment)
        dst.number_format = src.number_format


def _shift_merges_below(ws: Any, from_row: int, delta: int) -> None:
    if delta <= 0:
        return
    ranges = list(ws.merged_cells.ranges)
    for rng in ranges:
        if rng.min_row >= from_row:
            coord_old = rng.coord
            ws.unmerge_cells(coord_old)
            ws.merge_cells(
                start_row=rng.min_row + delta,
                start_column=rng.min_col,
                end_row=rng.max_row + delta,
                end_column=rng.max_col,
            )


def render_xlsx_mail_merge(
    template_path: Path,
    schema: list[dict[str, Any]],
    raw_data: dict[str, Any],
    out_path: Path,
    org_profile: dict[str, Any] | None = None,
) -> Path:
    wb = openpyxl.load_workbook(str(template_path), data_only=False)
    text_values, native_values, prepared_items, _ = prepare_merge_values(schema, raw_data, org_profile)

    for ws in wb.worksheets:
        # Step 1: find rows containing {{items.*}}
        item_row_indices: list[int] = []
        for r_idx in range(1, ws.max_row + 1):
            row_has_item = False
            for c_idx in range(1, ws.max_column + 1):
                v = ws.cell(row=r_idx, column=c_idx).value
                if isinstance(v, str) and re.search(r"\{\{\s*items\.", v):
                    row_has_item = True
                    break
            if row_has_item:
                item_row_indices.append(r_idx)

        # Process bottom-up so shifting doesn't invalidate earlier indices
        for r_idx in reversed(item_row_indices):
            count = len(prepared_items)
            if count > 1:
                delta = count - 1
                _shift_merges_below(ws, r_idx + 1, delta)
                ws.insert_rows(r_idx + 1, amount=delta)
                src_height = ws.row_dimensions[r_idx].height
                for offset in range(1, count):
                    dst_row = r_idx + offset
                    if src_height:
                        ws.row_dimensions[dst_row].height = src_height
                    for c_idx in range(1, ws.max_column + 1):
                        src_cell = ws.cell(row=r_idx, column=c_idx)
                        dst_cell = ws.cell(row=dst_row, column=c_idx)
                        dst_cell.value = src_cell.value
                        _copy_cell_style(src_cell, dst_cell)

            if count == 0:
                for c_idx in range(1, ws.max_column + 1):
                    _replace_xlsx_cell_value(ws.cell(row=r_idx, column=c_idx), text_values, native_values, is_item_row=True)
            else:
                for offset, item_ctx in enumerate(prepared_items):
                    merged_text = {**text_values, **{k: str(v) for k, v in item_ctx.items() if not k.startswith("__native__")}}
                    merged_native = {**native_values, **item_ctx}
                    target_row = r_idx + offset
                    for c_idx in range(1, ws.max_column + 1):
                        _replace_xlsx_cell_value(ws.cell(row=target_row, column=c_idx), merged_text, merged_native, is_item_row=True)

        # Step 2: replace remaining cells
        for row in ws.iter_rows():
            for cell in row:
                _replace_xlsx_cell_value(cell, text_values, native_values, is_item_row=False)

        # Ensure clean A4 width fit for PDF/PNG export
        ws.sheet_properties.pageSetUpPr.fitToPage = True
        ws.page_setup.fitToWidth = 1
        if not ws.page_setup.fitToHeight:
            ws.page_setup.fitToHeight = 0

    out_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(str(out_path))
    return out_path


def _convert_xlsx_to_pdf_dual_pass(xlsx_path: Path, out_dir: Path) -> Path:
    """Replace =BAHTTEXT(...) formulas in a temporary copy before LibreOffice Calc PDF export."""
    tmp_path = xlsx_path.with_name(f"{xlsx_path.stem}_preview_tmp.xlsx")
    shutil.copy2(xlsx_path, tmp_path)
    try:
        wb = openpyxl.load_workbook(str(tmp_path), data_only=False)
        for ws in wb.worksheets:
            for row in ws.iter_rows():
                for cell in row:
                    if isinstance(cell.value, str) and "BAHTTEXT" in cell.value.upper():
                        # Try to resolve simple cell reference inside BAHTTEXT(...)
                        m = re.search(r"BAHTTEXT\s*\(\s*([A-Z]{1,3}\d+)\s*\)", cell.value.upper())
                        if m:
                            ref_val = ws[m.group(1)].value
                            num = _to_number(ref_val)
                            if num is not None:
                                cell.value = baht_text(num)
                                continue
                        # Also support SUM(colRow1:colRow2) inside BAHTTEXT
                        m_sum = re.search(r"BAHTTEXT\s*\(\s*SUM\(\s*([A-Z]{1,3}\d+)\s*:\s*([A-Z]{1,3}\d+)\s*\)\s*\)", cell.value.upper())
                        if m_sum:
                            total = 0.0
                            for col_row in ws[f"{m_sum.group(1)}:{m_sum.group(2)}"]:
                                for c in col_row:
                                    n = _to_number(c.value)
                                    if n is not None:
                                        total += n
                            cell.value = baht_text(total)
            ws.sheet_properties.pageSetUpPr.fitToPage = True
            ws.page_setup.fitToWidth = 1
        wb.save(str(tmp_path))

        tmp_pdf = convert_office_to_pdf(tmp_path, out_dir)
        target_pdf = out_dir / f"{xlsx_path.stem}.pdf"
        if tmp_pdf != target_pdf:
            shutil.move(str(tmp_pdf), str(target_pdf))
        return target_pdf
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def render_single_custom_template(
    template: dict[str, Any],
    data: dict[str, Any],
    out_dir: Path,
    base_name: str,
    org_profile: dict[str, Any] | None = None,
    convert_pdf: bool = True,
) -> dict[str, Any]:
    """Render a single document from a Custom Template and optionally convert to PDF/PNG."""
    tpl_path = CUSTOM_TEMPLATES_DIR / template["storage_filename"]
    if not tpl_path.exists():
        raise FileNotFoundError(f"ไม่พบไฟล์แม่แบบ {template['storage_filename']}")

    ftype = str(template.get("file_type") or tpl_path.suffix.lstrip(".")).lower()
    schema = template.get("fields_schema_json") or []
    out_file = out_dir / f"{base_name}.{ftype}"

    if ftype == "docx":
        render_docx_mail_merge(tpl_path, schema, data, out_file, org_profile)
    elif ftype == "xlsx":
        render_xlsx_mail_merge(tpl_path, schema, data, out_file, org_profile)
    else:
        raise ValueError(f"ไม่รองรับไฟล์แม่แบบประเภท .{ftype}")

    pdf_name = ""
    pdf_error = ""
    page_urls: list[str] = []
    if convert_pdf:
        try:
            if ftype == "xlsx":
                pdf_path = _convert_xlsx_to_pdf_dual_pass(out_file, out_dir)
            else:
                pdf_path = convert_office_to_pdf(out_file, out_dir)
            pdf_name = pdf_path.name
            pngs = render_pdf_pages_to_png(pdf_path, out_dir, prefix=base_name)
            page_urls = [f"/v1/files/rendered/{p.name}" for p in pngs]
        except Exception as exc:
            pdf_error = str(exc)

    return {
        "file_type": ftype,
        "docx_filename": out_file.name,
        "pdf_filename": pdf_name,
        "docx_url": f"/v1/files/rendered/{out_file.name}",
        "pdf_url": f"/v1/files/rendered/{pdf_name}" if pdf_name else "",
        "page_image_urls": page_urls,
        "pdf_error": pdf_error,
        "font_family": "TH SarabunPSK",
    }


def build_batch_sample_xlsx(template: dict[str, Any]) -> bytes:
    """Create a starter Excel spreadsheet with headers matching the custom template's main schema."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "MailMergeData"
    schema = [f for f in (template.get("fields_schema_json") or []) if f.get("group", "main") != "items" and f.get("field_type") != "image"]

    if not schema:
        ws.cell(row=1, column=1, value="หมายเหตุ")
        ws.cell(row=2, column=1, value="แม่แบบนี้ยังไม่มีฟิลด์ข้อความหลัก")
    else:
        for c_idx, f in enumerate(schema, start=1):
            cell = ws.cell(row=1, column=c_idx, value=f["key"])
            cell.font = openpyxl.styles.Font(bold=True)
            # Sample hint row 2
            ftype = f.get("field_type", "text")
            if ftype == "date":
                hint = "2026-11-17"
            elif ftype == "number":
                hint = 1500
            elif ftype == "select" and f.get("options"):
                hint = f["options"][0]
            else:
                hint = f.get("default_value") or f"ตัวอย่าง{f.get('label') or f['key']}"
            ws.cell(row=2, column=c_idx, value=hint)
            ws.column_dimensions[get_column_letter(c_idx)].width = max(18, len(str(f["key"])) + 6)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def parse_batch_rows(file_bytes: bytes, filename: str, schema: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Parse uploaded .xlsx or .csv into list of row dicts keyed by schema keys."""
    ext = Path(filename or "").suffix.lower()
    # Map header name or label -> schema key
    header_map: dict[str, str] = {}
    for f in schema:
        if f.get("group", "main") == "items":
            continue
        k = str(f["key"]).strip()
        lbl = str(f.get("label") or "").strip()
        header_map[k.lower()] = k
        if lbl:
            header_map[lbl.lower()] = k

    raw_rows: list[list[Any]] = []
    headers: list[str] = []

    if ext == ".csv":
        text = file_bytes.decode("utf-8-sig", errors="replace")
        reader = csv.reader(io.StringIO(text))
        all_lines = list(reader)
        if not all_lines:
            return []
        headers = [str(h or "").strip() for h in all_lines[0]]
        raw_rows = all_lines[1:]
    elif ext in (".xlsx", ".xlsm"):
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
        ws = wb.active
        all_vals = list(ws.iter_rows(values_only=True))
        if not all_vals:
            return []
        headers = [str(h or "").strip() for h in all_vals[0]]
        raw_rows = [list(r) for r in all_vals[1:]]
    else:
        raise ValueError("รองรับเฉพาะไฟล์ .xlsx หรือ .csv สำหรับ Batch Mail-Merge")

    mapped_rows: list[dict[str, Any]] = []
    for row in raw_rows:
        if not any(v is not None and str(v).strip() != "" for v in row):
            continue
        item: dict[str, Any] = {}
        for idx, h in enumerate(headers):
            if not h:
                continue
            target_key = header_map.get(h.lower(), h)
            val = row[idx] if idx < len(row) else ""
            if target_key == "items" and isinstance(val, str) and val.strip().startswith("["):
                try:
                    item["items"] = json.loads(val)
                    continue
                except json.JSONDecodeError:
                    pass
            item[target_key] = "" if val is None else val
        mapped_rows.append(item)
        if len(mapped_rows) > MAX_BATCH_ROWS:
            raise ValueError(f"ข้อมูล Batch เกินขีดจำกัดสูงสุด {MAX_BATCH_ROWS} แถวต่อครั้ง (กรุณาแบ่งไฟล์ย่อย)")

    if not mapped_rows:
        raise ValueError("ไม่พบแถวข้อมูลในไฟล์ที่อัปโหลด")
    return mapped_rows


def _safe_filename_part(text: str, fallback: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\s]+', "_", str(text or "").strip()).strip("_")
    return (cleaned[:48] or fallback)


def generate_batch_mail_merge(
    template: dict[str, Any],
    rows: list[dict[str, Any]],
    out_dir: Path,
    prefix: str,
    org_profile: dict[str, Any] | None = None,
    include_pdf: bool = False,
) -> dict[str, Any]:
    """Generate documents for all batch rows and bundle into a .zip archive."""
    if len(rows) > MAX_BATCH_ROWS:
        raise ValueError(f"ข้อมูล Batch เกินขีดจำกัดสูงสุด {MAX_BATCH_ROWS} แถวต่อครั้ง")

    tpl_path = CUSTOM_TEMPLATES_DIR / template["storage_filename"]
    if not tpl_path.exists():
        raise FileNotFoundError(f"ไม่พบไฟล์แม่แบบ {template['storage_filename']}")

    ftype = str(template.get("file_type") or tpl_path.suffix.lstrip(".")).lower()
    schema = template.get("fields_schema_json") or []
    first_key = next((f["key"] for f in schema if f.get("group", "main") != "items" and f.get("field_type") != "image"), None)

    batch_work_dir = out_dir / f"{prefix}_work"
    batch_work_dir.mkdir(parents=True, exist_ok=True)
    generated_files: list[Path] = []
    item_summaries: list[dict[str, str]] = []

    try:
        for idx, row_data in enumerate(rows, start=1):
            label_raw = row_data.get(first_key, "") if first_key else ""
            safe_part = _safe_filename_part(str(label_raw), f"row_{idx:03d}")
            stem = f"{idx:03d}_{safe_part}"
            doc_path = batch_work_dir / f"{stem}.{ftype}"

            if ftype == "docx":
                render_docx_mail_merge(tpl_path, schema, row_data, doc_path, org_profile)
            else:
                render_xlsx_mail_merge(tpl_path, schema, row_data, doc_path, org_profile)
            generated_files.append(doc_path)

            pdf_done = False
            if include_pdf:
                try:
                    if ftype == "xlsx":
                        pdf_path = _convert_xlsx_to_pdf_dual_pass(doc_path, batch_work_dir)
                    else:
                        pdf_path = convert_office_to_pdf(doc_path, batch_work_dir)
                    generated_files.append(pdf_path)
                    pdf_done = True
                except Exception:
                    pass

            item_summaries.append({"row": str(idx), "filename": doc_path.name, "pdf": "yes" if pdf_done else "no"})

        zip_path = out_dir / f"{prefix}_batch.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for gf in generated_files:
                zf.write(gf, arcname=gf.name)

        return {
            "count": len(rows),
            "include_pdf": include_pdf,
            "zip_filename": zip_path.name,
            "zip_url": f"/v1/files/rendered/{zip_path.name}",
            "items": item_summaries,
        }
    finally:
        shutil.rmtree(batch_work_dir, ignore_errors=True)
