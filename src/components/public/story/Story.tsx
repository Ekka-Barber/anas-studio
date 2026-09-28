import Link from 'next/link'
import type { ReactNode } from 'react'

import { Figure } from '@/components/weave/Figure'
import layout from '@/components/weave/layout.module.css'
import { Band } from '@/components/weave/Band'
import { Lines } from '@/components/weave/Lines'
import type { Tone } from '@/components/weave/tones'
import { noteFor } from '@/content/media-notes'

import type { Para } from './flow'
import styles from './story.module.css'

/**
 * A run of reading paragraphs; large lines set in the display face. With
 * `heading`, the first line is the `<h2>` of its stretch of the text.
 */
export function StoryText({ paras, heading = false, children }: { paras: readonly Para[]; heading?: boolean; children?: ReactNode }) {
  return (
    <div className={layout.flow}>
      {paras.map((para, i) => {
        const Tag = heading && i === 0 ? 'h2' : 'p'
        return (
          <Tag key={i} className={para.kind === 'display' ? 't-display' : undefined} data-reveal="">
            <Lines text={para.text} />
          </Tag>
        )
      })}
      {children}
    </div>
  )
}

/**
 * A line that breaks out of the text as a full-width band. With `heading`,
 * it is the `<h2>` of the stretch it opens (rooms without year headings).
 */
export function StatementBand({
  text,
  tone = 'coral',
  size = 'band-xl',
  edge = true,
  heading = false,
}: {
  text: string
  tone?: Tone
  size?: 'band-xl' | 'band'
  edge?: boolean
  heading?: boolean
}) {
  const Tag = heading ? 'h2' : 'p'
  return (
    <Band tone={tone} edge={edge ? 'crenel' : undefined} pad="s" className={styles.statement}>
      <Tag className={`t-${size}`} data-reveal="" data-fx="band">
        <Lines text={text} />
      </Tag>
    </Band>
  )
}

/**
 * The CMS picture beside a text run, with its alt and caption from
 * `media-notes` (a bare image id carries neither). Renders nothing for an
 * empty field.
 */
export function StoryFigure({
  id,
  drop = false,
  room,
}: {
  id: string | null | undefined
  drop?: boolean
  /** The room the figure stands in: a caption never links to its own room. */
  room?: string
}) {
  if (!id) return null
  const note = noteFor(id)
  const caption = note.caption ? (
    note.link && note.link.href !== room ? (
      <span className={styles.captionLink}>
        <span>{note.caption}</span>
        <Link href={note.link.href} prefetch={false}>
          {note.link.label} ←
        </Link>
      </span>
    ) : (
      note.caption
    )
  ) : undefined
  return (
    <div className={`${layout.aside} ${drop ? layout.asideDrop : ''}`}>
      <Figure
        id={id}
        alt={note.alt}
        sizes="(min-width: 1024px) 480px, 100vw"
        caption={caption}
        ratio={note.ratio}
        focus={note.focus}
      />
    </div>
  )
}
