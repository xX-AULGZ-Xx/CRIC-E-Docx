"""Resolver & structural validator for CRIC E-Docx 16 built-in system templates."""

from __future__ import annotations

import datetime as _dt
import io
from pathlib import Path
from typing import Any

import docx
import openpyxl

from app.config import SYSTEM_TEMPLATE_OVERRIDES_DIR, TEMPLATES_DIR


SYSTEM_TEMPLATE_CATALOG: list[dict[str, Any]] = [
    # Saraban 6 templates
    {
        "key": "memo",
        "rel_path": "memo.docx",
        "name": "บันทึกข้อความ",
        "group": "สารบรรณ (6 แบบฟอร์ม)",
        "file_type": "docx",
        "min_tables": 0,
        "min_sheets": 0,
    },
    {
        "key": "order",
        "rel_path": "order.docx",
        "name": "คำสั่ง",
        "group": "สารบรรณ (6 แบบฟอร์ม)",
        "file_type": "docx",
        "min_tables": 0,
        "min_sheets": 0,
    },
    {
        "key": "announcement",
        "rel_path": "announcement.docx",
        "name": "ประกาศ",
        "group": "สารบรรณ (6 แบบฟอร์ม)",
        "file_type": "docx",
        "min_tables": 0,
        "min_sheets": 0,
    },
    {
        "key": "external",
        "rel_path": "external.docx",
        "name": "หนังสือภายนอก",
        "group": "สารบรรณ (6 แบบฟอร์ม)",
        "file_type": "docx",
        "min_tables": 0,
        "min_sheets": 0,
    },
    {
        "key": "agenda",
        "rel_path": "agenda.docx",
        "name": "ระเบียบวาระการประชุม",
        "group": "สารบรรณ (6 แบบฟอร์ม)",
        "file_type": "docx",
        "min_tables": 0,
        "min_sheets": 0,
    },
    {
        "key": "minutes",
        "rel_path": "minutes.docx",
        "name": "รายงานการประชุม",
        "group": "สารบรรณ (6 แบบฟอร์ม)",
        "file_type": "docx",
        "min_tables": 0,
        "min_sheets": 0,
    },
    # Procurement / สผ 2-69 (5 templates)
    {
        "key": "sp_1_approval_memo",
        "rel_path": "sp/1_approval_memo.docx",
        "name": "บันทึกขออนุมัติจัดซื้อ/จัดจ้าง (สผ.)",
        "group": "จัดซื้อ / สผ 2-69 (5 แบบฟอร์ม)",
        "file_type": "docx",
        "min_tables": 0,
        "min_sheets": 0,
    },
    {
        "key": "sp_2_sp1_purchase",
        "rel_path": "sp/2_sp1_purchase.docx",
        "name": "แบบขออนุมัติจัดซื้อจัดจ้าง (สผ.1)",
        "group": "จัดซื้อ / สผ 2-69 (5 แบบฟอร์ม)",
        "file_type": "docx",
        "min_tables": 1,
        "min_sheets": 0,
    },
    {
        "key": "sp_3_training_plan",
        "rel_path": "sp/3_training_plan.xlsx",
        "name": "ตารางรายละเอียดวัสดุฝึก (สผ.)",
        "group": "จัดซื้อ / สผ 2-69 (6 แบบฟอร์ม)",
        "file_type": "xlsx",
        "min_tables": 0,
        "min_sheets": 1,
    },
    {
        "key": "sp_3b_material_plan",
        "rel_path": "sp/3b_material_plan.docx",
        "name": "แผนการใช้วัสดุ (.DOCX)",
        "group": "จัดซื้อ / สผ 2-69 (6 แบบฟอร์ม)",
        "file_type": "docx",
        "min_tables": 5,
        "min_sheets": 0,
    },
    {
        "key": "sp_4_tor",
        "rel_path": "sp/4_tor.xlsx",
        "name": "ขอบเขตงาน / TOR และราคากลาง",
        "group": "จัดซื้อ / สผ 2-69 (5 แบบฟอร์ม)",
        "file_type": "xlsx",
        "min_tables": 0,
        "min_sheets": 1,
    },
    {
        "key": "sp_5_urgent_po",
        "rel_path": "sp/5_urgent_po.docx",
        "name": "ใบสั่งซื้อ/สั่งจ้างกรณีจำเป็นเร่งด่วน",
        "group": "จัดซื้อ / สผ 2-69 (5 แบบฟอร์ม)",
        "file_type": "docx",
        "min_tables": 1,
        "min_sheets": 0,
    },
    # Teaching / แผนการสอน 2-69 (5 templates)
    {
        "key": "teaching_1_course_syllabus",
        "rel_path": "teaching/1_course_syllabus.docx",
        "name": "กำหนดการสอนและโครงการสอน",
        "group": "แผนการสอน 2-69 (5 แบบฟอร์ม)",
        "file_type": "docx",
        "min_tables": 1,
        "min_sheets": 0,
    },
    {
        "key": "teaching_2_lesson_plan",
        "rel_path": "teaching/2_lesson_plan.docx",
        "name": "แผนการจัดการเรียนรู้รายหน่วย",
        "group": "แผนการสอน 2-69 (5 แบบฟอร์ม)",
        "file_type": "docx",
        "min_tables": 1,
        "min_sheets": 0,
    },
    {
        "key": "teaching_3a_post_teaching_memo",
        "rel_path": "teaching/3a_post_teaching_memo.docx",
        "name": "บันทึกข้อความส่งรายงานหลังสอน",
        "group": "แผนการสอน 2-69 (5 แบบฟอร์ม)",
        "file_type": "docx",
        "min_tables": 0,
        "min_sheets": 0,
    },
    {
        "key": "teaching_3b_post_teaching_sheet",
        "rel_path": "teaching/3b_post_teaching_sheet.docx",
        "name": "แบบรายงานผลการจัดการเรียนรู้หลังสอน",
        "group": "แผนการสอน 2-69 (5 แบบฟอร์ม)",
        "file_type": "docx",
        "min_tables": 1,
        "min_sheets": 0,
    },
    {
        "key": "teaching_4_online_teaching_report",
        "rel_path": "teaching/4_online_teaching_report.docx",
        "name": "แบบรายงานการสอนออนไลน์",
        "group": "แผนการสอน 2-69 (5 แบบฟอร์ม)",
        "file_type": "docx",
        "min_tables": 1,
        "min_sheets": 0,
    },
    {
        "key": "repair_request",
        "rel_path": "repair_request.docx",
        "name": "บันทึกข้อความแจ้งซ่อม (งานอาคารสถานที่)",
        "group": "ฝ่ายบริหารทรัพยากร",
        "file_type": "docx",
        "min_tables": 1,
        "min_sheets": 0,
    },
]

