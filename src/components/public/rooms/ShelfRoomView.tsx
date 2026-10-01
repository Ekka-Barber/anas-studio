import { RoomHero } from '@/components/public/RoomHero'
import { classify, toBlocks, type Para } from '@/components/public/story/flow'
import { StatementBand, StoryFigure, StoryText } from '@/components/public/story/Story'
import { Picture } from '@/components/public/Picture'
import { Tag } from '@/components/weave/Action'
import { Band } from '@/components/weave/Band'
import { Edge } from '@/components/weave/Edge'
import { Figure } from '@/components/weave/Figure'
import layout from '@/components/weave/layout.module.css'
import { Lines } from '@/components/weave/Lines'
import { RoomNav } from '@/components/weave/RoomNav'
import { noteFor } from '@/content/media-notes'
import type { ShelfRoom } from '@/lib/content'

import styles from './rooms.module.css'
import shelf from './shelf.module.css'

/**
 * على الرف (D39, direction B): three things waiting for their time, each
 * with a door at the top and its own article: ذرى on aubergine, كوب ضوء
 * القمر on saffron, بوتيك أنس القرني on coral.
 */

// The ذرى photos B chose for the door and for beside the text; the rest
// fill the mosaic. Either falls back to the first photo if Anas removes it.
const THURA_DOOR = 'thura-81'
const THURA_SIDE = 'thura-70'

/** «القدر ما يرتكز إلا على ثلاث» out of a text that quotes it. */
function quoted(text: string): string | null {
  return /«([^»]+)»/.exec(text)?.[1] ?? null
}

/** «من هالأرض لهالأرض». → من هالأرض لهالأرض (and the same for a bracketed note). */
function bare(text: string): string {
  return text.replace(/^[«"(\s]+|[»").\s]+$/g, '')
}

/** A list written as one line, «a، b، c.», as its items. */
function items(text: string): string[] {
  return text
    .split('،')
    .map((item) => item.trim().replace(/\.$/, ''))
    .filter(Boolean)
}

/** The paragraphs before the last large line's lead-in, and that closing pair. */
function splitClosing(paras: Para[]): [Para[], Para[]] {
  const last = paras.map((para) => para.kind).lastIndexOf('display')
  if (last < 2) return [paras, []]
  return [paras.slice(0, last - 1), paras.slice(last - 1)]
}

