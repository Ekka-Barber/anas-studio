/**
 * المَشاهد (D39): moments from Anas's rooms, filed under his own categories
 * (his brief, section 1: أماكن · مشاريع · منتجات · رحلات · خلف الكواليس).
 * A category with no photograph yet is not offered as a filter. Film stills
 * use the video's poster (`<id>-poster`). Order is the gallery's order.
 */
export const SCENE_CATEGORIES = ['أماكن', 'مشاريع', 'منتجات', 'رحلات', 'خلف الكواليس'] as const
export type SceneCategory = (typeof SCENE_CATEGORIES)[number]

export interface Scene {
  id: string
  category: SceneCategory
  caption: string
}

export const SCENES: Scene[] = [
  { id: 'street4-street-sign', category: 'أماكن', caption: 'لوحة شارع رقم 4، تبوك' },
  { id: 'raha-drone-opening_landscape-poster', category: 'أماكن', caption: 'افتتاح رحى المكان' },
  { id: 'thura-70', category: 'منتجات', caption: 'ذرى' },
  { id: 'raha-coffee-roasting_HD-poster', category: 'خلف الكواليس', caption: 'تحميص القهوة في رحى' },
  { id: 'street4-majlis', category: 'أماكن', caption: 'مجلس البيت' },
  { id: 'factory-yellow-mug_upscaled', category: 'خلف الكواليس', caption: 'كوب ضوء القمر في المصنع' },
  { id: 'raha-poster-orange', category: 'مشاريع', caption: 'دعوة من رحى المكان' },
  { id: 'khous-standing-b', category: 'منتجات', caption: 'خوص | حكايات شارع 4' },
  { id: 'street4-school-gate', category: 'أماكن', caption: 'بوابة المدرسة' },
  { id: '26-murady-cake-and-coffee', category: 'مشاريع', caption: 'مرادي' },
  { id: 'thura-81', category: 'منتجات', caption: 'ذرى' },
  { id: 'factory-mug-inside_original-ONLY', category: 'خلف الكواليس', caption: 'توقيع أنس في قاع الكوب' },
  { id: 'raha-drone-branch_vertical-poster', category: 'أماكن', caption: 'فرع من فروع رحى' },
  { id: '32-arm-brownie-bites', category: 'مشاريع', caption: 'ارم' },
  { id: 'render-83', category: 'منتجات', caption: 'رسم كوب ضوء القمر' },
  { id: 'street4-closed-door', category: 'أماكن', caption: 'باب من الحي' },
  { id: '31-murady-french-toast-banana', category: 'مشاريع', caption: 'مرادي' },
  { id: 'thura-77', category: 'منتجات', caption: 'ذرى بورق الذهب' },
  { id: 'raha-reel-community-poster', category: 'أماكن', caption: 'الحي حول رحى' },
]
