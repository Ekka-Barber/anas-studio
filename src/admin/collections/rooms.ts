import { z } from 'zod'

import { type Field, schemaFromFields } from '../fields'

/**
 * `rooms`: five fixed documents (`started`, `built`, `passed`, `shelf`, `book`),
 * each with its own fields matching `src/lib/content.ts`'s interfaces
 * exactly. Sections that are lists — movements, reels, the passed room's
 * brand wall and product gallery — are hideable: the admin can hide an item
 * without deleting it, and the public loader drops hidden items.
 *
 * D39 (direction B): the stored field `jewel` is the room's colour, the band
 * its page opens on; `tagline` is the room's line under its title and on
 * the home page; `pullLines` and `bandLines` name the paragraphs set as a
 * large line or as a full-width coloured band (each must repeat a paragraph
 * exactly). The field keeps its v1 name so stored documents stay valid.
 *
 * The rooms have no `slug` field: their routes are fixed and nothing reads a
 * room's slug. Stored documents that still carry one stay valid (the schema
 * drops unknown keys) and the form keeps the key when it saves.
 */
export const jewelSchema = z.enum(['coral', 'aub', 'saffron', 'paper'])
export const JEWEL_FIELD = {
  name: 'jewel',
  label: 'لون الغرفة',
  type: 'select',
  options: ['coral', 'aub', 'saffron', 'paper'],
  optionLabels: { coral: 'مرجاني', aub: 'باذنجاني', saffron: 'زعفراني', paper: 'رملي' },
} as const satisfies Field

const TAGLINE_FIELD = { name: 'tagline', label: 'سطر الغرفة', type: 'text' } as const satisfies Field
const PULL_LINES_OPTIONAL = { name: 'pullLines', label: 'أسطر كبيرة', type: 'paragraphs', required: false } as const satisfies Field
const BAND_LINES = { name: 'bandLines', label: 'أسطر على شريط ملوّن', type: 'paragraphs', required: false } as const satisfies Field

export const reelMediaFields = [
  { name: 'id', label: 'المعرّف', type: 'video' },
  { name: 'alt', label: 'الوصف البديل', type: 'text' },
] as const satisfies Field[]
export const reelMediaSchema = schemaFromFields(reelMediaFields)

export const galleryPhotoFields = [
  { name: 'id', label: 'المعرّف', type: 'image' },
  { name: 'alt', label: 'الوصف البديل', type: 'text' },
] as const satisfies Field[]
export const galleryPhotoSchema = schemaFromFields(galleryPhotoFields)

// --- بدأتُ من هنا -----------------------------------------------------
export const startedMovementFields = [
  { name: 'year', label: 'السنة', type: 'text' },
  { name: 'vignette', label: 'الصورة', type: 'image', nullable: true },
  { name: 'paragraphs', label: 'الفقرات', type: 'paragraphs' },
  { name: 'films', label: 'تظهر المقاطع هنا', type: 'boolean', required: false },
] as const satisfies Field[]
export const startedMovementSchema = schemaFromFields(startedMovementFields)

export const startedRoomFields = [
  { name: 'roomLabel', label: 'تسمية الغرفة', type: 'text' },
  { name: 'title', label: 'العنوان', type: 'text', nonBlank: true },
  TAGLINE_FIELD,
  JEWEL_FIELD,
  { name: 'heroLine', label: 'سطر البداية', type: 'text' },
  { name: 'movements', label: 'المحطّات', type: 'list', fields: startedMovementFields, hideable: true },
  { name: 'pullLines', label: 'أسطر كبيرة', type: 'paragraphs' },
  BAND_LINES,
  { name: 'closingLine', label: 'سطر الختام', type: 'text' },
  { name: 'signature', label: 'التوقيع', type: 'text' },
  {
    name: 'media',
    label: 'الوسائط',
    type: 'group',
    fields: [{ name: 'reels', label: 'المقاطع', type: 'list', fields: reelMediaFields, hideable: true }],
  },
] as const satisfies Field[]
export const startedRoomSchema = schemaFromFields(startedRoomFields)

