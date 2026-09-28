// Focus-ring probe used for FINDINGS.md rows 1 and 13 (run in the page; optional root selector).
// For every focusable element: the ring colour is the element's resolved --focus, drawn at its
// outline-offset (3px outside by default, or the element's own negative offset). The probe samples
// what actually sits under the ring on each side (elementFromPoint, first opaque background) and
// reports the WCAG ratio ring:background per side ("image" = photo or gradient, "offscreen" = the
// side falls outside the viewport and is not drawn).
(async (rootSel) => {
  const W = innerWidth, H = innerHeight
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 } } const h = s.trim().match(/^#([0-9a-f]{6})$/i); if (h) { const n = parseInt(h[1], 16); return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 } } return null }
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const bgAt = (x, y) => { if (x < 0 || x >= W || y < 0 || y >= H) return 'offscreen'; const el = document.elementFromPoint(x, y); if (!el) return 'none'; if (/IMG|VIDEO|PICTURE|CANVAS/.test(el.tagName)) return 'image'; for (let n = el; n; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.backgroundImage && cs.backgroundImage !== 'none') return 'image'; const c = parse(cs.backgroundColor); if (c && c.a > 0.5) return c } return parse(getComputedStyle(document.documentElement).backgroundColor) }
  const root = rootSel ? document.querySelector(rootSel) : document
  const out = []
  for (const el of root.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"])')) {
    if (el.closest('[hidden]') || (!rootSel && el.closest('dialog:not([open])'))) continue
    if (getComputedStyle(el).visibility === 'hidden' || el.tabIndex < 0) continue
    el.scrollIntoView({ block: 'center', inline: 'nearest' }); await new Promise((r) => setTimeout(r, 30))
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue
    const ring = parse(getComputedStyle(el).getPropertyValue('--focus')) || parse(getComputedStyle(document.documentElement).getPropertyValue('--aub'))
    const offRaw = parseFloat(getComputedStyle(el).outlineOffset) || 0; const off = offRaw !== 0 ? offRaw : 3; const d = off + 1.5
    const pts = { top: [r.left + r.width / 2, r.top - d], bottom: [r.left + r.width / 2, r.bottom + d], left: [r.left - d, r.top + r.height / 2], right: [r.right + d, r.top + r.height / 2] }
    const sides = {}; let ok = 0, bad = 0, gone = 0
    for (const [k, [x, y]] of Object.entries(pts)) { const bg = bgAt(x, y); if (typeof bg === 'string') { sides[k] = bg; if (bg === 'offscreen') gone++; continue } const cr = ratio(ring, bg); sides[k] = cr.toFixed(2); if (cr >= 3) ok++; else bad++ }
    if (bad > 0 || gone > 0) out.push({ text: (el.getAttribute('aria-label') || el.innerText || '').replace(/\s+/g, ' ').slice(0, 24), ring: getComputedStyle(el).getPropertyValue('--focus').trim(), sides, ok, bad, gone })
  }
  return JSON.stringify(out)
})
