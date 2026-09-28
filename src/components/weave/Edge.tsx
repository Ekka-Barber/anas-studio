import styles from './edge.module.css'
import type { EdgeColor } from './tones'

/**
 * The woven edges between bands, B's signature (DESIGN.md "Edges").
 *
 * - `crenel`: a row of triangles in the colour of the band that follows,
 *   standing on it like the Najdi triangles on Anas's ذرى card. `on` fills
 *   the gaps with a second colour instead of letting the page show through.
 * - `weave`: the 28px strip of palm-weave squares in all four colours.
 *
 * Always decorative: hidden from assistive technology.
 */
export function Edge(
  props:
    | { kind: 'crenel'; color: EdgeColor; on?: EdgeColor; size?: 'sm' | 'md' | 'lg' }
    | { kind: 'weave' },
) {
  if (props.kind === 'weave') return <div aria-hidden="true" className={styles.weave} />
  const { color, on, size = 'md' } = props
  return (
    <div
      aria-hidden="true"
      className={`${styles.crenel} ${styles[size]}`}
      data-color={color}
      data-on={on}
    />
  )
}