// --- بنيتُ هنا ----------------------------------------------------------
export const builtMovementFields = [
  { name: 'label', label: 'العنوان', type: 'text' },
  { name: 'paragraphs', label: 'الفقرات', type: 'paragraphs' },
] as const satisfies Field[]
export const builtMovementSchema = schemaFromFields(builtMovementFields)

export const builtRoomFields = [
  { name: 'roomLabel', label: 'تسمية الغرفة', type: 'text' },
  { name: 'title', label: 'العنوان', type: 'text', nonBlank: true },
  TAGLINE_FIELD,
  JEWEL_FIELD,
  { name: 'heroLine', label: 'سطر البداية', type: 'text' },
  {
    name: 'intro',
    label: 'المقدمة',
    type: 'group',
    fields: [
      { name: 'vignette', label: 'الصورة', type: 'image', nullable: true },
      { name: 'paragraphs', label: 'الفقرات', type: 'paragraphs' },
    ],
  },
  { name: 'movements', label: 'المحطّات', type: 'list', fields: builtMovementFields, hideable: true },
  {
    name: 'closing',
    label: 'الختام',
    type: 'group',
    fields: [
      { name: 'paragraphs', label: 'الفقرات', type: 'paragraphs' },
      { name: 'displayLine', label: 'سطر العرض', type: 'text' },
    ],
  },
  PULL_LINES_OPTIONAL,
  BAND_LINES,
  { name: 'refrain', label: 'اللازمة', type: 'text' },
  { name: 'signature', label: 'التوقيع', type: 'text' },
  {
    name: 'media',
    label: 'الوسائط',
    type: 'group',
    fields: [
      {
        name: 'logo',
        label: 'الشعار',
        type: 'group',
        fields: [
          { name: 'id', label: 'المعرّف', type: 'image' },
          { name: 'alt', label: 'الوصف البديل', type: 'text' },
        ],
      },
      { name: 'reels', label: 'المقاطع', type: 'list', fields: reelMediaFields, hideable: true },
      { name: 'droneFilm', label: 'اللقطة الجوية', type: 'group', fields: reelMediaFields },
    ],
  },
] as const satisfies Field[]
export const builtRoomSchema = schemaFromFields(builtRoomFields)

// --- مررتُ من هنا --------------------------------------------------------
export const brandFields = [
  { name: 'id', label: 'المعرّف', type: 'image' },
  { name: 'name', label: 'الاسم', type: 'text' },
] as const satisfies Field[]
export const brandSchema = schemaFromFields(brandFields)

export const passedRoomFields = [
  { name: 'roomLabel', label: 'تسمية الغرفة', type: 'text' },
  { name: 'title', label: 'العنوان', type: 'text', nonBlank: true },
  TAGLINE_FIELD,
  JEWEL_FIELD,
  { name: 'heroLine', label: 'سطر البداية', type: 'text' },
  { name: 'paragraphs', label: 'الفقرات', type: 'paragraphs' },
  { name: 'pullLines', label: 'أسطر كبيرة', type: 'paragraphs' },
  BAND_LINES,
  { name: 'closingLine', label: 'سطر الختام', type: 'text' },
  { name: 'galleryLine', label: 'سطر معرض المنتجات', type: 'text', required: false },
  {
    name: 'media',
    label: 'الوسائط',
    type: 'group',
    fields: [
      { name: 'reels', label: 'المقاطع', type: 'list', fields: reelMediaFields, hideable: true },
      { name: 'brandWall', label: 'جدار العلامات', type: 'list', fields: brandFields, hideable: true },
      { name: 'gallery', label: 'معرض المنتجات', type: 'list', fields: galleryPhotoFields, hideable: true },
    ],
  },
] as const satisfies Field[]
export const passedRoomSchema = schemaFromFields(passedRoomFields)

