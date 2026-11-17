"""Utilities for Thai numerals, official Thai dates, and document number formatting."""

from __future__ import annotations

import datetime as _dt
import re
from typing import Iterable

THAI_DIGITS = str.maketrans("0123456789", "๐๑๒๓๔๕๖๗๘๙")
ARABIC_DIGITS = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")

THAI_MONTHS = (
    "",
    "มกราคม",
    "กุมภาพันธ์",
    "มีนาคม",
    "เมษายน",
    "พฤษภาคม",
    "มิถุนายน",
    "กรกฎาคม",
    "สิงหาคม",
    "กันยายน",
    "ตุลาคม",
    "พฤศจิกายน",
    "ธันวาคม",
)

# Tokens that should keep ASCII digits (emails, URLs, Latin-prefixed codes like ISO9001, COVID-19, Windows11)
_PRESERVE_RE = re.compile(
    r"(https?://\S+|www\.\S+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|[A-Za-z][A-Za-z0-9._/-]*\d+[A-Za-z0-9._/-]*)"
)


def to_thai_digits(text: str, preserve_latin_tokens: bool = True) -> str:
    """Convert Arabic digits (0-9) to Unicode Thai digits (๐-๙).

    Preserves digits inside emails, URLs, and Latin-prefixed alphanumeric codes
    when ``preserve_latin_tokens`` is True.
    """
    if not text:
        return text
    if not preserve_latin_tokens:
        return text.translate(THAI_DIGITS)

    parts: list[str] = []
    last = 0
    for match in _PRESERVE_RE.finditer(text):
        if match.start() > last:
            parts.append(text[last : match.start()].translate(THAI_DIGITS))
        parts.append(match.group(0))
        last = match.end()
    if last < len(text):
        parts.append(text[last:].translate(THAI_DIGITS))
    return "".join(parts)


def to_arabic_digits(text: str) -> str:
    """Convert Thai digits (๐-๙) to ASCII digits (0-9)."""
    return text.translate(ARABIC_DIGITS) if text else text


def current_buddhist_year(today: _dt.date | None = None) -> int:
    """Return current Buddhist Era year (พ.ศ.)."""
    d = today or _dt.date.today()
    return d.year + 543


def format_thai_date(
    value: str | _dt.date | None = None,
    include_be_prefix: bool = False,
    month_year_only: bool = False,
) -> str:
    """Format a date as official Thai date with Thai numerals.

    Accepts ``YYYY-MM-DD`` (CE or BE if year >= 2400), ``datetime.date``,
    an already-formatted Thai date string, or ``None`` (today).
    """
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            value = _dt.date.today()
        else:
            iso = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", to_arabic_digits(raw))
            if iso:
                y, m, d = int(iso.group(1)), int(iso.group(2)), int(iso.group(3))
                if y >= 2400:
                    y -= 543
                value = _dt.date(y, m, d)
            else:
                # Already a Thai formatted string; normalize digits to Thai numerals
                return to_thai_digits(raw)

    if value is None:
        value = _dt.date.today()

    assert isinstance(value, _dt.date)
    be_year = value.year + 543
    month_name = THAI_MONTHS[value.month]
    if month_year_only:
        return to_thai_digits(f"{month_name} {be_year}")
    if include_be_prefix:
        return to_thai_digits(f"{value.day} {month_name} พ.ศ. {be_year}")
    return to_thai_digits(f"{value.day} {month_name} {be_year}")


def format_doc_number(
    prefix: str,
    number: str = "",
    is_circular: bool = False,
    year_be: int | str | None = None,
) -> str:
    """Format an official document number according to Thai Saraban rules.

    Examples:
        - External normal: ``ศธ ๐๖๒๒.๐๕/๑๒๓`` (or ``ศธ ๐๖๒๒.๐๕/........`` if empty)
        - External circular: ``ศธ ๐๖๒๒.๐๕/ว ๑๒๓``
        - Memo with division: ``ฝบ. ๑๒/๒๕๖๙``
    """
    clean_prefix = to_thai_digits(prefix.strip())
    clean_num = to_thai_digits(number.strip()) if number else ""
    if clean_prefix.endswith("/"):
        if is_circular:
            if clean_num.startswith("ว"):
                return f"{clean_prefix}{clean_num}"
            return f"{clean_prefix}ว {clean_num or '........'}"
        return f"{clean_prefix}{clean_num or '........'}"

    yr = to_thai_digits(str(year_be)) if year_be else to_thai_digits(str(current_buddhist_year()))
    num_part = clean_num or "............"
    if is_circular and not num_part.startswith("ว"):
        num_part = f"ว {num_part}"
    if clean_prefix:
        return f"{clean_prefix} {num_part}/{yr}"
    return f"{num_part}/{yr}"


def find_mixed_numerals(paragraphs: Iterable[str]) -> list[tuple[int, str, str]]:
    """Detect ASCII digits remaining in Thai prose (excluding emails/URLs/Latin codes).

    Returns list of ``(paragraph_index, offending_token, snippet)``.
    """
    issues: list[tuple[int, str, str]] = []
    for idx, text in enumerate(paragraphs):
        if not text:
            continue
        masked = _PRESERVE_RE.sub(" ", text)
        for m in re.finditer(r"[0-9]+", masked):
            start = max(0, m.start() - 15)
            end = min(len(masked), m.end() + 15)
            issues.append((idx, m.group(0), masked[start:end].strip()))
    return issues
