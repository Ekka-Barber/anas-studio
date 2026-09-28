#!/usr/bin/env python3
"""
P02: the book's public preview, built from the manuscript fragments Anas sent.

Anas supplied three fragments of «خوص» as Word-exported PDFs (the dedication,
the introduction and two pages of the chapter «صورة الروضة»). The owner
approved exactly these as the free preview on 2026-09-28 (E04 range): "ANAS
provide two or three PDF texts ... we only want to let users see these then
had to buy the whole book to read". Nothing else of the book is published.

This script writes one sanitized PDF, in the book's reading order, to
`public/book/khous-preview.pdf`, and records every input and output hash in
`content/book-source-manifest.json`. The page content streams and their
embedded font subsets are copied unchanged (Anas's words are never rewritten);
everything else is dropped:
  - document metadata and XMP (the Word export carries the author's email);
  - the structure tree, open actions, additional actions, names (JavaScript,
    embedded files), outlines and annotations;
  - page-level actions, annotations, thumbnails and piece info.
The output is then checked: no action, script, attachment, link or email may
remain, and every page's text must match its source page.

Run: `python scripts/prepare-preview.py` (pypdf 6+). Re-running on the same
inputs writes the same bytes. `--fixtures` also writes the reader's test
PDFs to `tests/fixtures/reader/`: synthetic pages (one, and an odd three)
and a corrupt file. None of them holds a word of the book.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import sys
from pathlib import Path

import pypdf
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DictionaryObject, NameObject, StreamObject, TextStringObject

ROOT = Path(__file__).resolve().parent.parent
OUT_PDF = ROOT / "public" / "book" / "khous-preview.pdf"
MANIFEST = ROOT / "content" / "book-source-manifest.json"
# Each page's text as pypdf reads it, in reading order. The reader uses it to
# put back the lam-alef ligatures pdf.js reverses (src/lib/book-preview.ts).
PAGE_TEXT = ROOT / "content" / "book-preview-text.json"
FIXTURES = ROOT / "tests" / "fixtures" / "reader"

# In the book's order. `label` is what the reader shows for these pages.
SOURCES = [
    {"file": "BOOK_ASSETS/ (8).pdf", "label": "الإهداء"},
    {"file": "BOOK_ASSETS/ (11).pdf", "label": "المقدمة"},
    {"file": "BOOK_ASSETS/ (9).pdf", "label": "من فصل «صورة الروضة»"},
]

# The only page-dictionary keys a rendered page needs.
PAGE_KEYS = {"/Type", "/Parent", "/Resources", "/MediaBox", "/CropBox", "/Contents", "/Rotate", "/Group"}
FORBIDDEN = [b"/JavaScript", b"/JS", b"/OpenAction", b"/AA", b"/EmbeddedFile", b"/Launch", b"/URI", b"/Annots", b"/Metadata"]
EMAIL = re.compile(rb"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalized(text: str) -> str:
    return re.sub(r"\s+", "", text or "")


def build() -> tuple[bytes, list[dict], list[dict]]:
    writer = PdfWriter()
    inputs: list[dict] = []
    pages: list[dict] = []
    for source in SOURCES:
        path = ROOT / source["file"]
        data = path.read_bytes()
        reader = PdfReader(io.BytesIO(data))
        inputs.append(
            {"file": source["file"], "sha256": sha256(data), "bytes": len(data), "pages": len(reader.pages), "label": source["label"]}
        )
        for index, page in enumerate(reader.pages):
            added = writer.add_page(page)
            for key in list(added.keys()):
                if key not in PAGE_KEYS:
                    del added[key]
            pages.append({"page": len(pages) + 1, "label": source["label"], "source": source["file"], "sourcePage": index + 1})

    # A bare catalog: pages, the language, and nothing that can run or attach.
    root = writer.root_object
    for key in list(root.keys()):
        if key not in ("/Type", "/Pages"):
            del root[key]
    root[NameObject("/Lang")] = TextStringObject("ar")
    writer.metadata = None
    writer.compress_identical_objects(remove_duplicates=True, remove_unreferenced=True)

    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue(), inputs, pages


def verify(data: bytes, pages: list[dict]) -> None:
    reader = PdfReader(io.BytesIO(data))
    assert len(reader.pages) == len(pages), "page count changed"
    for token in FORBIDDEN:
        assert re.search(re.escape(token) + rb"(?![A-Za-z])", data) is None, f"{token.decode()} left in the preview"
    assert EMAIL.search(data) is None, "an email address is left in the preview"
    assert reader.metadata is None or not any(reader.metadata.values()), "document metadata left in the preview"
    # Same words, page for page, as the source fragments.
    for entry, page in zip(pages, reader.pages):
        source = PdfReader(ROOT / entry["source"]).pages[entry["sourcePage"] - 1]
        assert normalized(page.extract_text()) == normalized(source.extract_text()), f"page {entry['page']} text differs from its source"


def fixture(pages: int) -> bytes:
    """A4 pages with a frame and a Latin label, drawn in a standard font."""
    writer = PdfWriter()
    font = DictionaryObject(
        {NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")}
    )
    for n in range(1, pages + 1):
        page = writer.add_blank_page(595, 842)
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
        stream = StreamObject()
        stream.set_data(f"4 w 72 72 451 698 re S BT /F1 40 Tf 110 420 Td (Fixture page {n} of {pages}) Tj ET".encode())
        page[NameObject("/Contents")] = writer._add_object(stream)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def write_fixtures() -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    (FIXTURES / "one-page.pdf").write_bytes(fixture(1))
    (FIXTURES / "three-pages.pdf").write_bytes(fixture(3))
    (FIXTURES / "corrupt.pdf").write_bytes(b"%PDF-1.7\nthis is not a PDF body\n%%EOF\n")
    print(f"{FIXTURES.relative_to(ROOT).as_posix()}: one-page.pdf, three-pages.pdf, corrupt.pdf")


def main() -> int:
    if "--fixtures" in sys.argv:
        write_fixtures()
    data, inputs, pages = build()
    verify(data, pages)
    OUT_PDF.parent.mkdir(parents=True, exist_ok=True)
    OUT_PDF.write_bytes(data)
    manifest = {
        "note": "Written by scripts/prepare-preview.py. The public preview of «خوص»: only these pages are published (E04 range, owner 2026-09-28).",
        "approval": {
            "by": "owner",
            "date": "2026-09-28",
            "words": "ANAS provide two or three PDF texts !! we only want to let users see these then had to buy the whole book to read",
        },
        "tool": f"pypdf {pypdf.__version__}",
        "inputs": inputs,
        "output": {
            "file": OUT_PDF.relative_to(ROOT).as_posix(),
            "url": "/book/khous-preview.pdf",
            "sha256": sha256(data),
            "bytes": len(data),
            "pages": len(pages),
        },
        "pages": pages,
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    texts = [page.extract_text() for page in PdfReader(io.BytesIO(data)).pages]
    PAGE_TEXT.write_text(json.dumps({"pages": texts}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"{OUT_PDF.relative_to(ROOT).as_posix()}: {len(pages)} pages, {len(data)} bytes, sha256 {sha256(data)[:16]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