_CATALOG_BY_KEY: dict[str, dict[str, Any]] = {item["key"]: item for item in SYSTEM_TEMPLATE_CATALOG}


def get_system_template_meta(key: str) -> dict[str, Any]:
    meta = _CATALOG_BY_KEY.get(key)
    if not meta:
        raise ValueError(f"ไม่พบแม่แบบระบบรหัส '{key}'")
    return meta


def default_path_for(rel_path: str) -> Path:
    return TEMPLATES_DIR / rel_path


def override_path_for(rel_path: str) -> Path:
    return SYSTEM_TEMPLATE_OVERRIDES_DIR / rel_path


def resolve_system_template(rel_path: str) -> Path:
    """Return persistent override path if present, otherwise built-in template path."""
    ovr = override_path_for(rel_path)
    if ovr.exists() and ovr.is_file():
        return ovr
    return default_path_for(rel_path)


def list_system_templates() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for meta in SYSTEM_TEMPLATE_CATALOG:
        rel = meta["rel_path"]
        ovr = override_path_for(rel)
        dft = default_path_for(rel)
        overridden = ovr.exists() and ovr.is_file()
        active_path = ovr if overridden else dft
        size_bytes = active_path.stat().st_size if active_path.exists() else 0
        updated_at = (
            _dt.datetime.fromtimestamp(ovr.stat().st_mtime, tz=_dt.timezone.utc).isoformat()
            if overridden
            else ""
        )
        rows.append(
            {
                **meta,
                "is_overridden": overridden,
                "default_exists": dft.exists(),
                "file_size_bytes": size_bytes,
                "updated_at": updated_at,
            }
        )
    return rows


def validate_system_template_override(key: str, file_bytes: bytes, filename: str = "") -> None:
    """Validate uploaded override file structure before replacing a built-in template."""
    meta = get_system_template_meta(key)
    expected_ext = meta["file_type"]
    if filename:
        ext = Path(filename).suffix.lower().lstrip(".")
        if ext != expected_ext:
            raise ValueError(f"แม่แบบ '{meta['name']}' ต้องใช้ไฟล์นามสกุล .{expected_ext} เท่านั้น (ได้รับ .{ext or 'ไม่ทราบ'})")

    if len(file_bytes) < 512:
        raise ValueError("ไฟล์แม่แบบมีขนาดเล็กผิดปกติหรือไม่สมบูรณ์")

    buf = io.BytesIO(file_bytes)
    if expected_ext == "docx":
        try:
            doc = docx.Document(buf)
        except Exception as exc:
            raise ValueError(f"ไม่สามารถเปิดไฟล์ .docx ได้ (ไฟล์อาจเสียหาย): {exc}") from exc
        if len(doc.paragraphs) == 0 and len(doc.tables) == 0:
            raise ValueError("ไฟล์ .docx ว่างเปล่า ไม่มีข้อความหรือตาราง")
        min_tables = int(meta.get("min_tables") or 0)
        if len(doc.tables) < min_tables:
            raise ValueError(
                f"แม่แบบ '{meta['name']}' ต้องมีตารางอย่างน้อย {min_tables} ตาราง (พบ {len(doc.tables)} ตาราง)"
            )
    elif expected_ext == "xlsx":
        try:
            wb = openpyxl.load_workbook(buf, data_only=False)
        except Exception as exc:
            raise ValueError(f"ไม่สามารถเปิดไฟล์ .xlsx ได้ (ไฟล์อาจเสียหาย): {exc}") from exc
        min_sheets = max(1, int(meta.get("min_sheets") or 1))
        if len(wb.sheetnames) < min_sheets:
            raise ValueError(
                f"แม่แบบ '{meta['name']}' ต้องมีชีทอย่างน้อย {min_sheets} ชีท (พบ {len(wb.sheetnames)} ชีท)"
            )


def save_system_template_override(key: str, file_bytes: bytes, filename: str = "") -> Path:
    meta = get_system_template_meta(key)
    validate_system_template_override(key, file_bytes, filename=filename)
    target = override_path_for(meta["rel_path"])
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(file_bytes)
    return target


def reset_system_template_override(key: str) -> bool:
    meta = get_system_template_meta(key)
    target = override_path_for(meta["rel_path"])
    if target.exists() and target.is_file():
        target.unlink()
        return True
    return False
