"""Automated linter & validator for Thai official government documents (.docx)."""

from __future__ import annotations

import argparse
import io
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import docx

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from thai_utils import find_mixed_numerals  # noqa: E402

# Commonly misspelled words from คู่มือการเขียนหนังสือราชการ.pdf (pp. 13-15)
MISSPELLED_WORDS: dict[str, str] = {
    "ปรากฎ": "ปรากฏ",
    "กฏหมาย": "กฎหมาย",
    "กรรมพันธ์": "กรรมพันธุ์",
    "กรรมสิทธิ": "กรรมสิทธิ์",
    "กระตือรือล้น": "กระตือรือร้น",
    "ขบวนการยุติธรรม": "กระบวนการยุติธรรม",
    "กระทดรัด": "กะทัดรัด",
    "กระทันหัน": "กะทันหัน",
    "กิติมศักดิ์": "กิตติมศักดิ์",
    "ครอบคุม": "ครอบคลุม",
    "คลุมเคลือ": "คลุมเครือ",
    "คอนเสิร์ท": "คอนเสิร์ต",
    "คำนวน": "คำนวณ",
    "เคหะสงเคราะห์": "เคหสงเคราะห์",
    "งบดุลย์": "งบดุล",
    "ชลอ": "ชะลอ",
    "เซ็นติเมตร": "เซนติเมตร",
    "เซ็นต์ชื่อ": "เซ็นชื่อ",
    "เต๊นท์": "เต็นท์",
    "ทรัพยสิทธิ์": "ทรัพย์สิน / ทรัพย์สิทธิ",
    "ฑีฆายุโก": "ทีฆายุโก",
    "ทุภิกขภัย": "ทุพภิกขภัย",
    "ทุรกันดาล": "ทุรกันดาร",
    "เทอดพระเกียรติ": "เทิดพระเกียรติ",
    "นวตกรรม": "นวัตกรรม",
    "นานับประการ": "นานัปการ",
    "นิมิตร": "นิมิต",
    "นิเวศน์วิทยา": "นิเวศวิทยา",
    "บิดพริ้ว": "บิดพลิ้ว",
    "บุคคลากร": "บุคลากร",
    "บูรณะปฏิสังขรณ์": "บูรณปฏิสังขรณ์",
    "ปฏิกริยา": "ปฏิกิริยา",
    "ปฐมนิเทศน์": "ปฐมนิเทศ",
    "ประจันบาน": "ประจัญบาน",
    "ประนิธาน": "ประณิธาน",
    "ปราณีต": "ประณีต",
    "ปฐมาภรณ์": "ประถมาภรณ์",
    "ประสพการณ์": "ประสบการณ์",
    "พิธีรีตรอง": "พิธีรีตอง",
    "ภาพยนต์": "ภาพยนตร์",
    "มนุษย์สัมพันธ์": "มนุษยสัมพันธ์",
    "มกุฏราชกุมาร": "มกุฎราชกุมาร",
    "มงกุฏราชกุมาร": "มกุฎราชกุมาร",
    "ลิขสิทธิ": "ลิขสิทธิ์",
    "โลกาภิวัฒน์": "โลกาภิวัตน์",
    "รังษี": "รังสี",
    "วิดีทัศน์": "วีดิทัศน์",
    "วาระดิถี": "วารดิถี",
    "วิกฤตการ": "วิกฤตการณ์ / วิกฤติการณ์",
    "วิกฤตกาล": "วิกฤตการณ์ / วิกฤติการณ์",
    "วันทยาหัตถ์": "วันทยหัตถ์",
    "สัมนา": "สัมมนา",
    "สักการะบูชา": "สักการบูชา",
    "สักกะหลาด": "สักหลาด",
    "สภาวะการณ์": "สภาวการณ์",
    "สถานะการณ์": "สถานการณ์",
    "สังเกตุ": "สังเกต",
    "สาระสังเขป": "สารสังเขป",
    "สาระประโยชน์": "สารประโยชน์",
    "สาธารณะประโยชน์": "สาธารณประโยชน์",
    "สังสันทน์": "สังสรรค์",
    "สัญญลักษณ์": "สัญลักษณ์",
    "สัญญลักขณ์": "สัญลักษณ์",
    "สันฐาน": "สัณฐาน",
    "อนุญาติ": "อนุญาต",
    "อริยาบท": "อิริยาบถ",
    "อิสสริยาภรณ์": "อิสริยาภรณ์",
    "อุปการะคุณ": "อุปการคุณ",
    "เอนกประสงค์": "อเนกประสงค์",
    "พิจาณา": "พิจารณา",
}