// --- على الرف -------------------------------------------------------------
export const thuraFlavourFields = [
  { name: 'name', label: 'الاسم', type: 'text' },
  { name: 'description', label: 'الوصف', type: 'textarea' },
  { name: 'regions', label: 'المناطق الثلاث', type: 'paragraphs', required: false },
] as const satisfies Field[]
export const thuraFlavourSchema = schemaFromFields(thuraFlavourFields)

export const thuraItemFields = [
  { name: 'name', label: 'الاسم', type: 'text' },
  { name: 'nameNote', label: 'ملاحظة النطق', type: 'text' },
  { name: 'meaning', label: 'المعنى', type: 'textarea' },
  { name: 'definition', label: 'التعريف', type: 'textarea' },
  { name: 'vision', label: 'الرؤية', type: 'textarea' },
  { name: 'goal', label: 'الهدف', type: 'textarea' },
  { name: 'flavours', label: 'النكهات', type: 'list', fields: thuraFlavourFields },
  { name: 'inspiration', label: 'الإلهام', type: 'textarea' },
  { name: 'inspirers', label: 'الملهِمون', type: 'textarea' },
  { name: 'slogan', label: 'الشعار', type: 'text' },
  { name: 'comingSoonLine', label: 'سطر قريباً', type: 'text' },
  { name: 'status', label: 'الحالة', type: 'text', required: false },
  { name: 'photos', label: 'الصور', type: 'list', fields: galleryPhotoFields },
] as const satisfies Field[]
export const thuraItemSchema = schemaFromFields(thuraItemFields)

export const moonlightCupItemFields = [
  { name: 'title', label: 'العنوان', type: 'text' },
  { name: 'paragraphs', label: 'الفقرات', type: 'paragraphs' },
  PULL_LINES_OPTIONAL,
  { name: 'status', label: 'الحالة', type: 'text' },
  { name: 'images', label: 'الصور', type: 'list', fields: galleryPhotoFields },
] as const satisfies Field[]
export const moonlightCupItemSchema = schemaFromFields(moonlightCupItemFields)

export const boutiqueItemFields = [
  { name: 'title', label: 'العنوان', type: 'text' },
  { name: 'paragraphs', label: 'الفقرات', type: 'paragraphs' },
  BAND_LINES,
  { name: 'status', label: 'الحالة', type: 'text', required: false },
  { name: 'closingLine', label: 'سطر الختام', type: 'text' },
] as const satisfies Field[]
export const boutiqueItemSchema = schemaFromFields(boutiqueItemFields)

export const shelfRoomFields = [
  { name: 'roomLabel', label: 'تسمية الغرفة', type: 'text' },
  { name: 'title', label: 'العنوان', type: 'text', nonBlank: true },
  TAGLINE_FIELD,
  JEWEL_FIELD,
  {
    name: 'items',
    label: 'العناصر',
    type: 'group',
    fields: [
      { name: 'thura', label: 'ذرى', type: 'group', fields: thuraItemFields },
      { name: 'moonlightCup', label: 'كوب ضوء القمر', type: 'group', fields: moonlightCupItemFields },
      { name: 'boutique', label: 'بوتيك أنس القرني', type: 'group', fields: boutiqueItemFields },
    ],
  },
] as const satisfies Field[]
export const shelfRoomSchema = schemaFromFields(shelfRoomFields)

// --- كتبتُ هنا ---------------------------------------------------------------
// The book's page (D39): «خوص | حكايات شارع 4». It has no `jewel` or `tagline`:
// its band is always saffron and the home page reads its title, line and
// status. `characters` are named by their lines in the manuscript, nothing more.
export const bookExcerptFields = [
  { name: 'text', label: 'النص', type: 'textarea' },
  { name: 'source', label: 'المصدر', type: 'text' },
] as const satisfies Field[]

export const bookCharacterFields = [
  { name: 'name', label: 'الاسم', type: 'text', nonBlank: true },
  { name: 'line', label: 'السطر', type: 'textarea' },
  { name: 'source', label: 'المصدر', type: 'text' },
] as const satisfies Field[]

