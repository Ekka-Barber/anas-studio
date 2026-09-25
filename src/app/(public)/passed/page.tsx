import { Gallery } from '@/components/public/Gallery'
import { NextRoomLink } from '@/components/public/NextRoomLink'
import { Picture } from '@/components/public/Picture'
import { RoomOpener } from '@/components/public/RoomOpener'
import styles from '@/components/public/public.module.css'
import { Vignette } from '@/components/public/Vignette'
import { VideoReel } from '@/components/public/VideoReel'
import { getPassedRoom } from '@/lib/content'

/**
 * مررتُ من هنا (renamed from «مرّت من هنا» — Anas, chat line 607). Hero line
 * is his own opening sentence (DESIGN-DIRECTION.md §2); brand wall and
 * product gallery are the confirmed real relationships (item 113), rights
 * pending E05.
 */
export default async function PassedPage() {
  const room = await getPassedRoom()
  const jewelVar = `var(--color-${room.jewel})`

  return (
    <main className={styles.roomSand}>
      <div className={styles.roomInner}>
        <div className={styles.chapter}>
          <div className={styles.chapterText}>
            <RoomOpener roomLabel={room.roomLabel} title={room.title} jewel={room.jewel} />
            <p className={styles.heroLine} style={{ color: jewelVar }}>
              {room.heroLine}
            </p>
          </div>
          <div className={styles.chapterVisual}>
            <Vignette id={room.vignette.id} />
          </div>
        </div>
      </div>

      <div className={styles.roomInner}>
        <div className={styles.chapter}>
          <div className={styles.chapterText}>
            {room.paragraphs.map((paragraph, index) =>
              room.pullLines.includes(paragraph) ? (
                <p key={index} className={styles.pullLine} style={{ color: jewelVar }}>
                  {paragraph}
                </p>
              ) : (
                <p key={index} className={styles.paragraph}>
                  {paragraph}
                </p>
              ),
            )}
            <p className={styles.closerLine} style={{ color: jewelVar }}>
              {room.closingLine}
            </p>
          </div>
          <div className={styles.chapterVisual}>
            <Vignette id={room.heroVignette} />
          </div>
        </div>
      </div>

      <div className={styles.roomInner}>
        <span className={styles.sectionLabel}>مقاطع</span>
        <ul className={styles.reelRow} tabIndex={0} aria-label="مقاطع الفيديو، مرّرها بالأسهم">
          {room.media.reels.map((reel) => (
            <li key={reel.id}>
              <VideoReel id={reel.id} alt={reel.alt} className={styles.reel} />
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.roomInner}>
        <span className={styles.sectionLabel}>العلامات</span>
        <ul className={styles.brandWall}>
          {room.media.brandWall.map((brand) => (
            <li key={brand.id} className={styles.brandItem}>
              <Picture id={brand.id} alt={brand.name} sizes="112px" className={styles.brandMark} />
              <span className={styles.brandName}>{brand.name}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.roomInner}>
        <span className={styles.sectionLabel}>المنتجات</span>
        <Gallery photos={room.media.gallery} roomImagesSizes="(min-width: 768px) 33vw, 50vw" />
      </div>

      <NextRoomLink href="/shelf" label="على الرف" jewel="oud" />
    </main>
  )
}
