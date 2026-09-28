import { RoomHero } from '@/components/public/RoomHero'
import { classify, toBlocks, type Block, type Para } from '@/components/public/story/flow'
import { StatementBand, StoryFigure, StoryText } from '@/components/public/story/Story'
import { Picture } from '@/components/public/Picture'
import { Band } from '@/components/weave/Band'
import { Edge } from '@/components/weave/Edge'
import layout from '@/components/weave/layout.module.css'
import { Lines } from '@/components/weave/Lines'
import { RoomNav } from '@/components/weave/RoomNav'
import { Signature } from '@/components/weave/Signature'
import { VideoTile } from '@/components/weave/VideoTile'
import { FILM_CAPTIONS } from '@/content/media-notes'
import type { BuiltRoom } from '@/lib/content'

import styles from './rooms.module.css'
import built from './built.module.css'

/**
 * بنيتُ هنا (D39, direction B): رحى المكان. The composition, top to bottom:
 * the aubergine title band with the رحى mark; two upright films side by
 * side; the story of how he arrived, broken by its coral band and the
 * opening film; «لم أكن وحدي» on aubergine with the team's films; the seven
 * branches on saffron; and the closing on aubergine, where his signature
 * meets the رحى mark.
 *
 * Which films go where is decided by id; any other visible film joins the
 * team band, so a film unhidden in the admin always appears.
 */
const HERO_FILMS = ['raha-drone-branch_vertical', 'raha-coffee-roasting_HD']

function RahaMark({ room, size }: { room: BuiltRoom; size: 'hero' | 'end' }) {
  return (
    <span data-tone="paper" className={size === 'hero' ? built.markHero : built.markEnd}>
      <Picture
        id={room.media.logo.id}
        alt={size === 'hero' ? room.media.logo.alt : ''}
        sizes={size === 'hero' ? '96px' : '48px'}
        className={built.logo}
      />
      {size === 'hero' ? (
        <span className={built.markName}>{room.signature}</span>
      ) : (
        <span className={built.markStack}>
          <span className={built.markName}>{room.refrain}</span>
          <span className="t-label t-muted">{room.signature}</span>
        </span>
      )}
    </span>
  )
}

/** A text run, and the picture beside it when there is one. */
function TextRun({ paras, figure, end = 'l' }: { paras: Para[]; figure?: string | null; end?: 'l' | 'xs' }) {
  return (
    <Band tone="sand" pad="l" padEnd={end}>
      <div className={layout.split}>
        <div className={layout.text}>
          <StoryText paras={paras} />
        </div>
        <StoryFigure id={figure} />
      </div>
    </Band>
  )
}

