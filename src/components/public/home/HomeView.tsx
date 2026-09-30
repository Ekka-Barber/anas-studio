import Link from 'next/link'

import { Picture } from '@/components/public/Picture'
import { ActionLink, Mark } from '@/components/weave/Action'
import { Band } from '@/components/weave/Band'
import { Edge } from '@/components/weave/Edge'
import { Lines } from '@/components/weave/Lines'
import { enter } from '@/components/weave/motion'
import { Signature } from '@/components/weave/Signature'
import type { Tone } from '@/components/weave/tones'
import { BOOK } from '@/content/book'
import type { RoomDoor } from '@/content/home'
import type { HomeContent } from '@/lib/content'

import styles from './home.module.css'

// His name, one word to a band, in the palette's order.
const NAME_TONES: Tone[] = ['aub', 'coral', 'saffron']

export interface HomeDoor extends RoomDoor {
  /** The room's own line from the CMS, when it has a document. */
  roomLine?: string
}

/**
 * The home page (D39, direction B): Anas's name woven as three bands beside
 * his portrait, his line and his work in a sentence, the statement on
 * aubergine, every room as a coloured door, and the book on saffron.
 */
export function HomeView({ home, doors }: { home: HomeContent; doors: HomeDoor[] }) {
  const words = home.name.split(/\s+/).filter(Boolean)
  return (
    <main id="main">
      <section aria-labelledby="hero-name" className={styles.hero}>
        <h1 id="hero-name" aria-label={home.name} className={`t-hero ${styles.name}`}>
          {words.map((word, i) => (
            <span
              key={i}
              aria-hidden="true"
              data-tone={NAME_TONES[i % NAME_TONES.length]}
              className={styles.nameBand}
              {...enter(60 + i * 140, 'band')}
            >
              {word}
            </span>
          ))}
        </h1>
        <figure className={`${styles.portrait} motion-scrub`} {...enter(0, 'media')}>
          <Picture
            id={home.portrait}
            alt={home.portraitAlt}
            sizes="(min-width: 1024px) 40vw, 100vw"
            loading="eager"
            fetchPriority="high"
            className={styles.portraitPicture}
          />
        </figure>
      </section>
      <Edge kind="weave" />

      <Band tone="sand" pad="l" className={styles.intro}>
        <p className={`${styles.tagline}`} {...enter(560)}>
          <Lines text={home.tagline} />
        </p>
        <div className={styles.introText}>
          <p className="t-read" {...enter(700)}>
            <Lines text={home.intro} />
          </p>
          <p data-tone="coral" className={styles.addition} {...enter(820, 'band')}>
            <Mark ink />
            <span>
              <Lines text={home.introAddition} />
            </span>
          </p>
          <div className={styles.introActions} {...enter(940)}>
            <ActionLink href="/contact">فلنتحدث</ActionLink>
            <Signature width={190} reveal={false} />
          </div>
        </div>
      </Band>

      <Band tone="aub" edge="crenel" pad="xl">
        <p className={`t-statement ${styles.statement}`} data-reveal="">
          <Lines text={home.statement} />
        </p>
      </Band>
      <Edge kind="weave" />

      <section id="rooms" aria-labelledby="rooms-title">
        <h2 id="rooms-title" className={`t-h2-lg ${styles.roomsTitle}`} data-reveal="">
          الغرف
        </h2>
        <ol className={styles.doors}>
          {doors.map((door, i) => {
            const line = door.roomLine ?? door.line
            return (
              <li key={door.href} className={styles.doorItem} data-reveal="" data-delay={(i % 4) * 80}>
                <Edge kind="crenel" color={door.tone} size="sm" />
                <Link href={door.href} prefetch={false} data-tone={door.tone} className={styles.door}>
                  <span className={styles.doorBody}>
                    <h3 className="t-card">{door.title}</h3>
                    {line && (
                      <span className="t-line">
                        <Lines text={line} />
                      </span>
                    )}
                    <span className={`t-label ${styles.doorFoot}`}>
                      {door.meta && <span className={door.tone === 'coral' || door.tone === 'saffron' ? undefined : 't-muted'}>{door.meta}</span>}
                      <span className={styles.enter}>
                        {door.cta ?? 'ادخل'} <span aria-hidden="true">←</span>
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ol>
      </section>

      <section aria-labelledby="book-title" className={styles.book}>
        <Band tone="saffron" edge="crenel" pad="l" className={styles.bookBand}>
          <Link href="/book" prefetch={false} tabIndex={-1} aria-hidden="true" className={styles.cover} data-reveal="" data-fx="media">
            <Picture id={BOOK.cover.id} alt="" sizes="(min-width: 1024px) 360px, 80vw" />
          </Link>
          <div className={styles.bookText}>
            <h2 id="book-title" className={`t-mega ${styles.bookTitle}`} data-reveal="" data-fx="band">
              {BOOK.title}
            </h2>
            <p className="t-h2" data-reveal="">
              {BOOK.subtitle}
            </p>
            <p className="t-quote" data-reveal="">
              <Lines text={BOOK.line} />
            </p>
            <p className={`t-body ${styles.bookStatus}`} data-reveal="">
              {BOOK.status[0]}
            </p>
            <div data-reveal="">
              <ActionLink href="/book">إلى الكتاب</ActionLink>
            </div>
          </div>
        </Band>
      </section>
    </main>
  )
}
