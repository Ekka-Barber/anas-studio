import { NextRoomLink } from '@/components/public/NextRoomLink'
import { Picture } from '@/components/public/Picture'
import { RoomOpener } from '@/components/public/RoomOpener'
import styles from '@/components/public/public.module.css'
import { Vignette } from '@/components/public/Vignette'
import { VideoReel } from '@/components/public/VideoReel'
import type { BuiltRoom } from '@/lib/content'

/**
 * بنيتُ هنا — رحى المكان. Three named movements from Anas's own lines
 * (DESIGN-DIRECTION.md §2): «لم أكن وحدي…», «سبعة فروع…», and the closing
 * «الشيخ آمن بي، وأنا آمنت برحى. وبين الإيمانين… بنينا.» at display size.
 */
export function BuiltRoomView({ room }: { room: BuiltRoom }) {
  const jewelVar = `var(--color-${room.jewel})`

  return (
    <main className={styles.roomPaper}>
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
            {room.intro.paragraphs.map((paragraph, index) => (
              <p key={index} className={styles.paragraph}>
                {paragraph}
              </p>
            ))}
          </div>
          {room.intro.vignette && (
            <div className={styles.chapterVisual}>
              <Vignette id={room.intro.vignette} />
            </div>
          )}
        </div>

        {room.movements.map((movement) => (
          <div key={movement.label} className={`${styles.movement} ${styles.chapter}`}>
            <div className={styles.chapterText}>
              {movement.paragraphs.map((paragraph, index) =>
                index === 0 ? (
                  <p key={index} className={styles.pullLine} style={{ color: jewelVar }}>
                    {paragraph}
                  </p>
                ) : (
                  <p key={index} className={styles.paragraph}>
                    {paragraph}
                  </p>
                ),
              )}
            </div>
            {movement.vignette && (
              <div className={styles.chapterVisual}>
                <Vignette id={movement.vignette} wide={movement.vignetteWide} />
              </div>
            )}
          </div>
        ))}

        <div className={`${styles.movement} ${styles.readingColumn}`}>
          {room.closing.paragraphs.map((paragraph, index) => (
            <p key={index} className={styles.paragraph}>
              {paragraph}
            </p>
          ))}
          <p className={styles.closerLine} style={{ color: jewelVar }}>
            {room.closing.displayLine}
          </p>
          <Picture id={room.media.logo.id} alt={room.media.logo.alt} sizes="140px" className={styles.roomLogo} />
          <p className={styles.signatureCaption}>{room.signature}</p>
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
        <VideoReel
          id={room.media.droneFilm.id}
          alt={room.media.droneFilm.alt}
          className={styles.droneFilm}
          autoplayOnView={false}
        />
      </div>

      <NextRoomLink href="/passed" label="مررتُ من هنا" jewel="plum" />
    </main>
  )
}
