import type { SceneItem } from '../components/public/scenes/SceneGallery'
import { SCENE_CATEGORIES, type SceneCategory } from '../content/scenes'

import type { Scene } from './content'
import { imageSources } from './images'

/**
 * The scenes page's tiles and filters (C05, D39), worked out on the server
 * so the client gallery receives only what it shows, never the image
 * manifest. A photo whose files cannot be found (an unresolved library id)
 * is left out, and a category with no photo left is not offered as a
 * filter. Keys are positions, so the same photo may appear twice.
 */
export function sceneGallery(scenes: readonly Scene[]): { items: SceneItem[]; categories: SceneCategory[] } {
  const items = scenes.flatMap((scene, index) => {
    const sources = imageSources(scene.image)
    return sources ? [{ key: String(index), category: scene.category, caption: scene.caption, sources }] : []
  })
  const categories = SCENE_CATEGORIES.filter((category) => items.some((item) => item.category === category))
  return { items, categories }
}
