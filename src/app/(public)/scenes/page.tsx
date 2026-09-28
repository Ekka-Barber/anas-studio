import type { Metadata } from 'next'

import { type SceneItem, SceneGallery } from '@/components/public/scenes/SceneGallery'
import { SCENE_CATEGORIES, SCENES } from '@/content/scenes'
import { imageSources } from '@/lib/images'

export const metadata: Metadata = { title: 'المَشاهد' }

/**
 * المَشاهد (D39): the gallery's files are worked out here, on the server, so
 * the client gallery receives only what it shows, never the image manifest.
 */
export default function ScenesPage() {
  const items: SceneItem[] = SCENES.flatMap((scene) => {
    const sources = imageSources(scene.id)
    return sources ? [{ key: scene.id, category: scene.category, caption: scene.caption, sources }] : []
  })
  const categories = SCENE_CATEGORIES.filter((category) => items.some((item) => item.category === category))
  return (
    <main id="main">
      <SceneGallery items={items} categories={categories} />
    </main>
  )
}
