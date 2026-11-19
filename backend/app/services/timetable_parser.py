"""Timetable & ศธ.02 (Sornor 02) parser for Excel, CSV, HTML, PDF text, and copy-pasted grids."""

from __future__ import annotations

import csv
import io
import re
from html.parser import HTMLParser
from typing import Any

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill

COURSE_CODE_RE = re.compile(r"\b(\d{5}-\d{4}|\d{4}-\d{4})\b")
TPN_RE = re.compile(r"\b(\d+)\s*[-–/]\s*(\d+)\s*[-–/]\s*(\d+)\b")
ROOM_RE = re.compile(r"(?:ห้อง|Room|Rm\.?)\s*[:：]?\s*([A-Za-z0-9ก-ฮ\.\-/]+)", re.IGNORECASE)
GROUP_RE = re.compile(
    r"(?:กลุ่ม(?:เรียน)?|ระดับ|ชั้น)\s*[:：]?\s*([ก-ฮA-Za-z0-9\.\-/]+(?:\s*/\s*\d+)?)"
    r"|\b((?:ปวช\.|ปวส\.|ชค|ชท|ชฟ|ชย|สทธ|สบค|สกต|สช|สฟ|สย|ชอ|สอ)[\.\s]*\d+(?:/\d+)?)\b"
)
STUDENT_COUNT_RE = re.compile(r"(?:จำนวน(?:นักเรียน|นักศึกษา)?|นศ\.?|นร\.?)\s*[:：]?\s*(\d{1,3})\s*(?:คน)?|\b(\d{1,3})\s*คน\b")
DAY_TIME_RE = re.compile(
    r"((?:วัน)?(?:จันทร์|อังคาร|พุธ|พฤหัสบดี|พฤหัส|ศุกร์|เสาร์|อาทิตย์|จ\.|อ\.|พ\.|พฤ\.|ศ\.|ส\.|อา\.)"
    r"(?:\s*(?:คาบ(?:ที่)?\s*)?\d{1,2}(?:\s*[-–:]\s*\d{1,2}(?::\d{2})?(?:\s*[-–]\s*\d{1,2}:\d{2})?)?)?)"
)
STUDENT_ID_RE = re.compile(r"\b6\d{9,11}\b")
THAI_DAYS = [
    ("จันทร์", ["จันทร์", "วันจันทร์", "จ."]),
    ("อังคาร", ["อังคาร", "วันอังคาร", "อ."]),
    ("พุธ", ["พุธ", "วันพุธ", "พ."]),
    ("พฤหัสบดี", ["พฤหัสบดี", "วันพฤหัสบดี", "พฤ.", "พฤหัส"]),
    ("ศุกร์", ["ศุกร์", "วันศุกร์", "ศ."]),
    ("เสาร์", ["เสาร์", "วันเสาร์", "ส."]),
    ("อาทิตย์", ["อาทิตย์", "วันอาทิตย์", "อา."]),
]


THAI_PUA_MAP = {
    "\uf700": "\u0e10",  # ฐ
    "\uf701": "\u0e34",  # ิ
    "\uf702": "\u0e35",  # ี
    "\uf703": "\u0e36",  # ึ
    "\uf704": "\u0e37",  # ื
    "\uf705": "\u0e48",  # ่
    "\uf706": "\u0e49",  # ้
    "\uf707": "\u0e4a",  # ๊
    "\uf708": "\u0e4b",  # ๋
    "\uf709": "\u0e4c",  # ์
    "\uf70a": "\u0e48",  # ่
    "\uf70b": "\u0e49",  # ้
    "\uf70c": "\u0e4a",  # ๊
    "\uf70d": "\u0e4b",  # ๋
    "\uf70e": "\u0e4c",  # ์
    "\uf70f": "\u0e0d",  # ญ
    "\uf710": "\u0e31",  # ั
    "\uf711": "\u0e4d",  # ํ
    "\uf712": "\u0e47",  # ็
    "\uf713": "\u0e48",  # ่
    "\uf714": "\u0e49",  # ้
    "\uf715": "\u0e4a",  # ๊
    "\uf716": "\u0e4b",  # ๋
    "\uf717": "\u0e4c",  # ์
    "\uf718": "\u0e38",  # ุ
    "\uf719": "\u0e39",  # ู
    "\uf71a": "\u0e3a",  # ฺ
}
_THAI_PUA_TRANS = str.maketrans(THAI_PUA_MAP)


def _normalize_thai_pua(text: str) -> str:
    return text.translate(_THAI_PUA_TRANS)


def _safe_int(val: Any, default: int = 0) -> int:
    if val is None or val == "":
        return default
    try:
        return int(float(str(val).strip()))
    except (ValueError, TypeError):
        return default


