"""Read-only source inventory; output is planning evidence, never a public asset."""
from pathlib import Path
import hashlib
import json
import sys
from pypdf import PdfReader

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
frozen = []
for directory in ['deploy', 'offer-site-v3', 'BOOK_ASSETS', 'Lyon_Arabic_FONT', 'Thmanyah-Font-Family']:
    for path in sorted((ROOT / directory).rglob('*')):
        if path.is_file():
            frozen.append({'path': path.relative_to(ROOT).as_posix(), 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
for name in ['PROMPT-FOR-ASTRA.md', 'AGENTS.md', 'anasaq-me-prd-v1.md', 'anasaq-me-full-package.md']:
    path = ROOT / name
    frozen.append({'path': name, 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
(OUT / 'source-manifest.json').write_text(json.dumps(frozen, ensure_ascii=False, indent=2), encoding='utf-8')
pdfs = []
for path in sorted((ROOT / 'BOOK_ASSETS').rglob('*.pdf')):
    try:
        reader = PdfReader(path)
        text = (reader.pages[0].extract_text() or '') if reader.pages else ''
        item = {'path': path.relative_to(ROOT).as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'pages': len(reader.pages), 'first_page_size_points': list(reader.pages[0].mediabox) if reader.pages else [], 'first_page_excerpt': text[:500], 'encrypted': reader.is_encrypted}
    except Exception as exc: item = {'path': path.relative_to(ROOT).as_posix(), 'error': str(exc)}
    pdfs.append(item)
(OUT / 'book-pdf-inventory.json').write_text(json.dumps(pdfs, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
for item in pdfs: print(item['path'], item.get('pages'), item.get('first_page_excerpt', '')[:120].replace('\n', ' '))
print('Frozen files:', len(frozen))
