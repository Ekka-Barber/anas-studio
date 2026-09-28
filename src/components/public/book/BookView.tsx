import { Picture } from '@/components/public/Picture'
import { ActionLink } from '@/components/weave/Action'
import { Band } from '@/components/weave/Band'
import { Edge } from '@/components/weave/Edge'
import { Figure } from '@/components/weave/Figure'
import layout from '@/components/weave/layout.module.css'
import { Lines } from '@/components/weave/Lines'
import { enter } from '@/components/weave/motion'
import { RoomNav } from '@/components/weave/RoomNav'
import { SectionNav } from '@/components/weave/SectionNav'
import { BOOK } from '@/content/book'

import styles from './book.module.css'

/**
 * كتبتُ هنا (D39, direction B): «خوص | حكايات شارع 4» in cover B on its
 * saffron band, then the book's sections under their own sticky contents:
 * about, passages, his Street No. 4 photos, the book's journey with the
 * standing mockup B, and the editions, announced «قريباً».
 *
 * Not here yet, on purpose: the characters (their names and lines wait for
 * Anas), the page-turning reader (P02, E04) and the availability sign-up
 * (P08). None of them is shown as a placeholder.
 */
const SECTIONS = [
  { id: 'about', label: 'نبذة' },
  { id: 'excerpts', label: 'اقتباسات' },
  { id: 'photos', label: 'صور' },
  { id: 'journey', label: 'رحلة الكتاب' },
  { id: 'editions', label: 'الطلب' },
] as const

