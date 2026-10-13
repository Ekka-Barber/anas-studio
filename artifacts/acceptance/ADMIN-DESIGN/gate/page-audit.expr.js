(function pageAudit({ width, motion }) {
  // Supported: Arabic and Persian (reported as "arabic", the script) and English (latin).
  const R = { arabic: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/ }
  const FLOOR = { arabic: [1.6, 1.25], latin: [1.35, 1.0] }
  const findings = []
  const agg = new Map()
  const add = (id, severity, message, el, extra = {}) => {
    const k = `${id}|${message}`
    const p = agg.get(k)
    if (p) { p.count++; if (p.samples.length < 3 && el) p.samples.push(sel(el)); return }
    agg.set(k, { id, severity, message, count: 1, samples: el ? [sel(el)] : [], ...extra })
  }
  const sel = (el) => {
    const parts = []
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 3; n = n.parentElement, i++) {
      let s = n.tagName.toLowerCase()
      if (n.id) { s += '#' + n.id; parts.unshift(s); break }
      const c = [...n.classList].find((x) => !/^(css|jsx|sc)-|__/.test(x)) || n.classList[0]
      if (c) s += '.' + c
      parts.unshift(s)
    }
    return parts.join(' > ')
  }
  const scriptOf = (t) => { for (const [k, re] of Object.entries(R)) if (re.test(t)) return k; return 'latin' }
  const parseRGBA = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 } }
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
  const blend = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 })
  const ratio = (f, b) => { const L1 = lum(f), L2 = lum(b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05) }
  const bgOf = (el) => {
    const layers = []
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return { unknown: true }
      const c = parseRGBA(cs.backgroundColor)
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 }
    for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base)
    return base
  }

  const html = document.documentElement
  const lang = html.getAttribute('lang')
  const dir = html.getAttribute('dir') || getComputedStyle(html).direction
  if (!lang) add('QA-04', 'P0', '<html> has no lang', html)

  const scripts = new Set()
  const fonts = {}
  const digits = { western: 0, arabic: 0 }
  let rtlText = 0, allText = 0, fontMarks = 0
  const textEls = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.trim()
    if (!t) continue
    const el = n.parentElement
    if (!el || seen.has(el) || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue
    seen.add(el)
    textEls.push(el)
  }
  for (const el of textEls) {
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    if (el.closest('[aria-hidden="true"]')) continue
    const own = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.nodeValue).join(' ').replace(/\s+/g, ' ').trim()
    if (!own) continue
    const script = scriptOf(own)
    scripts.add(script)
    allText += own.length
    if (script === 'arabic') rtlText += own.length
    if (/[0-9]/.test(own)) digits.western++
    if (/[\u0660-\u0669\u06F0-\u06F9]/.test(own)) digits.arabic++
    const fs = parseFloat(cs.fontSize)
    const lh = cs.lineHeight === 'normal' ? null : parseFloat(cs.lineHeight) / fs
    const ls = cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing) / fs
    const role = /^H[1-6]$/.test(el.tagName) ? 'heading' : 'text'
    const fam = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '')
    fonts[`${script}:${role}`] = fonts[`${script}:${role}`] || fam
    if (fontMarks < 60 && own.length > 2 && !el.hasAttribute('data-tsm-font')) { el.setAttribute('data-tsm-font', `${script}|${cs.fontFamily}|${sel(el)}`); fontMarks++ }

    const joined = script === 'arabic'
    if (joined && Math.abs(ls) > 0.001) add('SC-01', 'P0', `letter-spacing on ${script} text`, el)
    if (script !== 'latin' && /italic|oblique/.test(cs.fontStyle)) add('SC-02', 'P1', `italic on ${script} text`, el)
    if (script !== 'latin' && cs.textTransform !== 'none' && /uppercase|capitalize/.test(cs.textTransform)) add('SC-08', 'P2', `text-transform on ${script} text`, el)
    const lines = lh ? rect.height / (lh * fs) : 1
    if (lh) {
      const display = fs >= 28
      const floor = FLOOR[script] ? FLOOR[script][display ? 1 : 0] : 1.35
      if (lh + 0.001 < floor && (lines >= 1.8 || own.length > 80)) add(script === 'latin' ? 'TY-12' : 'SC-03', display ? 'P1' : 'P0', `${script} ${display ? 'display' : 'body'} line-height ${lh.toFixed(2)} (< ${floor})`, el)
    }
    if (fs < 20 && /^(kufam|reem kufi( fun| ink)?|lemonada|aref ruqaa( ink)?|rakkas|jomhuria|lalezar|katibeh|mirza|blaka( hollow| ink)?|marhey|qahiri|ruwudu|badeen display|oi|vibes|handjet|[\w -]*\bdisplay\b[\w -]*)$/i.test(fam)) add('TY-24', 'P1', `display face "${fam}" at ${fs}px`, el)
    if (own.length > 80 && fs < 16 && width <= 480) add('TY-13', 'P1', `body text ${fs}px on a phone`, el)
    if (fs < 12) add('TY-13', 'P1', `text ${fs}px`, el)
    if (script === 'latin' && own.length > 60 && ls > 0.05) add('TY-10', 'P1', 'wide tracking on body text', el)
    if (own.length > 60 && cs.textTransform === 'uppercase') add('TY-11', 'P1', 'uppercase running text', el)
    if (/text/.test(cs.webkitBackgroundClip || cs.backgroundClip) && /gradient/.test(cs.backgroundImage)) add('CO-05', 'P0', 'gradient text', el)
    if (/overflow|hidden|clip/.test(cs.overflow + cs.overflowY) && /hidden|clip/.test(cs.overflowY || cs.overflow) && el.scrollHeight > el.clientHeight + 2 && script !== 'latin') add('SC-15', 'P1', `${script} marks clipped by overflow`, el)
    if (own.length > 200 && script === 'latin' && rect.width / (fs * 0.5) > 95) add('TY-15', 'P2', 'line length over ~90 characters', el)

    // Contrast on the rendered background.
    const fg = parseRGBA(cs.color)
    const bg = bgOf(el)
    if (fg && !bg.unknown) {
      const weight = parseInt(cs.fontWeight) || 400
      const large = fs >= 24 || (fs >= 18.66 && weight >= 700)
      const r = ratio(fg.a < 1 ? blend(fg, bg) : fg, bg)
      const need = large ? 3 : 4.5
      if (r < need) add('QA-01', 'P0', `contrast ${r.toFixed(2)}:1 < ${need}:1`, el)
    }
  }
  if (rtlText > allText * 0.3 && dir !== 'rtl') add('SC-05', 'P1', 'mostly RTL text but the page is not dir="rtl"', html)
  if (digits.western && digits.arabic) add('SC-07', 'P1', `both digit systems visible (${digits.western} vs ${digits.arabic} elements)`, null)

  // Interactive elements.
  for (const el of document.querySelectorAll('a[href], button, [role="button"], input:not([type=hidden]), select, textarea, summary')) {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden') continue
    const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim() || [...el.querySelectorAll('img[alt]')].map((i) => i.alt).join('')
    if (/^(A|BUTTON)$/.test(el.tagName) && !name && !el.getAttribute('aria-labelledby')) add('QA-11', 'P0', `${el.tagName.toLowerCase()} without an accessible name`, el)
    const inlineLink = el.tagName === 'A' && cs.display === 'inline' && el.closest('p, li, dd, td, blockquote')
    if (!inlineLink && (r.width < 44 || r.height < 44) && !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) add('QA-05', 'P1', 'target smaller than 44×44', el)
    if (/^(A|BUTTON)$/.test(el.tagName) && cs.display !== 'inline' && name.split(/\s+/).length > 1) {
      const lh = cs.lineHeight === 'normal' ? parseFloat(cs.fontSize) * 1.3 : parseFloat(cs.lineHeight)
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
      if (r.height - pad > lh * 1.7 && r.width < 400) add('LA-22', 'P1', 'control label wraps to two lines', el)
    }
  }
  // Headings.
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((h) => h.getBoundingClientRect().height > 0)
  const h1 = hs.filter((h) => h.tagName === 'H1').length
  if (h1 !== 1) add('QA-03', 'P1', `${h1} visible <h1>`, null)
  for (let i = 1; i < hs.length; i++) { const a = +hs[i - 1].tagName[1], b = +hs[i].tagName[1]; if (b > a + 1) { add('QA-03', 'P2', `heading jumps h${a} → h${b}`, hs[i]); break } }
  // Images.
  for (const img of document.images) {
    if (!img.hasAttribute('alt')) add('IG-05', 'P0', '<img> without alt', img)
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) add('IG-04', 'P0', 'broken image', img)
  }
  // Overflow.
  const docW = document.documentElement.scrollWidth
  if (docW > innerWidth + 1) {
    const offenders = [...document.body.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1) }).slice(-3)
    add('LA-14', 'P0', `page scrolls sideways (${docW}px > ${innerWidth}px)`, offenders[0] || null, { evidence: offenders.map(sel).join(' | ') })
  }
  // Motion: anything still hidden or held after the scroll.
  if (motion) {
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height || el.closest('[aria-hidden="true"], dialog:not([open]), [hidden]')) continue
      const cs = getComputedStyle(el)
      if (parseFloat(cs.opacity) < 0.99 && cs.visibility !== 'hidden' && el.textContent.trim().length > 20 && !el.closest('[inert]')) add('MO-06', 'P0', 'content still transparent after scrolling the whole page', el)
    }
    for (const a of document.getAnimations()) {
      if (a.playState === 'paused' && a.effect && a.effect.target && a.effect.getComputedTiming().progress === 0) add('MO-06', 'P0', 'animation held at its first frame after scrolling', a.effect.target)
    }
  }
  for (const f of agg.values()) findings.push({ id: f.id, severity: f.severity, message: f.message, count: f.count, evidence: f.evidence || f.samples.join(' | ') })
  return { findings, scripts: [...scripts], fonts, lang, dir }
})({ width: window.innerWidth, motion: false })