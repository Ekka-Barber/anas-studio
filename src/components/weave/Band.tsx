import type { HTMLAttributes, ReactNode } from 'react'

import styles from './band.module.css'
import { Edge } from './Edge'
import type { Tone } from './tones'

type Pad = 'none' | 'hero' | 'xs' | 's' | 'm' | 'l' | 'xl'

/**
 * A full-width band: the unit every page of direction B is woven from.
 *
 * `tone` sets its surface (and so the colours of everything in it), `edge`
 * draws a woven edge above it: `crenel` triangles in the band's own colour,
 * or the `weave` strip. `pad` is its block padding; the inline padding is
 * always the page gutter unless `bleed` is set.
 */
export function Band({
  as: Tag = 'section',
  tone,
  edge,
  pad = 'l',
  padEnd,
  bleed = false,
  className,
  children,
  ...rest
}: {
  as?: 'section' | 'div' | 'header' | 'article' | 'aside' | 'footer'
  tone: Tone
  edge?: 'crenel' | 'weave'
  pad?: Pad
  /** A different padding at the end, when the band's first line needs less air. */
  padEnd?: Pad
  bleed?: boolean
  className?: string
  children: ReactNode
} & Omit<HTMLAttributes<HTMLElement>, 'className' | 'children'>) {
  const classes = [styles.band, styles[`pad-${pad}`], styles[`end-${padEnd ?? pad}`], bleed ? '' : styles.gutter, className]
  return (
    <>
      {edge === 'crenel' && <Edge kind="crenel" color={tone} />}
      {edge === 'weave' && <Edge kind="weave" />}
      <Tag data-tone={tone} className={classes.filter(Boolean).join(' ')} {...rest}>
        {children}
      </Tag>
    </>
  )
}
