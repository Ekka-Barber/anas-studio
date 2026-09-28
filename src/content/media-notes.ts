/**
 * Alt text and captions for images the CMS stores as a bare id (a room's or
 * a movement's picture field has no alt of its own). Keyed by image id; an
 * image not listed here is treated as decorative (empty alt). Lists that
 * carry their own `alt` in the CMS (galleries, photos) never read this.
 */
export interface MediaNote {
  alt: string
  caption?: string
  /** A crop for a tall picture beside text, e.g. "4 / 5", and its focus. */
  ratio?: string
  focus?: string
  /** A link the caption leads to, with its label. */
  link?: { href: string; label: string }
}

export const MEDIA_NOTES: Record<string, MediaNote> = {
  '31-murady-french-toast-banana': {
    alt: 'توست فرنسي بالموز من مرادي',
    caption: 'مرادي',
    link: { href: '/passed', label: 'مررتُ من هنا' },
  },
  '28-gold-tarts': { alt: 'تارت مغطّى بورق الذهب' },
  'raha-poster-orange': {
    alt: 'ملصق دعوة من رحى المكان: رسوم خطية كريمية على برتقالي وعصفور صغير',
    caption: 'دعوة من رحى المكان',
    ratio: '4 / 5',
    focus: '50% 40%',
  },
  'thura-70': { alt: 'قطعة ذرى على بطاقتها الباذنجانية بمثلثات مرجانية وتوقيع أنس', caption: 'ذرى على بطاقتها' },
  'factory-yellow-mug_upscaled': { alt: 'كوب ضوء القمر الأصفر بزهوره المرسومة في المصنع', caption: 'في المصنع' },
  'factory-mug-inside_original-ONLY': {
    alt: 'داخل الكوب: اسم ضوء القمر على الحافة وتوقيع أنس في القاع',
    caption: 'اسم الكوب على حافته، وتوقيعه في قاعه',
  },
}

/** Captions for films, by video id. */
export const FILM_CAPTIONS: Record<string, string> = {
  'raha-drone-opening_landscape': 'من افتتاح رحى المكان',
  'raha-roaster-drivethru-slogan': 'اتسعت الدار وحيّ الله الجار',
}

export function noteFor(id: string | null | undefined): MediaNote {
  return (id && MEDIA_NOTES[id]) || { alt: '' }
}