STYLE_ERROR_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"อาทิ\s*เช่น"), "ห้ามใช้ 'อาทิเช่น' ซ้อนกัน ให้เลือกใช้ 'อาทิ' หรือ 'เช่น' อย่างใดอย่างหนึ่ง"),
    (re.compile(r"(?:กระทรวง|มหาวิทยาลัย|คณะ|กรม|บริษัท|โครงการ|การสัมมนา)ฯ"), "ห้ามใช้ไปยาลน้อย (ฯ) ต่อท้ายคำนามที่สมบูรณ์แล้ว"),
    (re.compile(r"(?:นาย|ที่|ของ|ผม)\s*ๆ"), "ห้ามใช้ไม้ยมก (ๆ) แทนคำที่ต่างชนิดหรือต่างความหมาย เช่น 'นาย ๆ ละ' หรือ 'ที่ ๆ'"),
    (re.compile(r"ประเทศราชอาณาจักร"), "ชื่อทางการมีคำนำหน้าแล้ว ไม่ต้องเติมคำว่า 'ประเทศ' ซ้ำ"),
    (re.compile(r"ใคร่ขอ"), "ไม่ควรใช้คำว่า 'ใคร่' ให้ตัดออก เช่น 'ขอเชิญ' แทน 'ใคร่ขอเชิญ'"),
    (re.compile(r"จักขอบพระ?คุณ"), "ไม่ควรใช้คำว่า 'จัก' ในการขอบคุณ ให้ใช้ 'จะขอบคุณยิ่ง' หรือ 'จะขอบคุณมาก'"),
]

STYLE_WARNING_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"จะทำการ(?!ค้า|เกษตร|ประมง|บ้าน)"), "คำฟุ่มเฟือย 'จะทำการ...' ควรตัด 'ทำการ' ออก เช่น 'จะเปิดรับสมัคร'"),
    (re.compile(r"ใช้เวลาในการ"), "คำฟุ่มเฟือย 'ใช้เวลาในการ...' ควรใช้ 'ใช้เวลา...'"),
    (re.compile(r"หน่วยงานของท่าน"), "ควรใช้ชื่อหน่วยงานโดยตรงแทนคำว่า 'หน่วยงานของท่าน'"),
]


@dataclass
class Issue:
    level: str  # "ERROR" | "WARNING"
    location: str
    message: str


def _iter_all_paragraphs(doc: docx.Document) -> Iterable[tuple[str, object]]:
    for idx, p in enumerate(doc.paragraphs):
        yield f"P{idx + 1}", p
    for ti, table in enumerate(doc.tables):
        for ri, row in enumerate(table.rows):
            for ci, cell in enumerate(row.cells):
                for pi, p in enumerate(cell.paragraphs):
                    yield f"T{ti + 1}R{ri + 1}C{ci + 1}P{pi + 1}", p


