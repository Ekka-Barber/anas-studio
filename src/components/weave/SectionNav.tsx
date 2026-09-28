'use client'

import { useEffect, useRef, useState } from 'react'

import styles from './section-nav.module.css'

/**
 * A page's own contents, stuck under the site header: B's aubergine strip
 * with a coral triangle on the section you are reading. The current section
 * is the last one whose top has passed a line 40% down the screen, worked out
 * when a section crosses that line (an IntersectionObserver) and when a
 * scroll ends (a jump can skip the line); never on every scroll frame.
 * Every link keeps room for the triangle, so the labels never move; on a
 * narrow screen the strip scrolls sideways to keep the current link in view,
 * and fades at an end that has more links past it.
 * Plain in-page links, so it works without JavaScript.
 */
export function SectionNav({ label, sections }: { label: string; sections: ReadonlyArray<{ id: string; label: string }> }) {
  const [active, setActive] = useState(sections[0]?.id)
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const targets = sections.map((section) => document.getElementById(section.id)).filter((el): el is HTMLElement => el !== null)
    const update = () => {
      const line = window.innerHeight * 0.4
      let current = sections[0]?.id
      for (const target of targets) if (target.getBoundingClientRect().top <= line) current = target.id
      setActive(current)
    }
    const observer = new IntersectionObserver(update, { rootMargin: '-40% 0px -59% 0px' })
    targets.forEach((target) => observer.observe(target))
    window.addEventListener('scrollend', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('scrollend', update)
    }
  }, [sections])

  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const mark = () => {
      // In RTL scrollLeft runs from 0 (the start) down to minus the overflow.
      const moved = Math.abs(nav.scrollLeft)
      nav.toggleAttribute('data-more-start', moved > 1)
      nav.toggleAttribute('data-more-end', moved < nav.scrollWidth - nav.clientWidth - 1)
    }
    // The list resizes when the fonts arrive and when the window does.
    const sizes = new ResizeObserver(mark)
    sizes.observe(nav)
    if (nav.firstElementChild) sizes.observe(nav.firstElementChild)
    nav.addEventListener('scroll', mark, { passive: true })
    return () => {
      sizes.disconnect()
      nav.removeEventListener('scroll', mark)
    }
  }, [])

  // Only the strip scrolls here, never the page.
  useEffect(() => {
    const nav = navRef.current
    const link = nav?.querySelector<HTMLElement>('[aria-current]')
    if (!nav || !link) return
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    // The first section takes the strip back to its start.
    if (link.closest('li')?.previousElementSibling === null) {
      nav.scrollTo({ left: 0, behavior })
      return
    }
    const strip = nav.getBoundingClientRect()
    const box = link.getBoundingClientRect()
    const room = 56 // clear of the 48px fade
    const delta = box.left < strip.left + room ? box.left - strip.left - room : box.right > strip.right - room ? box.right - strip.right + room : 0
    if (delta !== 0) nav.scrollBy({ left: delta, behavior })
  }, [active])

  return (
    <div data-tone="aub" className={styles.bar}>
      <nav ref={navRef} aria-label={label} className={styles.scroller}>
        <ul className={styles.list}>
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} aria-current={active === section.id ? 'true' : undefined} className={styles.link}>
                <span aria-hidden="true" className={styles.here} />
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