export function BuiltRoomView({ room }: { room: BuiltRoom }) {
  const reels = room.media.reels
  const heroFilms = reels.filter((reel) => HERO_FILMS.includes(reel.id))
  const teamFilms = reels.filter((reel) => !HERO_FILMS.includes(reel.id))

  // The arrival: the room's opening line, then the intro, split at its band.
  const intro: Block[] = toBlocks([
    { text: room.heroLine, kind: 'display' },
    ...classify(room.intro.paragraphs, room.pullLines, room.bandLines),
  ])
  const [team, branches] = room.movements
  const teamParas = team ? classify(team.paragraphs, room.pullLines, room.bandLines) : []
  const branchParas = branches ? classify(branches.paragraphs, room.pullLines, room.bandLines) : []
  const closing = room.closing.paragraphs
  const closingBand = closing[closing.length - 1]
  const afterBranches: Para[] = [
    ...branchParas.filter((para) => para.text !== branches?.label),
    ...closing.slice(0, -1).map((text) => ({ text, kind: 'body' as const })),
  ]
  // The poster stands beside the text after the band.
  const firstBand = intro.findIndex((block) => block.kind === 'band')

  return (
    <>
      <main id="main">
        <RoomHero tone={room.jewel} title={room.title} tagline={room.tagline} aside={<RahaMark room={room} size="hero" />} />

        {heroFilms.length > 0 && (
          <div className={built.filmPair}>
            {heroFilms.map((reel, i) => (
              <div key={reel.id} data-reveal="" data-fx="media" data-delay={i * 120} className={built.filmCell}>
                <VideoTile id={reel.id} alt={reel.alt} ratio="9 / 14" />
              </div>
            ))}
          </div>
        )}
        <Edge kind="weave" />

        <article>
          {intro.map((block, i) => {
            if (block.kind === 'band') {
              return (
                <div key={i}>
                  <StatementBand text={block.text} size="band" heading />
                  <figure className={built.openingFilm}>
                    <div className="motion-expand">
                      <VideoTile id={room.media.droneFilm.id} alt={room.media.droneFilm.alt} ratio="16 / 9" large />
                    </div>
                    {FILM_CAPTIONS[room.media.droneFilm.id] && (
                      <figcaption data-tone="aub" className={`t-label ${built.filmCaption}`}>
                        {FILM_CAPTIONS[room.media.droneFilm.id]}
                      </figcaption>
                    )}
                  </figure>
                  <Edge kind="weave" />
                </div>
              )
            }
            const afterBand = firstBand !== -1 && i > firstBand
            return <TextRun key={i} paras={block.paras} figure={afterBand ? room.intro.vignette : null} end="xs" />
          })}

          {team && (
            <>
              <Band tone="aub" pad="s" aria-label={team.label} className={built.team}>
                <div className={built.teamText}>
                  {/* The movement's first line is its label: the <h2>. */}
                  <StoryText paras={teamParas.slice(0, 2)} heading />
                </div>
                {teamFilms.map((reel, i) => (
                  <figure key={reel.id} className={built.teamFilm} data-reveal="" data-fx="media" data-delay={i * 120}>
                    <VideoTile id={reel.id} alt={reel.alt} ratio="9 / 16" />
                    {FILM_CAPTIONS[reel.id] && <figcaption className={built.teamCaption}>{FILM_CAPTIONS[reel.id]}</figcaption>}
                  </figure>
                ))}
              </Band>
              {teamParas.length > 2 && (
                <Band tone="sand" pad="l">
                  <div className={layout.text}>
                    <StoryText paras={teamParas.slice(2)} />
                  </div>
                </Band>
              )}
            </>
          )}

          {branches && (
            <>
              <Band tone="saffron" edge="crenel" pad="l" aria-label={branches.label}>
                <h2 className={`t-band ${styles.bandLine}`} data-reveal="" data-fx="band">
                  <Lines text={branches.label} />
                </h2>
                {/* Seven triangles for the seven branches the line names. */}
                <div aria-hidden="true" className={built.branches} data-reveal="" data-seq="">
                  {Array.from({ length: 7 }, (_, i) => (
                    <span key={i} />
                  ))}
                </div>
              </Band>
              <Band tone="sand" pad="l">
                <div className={layout.text}>
                  <StoryText paras={afterBranches} />
                </div>
              </Band>
            </>
          )}

          <Band tone="aub" edge="crenel" pad="xl" aria-label="الخاتمة">
            {closingBand && (
              <h2 className={`t-band ${built.closingLine}`} data-reveal="" data-fx="band">
                <Lines text={closingBand} />
              </h2>
            )}
            <p className="t-band-xl t-accent" data-reveal="" data-fx="band" data-delay={200}>
              <Lines text={room.closing.displayLine} />
            </p>
            <div className={built.closingSign} data-reveal="">
              <Signature width={220} reveal={false} />
              <RahaMark room={room} size="end" />
            </div>
          </Band>
        </article>
      </main>
      <RoomNav back={{ href: '/started', label: 'بدأتُ من هنا' }} next={{ href: '/passed', label: 'مررتُ من هنا' }} nextTone="coral" />
    </>
  )
}
