"""Convert numeric amounts to standard Thai Baht text (BAHTTEXT)."""

from __future__ import annotations

_THAI_DIGITS_WORD = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"]
_POSITIONS = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"]


def _read_integer(n: int) -> str:
    if n == 0:
        return "ศูนย์"
    groups: list[str] = []
    remaining = n
    group_idx = 0
    while remaining > 0:
        chunk = remaining % 1_000_000
        remaining //= 1_000_000
        text = _read_under_million(chunk)
        if text:
            suffix = "ล้าน" * group_idx
            groups.append(text + suffix)
        elif group_idx > 0 and remaining > 0:
            groups.append("ล้าน" * group_idx)
        group_idx += 1
    return "".join(reversed(groups))


def _read_under_million(n: int) -> str:
    if n == 0:
        return ""
    s = str(n)
    length = len(s)
    out: list[str] = []
    for idx, ch in enumerate(s):
        d = int(ch)
        pos = length - idx - 1
        if d == 0:
            continue
        if pos == 0 and d == 1 and length > 1:
            out.append("เอ็ด")
        elif pos == 1 and d == 2:
            out.append("ยี่" + _POSITIONS[pos])
        elif pos == 1 and d == 1:
            out.append(_POSITIONS[pos])
        else:
            out.append(_THAI_DIGITS_WORD[d] + _POSITIONS[pos])
    return "".join(out)


def baht_text(amount: float | int) -> str:
    """Return standard Thai currency reading matching Excel BAHTTEXT()."""
    if amount is None:
        return "ศูนย์บาทถ้วน"
    rounded = round(float(amount) + 1e-9, 2)
    negative = rounded < 0
    rounded = abs(rounded)
    baht = int(rounded)
    satang = int(round((rounded - baht) * 100))
    if satang == 100:
        baht += 1
        satang = 0

    if baht == 0 and satang == 0:
        return "ศูนย์บาทถ้วน"

    parts: list[str] = []
    if negative:
        parts.append("ลบ")
    if baht > 0:
        parts.append(_read_integer(baht) + "บาท")
    if satang == 0:
        parts.append("ถ้วน")
    else:
        parts.append(_read_integer(satang) + "สตางค์")
    return "".join(parts)
