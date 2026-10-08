import { Fragment } from 'react'

import { BookPreview } from '@/components/book/BookPreview'
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
import type { Tone } from '@/components/weave/tones'
import type { BookRoom } from '@/lib/content'
import { formatMoney } from '@/lib/format'
import { imageSources } from '@/lib/images'
import type { EditionOffer } from '@/lib/store'

import styles from './book.module.css'

/**
 * كتبتُ هنا (D39, direction B): «خوص | حكايات شارع 4» in cover B on its
 * saffron band, then the book's sections under their own sticky contents:
 * about, passages, the characters (each only by the lines the manuscript
 * gives it), the pages Anas approved for reading (P02, the book reader), his
 * Street No. 4 photos, the book's journey with the standing mockup B, and the
 * editions, announced «قريباً» until the store sells them. The words and
 * pictures are the `book` document of the rooms collection (editable in the admin).
 *
 * Not here yet, on purpose: the availability sign-up (P08), not shown as a
 * placeholder.
 */
const SECTIONS = [
  { id: 'about', label: 'نبذة' },
  { id: 'excerpts', label: 'اقتباسات' },
  { id: 'characters', label: 'الشخصيات' },
  { id: 'pages', label: 'صفحات' },
  { id: 'photos', label: 'صور' },
  { id: 'journey', label: 'رحلة الكتاب' },
  { id: 'editions', label: 'الطلب' },
] as const

// The character cards are woven in turn from these surfaces, as the journal's are.
const CARD_TONES: Tone[] = ['paper', 'aub', 'coral', 'saffron']

/**
 * `journalName` is the journal's editable name (D11) for the link onward, and
 * `backName` the shelf's name on the menu for the link back. `offers[i]` is what
 * the store sells of `book.editions[i]` (the page works it out from the catalog
 * at build time): its variant's price and its product's page, or null while
 * there is nothing to buy and the edition says «يُعلن قريباً». All three are optional
 * because the admin's preview draws this view in the browser, where the loaders
 * cannot run.
 */
