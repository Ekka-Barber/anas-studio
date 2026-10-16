// A static server for the P12 design comp: the comp's own files, and the repository's fonts, brand marks and tokens.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const repo = join(here, '../../../..')
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }

function resolve(path) {
  if (path.startsWith('/fonts/') || path.startsWith('/brand/')) return join(repo, 'public', path)
  if (path === '/tokens.css') return join(repo, 'src/styles/tokens.css')
  return join(here, path === '/' ? 'index.html' : path)
}

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/\\/g, '/')
  if (path.includes('..')) return res.writeHead(400).end()
  try {
    const file = resolve(path)
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(await readFile(file))
  } catch {
    res.writeHead(404).end()
  }
}).listen(4317, '127.0.0.1', () => console.log('comp on http://127.0.0.1:4317'))