export function BookView() {
  return (
    <>
      <main id="main">
        <Band as="header" tone="saffron" edge="crenel" pad="hero" padEnd="l" className={styles.hero}>
          <div className={styles.cover} {...enter(240, 'media')}>
            <Picture id={BOOK.cover.id} alt={BOOK.cover.alt} sizes="(min-width: 1024px) 400px, 70vw" loading="eager" />
          </div>
          <div className={styles.heroText}>
            <p className={styles.roomLabel} {...enter(80)}>
              {BOOK.roomLabel}
            </p>
            <h1 className={styles.title}>
              <span className={`t-mega ${styles.titleWord}`} {...enter(200, 'band')}>
                {BOOK.title}
              </span>
              <span className={styles.subtitle} {...enter(360, 'band')}>
                {BOOK.subtitle}
              </span>
            </h1>
            <p className={`t-quote ${styles.line}`} {...enter(520)}>
              <Lines text={BOOK.line} />
            </p>
            <p className={styles.author} {...enter(620)}>
              {BOOK.author}
            </p>
            <div className={styles.actions} {...enter(760)}>
              <ActionLink href="#editions">النسخ</ActionLink>
            </div>
          </div>
        </Band>
        <Edge kind="weave" />
        <SectionNav label="أقسام الكتاب" sections={SECTIONS} />

        <Band tone="sand" pad="xl" id="about" aria-labelledby="about-title" className={styles.section}>
          <div className={styles.twoCols}>
            <div className={styles.colHead}>
              <h2 id="about-title" className={`t-h2 ${styles.h2}`} data-reveal="">
                نبذة
              </h2>
              <p className={`${styles.kicker}`} data-reveal="">
                {BOOK.about.kicker}
              </p>
              <p className="t-quote" data-reveal="">
                {BOOK.about.line}
              </p>
            </div>
            <div className={`${layout.flow} ${styles.colBody}`} data-reveal="">
              {BOOK.about.passage.map((para, i) => (
                <p key={i}>
                  <Lines text={para} />
                </p>
              ))}
              <p className={styles.source}>{BOOK.about.source}</p>
            </div>
          </div>
        </Band>

        <Band tone="sand" pad="none" padEnd="xl" id="excerpts" aria-labelledby="excerpts-title" className={styles.section}>
          <h2 id="excerpts-title" className={`t-h2 ${styles.h2}`} data-reveal="">
            اقتباسات
          </h2>
          <div className={styles.excerpts}>
            {BOOK.excerpts.map((excerpt) => (
              <figure key={excerpt.text} className={styles.excerpt} data-reveal="">
                <blockquote className={`t-display ${styles.quote}`}>
                  <span aria-hidden="true" className={`${styles.mark} ${styles.markOpen}`}>
                    «
                  </span>
                  {/* A quotation is set without its closing full stop; the stored text keeps it. */}
                  <Lines text={excerpt.text.replace(/\s*\.$/, '')} />
                  <span aria-hidden="true" className={styles.mark}>
                    »
                  </span>
                </blockquote>
                <figcaption className={styles.quoteSource}>{excerpt.source}</figcaption>
              </figure>
            ))}
          </div>
        </Band>

        <section id="photos" aria-labelledby="photos-title" className={styles.section}>
          <Edge kind="weave" />
          <h2 id="photos-title" className={`t-h2 ${styles.photosTitle}`} data-reveal="">
            صور
          </h2>
          <div className={`${layout.mosaic} ${styles.photos}`}>
            {BOOK.photos.map((photo) => (
              <Figure
                key={photo.id}
                id={photo.id}
                alt={photo.alt}
                sizes="(min-width: 1024px) 20vw, 50vw"
                ratio="3 / 4"
                focus={'focus' in photo ? photo.focus : undefined}
                caption={photo.caption}
                captionPlacement="corner"
                scrub
              />
            ))}
          </div>
        </section>

        <Band tone="sand" pad="xl" id="journey" aria-labelledby="journey-title" className={styles.section}>
          <div className={layout.text}>
            <h2 id="journey-title" className={`t-h2 ${styles.h2}`} data-reveal="">
              {BOOK.journey.title}
            </h2>
            <div className={layout.flow} data-reveal="">
              {BOOK.journey.passage.map((para, i) => (
                <p key={i}>
                  <Lines text={para} />
                </p>
              ))}
              <p className={styles.source}>{BOOK.journey.source}</p>
            </div>
          </div>
          <ul className={`${layout.lattice} ${styles.objects}`}>
            <li data-tone="paper" className={styles.object} data-reveal="" data-fx="media">
              <Picture id={BOOK.standing.id} alt={BOOK.standing.alt} sizes="(min-width: 1024px) 30vw, 100vw" />
              <span className={styles.objectLabel}>الغلاف والكعب</span>
            </li>
            <li data-tone="saffron" className={`${styles.object} ${styles.spine}`} data-reveal="" data-fx="media" data-delay={100}>
              <Picture id={BOOK.spine.id} alt={BOOK.spine.alt} sizes="120px" className={styles.spineArt} />
              <span className={styles.objectLabel}>الكعب</span>
            </li>
            <li data-tone="paper" className={styles.object} data-reveal="" data-fx="media" data-delay={200}>
              <Picture id={BOOK.bookmark.id} alt={BOOK.bookmark.alt} sizes="(min-width: 1024px) 30vw, 100vw" className={styles.bookmark} />
              <span className={styles.objectLabel}>فاصل من الخوص</span>
            </li>
          </ul>
        </Band>

        <section id="editions" aria-labelledby="editions-title" className={styles.section}>
          <Edge kind="weave" />
          <Band tone="sand" pad="l">
            <h2 id="editions-title" className="t-band-xl" data-reveal="" data-fx="band">
              قريباً
            </h2>
            <p className={styles.status} data-reveal="">
              {BOOK.status[0]}
              <br />
              {BOOK.status[1]}
            </p>
            <ul className={`${layout.lattice} ${styles.editions}`} data-reveal="">
              {BOOK.editions.map((edition) => (
                <li key={edition.name} data-tone="paper" className={styles.edition}>
                  <h3 className="t-card">{edition.name}</h3>
                  <p className="t-body">{edition.text}</p>
                  <p className={styles.price}>
                    <span>السعر</span>
                    <span>يُعلن قريباً</span>
                  </p>
                </li>
              ))}
            </ul>
          </Band>
        </section>
      </main>
      <RoomNav back={{ href: '/shelf', label: 'على الرف' }} next={{ href: '/journal', label: 'المجلس' }} nextTone="coral" />
    </>
  )
}