def _infer_level(course_code: str, text_hint: str = "") -> str:
    hint = f"{course_code} {text_hint}"
    if "ปวส" in hint or course_code.startswith("3"):
        return "ปวส."
    return "ปวช."


def _format_credits(t: int, p: int, c: int, fallback: str = "") -> str:
    if t or p or c:
        hours = t + p
        return f"{t}-{p}-{c} ({c} หน่วยกิต {hours} ชั่วโมง)"
    return fallback or "1-3-2 (2 หน่วยกิต 4 ชั่วโมง)"


def normalize_course_item(raw: dict[str, Any], default_semester: str = "2/2569") -> dict[str, Any]:
    code = str(raw.get("course_code") or "").strip()
    name = re.sub(r"\s+", " ", str(raw.get("course_name") or "").strip())
    t_hours = _safe_int(raw.get("t_hours"), 1)
    p_hours = _safe_int(raw.get("p_hours"), 3)
    credit_num = _safe_int(raw.get("credit_num"), 2)
    tpn_match = TPN_RE.search(str(raw.get("credits") or ""))
    if tpn_match and not (raw.get("t_hours") or raw.get("p_hours") or raw.get("credit_num")):
        t_hours, p_hours, credit_num = int(tpn_match.group(1)), int(tpn_match.group(2)), int(tpn_match.group(3))

    student_group = str(raw.get("student_group") or "").strip()
    room = str(raw.get("room") or "").strip()
    schedule_text = str(raw.get("schedule_text") or "").strip()
    if room and room not in schedule_text:
        schedule_text = f"{schedule_text} (ห้อง {room})".strip() if schedule_text else f"ห้อง {room}"

    level = str(raw.get("curriculum_level") or "").strip() or _infer_level(code, f"{name} {student_group}")
    semester = str(raw.get("semester") or "").strip() or default_semester
    total_students = max(0, _safe_int(raw.get("total_students"), 0))
    system_type = str(raw.get("system_type") or "").strip()
    if system_type not in ("ปกติ", "ทวิภาคี"):
        system_type = "ทวิภาคี" if ("ทวิภาคี" in student_group or "ทวิภาคี" in schedule_text) else "ปกติ"
    is_special = bool(raw.get("is_special")) or code.upper() == "PLC" or code.startswith("20000-")
    selected = bool(raw["selected"]) if "selected" in raw else (not is_special)

    return {
        "course_code": code,
        "course_name": name,
        "t_hours": t_hours,
        "p_hours": p_hours,
        "credit_num": credit_num,
        "credits": _format_credits(t_hours, p_hours, credit_num, str(raw.get("credits") or "")),
        "curriculum_level": level,
        "student_group": student_group,
        "total_students": total_students,
        "schedule_text": schedule_text,
        "room": room,
        "semester": semester,
        "system_type": system_type,
        "is_special": is_special,
        "selected": selected,
    }


def _merge_parsed_items(items: list[dict[str, Any]], default_semester: str) -> list[dict[str, Any]]:
    merged: dict[tuple[str, str], dict[str, Any]] = {}
    order: list[tuple[str, str]] = []
    for item in items:
        norm = normalize_course_item(item, default_semester)
        if not norm["course_code"] and not norm["course_name"]:
            continue
        key = (norm["course_code"], norm["student_group"])
        if key not in merged:
            merged[key] = norm
            order.append(key)
        else:
            existing = merged[key]
            if not existing["course_name"] and norm["course_name"]:
                existing["course_name"] = norm["course_name"]
            if norm["schedule_text"] and norm["schedule_text"] not in existing["schedule_text"]:
                existing["schedule_text"] = (
                    f"{existing['schedule_text']}, {norm['schedule_text']}"
                    if existing["schedule_text"]
                    else norm["schedule_text"]
                )
            if norm["total_students"] > existing["total_students"]:
                existing["total_students"] = norm["total_students"]
            if norm["room"] and not existing["room"]:
                existing["room"] = norm["room"]
    return [merged[k] for k in order]


