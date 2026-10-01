import type { z } from 'zod'

import { POLICY_DOC_IDS, POLICY_DOC_LABELS, policyFields, policySchema, type PolicyDocId } from './policies'
import { postFields, postSchema } from './posts'
import { roomPublishSchemas, roomSchemas, type RoomSlug } from './rooms'
import * as rooms from './rooms'
import { scenesFields, scenesSchema } from './scenes'
import { siteSettingsFields, siteSettingsSchema } from './site-settings'
import { taxonomyFields, taxonomySchema } from './taxonomies'

export type Collection = 'site_settings' | 'rooms' | 'posts' | 'taxonomies' | 'policies' | 'scenes'

/** Field configs per collection, for the admin form (part 2). */
export const collections = {
  site_settings: { fields: siteSettingsFields },
  rooms: {
    fields: {
      started: rooms.startedRoomFields,
      built: rooms.builtRoomFields,
      passed: rooms.passedRoomFields,
      shelf: rooms.shelfRoomFields,
    },
  },
  posts: { fields: postFields },
  taxonomies: { fields: taxonomyFields },
  policies: { fields: policyFields },
  scenes: { fields: scenesFields },
} as const

/** Arabic section labels for `/admin/content` (part 2). */
export const COLLECTION_LABELS: Record<Collection, string> = {
  rooms: 'الغرف',
  site_settings: 'إعدادات الموقع',
  posts: 'المقالات',
  taxonomies: 'التصنيفات',
  policies: 'السياسات',
  scenes: 'المَشاهد',
}

/** `site_settings` has exactly one document. */
export const SITE_SETTINGS_DOC_ID = 'site'

/** `scenes` has exactly one document: the gallery (C05). */
export const SCENES_DOC_ID = 'gallery'

/** Arabic labels for the four fixed room documents. */
export const ROOM_DOC_LABELS: Record<RoomSlug, string> = {
  started: 'بدأتُ من هنا',
  built: 'بنيتُ هنا',
  passed: 'مررتُ من هنا',
  shelf: 'على الرف',
}

/** Own keys only: `in` would accept `constructor` and `toString`. */
export function isRoomSlug(docId: string): docId is RoomSlug {
  return Object.hasOwn(roomSchemas, docId)
}

function isPolicyDocId(docId: string): docId is PolicyDocId {
  return (POLICY_DOC_IDS as readonly string[]).includes(docId)
}

/** A document's display title from its saved data, for the list and the editor. */
export function documentTitle(collection: Collection, docId: string, data: Record<string, unknown> | undefined): string {
  if (collection === 'rooms') {
    const fallback = isRoomSlug(docId) ? ROOM_DOC_LABELS[docId] : docId
    const label = typeof data?.roomLabel === 'string' ? data.roomLabel : null
    const title = typeof data?.title === 'string' ? data.title : null
    return label && title ? `${label}: ${title}` : (title || fallback)
  }
  if (collection === 'site_settings' || collection === 'scenes') return COLLECTION_LABELS[collection]
  if (collection === 'posts') {
    const title = data?.title
    return typeof title === 'string' && title ? title : 'بلا عنوان'
  }
  if (collection === 'policies') {
    const title = data?.title
    return typeof title === 'string' && title ? title : (isPolicyDocId(docId) ? POLICY_DOC_LABELS[docId] : docId)
  }
  const label = data?.label
  return typeof label === 'string' && label ? label : docId
}

/** The Zod schema a document of `collection`/`docId` must validate against. */
export function schemaFor(collection: Collection, docId: string): z.ZodTypeAny {
  switch (collection) {
    case 'site_settings':
      return siteSettingsSchema
    case 'rooms':
      if (!isRoomSlug(docId)) throw new Error(`Unknown room: ${docId}`)
      return roomPublishSchemas[docId]
    case 'posts':
      return postSchema
    case 'taxonomies':
      return taxonomySchema
    case 'policies':
      return policySchema
    case 'scenes':
      return scenesSchema
  }
}

export * from './posts'
export * from './rooms'
export * from './site-settings'
export * from './taxonomies'
export * from './policies'
export * from './scenes'