export function BookView({
  book,
  journalName = 'المجلس',
  backName = 'على الرف',
  offers = [],
}: {
  book: BookRoom
  journalName?: string
  backName?: string
  offers?: readonly (EditionOffer | null)[]
}) {
  const cover = imageSources(book.cover.id)
  // A list with nothing in it leaves its section out, and the contents link to it (DESIGN.md section 8: a section
  // waiting for Anas's material is not drawn).
  const filled: Record<string, boolean> = {
    excerpts: book.excerpts.length > 0,
    characters: book.characters.length > 0,
    photos: book.photos.length > 0,
    editions: book.editions.length > 0,
  }
  const sections = SECTIONS.filter((section) => filled[section.id] !== false)
  return (
    <>
      <main id="main">
        <Band as="header" tone="saffron" edge="crenel" pad="hero" padEnd="l" className={styles.hero}>
          <div className={styles.cover} {...enter(240, 'media')}>
            <Picture
              id={book.cover.id}
              alt={book.cover.alt}
              // Laid out at min(400px, 40%) of the band, never under 220px, and it stays that wide when the band wraps.
              sizes="(min-width: 1024px) 400px, (min-width: 560px) 40vw, 220px"
              loading="eager"
              fetchPriority="high"
            />
          </div>
          <div className={styles.heroText}>
            <p className={styles.roomLabel} {...enter(80)}>
              {book.roomLabel}
            </p>
            <h1 className={styles.title}>
              <span className={`t-mega ${styles.titleWord}`} {...enter(200, 'band')}>
                {book.title}
              </span>
              <span className={styles.subtitle} {...enter(360, 'band')}>
                {book.subtitle}
              </span>
            </h1>
            <p className={`t-quote ${styles.line}`} {...enter(520)}>
              <Lines text={book.line} />
            </p>
            <p className={styles.author} {...enter(620)}>
              {book.author}
            </p>
            <div className={styles.actions} {...enter(760)}>
              {filled.editions && <ActionLink href="#editions">النسخ</ActionLink>}
              <ActionLink href="#pages" variant="outline" arrow={false}>
                اقرأ صفحات منه
              </ActionLink>
            </div>
          </div>
        </Band>
        <Edge kind="weave" />
        <SectionNav label="أقسام الكتاب" sections={sections} />

        <Band tone="sand" pad="xl" id="about" aria-labelledby="about-title" className={styles.section}>
          <div className={styles.twoCols}>
            <div className={styles.colHead}>
              <h2 id="about-title" className={`t-h2 ${styles.h2}`} data-reveal="">
                نبذة
              </h2>
              <p className={`${styles.kicker}`} data-reveal="">
                {book.about.kicker}
              </p>
              <p className="t-quote" data-reveal="">
                {book.about.line}
              </p>
            </div>
            <div className={`${layout.flow} ${styles.colBody}`} data-reveal="">
              {book.about.passage.map((para, i) => (
                <p key={i}>
                  <Lines text={para} />
                </p>
              ))}
              <p className={styles.source}>{book.about.source}</p>
            </div>
          </div>
        </Band>

        {filled.excerpts && (
          <Band tone="sand" pad="none" padEnd="xl" id="excerpts" aria-labelledby="excerpts-title" className={styles.section}>
            <h2 id="excerpts-title" className={`t-h2 ${styles.h2}`} data-reveal="">
              اقتباسات
            </h2>
            <div className={styles.excerpts}>
              {book.excerpts.map((excerpt) => (
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
        )}

        {filled.characters && (
          <Band tone="sand" pad="none" padEnd="xl" id="characters" aria-labelledby="characters-title" className={styles.section}>
            <h2 id="characters-title" className={`t-h2 ${styles.h2}`} data-reveal="">
              الشخصيات
            </h2>
            <ul className={`${layout.lattice} ${styles.characters}`}>
              {book.characters.map((character, i) => (
                <li key={i} data-tone={CARD_TONES[i % CARD_TONES.length]} className={styles.character} data-reveal="">
                  <h3 className="t-card">{character.name}</h3>
                  <blockquote className="t-line">
                    <span aria-hidden="true" className={styles.cardMark}>
                      «
                    </span>
                    {/* A quotation is set without its closing full stop, as the excerpts are. */}
                    <Lines text={character.line.replace(/\s*\.$/, '')} />
                    <span aria-hidden="true" className={styles.cardMark}>
                      »
                    </span>
                  </blockquote>
                  <p className={styles.source}>{character.source}</p>
                </li>
              ))}
            </ul>
          </Band>
        )}

        <Band tone="deep" edge="crenel" pad="xl" id="pages" aria-labelledby="pages-title" className={styles.section}>
          <div className={styles.pagesHead}>
            <h2 id="pages-title" className={`t-h2 ${styles.h2}`} data-reveal="">
              صفحات من الكتاب
            </h2>
            <p className="t-read" data-reveal="">
              الإهداء، والمقدمة، وصفحتان من فصل «صورة الروضة»، كما كتبها أنس. وبقية الحكاية في الكتاب.
            </p>
          </div>
          {cover && <BookPreview cover={cover} editions={filled.editions} />}
        </Band>

        {filled.photos && (
          <section id="photos" aria-labelledby="photos-title" className={styles.section}>
            <Edge kind="weave" />
            <h2 id="photos-title" className={`t-h2 ${styles.photosTitle}`} data-reveal="">
              صور
            </h2>
            <div className={`${layout.mosaic} ${styles.photos}`}>
              {book.photos.map((photo) => (
                <Figure
                  key={photo.id}
                  id={photo.id}
                  alt={photo.alt}
                  sizes="(min-width: 1024px) 20vw, 50vw"
                  ratio="3 / 4"
                  focus={photo.focus || undefined}
                  caption={photo.caption}
                  captionPlacement="corner"
                  scrub
                />
              ))}
            </div>
          </section>
        )}

        <Band tone="sand" pad="xl" id="journey" aria-labelledby="journey-title" className={styles.section}>
          <div className={layout.text}>
            <h2 id="journey-title" className={`t-h2 ${styles.h2}`} data-reveal="">
              {book.journey.title}
            </h2>
            <div className={layout.flow} data-reveal="">
              {book.journey.passage.map((para, i) => (
                <p key={i}>
                  <Lines text={para} />
                </p>
              ))}
              <p className={styles.source}>{book.journey.source}</p>
            </div>
          </div>
          <ul className={`${layout.lattice} ${styles.objects}`}>
            <li data-tone="paper" className={styles.object} data-reveal="" data-fx="media">
              <Picture id={book.standing.id} alt={book.standing.alt} sizes="(min-width: 1024px) 30vw, 100vw" />
              <span className={styles.objectLabel}>الغلاف والكعب</span>
            </li>
            <li data-tone="saffron" className={`${styles.object} ${styles.spine}`} data-reveal="" data-fx="media" data-delay={100}>
              <Picture id={book.spine.id} alt={book.spine.alt} sizes="120px" className={styles.spineArt} />
              <span className={styles.objectLabel}>الكعب</span>
            </li>
            <li data-tone="paper" className={styles.object} data-reveal="" data-fx="media" data-delay={200}>
              <Picture id={book.bookmark.id} alt={book.bookmark.alt} sizes="(min-width: 1024px) 30vw, 100vw" className={styles.bookmark} />
              <span className={styles.objectLabel}>فاصل من الخوص</span>
            </li>
          </ul>
        </Band>

        {filled.editions && (
          <section id="editions" aria-labelledby="editions-title" className={styles.section}>
            <Edge kind="weave" />
            <Band tone="sand" pad="l">
              {/* «قريباً» while no edition can be bought; the editions' own name once one can. */}
              <h2 id="editions-title" className="t-band-xl" data-reveal="" data-fx="band">
                {offers.some((offer) => offer) ? 'النسخ' : 'قريباً'}
              </h2>
              <p className={styles.status} data-reveal="">
                {book.status.map((line, i) => (
                  <Fragment key={i}>
                    {i > 0 && <br />}
                    {line}
                  </Fragment>
                ))}
              </p>
              <ul className={`${layout.lattice} ${styles.editions}`} data-reveal="">
                {book.editions.map((edition, i) => {
                  const offer = offers[i] ?? null
                  return (
                    <li key={edition.name} data-tone="paper" className={styles.edition}>
                      <h3 className="t-card">{edition.name}</h3>
                      <p className="t-body">{edition.text}</p>
                      <p className={styles.price}>
                        <span>السعر</span>
                        <span>{offer ? formatMoney(offer.priceHalalas) : 'يُعلن قريباً'}</span>
                      </p>
                      {offer && (
                        <div>
                          {/* Each link names its edition: the visible words come first, so the name holds them (WCAG 2.5.3). */}
                          <ActionLink href={`/store/${offer.slug}`} aria-label={`اطلب النسخة: ${edition.name}`}>
                            اطلب النسخة
                          </ActionLink>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </Band>
          </section>
        )}
      </main>
      <RoomNav back={{ href: '/shelf', label: backName }} next={{ href: '/journal', label: journalName }} nextTone="coral" />
    </>
  )
}
