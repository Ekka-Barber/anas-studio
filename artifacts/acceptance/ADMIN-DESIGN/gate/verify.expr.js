// The admin shell's own checks, run in a settled page by the harness's --eval (after the D49 audit, AD-A1 to AD-A7):
// the page and table boxes, the rail (no sideways scroll, its height against the viewport, the current page's tab over
// the weave, a link that is not current leaving the weave visible), the strip below 1280px (its fade flags, the current
// link in view), every nav control's focus ring inside the box that clips it and clear of a fade, and the shell's gate.
(async () => {
  const R = (el) => el.getBoundingClientRect()
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const out = { w: innerWidth, h: innerHeight, pageOverflow: document.documentElement.scrollWidth - innerWidth }
  out.tableScroll = [...document.querySelectorAll('main [class*="tableWrap"]')].map((wrap) => wrap.scrollWidth - wrap.clientWidth)
  const gate = document.querySelector('[class*="gate"]')
  if (gate) {
    const b = R(gate)
    const button = gate.querySelector('button')
    out.gate = { width: Math.round(b.width), height: Math.round(b.height), buttonLines: button ? Math.round(R(button).height / parseFloat(getComputedStyle(button).lineHeight)) : null }
  }
  const nav = document.querySelector('nav[aria-label="لوحة التحكم"]')
  const header = document.querySelector('header')
  if (!nav || !header) return out
  const inner = header.firstElementChild
  const wide = innerWidth >= 1280
  const current = nav.querySelector('[aria-current="page"]')
  out.rail = {
    sideways: inner.scrollWidth - inner.clientWidth,
    scrollbarX: inner.offsetHeight - inner.clientHeight - parseFloat(getComputedStyle(inner).borderTopWidth) - parseFloat(getComputedStyle(inner).borderBottomWidth),
    tallBy: wide ? inner.scrollHeight - inner.clientHeight : null,
    stripMore: wide ? null : [nav.hasAttribute('data-more-start'), nav.hasAttribute('data-more-end')],
  }
  if (current) {
    const b = R(current)
    if (wide) {
      // The weave is the inner box's last 28px at its inline end (the left, in RTL).
      const x = Math.round(R(inner).left + 14)
      const hit = document.elementFromPoint(x, Math.round(b.top + b.height / 2))
      out.rail.tabOverWeave = Boolean(hit && (hit === current || current.contains(hit)))
      const other = [...nav.querySelectorAll('a')].find((a) => a !== current)
      if (other) {
        const o = R(other)
        const hit2 = document.elementFromPoint(x, Math.round(o.top + o.height / 2))
        out.rail.weaveBesideOther = !(hit2 && hit2.closest('a'))
      }
    } else {
      const strip = R(nav)
      out.rail.currentInStrip = b.left >= strip.left - 1 && b.right <= strip.right + 1
    }
  }
  // Focus rings: every control of the nav focused in turn, as the keyboard reaches it (the strip brings it into view);
  // its ring must lie inside the box that clips it (the strip below 1280px, the rail's inner box above), and in the
  // strip clear of a fade. A scripted focus after a screen the harness set up with a click is not :focus-visible: it
  // draws no ring and, like a press, does not move the strip (the final audit's AD-F1), so it is counted apart.
  const ring = async (el) => {
    el.focus()
    await frame()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const cs = getComputedStyle(el)
    const reach = parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth)
    const b = R(el)
    const box = R(wide ? inner : nav)
    const grow = Math.max(0, reach)
    const inside = b.left - grow >= box.left - 0.5 && b.right + grow <= box.right + 0.5 && b.top - grow >= box.top - 0.5 && b.bottom + grow <= box.bottom + 0.5
    const faded = !wide && ((nav.hasAttribute('data-more-end') && b.left < box.left + 40) || (nav.hasAttribute('data-more-start') && b.right > box.right - 40))
    return { control: el.textContent.trim(), focusVisible: el.matches(':focus-visible'), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} offset ${cs.outlineOffset}`, inside, faded }
  }
  const results = []
  for (const control of nav.querySelectorAll('a, button')) results.push(await ring(control))
  const drawn = results.filter((r) => r.focusVisible)
  out.rings = { count: results.length, notFocusVisible: results.length - drawn.length, outside: drawn.filter((r) => !r.inside).map((r) => r.control), faded: drawn.filter((r) => r.faded).map((r) => r.control), colours: [...new Set(drawn.map((r) => r.outline))] }
  document.activeElement?.blur()
  return out
})()
