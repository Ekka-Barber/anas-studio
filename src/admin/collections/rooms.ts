import { z } from 'zod'

import { type Field, schemaFromFields } from '../fields'

/**
 * `rooms`: four fixed documents (`started`, `built`, `passed`, `shelf`),
 * each with its own fields matching `src/lib/content.ts`'s interfaces
 * exactly. Sections that are lists — movements, reels, the passed room's
 * brand wall and product gallery — are hideable: the admin can hide an item
 * without deleting it, and the public loader drops hidden items.
 */
export const jewelSchema = z.enum(['forest', 'midnight', 'plum', 'oud'])
const JEWEL_FIELD = {
  name: 'jewel',
  label: 'اللون',
  type: 'select',
  options: ['forest', 'midnight', 'plum', 'oud'],
  optionLabels: { forest: 'أخضر داكن', midnight: 'كحلي', plum: 'برقوقي', oud: 'عودي' },
} as const satisfies Field

export const roomVignetteFields = [{ name: 'id', label: 'المعرّف', type: 'image' }] as const satisfies Field[]
export const roomVignetteSchema = schemaFromFields(roomVignetteFields)

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
] as const satisfies Field[]
export const startedMovementSchema = schemaFromFields(startedMovementFields)

export const startedRoomFields = [
  { name: 'slug', label: 'المعرّف', type: 'slug' },
  { name: 'roomLabel', label: 'تسمية الغرفة', type: 'text' },
  { name: 'title', label: 'العنوان', type: 'text' },
  JEWEL_FIELD,
  { name: 'vignette', label: 'الصورة الرئيسية', type: 'group', fields: roomVignetteFields },
  { name: 'heroLine', label: 'سطر البداية', type: 'text' },
  { name: 'movements', label: 'المحطّات', type: 'list', fields: startedMovementFields, hideable: true },
  { name: 'pullLines', label: 'الاقتباسات', type: 'paragraphs' },
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
  { name: 'vignette', label: 'الصورة', type: 'image', nullable: true },
  { name: 'vignetteWide', label: 'صورة عريضة', type: 'boolean', required: false },
  { name: 'paragraphs', label: 'الفقرات', type: 'paragraphs' },
] as const satisfies Field[]
export const builtMovementSchema = schemaFromFields(builtMovementFields)

export const builtRoomFields = [
  { name: 'slug', label: 'المعرّف', type: 'slug' },
  { name: 'roomLabel', label: 'تسمية الغرفة', type: 'text' },
  { name: 'title', label: 'العنوان', type: 'text' },
  JEWEL_FIELD,
  { name: 'vignette', label: 'الصورة الرئيسية', type: 'group', fields: roomVignetteFields },
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
  { name: 'slug', label: 'المعرّف', type: 'slug' },
  { name: 'roomLabel', label: 'تسمية الغرفة', type: 'text' },
  { name: 'title', label: 'العنوان', type: 'text' },
  JEWEL_FIELD,
  { name: 'vignette', label: 'الصورة الرئيسية', type: 'group', fields: roomVignetteFields },
  { name: 'heroLine', label: 'سطر البداية', type: 'text' },
  { name: 'heroVignette', label: 'صورة البداية', type: 'image' },
  { name: 'paragraphs', label: 'الفقرات', type: 'paragraphs' },
  { name: 'pullLines', label: 'الاقتباسات', type: 'paragraphs' },
  { name: 'closingLine', label: 'سطر الختام', type: 'text' },
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
  { name: 'vignette', label: 'الصورة', type: 'image' },
  { name: 'divider', label: 'الفاصل', type: 'image' },
  { name: 'photos', label: 'الصور', type: 'list', fields: galleryPhotoFields },
  { name: 'posterId', label: 'صورة الفيلم', type: 'image' },
] as const satisfies Field[]
export const thuraItemSchema = schemaFromFields(thuraItemFields)

export const moonlightCupItemFields = [
  { name: 'title', label: 'العنوان', type: 'text' },
  { name: 'paragraphs', label: 'الفقرات', type: 'paragraphs' },
  { name: 'status', label: 'الحالة', type: 'text' },
  { name: 'vignette', label: 'الصورة', type: 'image' },
  { name: 'images', label: 'الصور', type: 'list', fields: galleryPhotoFields },
] as const satisfies Field[]
export const moonlightCupItemSchema = schemaFromFields(moonlightCupItemFields)

export const boutiqueItemFields = [
  { name: 'title', label: 'العنوان', type: 'text' },
  { name: 'paragraphs', label: 'الفقرات', type: 'paragraphs' },
  { name: 'closingLine', label: 'سطر الختام', type: 'text' },
  { name: 'vignette', label: 'الصورة', type: 'image' },
] as const satisfies Field[]
export const boutiqueItemSchema = schemaFromFields(boutiqueItemFields)

export const shelfRoomFields = [
  { name: 'slug', label: 'المعرّف', type: 'slug' },
  { name: 'roomLabel', label: 'تسمية الغرفة', type: 'text' },
  { name: 'title', label: 'العنوان', type: 'text' },
  JEWEL_FIELD,
  { name: 'vignette', label: 'الصورة الرئيسية', type: 'group', fields: roomVignetteFields },
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

export const roomSchemas = {
  started: startedRoomSchema,
  built: builtRoomSchema,
  passed: passedRoomSchema,
  shelf: shelfRoomSchema,
} as const
export type RoomSlug = keyof typeof roomSchemas
