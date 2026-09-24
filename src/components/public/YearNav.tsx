'use client'

import { useEffect, useRef, useState } from 'react'

import styles from './public.module.css'

/**
 * The frozen Khous sub-nav (deploy/design/كُتبت هنا) reused as a room's year
 * index: sticky under the header, the year being read marked as you scroll,
 * and the frozen brass reading bar along the top edge. Without JS the links
 * are plain in-page anchors.
 */
export function YearNav({ years }: { years: string[] }) {
  const [active, setActive] = useState(0)
  const [progress, setProgress] = useState(0)
  const nav = useRef<HTMLElement>(null)

  useEffect(() => {
    const sections = years.map((_, i) => document.getElementById(`year-${i}`))
    let frame = 0
    const update = () => {
      frame = 0
      // Stick flush under the site header, whose height differs by breakpoint.
      const header = document.querySelector('header')
      if (header && nav.current) nav.current.style.top = `${header.offsetHeight}px`
      let current = 0
      sections.forEach((section, i) => {
        if (section && section.getBoundingClientRect().top <= innerHeight * 0.35) current = i
      })
      setActive(current)
      const max = document.documentElement.scrollHeight - innerHeight
      setProgress(max > 0 ? scrollY / max : 0)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    schedule()
    addEventListener('scroll', schedule, { passive: true })
    addEventListener('resize', schedule)
    return () => {
      removeEventListener('scroll', schedule)
      removeEventListener('resize', schedule)
      cancelAnimationFrame(frame)
    }
  }, [years])

  return (
    <>
      <div className={styles.readingBar} style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
      <nav ref={nav} className={styles.yearNav} aria-label="سنوات الغرفة">
        <ol>
          {years.map((year, i) => (
            <li key={year}>
              <a href={`#year-${i}`} aria-current={i === active ? 'true' : undefined}>
                {year}
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </>
  )
}