def _extract_fields_from_text_chunk(chunk: str, day_label: str = "", period_label: str = "") -> dict[str, Any] | None:
    code_m = COURSE_CODE_RE.search(chunk)
    if not code_m:
        return None
    code = code_m.group(1)

    t_hours, p_hours, credit_num = 1, 3, 2
    tpn_m = TPN_RE.search(chunk)
    if tpn_m:
        t_hours, p_hours, credit_num = int(tpn_m.group(1)), int(tpn_m.group(2)), int(tpn_m.group(3))

    room_m = ROOM_RE.search(chunk)
    room = room_m.group(1).strip() if room_m else ""

    group_m = GROUP_RE.search(chunk)
    student_group = ""
    if group_m:
        student_group = (group_m.group(1) or group_m.group(2) or "").strip()

    count_m = STUDENT_COUNT_RE.search(chunk)
    total_students = 0
    if count_m:
        total_students = int(count_m.group(1) or count_m.group(2) or 0)

    # Clean course name from remaining text around course code
    cleaned = chunk[code_m.end() :]
    inline_sched = ""
    if not day_label:
        dt_m = DAY_TIME_RE.search(cleaned)
        if dt_m:
            inline_sched = dt_m.group(1).strip()
            cleaned = cleaned.replace(dt_m.group(1), " ", 1)
    for pat in (TPN_RE, ROOM_RE, STUDENT_COUNT_RE):
        cleaned = pat.sub(" ", cleaned)
    if student_group:
        cleaned = cleaned.replace(student_group, " ")
    # Remove common labels
    cleaned = re.sub(r"\b(?:กลุ่ม|ห้อง|คาบ|วิชา)\b", " ", cleaned)
    cleaned = re.sub(r"[|\t]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -–:,()/")

    schedule_parts = [p for p in (day_label, period_label, inline_sched) if p]
    schedule_text = " ".join(schedule_parts).strip()

    return {
        "course_code": code,
        "course_name": cleaned or f"รายวิชา {code}",
        "t_hours": t_hours,
        "p_hours": p_hours,
        "credit_num": credit_num,
        "student_group": student_group,
        "total_students": total_students,
        "room": room,
        "schedule_text": schedule_text,
    }


def _detect_day_label(text: str) -> str:
    stripped = text.strip()
    for canonical, aliases in THAI_DAYS:
        for alias in aliases:
            if stripped.startswith(alias) or f"วัน{canonical}" in stripped:
                return canonical
    return ""


