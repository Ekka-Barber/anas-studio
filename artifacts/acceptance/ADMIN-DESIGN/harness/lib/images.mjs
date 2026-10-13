// Finds the repository's own photos (public/images) and reads their sizes,
// so the media library, product covers and the storage mock use real pictures.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'

function webpSize(buf) {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null
  const type = buf.toString('ascii', 12, 16)
  if (type === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
  if (type === 'VP8L') {
    const bits = buf.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (type === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
  return null
}

function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buf[offset + 1]
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) }
    }
    offset += 2 + buf.readUInt16BE(offset + 2)
  }
  return null
}

function pngSize(buf) {
  return buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG' ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : null
}

function sizeOf(file) {
  const buf = readFileSync(file)
  return webpSize(buf) ?? jpegSize(buf) ?? pngSize(buf)
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name)
    const info = statSync(abs)
    if (info.isDirectory()) walk(abs, out)
    else if (/\.(webp|jpe?g|png)$/i.test(name)) out.push(abs)
  }
  return out
}

/** Every photo under `<site>/public/images`, with its folder, family (stem without the size suffix), bytes and pixels. */
export function scanImages(siteDir) {
  const root = path.join(siteDir, 'public', 'images')
  if (!existsSync(root)) return []
  const images = []
  for (const abs of walk(root).sort()) {
    const rel = path.relative(root, abs).split(path.sep).join('/')
    const size = sizeOf(abs)
    if (!size || !size.width || !size.height) continue
    const stem = path.basename(abs).replace(/\.[^.]+$/, '')
    images.push({
      abs,
      rel,
      dir: rel.includes('/') ? rel.split('/')[0] : '',
      stem,
      family: stem.replace(/-\d{3,4}$/, ''),
      bytes: statSync(abs).size,
      width: size.width,
      height: size.height,
    })
  }
  return images
}

/**
 * Groups the photos by `dir/family` and picks, for each group, the file the
 * storage mock serves (the smallest at 700px or wider, else the widest) and the
 * widest file as the "original".
 */
export function groupImages(images) {
  const groups = new Map()
  for (const image of images) {
    const key = `${image.dir}/${image.family}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(image)
  }
  const result = []
  for (const [key, variants] of groups) {
    variants.sort((a, b) => a.width - b.width)
    const original = variants[variants.length - 1]
    const served = variants.find((variant) => variant.width >= 700) ?? original
    result.push({ key, dir: variants[0].dir, family: variants[0].family, served, original })
  }
  return result
}
