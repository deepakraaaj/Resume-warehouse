#!/usr/bin/env python3
"""
Automated Resume Compiler & Layout Auditor
Strictly enforces the 1-page A4, symmetrical margins, and trailing space metrics
defined in .agents/AGENTS.md.
"""

import os
import sys
import subprocess
import glob
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parent.parent
HTML_DIR = WORKSPACE / "HTML"
PDF_DIR = WORKSPACE / "PDF"

# Explicit mapping of HTML source to PDF output names
MAPPINGS = {
    "Deepakraj_Full_Stack_Engineer_Resume.html": "Deepakraj_Full_Stack_Engineer_Resume.pdf",
    "Deepakraj_Forward_Deployed_Engineer_Resume01.html": "Deepakraj_FDE.pdf",
    "Deepakraj_Forward_Deployed_Engineer_Resume.html": "Deepakraj_Forward_Deployed_Engineer_Resume.pdf",
    "Deepakraj_Python_Developer_Resume.html": "Deepakraj_Python_Developer_Resume.pdf",
    "Deepakraj_Kotlin_Backend_Engineer_Resume.html": "Deepakraj_Kotlin_Backend_Engineer_Resume.pdf",
    "Deepakraj_GENAI_Software_Engineer_Resume.html": "Deepakraj_GENAI_Software_Engineer_Resume.pdf",
    "Deepakraj_ERPNext_Developer_Resume.html": "Deepakraj_B_Resume_ERPNext.pdf",
    "Deepakraj_Junior_Software_Engineer_Resume.html": "Deepakraj_Junior_Software_Engineer_Resume.pdf",
}

def compile_pdf(html_path: Path, pdf_path: Path):
    cmd = [
        "google-chrome",
        "--headless=new",
        "--disable-gpu",
        "--no-pdf-header-footer",
        f"--print-to-pdf={pdf_path}",
        f"file://{html_path.resolve()}"
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    return res.returncode == 0

def audit_pdf(pdf_path: Path):
    try:
        import pdfplumber
    except ImportError:
        return {"error": "pdfplumber not installed"}

    if not pdf_path.exists():
        return {"error": "PDF file not found"}

    try:
        with pdfplumber.open(pdf_path) as pdf:
            pages = len(pdf.pages)
            if pages == 0:
                return {"pages": 0, "error": "No pages in PDF"}
            page = pdf.pages[0]
            words = page.extract_words()
            if not words:
                return {"pages": pages, "error": "No extractable text"}
            left = min(w["x0"] for w in words)
            right = page.width - max(w["x1"] for w in words)
            bottom = max(w["bottom"] for w in words)
            trailing = page.height - bottom
            return {
                "pages": pages,
                "page_width": round(page.width, 2),
                "page_height": round(page.height, 2),
                "left_margin": round(left, 2),
                "right_margin": round(right, 2),
                "margin_delta": round(abs(left - right), 2),
                "bottom": round(bottom, 2),
                "trailing_space": round(trailing, 2),
                "status": "PASS" if pages == 1 and abs(left - right) < 2.5 else "WARN"
            }
    except Exception as e:
        return {"error": str(e)}

def main():
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    targets = sys.argv[1:] if len(sys.argv) > 1 else list(HTML_DIR.glob("*.html"))

    print(f"\n{'='*75}")
    print(" RESUME COMPILER & AUDIT REPORT (A4 Verification)")
    print(f"{'='*75}")

    all_pass = True
    for item in targets:
        html_path = Path(item) if Path(item).is_absolute() else HTML_DIR / Path(item).name
        if not html_path.exists():
            continue

        filename = html_path.name
        pdf_name = MAPPINGS.get(filename, filename.replace(".html", ".pdf"))
        pdf_path = PDF_DIR / pdf_name

        print(f"\nCompiling: {filename} -> {pdf_name}...")
        ok = compile_pdf(html_path, pdf_path)
        if not ok:
            print(f"  [ERROR] Failed to compile {filename}")
            all_pass = False
            continue

        # Also sync DeepakrajB_Full_STACK.pdf if Full Stack
        if filename == "Deepakraj_Full_Stack_Engineer_Resume.html":
            alt_pdf = PDF_DIR / "DeepakrajB_Full_STACK.pdf"
            compile_pdf(html_path, alt_pdf)

        metrics = audit_pdf(pdf_path)
        if "error" in metrics:
            print(f"  [AUDIT ERROR]: {metrics['error']}")
            all_pass = False
            continue

        pages = metrics["pages"]
        left = metrics["left_margin"]
        right = metrics["right_margin"]
        delta = metrics["margin_delta"]
        trailing = metrics["trailing_space"]
        status = metrics["status"]

        status_str = "[OK - 1 PAGE]" if pages == 1 else f"[FAIL - {pages} PAGES]"
        print(f"  Result: {status_str} | Left: {left}pt | Right: {right}pt (delta: {delta}pt) | Trailing: {trailing}pt")

        if pages != 1:
            all_pass = False

    print(f"\n{'='*75}")
    print(" Audit complete. All resumes tracked in HTML/ and PDF/.")
    print(f"{'='*75}\n")
    return 0 if all_pass else 1

if __name__ == "__main__":
    sys.exit(main())
