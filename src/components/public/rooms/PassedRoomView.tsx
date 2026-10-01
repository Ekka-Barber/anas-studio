import { RoomHero } from '@/components/public/RoomHero'
import { classify, storyPictures, toBlocks, type Para } from '@/components/public/story/flow'
import { StatementBand, StoryFigure, StoryText } from '@/components/public/story/Story'
import { Picture } from '@/components/public/Picture'
import { Band } from '@/components/weave/Band'
import { Figure } from '@/components/weave/Figure'
import layout from '@/components/weave/layout.module.css'
import { Lines } from '@/components/weave/Lines'
import { RoomNav } from '@/components/weave/RoomNav'
import { Signature } from '@/components/weave/Signature'
import { VideoTile } from '@/components/weave/VideoTile'
import type { PassedRoom } from '@/lib/content'

import passed from './passed.module.css'

/**
 * مررتُ من هنا (D39, direction B): the eleven brands as a woven wall, then
 * the story in parts split by its band, each part with the next of its
 * pictures beside it, the ارم films, and the products he made, edge to edge.
 */
// The pictures beside the story's parts, in order, and the brand whose
// films close it. Each is used only while it is still in the room's lists.
const STORY_PICTURES = ['31-murady-french-toast-banana', '28-gold-tarts']
const FILM_BRAND = 'arm'
// Captions for the product photos whose brand is confirmed (PACK-INDEX).
const PRODUCT_BRANDS: Record<string, string> = {
  '32-arm-brownie-bites': 'ارم',
  '26-murady-cake-and-coffee': 'مرادي',
}

export function PassedRoomView({ room }: { room: PassedRoom }) {
  const gallery = room.media.gallery
  const paras: Para[] = [{ text: room.heroLine, kind: 'display' }, ...classify(room.paragraphs, room.pullLines, room.bandLines)]
  const blocks = toBlocks(paras)
  // A picture stands beside a text block; one with no block left stays with the products.
  const pictures = storyPictures(STORY_PICTURES, gallery, blocks)
  const brand = room.media.brandWall.find((entry) => entry.id === FILM_BRAND)
  const shownProducts = gallery.filter((photo) => !pictures.includes(photo.id))
  let text = 0

  return (
    <>
      <main id="main">
        <RoomHero tone={room.jewel} title={room.title} tagline={room.tagline} />

        {room.media.brandWall.length > 0 && (
          <Band tone="sand" pad="m" aria-label="العلامات">
            <ul className={`${layout.lattice} ${passed.brands}`}>
              {room.media.brandWall.map((entry, i) => (
                <li key={entry.id} data-tone="paper" className={passed.brand} data-reveal="" data-delay={(i % 6) * 50}>
                  <Picture id={entry.id} alt="" sizes="112px" className={passed.brandLogo} />
                  <span className={passed.brandName}>{entry.name}</span>
                </li>
              ))}
              <li aria-hidden="true" className={passed.brandFill} />
            </ul>
          </Band>
        )}

        <article>
          {blocks.map((block, i) => {
            if (block.kind === 'band') return <StatementBand key={i} text={block.text} heading />
            const figure = pictures[text++]
            const photo = gallery.find((p) => p.id === figure)
            return (
              <Band key={i} tone="sand" pad={i === 0 ? 'xs' : 'l'} padEnd="xs">
                <div className={layout.split}>
                  <div className={layout.text}>
                    <StoryText paras={block.paras} />
                  </div>
                  <StoryFigure id={figure} alt={photo?.alt} room="/passed" />
                </div>
              </Band>
            )
          })}

          {room.media.reels.length > 0 && (
            <Band tone="aub" pad="s" aria-label={brand ? `مقاطع من ${brand.name}` : 'مقاطع'} className={passed.films}>
              {room.media.reels.map((reel, i) => (
                <figure key={reel.id} className={passed.film} data-reveal="" data-fx="media" data-delay={i * 120}>
                  <VideoTile id={reel.id} alt={reel.alt} ratio="1 / 1" />
                </figure>
              ))}
              {brand && (
                <div className={passed.filmBrand}>
                  <Picture id={brand.id} alt="" sizes="64px" className={passed.filmLogo} />
                  <span className="t-h3">{brand.name}</span>
                </div>
              )}
            </Band>
          )}

          <Band tone="sand" pad="l">
            <div className={layout.measure}>
              <p className="t-display" data-reveal="">
                <Lines text={room.closingLine} />
              </p>
              <Signature width={220} className={passed.signature} />
            </div>
          </Band>
        </article>

        {shownProducts.length > 0 && (
          <section aria-label="منتجات">
            {room.galleryLine && (
              <Band tone="paper" edge="crenel" pad="m">
                <h2 className={`t-display ${passed.galleryLine}`} data-reveal="">
                  <Lines text={room.galleryLine} />
                </h2>
              </Band>
            )}
            <div className={`${layout.mosaic} ${passed.products}`}>
              {shownProducts.map((photo) => (
                <Figure
                  key={photo.id}
                  id={photo.id}
                  alt={photo.alt}
                  sizes="(min-width: 1024px) 25vw, 50vw"
                  ratio="1 / 1"
                  scrub
                  caption={PRODUCT_BRANDS[photo.id]}
                  captionPlacement="corner"
                  className={passed.product}
                />
              ))}
            </div>
          </section>
        )}
      </main>
      <RoomNav back={{ href: '/built', label: 'بنيتُ هنا' }} next={{ href: '/shelf', label: 'على الرف' }} nextTone="paper" />
    </>
  )
}
