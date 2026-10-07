// Static server for the Next export, with Cloudflare Pages' clean-URL rule
// (`/store` -> `store.html`) and `404.html` for unknown paths. Audit use only.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const root = process.argv[2]
const port = Number(process.argv[3] ?? 4173)
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.pdf': 'application/pdf',
  '.ico': 'image/x-icon', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.xml': 'application/xml',
}
const isFile = async (path) => (await stat(path).catch(() => null))?.isFile() ?? false

createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname)).replace(/^([/\\])+/, '')
  if (path.includes('..')) return response.writeHead(400).end()
  const base = join(root, path)
  const candidates = path === '' ? [join(root, 'index.html')] : [base, `${base.replace(/[/\\]$/, '')}.html`, join(base, 'index.html')]
  for (const file of candidates) {
    if (await isFile(file)) {
      response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
      return response.end(await readFile(file))
    }
  }
  response.writeHead(404, { 'content-type': types['.html'] })
  response.end(await readFile(join(root, '404.html')).catch(() => 'not found'))
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}`))