class _SimpleHTMLTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[tuple[str, int]]]] = []
        self._in_table = False
        self._in_row = False
        self._in_cell = False
        self._colspan = 1
        self._cell_buf: list[str] = []
        self._current_row: list[tuple[str, int]] = []
        self._current_table: list[list[tuple[str, int]]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        t = tag.lower()
        if t == "table":
            self._in_table = True
            self._current_table = []
        elif t == "tr" and self._in_table:
            self._in_row = True
            self._current_row = []
        elif t in ("td", "th") and self._in_row:
            self._in_cell = True
            self._cell_buf = []
            self._colspan = 1
            for k, v in attrs:
                if k.lower() == "colspan" and v and v.isdigit():
                    self._colspan = max(1, int(v))
        elif t == "br" and self._in_cell:
            self._cell_buf.append(" ")

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._cell_buf.append(data)

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        if t in ("td", "th") and self._in_cell:
            text = re.sub(r"\s+", " ", "".join(self._cell_buf)).strip()
            self._current_row.append((text, self._colspan))
            self._in_cell = False
        elif t == "tr" and self._in_row:
            if any(c[0] for c in self._current_row):
                self._current_table.append(self._current_row)
            self._in_row = False
        elif t == "table" and self._in_table:
            if self._current_table:
                self.tables.append(self._current_table)
            self._in_table = False


def parse_html_sornor02(html_text: str, default_semester: str = "2/2569") -> tuple[list[dict[str, Any]], list[str]]:
    parser = _SimpleHTMLTableParser()
    parser.feed(html_text)
    warnings: list[str] = []
    raw_items: list[dict[str, Any]] = []
    student_ids_found: set[str] = set()

    for table in parser.tables:
        # Check if this table is a student roster table (for total_students detection)
        roster_count = 0
        for row in table:
            row_txt = " ".join(c[0] for c in row)
            sid_m = STUDENT_ID_RE.search(row_txt)
            if sid_m:
                student_ids_found.add(sid_m.group(0))
                roster_count += 1

        # Detect header columns if list table
        headers = [c[0] for c in table[0]] if table else []
        is_list_header = any(
            h in cell for cell in headers for h in ("รหัสวิชา", "ชื่อวิชา", "หน่วยกิต", "Course")
        )

        if is_list_header and len(table) > 1:
            col_map: dict[str, int] = {}
            for idx, cell in enumerate(headers):
                if "รหัส" in cell:
                    col_map["code"] = idx
                elif "ชื่อวิชา" in cell or "รายวิชา" in cell:
                    col_map["name"] = idx
                elif "ท-ป-น" in cell or "หน่วยกิต" in cell:
                    col_map["credits"] = idx
                elif "กลุ่ม" in cell:
                    col_map["group"] = idx
                elif "วัน" in cell or "เวลา" in cell or "คาบ" in cell:
                    col_map["schedule"] = idx
                elif "ห้อง" in cell:
                    col_map["room"] = idx
                elif "จำนวน" in cell or "นักศึกษา" in cell or "นักเรียน" in cell:
                    col_map["students"] = idx

            for row in table[1:]:
                cells = [c[0] for c in row]
                row_text = " ".join(cells)
                code_m = COURSE_CODE_RE.search(row_text)
                if not code_m and "code" not in col_map:
                    continue
                code = cells[col_map["code"]] if "code" in col_map and col_map["code"] < len(cells) else (code_m.group(1) if code_m else "")
                if not COURSE_CODE_RE.search(code):
                    if code_m:
                        code = code_m.group(1)
                    else:
                        continue
                name = cells[col_map["name"]] if "name" in col_map and col_map["name"] < len(cells) else ""
                credits_txt = cells[col_map["credits"]] if "credits" in col_map and col_map["credits"] < len(cells) else ""
                group_txt = cells[col_map["group"]] if "group" in col_map and col_map["group"] < len(cells) else ""
                sched_txt = cells[col_map["schedule"]] if "schedule" in col_map and col_map["schedule"] < len(cells) else ""
                room_txt = cells[col_map["room"]] if "room" in col_map and col_map["room"] < len(cells) else ""
                stud_txt = cells[col_map["students"]] if "students" in col_map and col_map["students"] < len(cells) else ""
                raw_items.append({
                    "course_code": COURSE_CODE_RE.search(code).group(1),
                    "course_name": name,
                    "credits": credits_txt,
                    "student_group": group_txt,
                    "schedule_text": sched_txt,
                    "room": room_txt,
                    "total_students": _safe_int(re.sub(r"[^\d]", "", stud_txt), 0),
                })
            continue

        # Otherwise scan rows for Grid Timetable (วันจันทร์-อาทิตย์ × คาบ) or embedded course codes
        for row in table:
            first_cell = row[0][0] if row else ""
            day_label = _detect_day_label(first_cell)
            period_cursor = 1
            for idx, (cell_text, colspan) in enumerate(row):
                if idx == 0 and day_label:
                    continue
                if COURSE_CODE_RE.search(cell_text):
                    period_label = (
                        f"คาบ {period_cursor}-{period_cursor + colspan - 1}"
                        if colspan > 1
                        else f"คาบ {period_cursor}"
                    ) if day_label else ""
                    extracted = _extract_fields_from_text_chunk(cell_text, day_label, period_label)
                    if extracted:
                        raw_items.append(extracted)
                period_cursor += colspan

        if roster_count > 0 and raw_items:
            for it in raw_items:
                if not it.get("total_students"):
                    it["total_students"] = roster_count

    if not raw_items:
        # Fallback: parse plain text stripped from HTML
        plain = re.sub(r"<[^>]+>", " ", html_text)
        return parse_csv_or_text_timetable(plain, default_semester)

    merged = _merge_parsed_items(raw_items, default_semester)
    if student_ids_found and all(i["total_students"] == 0 for i in merged):
        for i in merged:
            i["total_students"] = len(student_ids_found)
        warnings.append(f"ตรวจพบรายชื่อนักเรียน {len(student_ids_found)} คนจากหน้า ศธ.02 และเติมเข้าทุกวิชาแล้ว")
    return merged, warnings


def parse_csv_or_text_timetable(text: str, default_semester: str = "2/2569") -> tuple[list[dict[str, Any]], list[str]]:
    if "<table" in text.lower() or "<tr" in text.lower():
        return parse_html_sornor02(text, default_semester)

    warnings: list[str] = []
    raw_items: list[dict[str, Any]] = []
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    # Try delimited table first (tab or comma)
    for ln in lines:
        day_label = _detect_day_label(ln)
        if "\t" in ln:
            parts = [p.strip() for p in ln.split("\t") if p.strip()]
            # Could be either list row or grid row with multiple courses
            course_parts = [p for p in parts if COURSE_CODE_RE.search(p)]
            if len(course_parts) > 1 or (day_label and course_parts):
                for p_idx, cell in enumerate(parts):
                    if COURSE_CODE_RE.search(cell):
                        extracted = _extract_fields_from_text_chunk(cell, day_label, f"คาบ {p_idx}" if day_label else "")
                        if extracted:
                            raw_items.append(extracted)
                continue

        # Standard CSV / TSV single-course row
        sep = "\t" if "\t" in ln else ("," if ln.count(",") >= 2 else None)
        if sep:
            row = next(csv.reader([ln], delimiter=sep))
            joined = " ".join(row)
            if "รหัสวิชา" in joined:
                continue
            code_m = COURSE_CODE_RE.search(joined)
            if code_m:
                # Positional guess: code, name, t, p, c, group, schedule, room, students
                code = code_m.group(1)
                idx_code = next((i for i, c in enumerate(row) if code in c), 0)
                name = row[idx_code + 1].strip() if idx_code + 1 < len(row) else ""
                t_val, p_val, c_val = 1, 3, 2
                tpn_m = TPN_RE.search(joined)
                if tpn_m:
                    t_val, p_val, c_val = int(tpn_m.group(1)), int(tpn_m.group(2)), int(tpn_m.group(3))
                elif idx_code + 4 < len(row) and all(re.fullmatch(r"\d+", row[j].strip() or "") for j in range(idx_code + 2, idx_code + 5)):
                    t_val = _safe_int(row[idx_code + 2], 1)
                    p_val = _safe_int(row[idx_code + 3], 3)
                    c_val = _safe_int(row[idx_code + 4], 2)
                group_txt = ""
                sched_txt = ""
                room_txt = ""
                stud_cnt = 0
                for cell in row[idx_code + 2 :]:
                    c_str = cell.strip()
                    if not c_str or re.fullmatch(r"\d+", c_str) or TPN_RE.fullmatch(c_str):
                        continue
                    if any(d[0] in c_str or "คาบ" in c_str or ":" in c_str for d in THAI_DAYS):
                        sched_txt = f"{sched_txt} {c_str}".strip()
                    elif "ห้อง" in c_str or re.fullmatch(r"[A-Za-z]?\d{3,4}", c_str):
                        room_txt = c_str.replace("ห้อง", "").strip()
                    elif "คน" in c_str:
                        stud_cnt = _safe_int(re.sub(r"[^\d]", "", c_str), 0)
                    elif not group_txt:
                        group_txt = c_str
                raw_items.append({
                    "course_code": code,
                    "course_name": name or f"รายวิชา {code}",
                    "t_hours": t_val,
                    "p_hours": p_val,
                    "credit_num": c_val,
                    "student_group": group_txt,
                    "schedule_text": sched_txt,
                    "room": room_txt,
                    "total_students": stud_cnt,
                })
                continue

        # Free-text / PDF line extraction
        extracted = _extract_fields_from_text_chunk(ln, day_label)
        if extracted:
            raw_items.append(extracted)

    if not raw_items:
        warnings.append("ไม่พบรหัสวิชา (เช่น 20100-1001) ในข้อความที่ส่งมา กรุณาตรวจสอบรูปแบบหรือแก้ไขเพิ่มในตารางพรีวิว")
    return _merge_parsed_items(raw_items, default_semester), warnings


def parse_xlsx_timetable(content: bytes, default_semester: str = "2/2569") -> tuple[list[dict[str, Any]], list[str]]:
    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    ws = wb.active
    rows = [[str(cell).strip() if cell is not None else "" for cell in row] for row in ws.iter_rows(values_only=True)]
    rows = [r for r in rows if any(r)]
    if not rows:
        return [], ["ไม่พบข้อมูลในไฟล์ Excel"]

    # Check for header row
    header_idx = -1
    col_map: dict[str, int] = {}
    for r_idx, row in enumerate(rows[:10]):
        joined = " ".join(row)
        if "รหัสวิชา" in joined or "ชื่อวิชา" in joined:
            header_idx = r_idx
            for c_idx, cell in enumerate(row):
                if "รหัส" in cell:
                    col_map["code"] = c_idx
                elif "ชื่อวิชา" in cell or "รายวิชา" in cell:
                    col_map["name"] = c_idx
                elif cell in ("ท", "ทฤษฎี"):
                    col_map["t"] = c_idx
                elif cell in ("ป", "ปฏิบัติ"):
                    col_map["p"] = c_idx
                elif cell in ("น", "หน่วยกิต"):
                    col_map["c"] = c_idx
                elif "ท-ป-น" in cell:
                    col_map["tpn"] = c_idx
                elif "กลุ่ม" in cell:
                    col_map["group"] = c_idx
                elif "วัน" in cell or "เวลา" in cell or "คาบ" in cell:
                    col_map["schedule"] = c_idx
                elif "ห้อง" in cell:
                    col_map["room"] = c_idx
                elif "จำนวน" in cell or "นักเรียน" in cell or "นักศึกษา" in cell:
                    col_map["students"] = c_idx
                elif "ภาค" in cell:
                    col_map["semester"] = c_idx
            break

    raw_items: list[dict[str, Any]] = []
    if header_idx >= 0 and "code" in col_map:
        for row in rows[header_idx + 1 :]:
            code_cell = row[col_map["code"]] if col_map["code"] < len(row) else ""
            code_m = COURSE_CODE_RE.search(code_cell)
            if not code_m:
                continue
            item: dict[str, Any] = {"course_code": code_m.group(1)}
            if "name" in col_map and col_map["name"] < len(row):
                item["course_name"] = row[col_map["name"]]
            if "t" in col_map and col_map["t"] < len(row):
                item["t_hours"] = _safe_int(row[col_map["t"]], 1)
            if "p" in col_map and col_map["p"] < len(row):
                item["p_hours"] = _safe_int(row[col_map["p"]], 3)
            if "c" in col_map and col_map["c"] < len(row):
                item["credit_num"] = _safe_int(row[col_map["c"]], 2)
            if "tpn" in col_map and col_map["tpn"] < len(row):
                item["credits"] = row[col_map["tpn"]]
            if "group" in col_map and col_map["group"] < len(row):
                item["student_group"] = row[col_map["group"]]
            if "schedule" in col_map and col_map["schedule"] < len(row):
                item["schedule_text"] = row[col_map["schedule"]]
            if "room" in col_map and col_map["room"] < len(row):
                item["room"] = row[col_map["room"]]
            if "students" in col_map and col_map["students"] < len(row):
                item["total_students"] = _safe_int(re.sub(r"[^\d]", "", row[col_map["students"]]), 0)
            if "semester" in col_map and col_map["semester"] < len(row) and row[col_map["semester"]]:
                item["semester"] = row[col_map["semester"]]
            raw_items.append(item)
        return _merge_parsed_items(raw_items, default_semester), []

    # Fallback: grid/unstructured Excel -> convert to TSV text and parse
    tsv_text = "\n".join("\t".join(r) for r in rows)
    return parse_csv_or_text_timetable(tsv_text, default_semester)


def build_timetable_template_xlsx() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "ตารางสอน"

    headers = [
        "รหัสวิชา",
        "ชื่อวิชา",
        "ท",
        "ป",
        "น",
        "กลุ่มเรียน",
        "วัน-เวลาสอน",
        "ห้องเรียน",
        "จำนวนนักเรียน",
        "ภาคเรียน",
    ]
    ws.append(headers)

    header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")
    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    ws.append(["20100-1001", "เขียนแบบเทคนิคเบื้องต้น", 1, 3, 2, "ปวช.1/1", "จันทร์ 1-4", "421", 28, "2/2569"])
    ws.append(["21910-2013", "โปรแกรมกราฟิกและการตกแต่งภาพ", 1, 3, 2, "ปวช.2/1", "พุธ 5-8", "Lab 2", 32, "2/2569"])

    widths = [14, 34, 6, 6, 6, 14, 22, 14, 15, 12]
    for idx, w in enumerate(widths, start=1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(idx)].width = w

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


DETAIL_ROW_RE = re.compile(
    r"^\s*(จันทร์|อังคาร|พุธ|พฤหัสบดี|ศุกร์|เสาร์|อาทิตย์)\s+"
    r"(\d+\s*-\s*\d+|\d+)\s+"
    r"(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})\s+"
    r"(?:(\d{9})\s+)?"
    r"(\d{5}-\d{4}|PLC)\b(.*)$"
)
SUMMARY_TPN_RE = re.compile(r"\b(\d{5}-\d{4})\s+(.+?)\s+(\d+)-(\d+)-(\d+)\b")
SUMMARY_4COL_RE = re.compile(r"\b(\d{5}-\d{4})\s+(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\b")
READABLE_GROUP_RE = re.compile(r"((?:เทคโนโลยีฯ\.?|ปวช\.?|ปวส\.?)[^\n]*?(?:ปวช|ปวส)[^\n]*)", re.IGNORECASE)


def extract_timetable_metadata(raw_text: str) -> dict[str, str]:
    text = _normalize_thai_pua(raw_text)
    meta: dict[str, str] = {}

    sem_m = re.search(r"ภาคเรียน\s+(\d/\d{4})", text)
    if not sem_m:
        sem_m2 = re.search(r"ตารางสอนภาคเรียนที่\s*(\d)\s+ปีการศึกษา\s*(\d{4})", text)
        if sem_m2:
            meta["semester"] = f"{sem_m2.group(1)}/{sem_m2.group(2)}"
    else:
        meta["semester"] = sem_m.group(1)

    inst_m = re.search(r"(?:ชื่อ)?ผู้สอน\s+([^\n\r]+?)(?:\s{2,}|วุฒิการศึกษา|รหัสวิชา|$)", text, re.MULTILINE)
    if inst_m:
        meta["instructor_name"] = re.sub(r"\s+", " ", inst_m.group(1)).strip()

    dept_m = re.search(r"แผนกวิชา\s+([^\n\r]+?)(?:\s{2,}|สาขาวิชา|วุฒิการศึกษา|รหัสวิชา|$)", text, re.MULTILINE)
    if dept_m:
        meta["department_name"] = re.sub(r"\s+", " ", dept_m.group(1)).strip()

    major_m = re.search(r"สาขาวิชา\s+([^\n\r]+?)(?:\s{2,}|วุฒิการศึกษา|รหัสวิชา|$)", text, re.MULTILINE)
    if major_m:
        meta["major_name"] = re.sub(r"\s+", " ", major_m.group(1)).strip()

    # Extract signer names (parenthesized Thai names near role titles)
    paren_names = list(re.finditer(r"\(((?:นาย|นางสาว|นาง)[^\)]{4,50})\)", text))
    for m in paren_names:
        name = re.sub(r"\s+", " ", m.group(1)).strip()
        ctx = text[max(0, m.start() - 40) : min(len(text), m.end() + 140)]
        if "หัวหน้างานพัฒนาหลักสูตร" in ctx and "curriculum_head_name" not in meta:
            meta["curriculum_head_name"] = name
        elif "รองผู้อำนวยการฝ่ายวิชาการ" in ctx and "deputy_academic_name" not in meta:
            meta["deputy_academic_name"] = name
        elif "ผู้อำนวยการ" in ctx and "director_name" not in meta:
            meta["director_name"] = name

    return meta


def _clean_readable_group(raw_group: str) -> str:
    txt = re.sub(r"\s+", " ", raw_group).strip()
    txt = txt.replace("เทคโนโลยีฯ.", "").replace("เทคโนโลยีฯ", "").strip(" .")
    # Remove trailing truncated word like ",ปว.."
    txt = re.sub(r",?\s*ปว\.{1,2}$", "", txt).strip(" ,")
    return txt


def parse_cric_pdf_timetable(
    pdf_text: str, default_semester: str = "2/2569"
) -> tuple[list[dict[str, Any]], dict[str, str], list[str]]:
    text = _normalize_thai_pua(pdf_text)
    meta = extract_timetable_metadata(text)
    sem = meta.get("semester") or default_semester
    warnings: list[str] = []

    # 1. Build course summary map (code -> {course_name, t_hours, p_hours, credit_num})
    summary_map: dict[str, dict[str, Any]] = {}
    for m in SUMMARY_4COL_RE.finditer(text):
        code, name, t, p, c, _h = m.groups()
        summary_map[code] = {
            "course_name": re.sub(r"\s+", " ", name).strip(),
            "t_hours": int(t),
            "p_hours": int(p),
            "credit_num": int(c),
        }
    for m in SUMMARY_TPN_RE.finditer(text):
        code, name, t, p, c = m.groups()
        clean_name = re.sub(r"\s+", " ", name).strip()
        prev = summary_map.get(code, {})
        summary_map[code] = {
            "course_name": clean_name if len(clean_name) >= len(prev.get("course_name", "")) else prev["course_name"],
            "t_hours": int(t),
            "p_hours": int(p),
            "credit_num": int(c),
        }
    if re.search(r"\bPLC\b", text):
        summary_map.setdefault(
            "PLC",
            {"course_name": "ชุมชนการเรียนรู้ทางวิชาชีพ (PLC)", "t_hours": 0, "p_hours": 2, "credit_num": 0},
        )

    # 2. Scan Page 1 Grid for readable group hints keyed by (course_code, day)
    grid_hints: dict[tuple[str, str], list[str]] = {}
    lines = text.splitlines()
    current_grid_day = ""
    for i, ln in enumerate(lines):
        # Stop scanning grid once we hit the detail table header on page 2
        if "คาบเรียน" in ln and "เวลาเรียน" in ln and "กลุ่มเรียน" in ln:
            break
        day_m = re.match(r"^\s*วัน(จันทร์|อังคาร|พุธ|พฤหัสบดี|ศุกร์|เสาร์|อาทิตย์)\b", ln)
        if day_m:
            current_grid_day = day_m.group(1)
        if current_grid_day:
            for code_m in re.finditer(r"\b(\d{5}-\d{4}|PLC)\b", ln):
                code = code_m.group(1)
                window = "\n".join(lines[i : min(len(lines), i + 5)])
                g_m = READABLE_GROUP_RE.search(window)
                if g_m:
                    for seg in re.split(r"(?=เทคโนโลยีฯ)", g_m.group(1)):
                        hint = _clean_readable_group(seg)
                        if hint and ("ปวช" in hint or "ปวส" in hint):
                            grid_hints.setdefault((code, current_grid_day), [])
                            if hint not in grid_hints[(code, current_grid_day)]:
                                grid_hints[(code, current_grid_day)].append(hint)

    # 3. Parse Page 2 detail table rows (supporting wrapped course_name and room lines)
    detail_rows: list[dict[str, Any]] = []
    in_detail = False
    current_row: dict[str, Any] | None = None

    for ln in lines:
        if "คาบเรียน" in ln and "เวลาเรียน" in ln and "รหัสวิชา" in ln:
            in_detail = True
            continue
        if not in_detail:
            continue
        if "รวมชั่วโมง" in ln or "ลงชื่อ" in ln:
            if current_row:
                detail_rows.append(current_row)
                current_row = None
            if "รวมชั่วโมง" in ln:
                break
            continue

        row_m = DETAIL_ROW_RE.match(ln)
        if row_m:
            if current_row:
                detail_rows.append(current_row)
            day, periods, time_range, group_code, code, tail = row_m.groups()
            tail_clean = re.sub(r"\s+-\s+-\s*$", "", tail).strip()
            current_row = {
                "day": day,
                "periods": re.sub(r"\s+", "", periods),
                "time_range": re.sub(r"\s+", "", time_range),
                "group_code": (group_code or "").strip(),
                "course_code": code,
                "tail_parts": [tail_clean] if tail_clean else [],
            }
        elif current_row and ln.strip():
            part = re.sub(r"\s+-\s+-\s*$", "", ln).strip()
            if part and part != "-":
                current_row["tail_parts"].append(part)

    if current_row:
        detail_rows.append(current_row)

    if not detail_rows:
        fallback_items, fallback_warn = parse_csv_or_text_timetable(text, sem)
        return fallback_items, meta, fallback_warn

    # 4. Merge simultaneous co-taught rows (same course_code + day + periods) into sessions
    sessions: dict[tuple[str, str, str], dict[str, Any]] = {}
    session_order: list[tuple[str, str, str]] = []
    for r in detail_rows:
        s_key = (r["course_code"], r["day"], r["periods"])
        if s_key not in sessions:
            tail_joined = " ".join(r["tail_parts"])
            room = ""
            if "สถานประกอบการ" in tail_joined:
                room = "สถานประกอบการ"
            elif "ห้องปฏิบัติการ" in tail_joined:
                rm_m = re.search(r"(ห้องปฏิบัติการ[^\n]+)", tail_joined)
                if rm_m:
                    room = re.sub(r"\s+", "", rm_m.group(1))
            sessions[s_key] = {
                "course_code": r["course_code"],
                "day": r["day"],
                "periods": r["periods"],
                "time_range": r["time_range"],
                "group_codes": [r["group_code"]] if r["group_code"] else [],
                "room": room,
                "tail_text": tail_joined,
            }
            session_order.append(s_key)
        else:
            if r["group_code"] and r["group_code"] not in sessions[s_key]["group_codes"]:
                sessions[s_key]["group_codes"].append(r["group_code"])

    # 5. Group sessions by (course_code, tuple_of_group_codes) so simultaneous groups stay 1 item
    #    while separate cohorts/times (e.g., ปวช.3 vs ทวิภาคี) stay distinct items!
    grouped: dict[tuple[str, tuple[str, ...]], dict[str, Any]] = {}
    group_order: list[tuple[str, tuple[str, ...]]] = []

    for s_key in session_order:
        sess = sessions[s_key]
        code = sess["course_code"]
        g_codes = tuple(sorted(sess["group_codes"]))
        g_key = (code, g_codes)

        hints = grid_hints.get((code, sess["day"]), [])
        # Pick matching readable hint for this session (e.g., ทวิภาคี vs regular)
        readable_hint = ""
        if len(hints) == 1:
            readable_hint = hints[0]
        elif len(hints) > 1:
            if "สถานประกอบการ" in sess["room"]:
                readable_hint = next((h for h in hints if "ทวิภาคี" in h), hints[0])
            else:
                readable_hint = next((h for h in hints if "ทวิภาคี" not in h), hints[0])

        sched_str = f"{sess['day']} คาบ {sess['periods']} ({sess['time_range']})"
        if sess["room"] and sess["room"] not in sched_str:
            sched_str += f" [{sess['room']}]"

        if g_key not in grouped:
            summary = summary_map.get(code, {})
            is_dve = "ทวิภาคี" in readable_hint or "สถานประกอบการ" in sess["room"]
            if readable_hint and g_codes:
                group_display = f"{readable_hint} ({', '.join(g_codes)})"
            elif readable_hint:
                group_display = readable_hint
            else:
                group_display = ", ".join(g_codes)

            grouped[g_key] = {
                "course_code": code,
                "course_name": summary.get("course_name") or sess["tail_text"] or f"รายวิชา {code}",
                "t_hours": summary.get("t_hours", 1),
                "p_hours": summary.get("p_hours", 3),
                "credit_num": summary.get("credit_num", 2),
                "student_group": group_display,
                "schedule_text": sched_str,
                "room": sess["room"],
                "semester": sem,
                "system_type": "ทวิภาคี" if is_dve else "ปกติ",
                "is_special": code == "PLC" or code.startswith("20000-"),
            }
            group_order.append(g_key)
        else:
            existing = grouped[g_key]
            if sched_str not in existing["schedule_text"]:
                existing["schedule_text"] += f", {sched_str}"
            if ("ทวิภาคี" in readable_hint or "สถานประกอบการ" in sess["room"]) and existing["system_type"] != "ทวิภาคี":
                existing["system_type"] = "ทวิภาคี"

    items = [normalize_course_item(grouped[k], sem) for k in group_order]
    return items, meta, warnings