export const bookPhotoFields = [
  ...galleryPhotoFields,
  { name: 'caption', label: 'التعليق', type: 'text' },
  // A CSS object-position such as `50% 36%`, for a picture that crops badly at the centre.
  { name: 'focus', label: 'نقطة التركيز', type: 'text', required: false },
] as const satisfies Field[]

export const bookEditionFields = [
  { name: 'name', label: 'الاسم', type: 'text' },
  { name: 'text', label: 'الوصف', type: 'textarea' },
  // The store variant this edition is sold as, by its SKU (the variant's «رمز SKU» in the store): an edition is one
  // variant, so the card shows that variant's own price and a link to its product. Empty, unknown or unpriced, the card
  // says «يُعلن قريباً». No publish rule: a SKU that matches nothing only leaves the card as it was. The pattern is the
  // variants form's own, so a mistyped SKU is named at save.
  {
    name: 'variantSku',
    label: 'رمز SKU للنسخة في المتجر',
    type: 'text',
    required: false,
    pattern: { regex: /^(?:[A-Za-z0-9][A-Za-z0-9-]{0,39})?$/, message: 'حروف لاتينية وأرقام وشرطات، من 1 إلى 40، ولا يبدأ بشرطة.' },
    hint: 'متى كان لهذا الرمز سعر في المتجر ظهر سعره ورابط الطلب على البطاقة في الصفحة المنشورة، لا في المعاينة.',
  },
] as const satisfies Field[]

export const bookRoomFields = [
  { name: 'roomLabel', label: 'تسمية الغرفة', type: 'text' },
  { name: 'title', label: 'العنوان', type: 'text', nonBlank: true },
  { name: 'subtitle', label: 'العنوان الفرعي', type: 'text' },
  { name: 'author', label: 'المؤلف', type: 'text' },
  { name: 'line', label: 'السطر', type: 'text' },
  { name: 'cover', label: 'الغلاف', type: 'group', fields: galleryPhotoFields },
  { name: 'standing', label: 'الكتاب واقفاً', type: 'group', fields: galleryPhotoFields },
  { name: 'spine', label: 'الكعب', type: 'group', fields: galleryPhotoFields },
  { name: 'bookmark', label: 'فاصل الخوص', type: 'group', fields: galleryPhotoFields },
  {
    name: 'about',
    label: 'نبذة',
    type: 'group',
    fields: [
      { name: 'kicker', label: 'العبارة الأولى', type: 'text' },
      { name: 'line', label: 'السطر', type: 'text' },
      { name: 'passage', label: 'الفقرات', type: 'paragraphs' },
      { name: 'source', label: 'المصدر', type: 'text' },
    ],
  },
  { name: 'excerpts', label: 'اقتباسات', type: 'list', fields: bookExcerptFields },
  { name: 'characters', label: 'الشخصيات', type: 'list', fields: bookCharacterFields },
  { name: 'photos', label: 'صور', type: 'list', fields: bookPhotoFields },
  {
    name: 'journey',
    label: 'رحلة الكتاب',
    type: 'group',
    fields: [
      { name: 'title', label: 'العنوان', type: 'text' },
      { name: 'passage', label: 'الفقرات', type: 'paragraphs' },
      { name: 'source', label: 'المصدر', type: 'text' },
    ],
  },
  { name: 'status', label: 'الحالة', type: 'paragraphs' },
  { name: 'editions', label: 'النسخ', type: 'list', fields: bookEditionFields },
] as const satisfies Field[]
export const bookRoomSchema = schemaFromFields(bookRoomFields)

export const roomSchemas = {
  started: startedRoomSchema,
  built: builtRoomSchema,
  passed: passedRoomSchema,
  shelf: shelfRoomSchema,
  book: bookRoomSchema,
} as const
export type RoomSlug = keyof typeof roomSchemas

