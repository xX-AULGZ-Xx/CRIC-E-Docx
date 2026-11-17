"""Convert .docx and .xlsx documents to .pdf using LibreOffice headless (or Office COM fallback on Windows)."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


def convert_office_to_pdf(src_path: Path, out_dir: Path | None = None) -> Path:
    """Convert a .docx or .xlsx file to .pdf and return the resulting PDF path."""
    src_path = src_path.resolve()
    target_dir = (out_dir or src_path.parent).resolve()
    target_dir.mkdir(parents=True, exist_ok=True)
    expected_pdf = target_dir / f"{src_path.stem}.pdf"

    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if soffice:
        cmd = [
            soffice,
            "--headless",
            "--norestore",
            "--convert-to",
            "pdf",
            "--outdir",
            str(target_dir),
            str(src_path),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=60, check=False)
        if res.returncode == 0 and expected_pdf.exists():
            return expected_pdf
        raise RuntimeError(f"LibreOffice conversion failed: {res.stderr or res.stdout}")

    if os.name == "nt":
        src_esc = str(src_path).replace("'", "''")
        dst_esc = str(expected_pdf).replace("'", "''")
        ext = src_path.suffix.lower()
        if ext in (".xlsx", ".xls"):
            ps = (
                "$ErrorActionPreference='Stop';"
                "$e=New-Object -ComObject Excel.Application;"
                "$e.Visible=$false;$e.DisplayAlerts=$false;"
                "try{"
                f"$wb=$e.Workbooks.Open('{src_esc}',0,$true);"
                f"$wb.ExportAsFixedFormat(0,'{dst_esc}');"
                "$wb.Close($false)"
                "}finally{$e.Quit()}"
            )
        else:
            ps = (
                "$ErrorActionPreference='Stop';"
                "$w=New-Object -ComObject Word.Application;"
                "$w.Visible=$false;$w.DisplayAlerts=0;"
                "try{"
                f"$d=$w.Documents.Open('{src_esc}',$false,$true);"
                f"$d.SaveAs2('{dst_esc}',17);"
                "$d.Close($false)"
                "}finally{$w.Quit()}"
            )
        res = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if res.returncode == 0 and expected_pdf.exists():
            return expected_pdf
        raise RuntimeError(f"Office COM PDF conversion failed: {res.stderr or res.stdout}")

    raise RuntimeError("Neither LibreOffice (soffice) nor Microsoft Office is available for PDF conversion.")


def convert_docx_to_pdf(docx_path: Path, out_dir: Path | None = None) -> Path:
    """Backwards-compatible alias for converting .docx (or .xlsx) to .pdf."""
    return convert_office_to_pdf(docx_path, out_dir)


def render_pdf_pages_to_png(
    pdf_path: Path,
    out_dir: Path | None = None,
    prefix: str | None = None,
    dpi: int = 150,
) -> list[Path]:
    """Render each page of a PDF into PNG images using poppler's pdftoppm.

    Returns an empty list if pdftoppm is unavailable (e.g. local Windows dev).
    """
    pdftoppm = shutil.which("pdftoppm")
    if not pdftoppm or not pdf_path.exists():
        return []

    target_dir = (out_dir or pdf_path.parent).resolve()
    target_dir.mkdir(parents=True, exist_ok=True)
    stem = prefix or pdf_path.stem

    for old in target_dir.glob(f"{stem}_page-*.png"):
        try:
            old.unlink()
        except OSError:
            pass

    out_prefix = target_dir / f"{stem}_page"
    res = subprocess.run(
        [pdftoppm, "-png", "-r", str(dpi), str(pdf_path), str(out_prefix)],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if res.returncode != 0:
        return []
    return sorted(target_dir.glob(f"{stem}_page-*.png"))