export function ShelfRoomView({ room }: { room: ShelfRoom }) {
  const { thura, moonlightCup: moon, boutique } = room.items
  const thuraSide = thura.photos.find((photo) => photo.id === THURA_SIDE) ?? thura.photos[0]
  const thuraDoor = thura.photos.find((photo) => photo.id === THURA_DOOR) ?? thuraSide
  const thuraRest = thura.photos.filter((photo) => photo !== thuraSide)
  const inspiration = quoted(thura.inspiration)
  const moonParas = classify(moon.paragraphs, moon.pullLines)
  if (moonParas[0]) moonParas[0] = { ...moonParas[0], kind: 'display' }
  const [moonFirst, moonLast] = splitClosing(moonParas)
  const [moonRender, moonRender2, moonFactory, moonInside] = moon.images
  const boutiqueBlocks = toBlocks(
    classify(boutique.paragraphs, [boutique.paragraphs[0] ?? ''], boutique.bandLines),
  )

  return (
    <>
      <main id="main">
        <RoomHero tone={room.jewel} title={room.title} tagline={room.tagline} />

        <nav aria-label="ما على الرف" className={shelf.doorsWrap}>
          <ul className={`${layout.lattice} ${shelf.doors}`}>
            <li>
              <a href="#thura" data-tone="aub" className={shelf.door}>
                {thuraDoor && <Picture id={thuraDoor.id} alt="" sizes="(min-width: 1024px) 33vw, 100vw" className={shelf.doorPicture} />}
                <span className={shelf.doorFoot}>
                  <span className="t-card">{thura.name}</span>
                  {thura.status && <Tag>{thura.status}</Tag>}
                </span>
              </a>
            </li>
            <li>
              <a href="#moonlight" data-tone="saffron" className={shelf.door}>
                {moonFactory && <Picture id={moonFactory.id} alt="" sizes="(min-width: 1024px) 33vw, 100vw" className={shelf.doorPicture} />}
                <span className={shelf.doorFoot}>
                  <span className="t-card">{moon.title}</span>
                  <Tag variant="ink">{moon.status}</Tag>
                </span>
              </a>
            </li>
            <li>
              <a href="#boutique" data-tone="coral" className={`${shelf.door} ${shelf.doorText}`}>
                {boutique.status && <span className={`t-h3 ${shelf.doorWait}`}>{boutique.status}</span>}
                <span className={shelf.doorFoot}>
                  <span className="t-card">{boutique.title}</span>
                </span>
              </a>
            </li>
          </ul>
        </nav>

        {/* ذرى */}
        <article id="thura" aria-labelledby="thura-title" className={shelf.article}>
          <Band as="header" tone="aub" edge="crenel" pad="xs" padEnd="s" className={shelf.head}>
            <h2 id="thura-title" className={shelf.thuraName} data-reveal="" data-fx="band">
              {thura.name}
            </h2>
            <div className={shelf.headMeta} data-reveal="">
              {thura.status && <Tag large>{thura.status}</Tag>}
              <span className="t-body t-muted">{bare(thura.nameNote)}</span>
            </div>
          </Band>
          <Edge kind="crenel" color="coral" on="aub" size="lg" />
          <Band tone="sand" pad="l" padEnd="xs">
            <div className={layout.split}>
              <div className={layout.text}>
                <div className={layout.flow}>
                  <p className={shelf.meaning} data-reveal="">
                    <Lines text={thura.meaning} />
                  </p>
                  <p data-reveal="">
                    <Lines text={thura.definition} />
                  </p>
                </div>
              </div>
              {thuraSide && (
                <div className={layout.aside}>
                  <Figure id={thuraSide.id} alt={thuraSide.alt} sizes="(min-width: 1024px) 480px, 100vw" ratio="4 / 5" caption={noteFor(thuraSide.id).caption} />
                </div>
              )}
            </div>
          </Band>
          {thuraRest.length > 0 && (
            <div className={`${layout.mosaic} ${shelf.mosaic}`}>
              {thuraRest.map((photo) => (
                <Figure key={photo.id} id={photo.id} alt={photo.alt} sizes="(min-width: 1024px) 17vw, 50vw" ratio="3 / 4" scrub />
              ))}
            </div>
          )}
          <Band tone="sand" pad="l" padEnd="m">
            <div className={`${layout.measure} ${shelf.notes}`}>
              {(
                [
                  ['الرؤية', thura.vision],
                  ['الهدف', thura.goal],
                  ['الإلهام', thura.inspiration],
                ] as const
              ).map(([title, text]) => (
                <section key={title}>
                  <h3 className="t-h3" data-reveal="">
                    {title}
                  </h3>
                  <p className="t-read" data-reveal="">
                    <Lines text={text} />
                  </p>
                </section>
              ))}
            </div>
          </Band>
          {inspiration && <StatementBand text={inspiration} edge={false} />}

          {thura.flavours.length > 0 && (
            <Band tone="sand" pad="l" aria-labelledby="flavours-title">
              <h3 id="flavours-title" className={`t-h3 ${shelf.sectionTitle}`} data-reveal="">
                المنتجات
              </h3>
              <ol className={`${layout.lattice} ${shelf.flavours}`}>
                {thura.flavours.map((flavour) => (
                  <li key={flavour.name} data-tone="paper" className={shelf.flavour} data-reveal="">
                    {flavour.regions && flavour.regions.length === 3 && (
                      <>
                        <div aria-hidden="true" className={shelf.triangle}>
                          <span className={shelf.regionTop}>{flavour.regions[0]}</span>
                          <span className={shelf.triangleShape} />
                          <span className={shelf.regionStart}>{flavour.regions[1]}</span>
                          <span className={shelf.regionEnd}>{flavour.regions[2]}</span>
                        </div>
                        <p className="visually-hidden">المناطق: {flavour.regions.join('، ')}</p>
                      </>
                    )}
                    <h4 className={shelf.flavourName}>{flavour.name}</h4>
                    <p className="t-body">
                      <Lines text={flavour.description} />
                    </p>
                  </li>
                ))}
                <li aria-hidden="true" className={shelf.weaveCell} />
              </ol>
            </Band>
          )}

          <Band tone="sand" pad="none" padEnd="l">
            <div className={layout.measure}>
              <h3 className="t-h3" data-reveal="">
                الملهمون
              </h3>
              <ul className={shelf.inspirers} data-reveal="">
                {items(thura.inspirers).map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </div>
          </Band>

          <Band tone="aub" edge="crenel" pad="xl">
            <p className="t-band-xl t-accent" data-reveal="" data-fx="band">
              {bare(thura.slogan)}
            </p>
            <p className={`t-quote ${shelf.soon}`} data-reveal="">
              <Lines text={thura.comingSoonLine} />
            </p>
          </Band>
        </article>

        {/* كوب ضوء القمر */}
        <article id="moonlight" aria-labelledby="moon-title" className={shelf.article}>
          <Edge kind="weave" />
          <Band as="header" tone="saffron" pad="m" className={shelf.head}>
            <h2 id="moon-title" className="t-band-xl" data-reveal="" data-fx="band">
              {moon.title}
            </h2>
            <span data-reveal="">
              <Tag variant="ink" large>
                {moon.status}
              </Tag>
            </span>
          </Band>
          {moonRender && (
            <Band tone="paper" pad="m">
              <figure className={shelf.render} data-reveal="" data-fx="media">
                <Picture id={moonRender.id} alt={moonRender.alt} sizes="(min-width: 1100px) 1000px, 100vw" />
              </figure>
            </Band>
          )}
          <Band tone="sand" pad="l" padEnd="xs">
            <div className={layout.split}>
              <div className={layout.text}>
                <StoryText paras={moonFirst} />
              </div>
              {moonFactory && <StoryFigure id={moonFactory.id} alt={moonFactory.alt} />}
            </div>
          </Band>
          {moonLast.length > 0 && (
            <Band tone="sand" pad="xs" padEnd="l">
              <div className={`${layout.split} ${layout.splitEnd}`}>
                {moonInside && <StoryFigure id={moonInside.id} alt={moonInside.alt} />}
                <div className={layout.text}>
                  {moonRender2 && (
                    <figure data-tone="paper" className={shelf.renderSmall} data-reveal="" data-fx="media">
                      <Picture id={moonRender2.id} alt={moonRender2.alt} sizes="(min-width: 1024px) 700px, 100vw" />
                    </figure>
                  )}
                  <StoryText paras={moonLast} />
                </div>
              </div>
            </Band>
          )}
        </article>

        {/* بوتيك أنس القرني */}
        <article id="boutique" aria-labelledby="boutique-title" className={shelf.article}>
          <Band as="header" tone="coral" edge="crenel" pad="xs" padEnd="s" className={shelf.head}>
            <h2 id="boutique-title" className="t-band-xl" data-reveal="" data-fx="band">
              {boutique.title}
            </h2>
            {boutique.status && (
              <span data-reveal="">
                <Tag variant="ink" large>
                  {boutique.status}
                </Tag>
              </span>
            )}
          </Band>
          {boutiqueBlocks.map((block, i) =>
            block.kind === 'band' ? (
              <Band key={i} tone="aub" pad="m">
                <p className={`t-statement ${styles.bandLine}`} data-reveal="" data-fx="band">
                  <Lines text={block.text} />
                </p>
              </Band>
            ) : (
              <Band key={i} tone="sand" pad="l">
                <div className={layout.text}>
                  <StoryText paras={block.paras} />
                </div>
              </Band>
            ),
          )}
          <Band tone="sand" pad="s" padEnd="l">
            <p className={`t-read ${layout.measure}`} data-reveal="">
              <Lines text={boutique.closingLine} />
            </p>
          </Band>
        </article>
      </main>
      <RoomNav back={{ href: '/passed', label: 'مررتُ من هنا' }} next={{ href: '/book', label: 'كتبتُ هنا' }} nextTone="saffron" />
    </>
  )
}
