import type { CSSProperties } from 'react'

/**
 * Scroll reveals for direction B (see src/styles/motion.css for the rules).
 *
 * An element marked `data-reveal` is visible in the HTML. When motion is
 * allowed, `mountReveals` holds only the ones still below the fold in their
 * starting state and plays each once as it scrolls in. It never touches an
 * element already on screen, and printing releases every hold, so nothing can
 * stay hidden.
 */
export type Fx = 'rise' | 'band' | 'fade' | 'media' | 'sign' | 'grow'

const EASE_OUT = 'cubic-bezier(.2,.7,.1,1)'
const EASE_WEAVE = 'cubic-bezier(.77,0,.18,1)'
const EASE_SIGN = 'cubic-bezier(.65,0,.35,1)'

const FROM: Record<Fx | 'pop', Keyframe> = {
  rise: { opacity: 0, transform: 'translateY(32px)' },
  band: { clipPath: 'inset(0 0 0 100%)' },
  fade: { opacity: 0 },
  media: { clipPath: 'inset(100% 0 0 0)' },
  sign: { clipPath: 'inset(0 100% 0 0)' },
  grow: { transform: 'scaleX(0)' },
  pop: { opacity: 0, transform: 'translateY(24px) scale(.95)' },
}
const TO: Record<Fx | 'pop', Keyframe> = {
  rise: { opacity: 1, transform: 'none' },
  band: { clipPath: 'inset(0 0 0 0)' },
  fade: { opacity: 1 },
  media: { clipPath: 'inset(0 0 0 0)' },
  sign: { clipPath: 'inset(0 0 0 0)' },
  grow: { transform: 'scaleX(1)' },
  pop: { opacity: 1, transform: 'none' },
}
const DURATION: Record<Fx | 'pop', number> = { rise: 850, band: 900, fade: 900, media: 1100, sign: 1800, grow: 1100, pop: 560 }
// Clipped effects start fully hidden, so the observer watches their parent:
// an element clipped to nothing has no visible area to intersect.
const CLIPPED = new Set<Fx>(['band', 'media', 'sign', 'grow'])

/** Props for an entrance on page load (CSS only; see motion.css). */
export function enter(delayMs: number, fx?: Fx): Record<string, unknown> & { style: CSSProperties } {
  return {
    'data-enter': '',
    ...(fx ? { 'data-fx': fx } : {}),
    style: { '--enter-delay': `${delayMs}ms` } as CSSProperties,
  }
}

/** The one entrance a calm page (cart, checkout, a policy) has: its title fades in, briefly. */
export const calmEnter = {
  'data-enter': '',
  'data-fx': 'fade',
  style: { '--enter-dur': 'var(--dur-ui)' } as CSSProperties,
}

export function motionAllowed(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof document.body.animate === 'function' &&
    'IntersectionObserver' in window &&
    window.matchMedia('(prefers-reduced-motion: no-preference)').matches &&
    !/[?&](still|frame)=1/.test(window.location.search)
  )
}

function fxOf(el: HTMLElement): Fx {
  const fx = el.dataset.fx as Fx | undefined
  return fx && fx in FROM ? fx : 'rise'
}

function targets(el: HTMLElement): HTMLElement[] {
  return el.hasAttribute('data-seq') ? (Array.from(el.children) as HTMLElement[]) : [el]
}

const holds = new WeakMap<HTMLElement, Animation>()

function hold(el: HTMLElement) {
  const kind = el.hasAttribute('data-seq') ? 'pop' : fxOf(el)
  for (const target of targets(el)) holds.set(target, target.animate([FROM[kind]], { duration: 1, fill: 'forwards' }))
}

function release(el: HTMLElement) {
  for (const target of targets(el)) {
    holds.get(target)?.cancel()
    holds.delete(target)
  }
}

function play(el: HTMLElement) {
  release(el)
  const delay = Number(el.dataset.delay ?? 0)
  if (el.hasAttribute('data-seq')) {
    targets(el).forEach((child, i) =>
      child.animate([FROM.pop, TO.pop], { duration: DURATION.pop, delay: delay + i * 130, easing: EASE_OUT, fill: 'backwards' }),
    )
    return
  }
  const fx = fxOf(el)
  const easing = fx === 'sign' ? EASE_SIGN : fx === 'rise' || fx === 'fade' ? EASE_OUT : EASE_WEAVE
  el.animate([FROM[fx], TO[fx]], { duration: DURATION[fx], delay, easing, fill: 'backwards' })
}

/**
 * Starts the reveals under `root`. Returns a cleanup that releases every
 * hold, for route changes and unmount. Safe to call again on the same root:
 * an element already handled is skipped.
 */
export function mountReveals(root: ParentNode): () => void {
  if (!motionAllowed()) return () => {}
  const seen = new WeakSet<Element>()
  const pending = new Map<Element, HTMLElement[]>()
  const held: HTMLElement[] = []
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        observer.unobserve(entry.target)
        for (const el of pending.get(entry.target) ?? []) play(el)
        pending.delete(entry.target)
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0 },
  )

  function scan() {
    const fold = window.innerHeight * 0.92
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'))) {
      if (seen.has(el)) continue
      seen.add(el)
      if (el.getBoundingClientRect().top < fold) continue
      const watched = (CLIPPED.has(fxOf(el)) || el.hasAttribute('data-seq')) && el.parentElement ? el.parentElement : el
      hold(el)
      held.push(el)
      if (!pending.has(watched)) {
        pending.set(watched, [])
        observer.observe(watched)
      }
      pending.get(watched)!.push(el)
    }
  }

  const releaseAll = () => held.forEach(release)
  window.addEventListener('beforeprint', releaseAll)
  scan()
  // Content rendered later (a filtered grid, a lightbox) is picked up too.
  const mutations = new MutationObserver(scan)
  mutations.observe(root, { childList: true, subtree: true })

  return () => {
    observer.disconnect()
    mutations.disconnect()
    window.removeEventListener('beforeprint', releaseAll)
    releaseAll()
  }
}
