import type { z } from 'zod'

import { postFields, postSchema } from './posts'
import { roomSchemas, type RoomSlug } from './rooms'
import * as rooms from './rooms'
import { siteSettingsFields, siteSettingsSchema } from './site-settings'
import { taxonomyFields, taxonomySchema } from './taxonomies'

export type Collection = 'site_settings' | 'rooms' | 'posts' | 'taxonomies'

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
} as const

function isRoomSlug(docId: string): docId is RoomSlug {
  return docId in roomSchemas
}

/** The Zod schema a document of `collection`/`docId` must validate against. */
export function schemaFor(collection: Collection, docId: string): z.ZodTypeAny {
  switch (collection) {
    case 'site_settings':
      return siteSettingsSchema
    case 'rooms':
      if (!isRoomSlug(docId)) throw new Error(`Unknown room: ${docId}`)
      return roomSchemas[docId]
    case 'posts':
      return postSchema
    case 'taxonomies':
      return taxonomySchema
  }
}

export * from './posts'
export * from './rooms'
export * from './site-settings'
export * from './taxonomies'
