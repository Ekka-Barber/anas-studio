import type { ReactNode } from 'react'

import { Band } from '@/components/weave/Band'
import { Edge } from '@/components/weave/Edge'
import { Lines } from '@/components/weave/Lines'
import { enter } from '@/components/weave/motion'
import type { Tone } from '@/components/weave/tones'

import styles from './room-hero.module.css'

/**
 * A page's opening band: triangles in its colour, the title at poster size,
 * the room's line under it, then the weave. `aside` sits at the end of the
 * band on wide screens (the رحى logo in بنيتُ هنا).
 */
export function RoomHero({
  tone,
  title,
  tagline,
  aside,
  children,
}: {
  tone: Tone
  title: string
  tagline?: string
  aside?: ReactNode
  children?: ReactNode
}) {
  const dark = tone === 'aub' || tone === 'night' || tone === 'deep'
  return (
    <>
      <Band as="header" tone={tone} edge="crenel" pad="hero" padEnd="l" className={styles.hero}>
        <div className={styles.text}>
          <h1 className={`t-title ${styles.title}`} {...enter(80, 'band')}>
            {title}
          </h1>
          {tagline && (
            <p className={`t-lead ${styles.tagline} ${dark ? 't-accent' : ''}`} {...enter(360)}>
              <Lines text={tagline} />
            </p>
          )}
          {children}
        </div>
        {aside}
      </Band>
      <Edge kind="weave" />
    </>
  )
}
