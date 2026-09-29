import type { Metadata } from 'next'

import { SceneGallery } from '@/components/public/scenes/SceneGallery'
import { Band } from '@/components/weave/Band'
import { getScenes } from '@/lib/content'
import { sceneGallery } from '@/lib/scenes'

export const metadata: Metadata = { title: 'المَشاهد' }

/**
 * المَشاهد (D39): the published gallery (C05), shaped on the server by
 * `sceneGallery`. With nothing to show, the grid stays empty and says so.
 */
export default async function ScenesPage() {
  const { items, categories } = sceneGallery(await getScenes())
  return (
    <main id="main">
      <SceneGallery items={items} categories={categories} />
      {items.length === 0 && (
        <Band tone="sand" pad="l">
          <p>لا توجد مَشاهد بعد.</p>
        </Band>
      )}
    </main>
  )
}
