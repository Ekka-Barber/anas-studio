"""Reproduce public runtime research. No credentials or project content are sent."""
import concurrent.futures
import datetime
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
DOCS = {
    'cloudflare-next': 'https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/',
    'cloudflare-pricing': 'https://developers.cloudflare.com/workers/platform/pricing/',
    'cloudflare-r2-pricing': 'https://developers.cloudflare.com/r2/pricing/',
    'cloudflare-images': 'https://developers.cloudflare.com/images/pricing/',
    'cloudflare-turnstile': 'https://developers.cloudflare.com/turnstile/get-started/server-side-validation/',
    'cloudflare-analytics': 'https://developers.cloudflare.com/web-analytics/',
    'supabase-backups': 'https://supabase.com/docs/guides/platform/backups',
    'supabase-production': 'https://supabase.com/docs/guides/deployment/going-into-prod',
    'supabase-pricing': 'https://supabase.com/pricing',
    'vercel-hobby': 'https://vercel.com/docs/plans/hobby',
    'resend-pricing': 'https://resend.com/pricing',
    'resend-idempotency': 'https://resend.com/docs/dashboard/emails/idempotency-keys',
    'postmark-pricing': 'https://postmarkapp.com/pricing',
    'opennext': 'https://opennext.js.org/cloudflare',
    'sharp': 'https://sharp.pixelplumbing.com/',
    'turnstile-pricing': 'https://developers.cloudflare.com/turnstile/plans/',
}
PACKAGES = ['next', 'react', 'typescript', '@opennextjs/cloudflare', 'wrangler', 'sharp', 'resend', 'nodemailer', 'vitest', '@playwright/test', '@axe-core/playwright', '@lhci/cli', 'react-easy-crop', 'cropperjs', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner', 'motion', 'yet-another-react-lightbox']
REPOS = ['opennextjs/opennextjs-cloudflare', 'lovell/sharp', 'resend/resend-node', 'vitest-dev/vitest', 'microsoft/playwright', 'AOMediaCodec/libavif', 'ValentinH/react-easy-crop', 'fengyuanchen/cropperjs', 'igordaniel/yet-another-react-lightbox', 'motiondivision/motion']

class Text(HTMLParser):
    def __init__(self):
        super().__init__(); self.skip = 0; self.parts = []
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript'): self.skip += 1
        if tag in ('p', 'li', 'h1', 'h2', 'h3', 'tr', 'pre', 'section'): self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript'): self.skip = max(0, self.skip - 1)
    def handle_data(self, data):
        if not self.skip: self.parts.append(data)

def fetch(url):
    req = Request(url, headers={'User-Agent': 'ANASAQ-planning-research', 'Accept': 'application/json,text/html,text/plain'})
    with urlopen(req, timeout=35) as response:
        body = response.read()
        return body, response.status, response.url

def doc(item):
    name, url = item
    try:
        body, status, final = fetch(url)
        parser = Text(); parser.feed(body.decode('utf-8', errors='replace'))
        content = '\n'.join(line.strip() for line in ''.join(parser.parts).splitlines() if line.strip())
        meta = {'url': url, 'final_url': final, 'status': status, 'retrieved_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'sha256_response': hashlib.sha256(body).hexdigest()}
        (ROOT / f'runtime-{name}.txt').write_text(json.dumps(meta, ensure_ascii=False) + '\n\n' + content, encoding='utf-8')
        return name, status, len(body)
    except Exception as exc:
        (ROOT / f'runtime-{name}.txt').write_text(f'{url}\nFETCH FAILED: {exc}\n', encoding='utf-8')
        return name, str(exc)

def package(name):
    try:
        body, status, final = fetch('https://registry.npmjs.org/' + name.replace('/', '%2f'))
        data = json.loads(body); version = data['dist-tags']['latest']; selected = data['versions'][version]
        return {'name': name, 'version': version, 'published': data.get('time', {}).get(version), 'license': selected.get('license'), 'unpackedSize': selected.get('dist', {}).get('unpackedSize'), 'integrity': selected.get('dist', {}).get('integrity'), 'engines': selected.get('engines'), 'dependencies': selected.get('dependencies'), 'peerDependencies': selected.get('peerDependencies'), 'source': final, 'retrieved': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    except Exception as exc: return {'name': name, 'error': str(exc)}

def repo(name):
    try:
        body, _, final = fetch('https://api.github.com/repos/' + name)
        data = json.loads(body)
        return {key: data.get(key) for key in ['full_name', 'html_url', 'archived', 'pushed_at', 'updated_at', 'open_issues_count', 'license', 'default_branch']} | {'source': final}
    except Exception as exc: return {'repo': name, 'error': str(exc)}

if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for result in pool.map(doc, DOCS.items()): print(result)
        (ROOT / 'runtime-packages.json').write_text(json.dumps(list(pool.map(package, PACKAGES)), indent=2), encoding='utf-8')
        (ROOT / 'runtime-repositories.json').write_text(json.dumps(list(pool.map(repo, REPOS)), indent=2), encoding='utf-8')
