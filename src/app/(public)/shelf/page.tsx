import { NextRoomLink } from '@/components/public/NextRoomLink'
import { Picture } from '@/components/public/Picture'
import { RoomOpener } from '@/components/public/RoomOpener'
import styles from '@/components/public/public.module.css'
import { Vignette } from '@/components/public/Vignette'
import { getShelfRoom } from '@/lib/content'

/**
 * على الرف — three shelf objects, each with its own story (DESIGN-DIRECTION.md
 * §2): ذرى, كوب ضوء القمر, بوتيك أنس القرني. No purchase/notify controls yet
 * (P01 scope) — every status label here is the truthful current state.
 */
export default function ShelfPage() {
  const room = getShelfRoom()
  const jewelVar = `var(--color-${room.jewel})`
  const { thura, moonlightCup, boutique } = room.items

  return (
    <main className={styles.roomSand}>
      <div className={styles.roomInner}>
        <div className={styles.chapter}>
          <div className={styles.chapterText}>
            <RoomOpener roomLabel={room.roomLabel} title={room.title} jewel={room.jewel} />
          </div>
          <div className={styles.chapterVisual}>
            <Vignette id={room.vignette.id} />
          </div>
        </div>
      </div>

      <div className={styles.roomInner}>
        {/* ذرى */}
        <section className={`${styles.shelfItem} ${styles.chapter}`}>
          <div className={styles.chapterText}>
            <h2 className={styles.shelfHeading}>
              {thura.name} <span className={styles.shelfNameNote}>{thura.nameNote}</span>
            </h2>
            <div className={styles.readingColumn}>
              <p className={styles.paragraph}>{thura.meaning}</p>
              <p className={styles.paragraph}>{thura.definition}</p>
              <p className={styles.paragraph}>{thura.vision}</p>
              <p className={styles.paragraph}>{thura.goal}</p>
            </div>
          </div>
          <div className={styles.chapterVisual}>
            <Vignette id={thura.vignette} />
          </div>
        </section>

        <Picture id={thura.divider} alt="" sizes="(min-width: 768px) 800px, 100vw" className={styles.divider} />

        <ul className={styles.flavourList}>
          {thura.flavours.map((flavour) => (
            <li key={flavour.name}>
              <h3 className={styles.flavourName} style={{ color: jewelVar }}>
                {flavour.name}
              </h3>
              <p className={styles.flavourDescription}>{flavour.description}</p>
            </li>
          ))}
        </ul>

        <div className={`${styles.readingColumn} ${styles.thuraInspiration}`}>
          <p className={styles.paragraph}>{thura.inspiration}</p>
          <p className={styles.paragraph}>{thura.inspirers}</p>
          <p className={styles.pullLine} style={{ color: jewelVar }}>
            {thura.slogan}
          </p>
        </div>

        <ul className={`${styles.thumbGrid} ${styles.thuraPhotoGrid}`}>
          {thura.photos.map((photo, index) => (
            <li key={photo.id}>
              <Picture
                id={photo.id}
                alt={photo.alt}
                sizes={index === 0 ? '(min-width: 768px) 700px, 100vw' : '(min-width: 768px) 340px, 45vw'}
              />
            </li>
          ))}
        </ul>

        <Picture id={thura.posterId} alt="لقطة من فيلم ذرى" sizes="(min-width: 768px) 800px, 100vw" className={styles.poster} />
        <p className={styles.shelfNote}>{thura.comingSoonLine}</p>

        {/* كوب ضوء القمر */}
        <section className={`${styles.shelfItem} ${styles.chapter}`}>
          <div className={styles.chapterText}>
            <h2 className={styles.shelfHeading}>{moonlightCup.title}</h2>
            <span className={styles.shelfStatus}>{moonlightCup.status}</span>
            <div className={`${styles.readingColumn} ${styles.moonlightIntro}`}>
              {moonlightCup.paragraphs.map((paragraph, index) => (
                <p key={index} className={styles.paragraph}>
                  {paragraph}
                </p>
              ))}
            </div>
          </div>
          <div className={styles.chapterVisual}>
            <Vignette id={moonlightCup.vignette} />
          </div>
        </section>

        <ul className={`${styles.thumbGrid} ${styles.moonlightPhotoGrid}`}>
          {moonlightCup.images.map((image) => (
            <li key={image.id}>
              <Picture id={image.id} alt={image.alt} sizes="(min-width: 768px) 200px, 33vw" />
            </li>
          ))}
        </ul>

        {/* بوتيك أنس القرني */}
        <section className={`${styles.shelfItem} ${styles.chapter}`}>
          <div className={styles.chapterText}>
            <h2 className={styles.shelfHeading}>{boutique.title}</h2>
            <div className={`${styles.readingColumn} ${styles.moonlightIntro}`}>
              {boutique.paragraphs.map((paragraph, index) => (
                <p key={index} className={styles.paragraph}>
                  {paragraph}
                </p>
              ))}
              <p className={styles.closerLine} style={{ color: jewelVar }}>
                {boutique.closingLine}
              </p>
            </div>
          </div>
          <div className={styles.chapterVisual}>
            <Vignette id={boutique.vignette} />
          </div>
        </section>
      </div>

      {/* كُتبت هنا has no built page yet (part 2); the frozen file's own
          accent (#234A30 / forest) is reused here as a placeholder — not a
          confirmed jewel colour for that room. */}
      <NextRoomLink href="/book" label="كُتبتُ هنا" jewel="forest" />
    </main>
  )
}
