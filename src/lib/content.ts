/**
 * Published-content loaders (P04, D29): every getter reads
 * `published_documents` through the Data API with the publishable key,
 * validates the row with the collection's Zod schema, and tags the fetch so
 * `POST /api/revalidate` can invalidate it after a publish. There is no
 * fallback to `content/initial-content.json` — that file is only the import
 * source for `scripts/import-content.mjs` and a test fixture; a missing env
 * var, a missing document or invalid data throws.
 */
import { cache } from 'react'
import type { z } from 'zod'

import {
  boutiqueItemSchema,
  brandSchema,
  builtMovementSchema,
  builtRoomSchema,
  footerSchema,
  galleryPhotoSchema,
  jewelSchema,
  moonlightCupItemSchema,
  navItemSchema,
  passedRoomSchema,
  reelMediaSchema,
  roomVignetteSchema,
  shelfRoomSchema,
  siteSettingsSchema,
  startedMovementSchema,
  startedRoomSchema,
  thuraFlavourSchema,
  thuraItemSchema,
} from '../admin/collections'

import { requireEnv } from './env'

export type NavItem = z.infer<typeof navItemSchema>
export type FooterContent = z.infer<typeof footerSchema>
export type RoomJewel = z.infer<typeof jewelSchema>
export type RoomVignette = z.infer<typeof roomVignetteSchema>
export type ReelMedia = z.infer<typeof reelMediaSchema>
export type StartedMovement = z.infer<typeof startedMovementSchema>
export type StartedRoom = z.infer<typeof startedRoomSchema>
export type BuiltMovement = z.infer<typeof builtMovementSchema>
export type BuiltRoom = z.infer<typeof builtRoomSchema>
export type Brand = z.infer<typeof brandSchema>
export type GalleryPhoto = z.infer<typeof galleryPhotoSchema>
export type PassedRoom = z.infer<typeof passedRoomSchema>
export type ThuraFlavour = z.infer<typeof thuraFlavourSchema>
export type ThuraItem = z.infer<typeof thuraItemSchema>
export type MoonlightCupItem = z.infer<typeof moonlightCupItemSchema>
export type BoutiqueItem = z.infer<typeof boutiqueItemSchema>
export type ShelfRoom = z.infer<typeof shelfRoomSchema>
export type SiteContent = z.infer<typeof siteSettingsSchema>

async function fetchPublished<T>(collection: string, docId: string, schema: z.ZodType<T>): Promise<T> {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  const key = requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
  const params = new URLSearchParams({ collection: `eq.${collection}`, doc_id: `eq.${docId}`, select: 'data' })
  const response = await fetch(`${url}/rest/v1/published_documents?${params}`, {
    headers: { apikey: key },
    cache: 'force-cache',
    next: { tags: [`content:${collection}`, `content:${collection}:${docId}`] },
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch ${collection}/${docId}: ${response.status}`)
  }
  const rows = (await response.json()) as Array<{ data: unknown }>
  const row = rows[0]
  if (!row) {
    throw new Error(`Missing published document: ${collection}/${docId}`)
  }
  return schema.parse(row.data)
}

/** Drops items a hideable list's admin control marked `hidden: true`. */
function dropHidden<T extends { hidden?: boolean }>(items: readonly T[]): T[] {
  return items.filter((item) => !item.hidden)
}

// One fetch of `site_settings/site` per render, shared by Header and Footer.
const fetchSiteSettings = cache(
  async (): Promise<SiteContent> => fetchPublished('site_settings', 'site', siteSettingsSchema),
)

export async function getNav(): Promise<NavItem[]> {
  return (await fetchSiteSettings()).nav
}

export async function getFooter(): Promise<FooterContent> {
  return (await fetchSiteSettings()).footer
}

export async function getHomeIntroAddition(): Promise<string> {
  return (await fetchSiteSettings()).home.introAddition
}

export async function getStartedRoom(): Promise<StartedRoom> {
  const room = await fetchPublished('rooms', 'started', startedRoomSchema)
  return {
    ...room,
    movements: dropHidden(room.movements),
    media: { ...room.media, reels: dropHidden(room.media.reels) },
  }
}

export async function getBuiltRoom(): Promise<BuiltRoom> {
  const room = await fetchPublished('rooms', 'built', builtRoomSchema)
  return {
    ...room,
    movements: dropHidden(room.movements),
    media: { ...room.media, reels: dropHidden(room.media.reels) },
  }
}

export async function getPassedRoom(): Promise<PassedRoom> {
  const room = await fetchPublished('rooms', 'passed', passedRoomSchema)
  return {
    ...room,
    media: {
      ...room.media,
      reels: dropHidden(room.media.reels),
      brandWall: dropHidden(room.media.brandWall),
      gallery: dropHidden(room.media.gallery),
    },
  }
}

export async function getShelfRoom(): Promise<ShelfRoom> {
  return fetchPublished('rooms', 'shelf', shelfRoomSchema)
}

// Media-manifest reads (getImage/getVideo) intentionally do NOT live here:
// Picture and VideoReel are rendered from client components, and any
// value-import from this module pulls its dependencies into the client
// bundle. Each of Picture.tsx/VideoReel.tsx reads its own manifest JSON
// directly (P01 audit fix 10).
