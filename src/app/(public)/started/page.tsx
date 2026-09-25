import { NextRoomLink } from '@/components/public/NextRoomLink'
import { Picture } from '@/components/public/Picture'
import { RoomOpener } from '@/components/public/RoomOpener'
import styles from '@/components/public/public.module.css'
import { VideoReel } from '@/components/public/VideoReel'
import { YearNav } from '@/components/public/YearNav'
import { getStartedRoom } from '@/lib/content'

/**
 * بدأتُ من هنا on the frozen handoff composition (deploy/design/بدأت هنا):
 * the room opener, then one alternating art/text row per year Anas names,
 * the last in the handoff's sand «قيد التكوين» panel. The art is the Khous
 * book's street-4 watercolours and Anas's own product films.
 */
type Art = { image: string; alt: string } | { films: string[] }

// One entry per year, in the order of room.movements.
const ART: Art[] = [
  {
    image: 'started-mothers-hands',
    alt: 'يدا امرأة تغطّيان طبق طعام بغطاء مجدول من الخوص، وإلى جانبه قدر صغير ومنديل مطرّز.',
  },
  {
    image: 'started-child-door',
    alt: 'طفل يقف على عتبة باب خشبي وقد رفع يده ليطرقه، حاملاً بيده الأخرى طبقاً مغطّى.',
  },
  { films: ['46-kid-picnic-jam', '47-kid-bisht-honey-jar', '50-kid-cafe-croissant-jam'] },
  {
    image: 'started-closed-door',
    alt: 'باب خشبي بنّي مغلق لبيت قديم تحت مظلّة خشبية مضلّعة، وقد نمت أمامه شجيرات وجذع نخلة حتى كاد يحجبه.',
  },
]

export default async function StartedPage() {
  const room = await getStartedRoom()
  const reelAlt = (id: string) => room.media.reels.find((reel) => reel.id === id)?.alt ?? ''
  const last = room.movements.length - 1

  return (
    <main className={styles.roomPaper}>
      <section className={styles.startedHero}>
        <div>
          <RoomOpener roomLabel={room.roomLabel} title={room.title} jewel={room.jewel} />
          <p className={styles.startedHeroLine}>{room.heroLine}</p>
        </div>
        <Picture
          id="started-street-4"
          alt="لوحة شارع زرقاء على عمود أبيض تحمل ثلاث لافتات: شارع رقم 4، و STREET NO. 4، ومنازل رقم 401-472، وخلفها بيوت الحي وأشجار النخيل."
          sizes="(min-width: 1024px) 34vw, 78vw"
          loading="eager"
          className={styles.startedHeroArt}
        />
      </section>

      <YearNav years={room.movements.map((movement) => movement.year)} />

      <div className={styles.stories}>
        {room.movements.map((movement, i) => {
          const art = ART[i]
          const [lead, ...rest] = movement.paragraphs
          const classes = [styles.story, i % 2 ? styles.storyFlip : '', i === last ? styles.storyPending : '']
          return (
            <article
              key={movement.year}
              id={`year-${i}`}
              aria-labelledby={`year-${i}-title`}
              className={classes.join(' ')}
            >
              <div className={styles.storyArt}>
                {art && 'films' in art ? (
                  <div className={styles.filmTrio}>
                    {art.films.map((id) => (
                      <VideoReel key={id} id={id} alt={reelAlt(id)} className={styles.reel} />
                    ))}
                  </div>
                ) : art ? (
                  <Picture id={art.image} alt={art.alt} sizes="(min-width: 1024px) 40vw, 100vw" className={styles.storyPlate} />
                ) : null}
              </div>
              <div className={styles.storyText}>
                <h2 id={`year-${i}-title`} className={styles.storyYear}>
                  {movement.year}
                </h2>
                <p className={styles.storyLead}>{lead}</p>
                {rest.map((paragraph, k) => (
                  <p key={k} className={room.pullLines.includes(paragraph) ? styles.storyPull : styles.storyBody}>
                    {paragraph}
                  </p>
                ))}
                {i === last && (
                  <>
                    <p className={styles.storyCloser}>{room.closingLine}</p>
                    <p className={styles.signatureCaption}>{room.signature}</p>
                  </>
                )}
              </div>
            </article>
          )
        })}
      </div>

      <NextRoomLink href="/built" label="بنيتُ هنا" jewel="midnight" />
    </main>
  )
}
