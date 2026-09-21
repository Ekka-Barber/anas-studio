"""Public package, license and advisory evidence for the planning decision log."""
import importlib.util
import json
from pathlib import Path
from urllib.request import Request, urlopen
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('research', ROOT / 'collect-runtime.py')
research = importlib.util.module_from_spec(spec)
spec.loader.exec_module(research)
names = ['react-dom', '@types/react', '@types/react-dom', '@types/node', 'eslint', 'eslint-config-next', 'supabase', 'pdfjs-dist', 'page-flip', 'react-pageflip', 'three', '@react-three/fiber', 'ics', 'ical.js', '@medusajs/medusa', '@payloadcms/plugin-ecommerce', '@tiptap/extension-image', '@tiptap/extension-link', '@tiptap/extension-text-align', 'sanitize-html', '@types/sanitize-html', '@radix-ui/react-direction', 'tsx', 'pg', 'jose']
repos = ['Nodlik/StPageFlip', 'Nodlik/react-pageflip', 'mozilla/pdf.js', 'mrdoob/three.js', 'pmndrs/react-three-fiber', 'adamgibbons/ics', 'kewisch/ical.js', 'medusajs/medusa', 'saleor/saleor', 'calcom/cal.com', 'vercel/next.js', 'cloudflare/vinext']
with ThreadPoolExecutor(max_workers=6) as pool:
    packages = list(pool.map(research.package, names))
    (ROOT / 'additional-packages.json').write_text(json.dumps(packages, indent=2), encoding='utf-8')
    (ROOT / 'additional-repositories.json').write_text(json.dumps(list(pool.map(research.repo, repos)), indent=2), encoding='utf-8')
    docs = {
        'image-crop': 'https://raw.githubusercontent.com/ValentinH/react-easy-crop/main/README.md',
        'lightbox': 'https://yet-another-react-lightbox.com/documentation',
        'ics': 'https://raw.githubusercontent.com/adamgibbons/ics/master/README.md',
        'pg-rls': 'https://www.postgresql.org/docs/current/ddl-rowsecurity.html',
        'pg-ranges': 'https://www.postgresql.org/docs/current/rangetypes.html',
        'sharp-security': 'https://raw.githubusercontent.com/lovell/sharp/main/SECURITY.md',
    }
    list(pool.map(research.doc, docs.items()))

all_packages = packages + json.loads((ROOT / 'runtime-packages.json').read_text(encoding='utf-8'))
platform = json.loads((ROOT / 'platform-npm.json').read_text(encoding='utf-8'))
all_packages += [{'name': p['package'], 'version': p['version']} for p in platform if 'version' in p]
queries = [{'package': {'name': p['name'], 'ecosystem': 'npm'}, 'version': p['version']} for p in all_packages if 'version' in p]
try:
    req = Request('https://api.osv.dev/v1/querybatch', data=json.dumps({'queries': queries}).encode(), headers={'Content-Type': 'application/json', 'User-Agent': 'ANASAQ-planning-research'})
    with urlopen(req, timeout=60) as response: result = json.load(response)
    report = [{'package': q['package']['name'], 'version': q['version'], 'vulns': r.get('vulns', [])} for q, r in zip(queries, result['results'])]
except Exception as exc: report = {'status': 'unavailable', 'error': str(exc), 'queries': queries}
(ROOT / 'advisories.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print('Additional package, repository, documentation and advisory evidence saved.')
