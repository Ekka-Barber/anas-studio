/**
 * المَشاهد (D39): Anas's own categories for the scenes (his brief, section 1:
 * أماكن · مشاريع · منتجات · رحلات · خلف الكواليس). They stay fixed in code;
 * the photos, their order and captions are the `scenes` collection (C05,
 * `src/admin/collections/scenes.ts`), whose category field offers only these.
 */
export const SCENE_CATEGORIES = ['أماكن', 'مشاريع', 'منتجات', 'رحلات', 'خلف الكواليس'] as const
export type SceneCategory = (typeof SCENE_CATEGORIES)[number]