/**
 * The publish rule for `pullLines` and `bandLines`: the public page matches
 * them to a paragraph by exact text (`classify`, story/flow.ts), so a line
 * that no longer repeats one, after a typo fix in the paragraph, is silently
 * set as plain text. Only the form and the publish gate (`schemaFor`) run it;
 * the loaders keep the lenient schemas above, so a mismatch never stops the build.
 */
export const LINE_NOT_A_PARAGRAPH_ERROR = 'هذا السطر لا يطابق أي فقرة حرفيًا.'

function repeatsAParagraph(
  ctx: z.RefinementCtx,
  path: (string | number)[],
  lines: readonly string[] | undefined,
  paragraphs: readonly string[],
) {
  const known = new Set(paragraphs)
  lines?.forEach((line, index) => {
    if (!known.has(line)) ctx.addIssue({ code: 'custom', path: [...path, index], message: LINE_NOT_A_PARAGRAPH_ERROR })
  })
}

/**
 * The publish rule for a photo's words (ADMIN-CMS-09): an image that is set needs its alt, for those who cannot see it.
 * Only the publish gate runs it; a draft saves with the alt blank, and the loaders keep the lenient schemas.
 */
export const PHOTO_ALT_ERROR = 'اكتب الوصف البديل للصورة.'

type Photo = { id: string; alt: string }

function altIsWritten(ctx: z.RefinementCtx, path: (string | number)[], photo: Photo | undefined) {
  if (photo !== undefined && photo.id !== '' && photo.alt.trim() === '') {
    ctx.addIssue({ code: 'custom', path: [...path, 'alt'], message: PHOTO_ALT_ERROR })
  }
}

function altsAreWritten(ctx: z.RefinementCtx, path: (string | number)[], photos: readonly Photo[] | undefined) {
  photos?.forEach((photo, index) => altIsWritten(ctx, [...path, index], photo))
}

export const roomPublishSchemas = {
  started: startedRoomSchema.superRefine((room, ctx) => {
    const paragraphs = room.movements.flatMap((movement) => movement.paragraphs)
    repeatsAParagraph(ctx, ['pullLines'], room.pullLines, paragraphs)
    repeatsAParagraph(ctx, ['bandLines'], room.bandLines, paragraphs)
  }),
  built: builtRoomSchema.superRefine((room, ctx) => {
    const paragraphs = [
      ...room.intro.paragraphs,
      ...room.movements.flatMap((movement) => movement.paragraphs),
      ...room.closing.paragraphs,
    ]
    repeatsAParagraph(ctx, ['pullLines'], room.pullLines, paragraphs)
    repeatsAParagraph(ctx, ['bandLines'], room.bandLines, paragraphs)
    altIsWritten(ctx, ['media', 'logo'], room.media.logo)
  }),
  passed: passedRoomSchema.superRefine((room, ctx) => {
    repeatsAParagraph(ctx, ['pullLines'], room.pullLines, room.paragraphs)
    repeatsAParagraph(ctx, ['bandLines'], room.bandLines, room.paragraphs)
    altsAreWritten(ctx, ['media', 'gallery'], room.media.gallery)
  }),
  shelf: shelfRoomSchema.superRefine((room, ctx) => {
    const { thura, moonlightCup, boutique } = room.items
    repeatsAParagraph(ctx, ['items', 'moonlightCup', 'pullLines'], moonlightCup.pullLines, moonlightCup.paragraphs)
    repeatsAParagraph(ctx, ['items', 'boutique', 'bandLines'], boutique.bandLines, boutique.paragraphs)
    altsAreWritten(ctx, ['items', 'thura', 'photos'], thura.photos)
    altsAreWritten(ctx, ['items', 'moonlightCup', 'images'], moonlightCup.images)
  }),
  book: bookRoomSchema.superRefine((room, ctx) => {
    altIsWritten(ctx, ['cover'], room.cover)
    altIsWritten(ctx, ['standing'], room.standing)
    altIsWritten(ctx, ['spine'], room.spine)
    altIsWritten(ctx, ['bookmark'], room.bookmark)
    altsAreWritten(ctx, ['photos'], room.photos)
  }),
} as const