def validate_document(
    docx_path: Path,
    extra_misspellings: dict[str, str] | None = None,
    extra_forbidden: list[str] | None = None,
) -> list[Issue]:
    issues: list[Issue] = []
    doc = docx.Document(str(docx_path))
    misspellings = {**MISSPELLED_WORDS, **(extra_misspellings or {})}
    custom_forbidden = [w.strip() for w in (extra_forbidden or []) if w and w.strip()]

    # 1. Check page margins
    for si, sec in enumerate(doc.sections):
        left_cm = sec.left_margin.cm if sec.left_margin else 0.0
        right_cm = sec.right_margin.cm if sec.right_margin else 0.0
        if abs(left_cm - 3.0) > 0.25 or abs(right_cm - 2.0) > 0.25:
            issues.append(
                Issue(
                    "WARNING",
                    f"Section {si + 1}",
                    f"ระยะขอบซ้าย/ขวา ({left_cm:.2f}/{right_cm:.2f} ซม.) ต่างจากเกณฑ์มาตรฐาน 3.00/2.00 ซม.",
                )
            )

    para_texts: list[tuple[str, str]] = []
    for loc, p in _iter_all_paragraphs(doc):
        txt = p.text
        para_texts.append((loc, txt))

        # 2. Check font consistency on non-empty runs
        for r in p.runs:
            if r.text.strip():
                fname = r.font.name
                if fname and fname not in ("TH SarabunIT๙", "TH Sarabun New", "TH SarabunIT9") and "Sarabun" not in fname:
                    issues.append(
                        Issue("WARNING", loc, f"พบฟอนต์ '{fname}' แทนที่จะเป็น 'TH SarabunIT๙' หรือ 'TH Sarabun New'")
                    )
                    break

        if not txt.strip():
            continue

        # 3. Leftover placeholder warning
        if "......" in txt or "….." in txt or "........" in txt:
            issues.append(
                Issue("WARNING", loc, f"ยังพบจุดไข่ปลาเว้นช่องกรอกข้อมูล: '{txt.strip()[:50]}'")
            )

        # 4. Misspelled words
        for wrong, right in misspellings.items():
            if wrong in txt:
                # Special guard: avoid substring false positive when 'วิกฤตการ' is inside 'วิกฤตการณ์'
                if wrong == "วิกฤตการ" and "วิกฤตการณ์" in txt.replace("วิกฤตการ ", " "):
                    if not re.search(r"วิกฤตการ(?!ณ์)", txt):
                        continue
                if wrong == "ครองราช" and "ครองราชย์" in txt:
                    if not re.search(r"ครองราช(?!ย์)", txt):
                        continue
                if wrong == "ดุลย์" and not re.search(r"ดุลย์", txt):
                    continue
                if wrong == "กรรมสิทธิ" and not re.search(r"กรรมสิทธิ(?!์)", txt):
                    continue
                if wrong == "ลิขสิทธิ" and not re.search(r"ลิขสิทธิ(?!์)", txt):
                    continue
                issues.append(Issue("ERROR", loc, f"สะกดคำผิด '{wrong}' -> ควรใช้ '{right}'"))

        # 5. Style errors & warnings
        for pat, msg in STYLE_ERROR_PATTERNS:
            m = pat.search(txt)
            if m:
                issues.append(Issue("ERROR", loc, f"{msg} (พบ: '{m.group(0)}')"))
        for pat, msg in STYLE_WARNING_PATTERNS:
            m = pat.search(txt)
            if m:
                issues.append(Issue("WARNING", loc, f"{msg} (พบ: '{m.group(0)}')"))
        for term in custom_forbidden:
            if term in txt:
                issues.append(Issue("ERROR", loc, f"พบคำต้องห้ามตามกฎหน่วยงาน: '{term}'"))

        # 6. Overuse of 'ซึ่ง' or overly long paragraph (> ~8 lines)
        if txt.count("ซึ่ง") > 2:
            issues.append(
                Issue("WARNING", loc, f"ใช้คำว่า 'ซึ่ง' ถึง {txt.count('ซึ่ง')} ครั้งในย่อหน้าเดียว ควรแยกประโยคใหม่")
            )
        if len(txt.strip()) > 720 and not txt.strip().startswith("๑."):
            issues.append(
                Issue("WARNING", loc, f"ย่อหน้ายาว ({len(txt.strip())} ตัวอักษร) อาจเกิน 8 บรรทัด ควรแบ่งย่อหน้าใหม่")
            )

    # 7. Mixed Arabic numerals check across all paragraphs
    only_texts = [t for _, t in para_texts]
    for idx, tok, snippet in find_mixed_numerals(only_texts):
        loc = para_texts[idx][0]
        issues.append(
            Issue(
                "ERROR",
                loc,
                f"พบเลขอารบิก '{tok}' ในบริบท '{snippet}' (เอกสารราชการต้องใช้เลขไทย ๐-๙ ตลอดฉบับ)",
            )
        )

    # 8. Check redundant closing after thanking
    full_text = "\n".join(only_texts)
    if re.search(r"ขอบ(?:พระ)?คุณ[^\n]{0,60}\n\s*จึงเรียนมาเพื่อ(?:โปรด)?ทราบ", full_text):
        issues.append(
            Issue(
                "WARNING",
                "Document",
                "มีการกล่าวขอบคุณแล้วไม่ควรลงท้าย 'จึงเรียนมาเพื่อทราบ' ซ้ำอีก",
            )
        )

    return issues


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Validate a Thai official .docx document")
    parser.add_argument("docx_path", type=Path, help="Path to the .docx file to validate")
    parser.add_argument("--strict", action="store_true", help="Treat warnings as errors")
    args = parser.parse_args()

    if not args.docx_path.exists():
        print(f"[ERROR] File not found: {args.docx_path}")
        return 2

    issues = validate_document(args.docx_path)
    errors = [i for i in issues if i.level == "ERROR"]
    warnings = [i for i in issues if i.level == "WARNING"]

    if not issues:
        print(f"[PASS] {args.docx_path.name}: ผ่านการตรวจสอบทุกรายการ (0 errors, 0 warnings)")
        return 0

    for item in issues:
        print(f"[{item.level}] {item.location}: {item.message}")

    print(f"\nSummary for {args.docx_path.name}: {len(errors)} error(s), {len(warnings)} warning(s)")
    if errors or (args.strict and warnings):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
