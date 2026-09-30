import Link from 'next/link'

import { RoomHero } from '@/components/public/RoomHero'
import { classify, splitAfterFirstDisplay, toBlocks, type Para } from '@/components/public/story/flow'
import { StatementBand, StoryFigure, StoryText } from '@/components/public/story/Story'
import { Tag } from '@/components/weave/Action'
import { Band } from '@/components/weave/Band'
import { Edge } from '@/components/weave/Edge'
import layout from '@/components/weave/layout.module.css'
import { Lines } from '@/components/weave/Lines'
import { RoomNav } from '@/components/weave/RoomNav'
import { Signature } from '@/components/weave/Signature'
import type { Tone } from '@/components/weave/tones'
import { VideoTile } from '@/components/weave/VideoTile'
import type { StartedMovement, StartedRoom } from '@/lib/content'

import styles from './rooms.module.css'

/**
 * بدأتُ من هنا (D39, direction B). Each year Anas names opens with its own
 * band; a stretch that is not a year (his «وشيء لم يبدأ بعد») opens on paper
 * between two weave strips. The family films sit after the first large line
 * of the movement marked `films`. The room ends with his signature, then the
 * store it leads to.
 */
const YEAR_TONES: Tone[] = ['aub', 'saffron', 'coral']

function Films({ reels }: { reels: StartedRoom['media']['reels'] }) {
  if (reels.length === 0) return null
  return (
    <Band tone="aub" pad="s" aria-label="مقاطع من حكايات العائلة">
      <ul className={styles.films}>
        {reels.map((reel, i) => (
          <li key={reel.id} data-reveal="" data-fx="media" data-delay={i * 120}>
            {/* The family films are 16:9 scenes padded to 9:16 with blurred
                copies; the 16:9 frame shows only the sharp scene. */}
            <VideoTile id={reel.id} alt={reel.alt} ratio="16 / 9" />
          </li>
        ))}
      </ul>
    </Band>
  )
}

function Movement({
  movement,
  index,
  room,
  last,
}: {
  movement: StartedMovement
  index: number
  room: StartedRoom
  last: boolean
}) {
  const isYear = /^\d{4}$/.test(movement.year)
  const tone = YEAR_TONES[index % YEAR_TONES.length] ?? 'aub'
  const blocks = toBlocks(classify(movement.paragraphs, room.pullLines, room.bandLines))
  // The picture and the films belong to the first block of text, wherever a band line falls.
  const firstText = blocks.findIndex((x) => x.kind === 'text')
  const finalBlock = blocks[blocks.length - 1]
  // The closing rides the movement's last text. A movement that ends on a band, has no text, or
  // ends on the films (a first block with no large line to split at) gives it a band of its own.
  const closingInText =
    last &&
    finalBlock?.kind === 'text' &&
    !(blocks.length - 1 === firstText && movement.films && splitAfterFirstDisplay(finalBlock.paras)[1].length === 0)
  const closing = (
    <>
      <Signature width={220} className={styles.signature} />
      <p className={`t-h3 ${styles.closingLine}`} data-reveal="">
        {room.closingLine}
      </p>
      <p className="t-label t-muted" data-reveal="">
        {room.signature}
      </p>
    </>
  )

  return (
    <section id={`year-${index}`} aria-labelledby={`year-${index}-title`}>
      {isYear ? (
        <>
          <Edge kind="crenel" color={tone} />
          <h2 id={`year-${index}-title`} data-tone={tone} className={`t-year ${styles.yearBand}`} data-reveal="" data-fx="band">
            {movement.year}
          </h2>
        </>
      ) : (
        <>
          <Edge kind="weave" />
          <h2 id={`year-${index}-title`} data-tone="paper" className={`t-band-xl ${styles.labelBand}`} data-reveal="" data-fx="band">
            {movement.year}
          </h2>
          <Edge kind="weave" />
        </>
      )}
      {blocks.map((block, b) => {
        if (block.kind === 'band') return <StatementBand key={b} text={block.text} edge={false} />
        const first = b === firstText
        const withFigure = first && movement.vignette
        let before: Para[] = block.paras
        let after: Para[] = []
        if (first && movement.films) [before, after] = splitAfterFirstDisplay(block.paras)
        const lastBlock = closingInText && b === blocks.length - 1
        return (
          <div key={b}>
            <Band tone="sand" pad="m">
              <div className={layout.split}>
                <div className={layout.text}>
                  <StoryText paras={before}>{lastBlock && after.length === 0 && closing}</StoryText>
                </div>
                {withFigure && <StoryFigure id={movement.vignette} drop />}
              </div>
            </Band>
            {first && movement.films && <Films reels={room.media.reels} />}
            {after.length > 0 && (
              <Band tone="sand" pad="m">
                <div className={layout.text}>
                  <StoryText paras={after}>{lastBlock && closing}</StoryText>
                </div>
              </Band>
            )}
          </div>
        )
      })}
      {last && !closingInText && (
        <Band tone="sand" pad="m">
          <div className={layout.text}>
            <StoryText paras={[]}>{closing}</StoryText>
          </div>
        </Band>
      )}
    </section>
  )
}

export function StartedRoomView({ room }: { room: StartedRoom }) {
  const last = room.movements.length - 1
  return (
    <>
      <main id="main">
        <RoomHero tone={room.jewel} title={room.title} tagline={room.tagline} />
        <article>
          <Band tone="sand" pad="l">
            <p className={styles.opening} data-reveal="">
              <Lines text={room.heroLine} />
            </p>
          </Band>
          {room.movements.map((movement, i) => (
            <Movement key={`${movement.year}-${i}`} movement={movement} index={i} room={room} last={i === last} />
          ))}
        </article>

        <section aria-labelledby="shop-title">
          <Band tone="aub" edge="crenel" pad="xs" padEnd="s" className={styles.shopHead}>
            <h2 id="shop-title" className="t-band-xl" data-reveal="" data-fx="band">
              المتجر
            </h2>
            <Tag large>قريباً</Tag>
          </Band>
          <Edge kind="weave" />
          <Band tone="sand" pad="l">
            <Link href="/shelf#boutique" prefetch={false} data-tone="aub" className={styles.boutiqueDoor} data-reveal="">
              <span className="t-statement t-accent">وشيء لم يبدأ بعد.</span>
              <span className={styles.boutiqueName}>
                <span className="t-h3">بوتيك أنس القرني</span>
                <span className="t-label">
                  على الرف <span aria-hidden="true">←</span>
                </span>
              </span>
            </Link>
          </Band>
        </section>
      </main>
      <RoomNav back={{ href: '/', label: 'الرئيسية' }} backLabel="العودة" next={{ href: '/built', label: 'بنيتُ هنا' }} />
    </>
  )
}
