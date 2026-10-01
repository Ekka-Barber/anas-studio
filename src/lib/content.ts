/**
 * Published-content loaders (P04, D29, D32): every getter reads
 * `published_documents` through the Data API with the publishable key and
 * validates the row with the collection's Zod schema. They run at build time
 * only: the site is a static export rebuilt after each publish (D32). A
 * missing env var, a missing document or invalid data throws, so the build
 * fails and the last good deployment stays live — that build-time Zod check
 * is what guards the public site. The one missing document that does not
 * throw is the scenes gallery, whose page says it has no scenes yet (C05).
 * There is no fallback to
 * `content/initial-content.json`; that file is only the import source for
 * `scripts/import-content.mjs` and a test fixture.
 *
 * P05: after parsing, media-library ids in the document are resolved against
 * `media` and replaced with `formatMediaRef` strings; an unresolved id stays
 * as it is and `<Picture>` renders it as nothing. The admin preview reuses
 * `replaceMediaIds` and the room `shape*` functions with a draft.
 */
import { cache } from 'react'
import type { z } from 'zod'

import {
  bookRoomSchema,
  brandSchema,
  builtRoomSchema,
  footerSchema,
  isHttpsUrl,
  navItemSchema,
  passedRoomSchema,
  SCENES_DOC_ID,
  scenesSchema,
  shelfRoomSchema,
  siteSettingsStoredSchema,
  startedMovementSchema,
  startedRoomSchema,
} from '../admin/collections'

import { requireEnv } from './env'
import { collectMediaIds, formatMediaRef, MEDIA_ORIGIN } from './media-ref'

export type NavItem = z.infer<typeof navItemSchema>
export type FooterContent = z.infer<typeof footerSchema>
export type StartedMovement = z.infer<typeof startedMovementSchema>
export type StartedRoom = z.infer<typeof startedRoomSchema>
export type BuiltRoom = z.infer<typeof builtRoomSchema>
export type Brand = z.infer<typeof brandSchema>
export type PassedRoom = z.infer<typeof passedRoomSchema>
export type ShelfRoom = z.infer<typeof shelfRoomSchema>
export type BookRoom = z.infer<typeof bookRoomSchema>
export type SiteContent = z.infer<typeof siteSettingsStoredSchema>
export type SocialLink = NonNullable<SiteContent['social']>[number]
export type RoomDoor = NonNullable<SiteContent['home']['doors']>[number]
export type ContactPage = NonNullable<SiteContent['contactPage']>
export type Scene = z.infer<typeof scenesSchema>['items'][number]

/** A media row's derivatives, as `media_complete` recorded them. */
export interface MediaDerivative {
  width: number
  height: number
}

/** What the build reads of a media row: its derivatives and the alt text written at upload. */
export interface MediaInfo {
  derivatives: MediaDerivative[]
  alt?: string
}

/** Media rows by id. A bare derivative list (the admin preview's) carries no alt. */
export type MediaLookup = ReadonlyMap<string, MediaDerivative[] | MediaInfo>

// Ids per request: each UUID adds about 39 characters to the GET URL, and
// Cloudflare, which fronts hosted Supabase, refuses one past 16 KB.
const MEDIA_CHUNK = 100

/**
 * The derivatives and alt text of each media row, read with the publishable
 * key in chunks of `MEDIA_CHUNK` ids. An id anon may not read (no published
 * document references it) has no entry — an unreadable library is an error.
 * The one media read of every build-time loader.
 */
export async function mediaById(ids: string[]): Promise<Map<string, MediaInfo>> {
  const byId = new Map<string, MediaInfo>()
  for (let start = 0; start < ids.length; start += MEDIA_CHUNK) {
    const params = new URLSearchParams({
      select: 'id,derivatives,alt_ar',
      id: `in.(${ids.slice(start, start + MEDIA_CHUNK).join(',')})`,
    })
    const response = await fetch(`${requireEnv('NEXT_PUBLIC_SUPABASE_URL')}/rest/v1/media?${params}`, {
      headers: { apikey: requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') },
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch media: ${response.status}`)
    }
    const rows = (await response.json()) as Array<{ id: string; derivatives: MediaDerivative[]; alt_ar: string }>
    for (const row of rows) byId.set(row.id, { derivatives: row.derivatives, alt: row.alt_ar })
  }
  return byId
}

/**
 * Replaces media-library ids in a parsed document with `formatMediaRef`
 * strings (P05). An id anon may not read stays a bare string.
 */
async function resolveMedia<T>(data: T): Promise<T> {
  const ids = collectMediaIds(data)
  if (ids.length === 0) return data
  return replaceMediaIds(data, await mediaById(ids), MEDIA_ORIGIN)
}

/** Deep-walks `value`, swapping each resolved media id for its reference string (with the row's alt). */
export function replaceMediaIds<T>(value: T, byId: MediaLookup, origin: string): T {
  function walk(node: unknown): unknown {
    if (typeof node === 'string') {
      const row = byId.get(node)
      const derivatives = Array.isArray(row) ? row : row?.derivatives
      const alt = Array.isArray(row) ? undefined : row?.alt
      if (!derivatives || derivatives.length === 0) return node
      const largestWidth = Math.max(...derivatives.map((d) => d.width))
      const largest = derivatives.find((d) => d.width === largestWidth)!
      return formatMediaRef({
        base: `${origin}/m/${node}`,
        width: largest.width,
        height: largest.height,
        widths: derivatives.map((d) => d.width).sort((a, b) => a - b),
        alt,
      })
    }
    if (Array.isArray(node)) return node.map(walk)
    if (node !== null && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(node)) out[key] = walk(item)
      return out
    }
    return node
  }
  return walk(value) as T
}

/** The published document, or null when it has never been published. */
async function fetchPublishedOrNull<T>(collection: string, docId: string, schema: z.ZodType<T>): Promise<T | null> {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  const key = requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
  const params = new URLSearchParams({ collection: `eq.${collection}`, doc_id: `eq.${docId}`, select: 'data' })
  const response = await fetch(`${url}/rest/v1/published_documents?${params}`, { headers: { apikey: key } })
  if (!response.ok) {
    throw new Error(`Failed to fetch ${collection}/${docId}: ${response.status}`)
  }
  const rows = (await response.json()) as Array<{ data: unknown }>
  const row = rows[0]
  return row ? resolveMedia(schema.parse(row.data)) : null
}

async function fetchPublished<T>(collection: string, docId: string, schema: z.ZodType<T>): Promise<T> {
  const data = await fetchPublishedOrNull(collection, docId, schema)
  if (data === null) {
    throw new Error(`Missing published document: ${collection}/${docId}`)
  }
  return data
}

/** Drops items a hideable list's admin control marked `hidden: true`. */
function dropHidden<T extends { hidden?: boolean }>(items: readonly T[]): T[] {
  return items.filter((item) => !item.hidden)
}

// One fetch of `site_settings/site` per render, shared by Header and Footer.
// The lenient stored schema on purpose: the publish gate enforces the contact
// rules, so one bad stored value cannot fail the whole site build.
const fetchSiteSettings = cache(
  async (): Promise<SiteContent> => fetchPublished('site_settings', 'site', siteSettingsStoredSchema),
)

export async function getNav(): Promise<NavItem[]> {
  return (await fetchSiteSettings()).nav
}

export async function getFooter(): Promise<FooterContent> {
  return (await fetchSiteSettings()).footer
}

/**
 * The journal's name (D11, C08): the label of its menu item, so renaming it
 * there renames it on every page. «المجلس» until the menu says otherwise,
 * and while its label is blank.
 */
export async function getJournalName(): Promise<string> {
  const label = (await getNav()).find((item) => item.href === '/journal')?.label.trim()
  return label || 'المجلس'
}

export type HomeContent = SiteContent['home']

/** The home page's words (site_settings.home, D39). */
export async function getHome(): Promise<HomeContent> {
  return (await fetchSiteSettings()).home
}

/** The home page's room doors in the admin's order (site_settings.home.doors); the build fails while the published document has none. */
export async function getHomeDoors(): Promise<RoomDoor[]> {
  const { doors } = (await fetchSiteSettings()).home
  if (!doors) throw new Error('Published site_settings/site is missing home.doors')
  return doors
}

/** The contact page's words (site_settings.contactPage); the build fails while the published document has none. */
export async function getContactPage(): Promise<ContactPage> {
  const page = (await fetchSiteSettings()).contactPage
  if (!page) throw new Error('Published site_settings/site is missing contactPage')
  return page
}

/** The site's contact details, when set (site_settings.contact). */
export async function getContact(): Promise<SiteContent['contact']> {
  return (await fetchSiteSettings()).contact
}

/**
 * The social links in the admin's order (site_settings.social, C09); none
 * when the list is unset or empty. The publish gate refuses a link that is
 * not https, and this drops one too, so a stored `javascript:` or `http:`
 * link can never reach a page.
 */
export async function getSocial(): Promise<SocialLink[]> {
  return ((await fetchSiteSettings()).social ?? []).filter((link) => isHttpsUrl(link.href))
}

// What each room's page shows of its stored document: hidden list items are
// dropped. Shared by the public loaders and the admin preview.
export function shapeStartedRoom(room: StartedRoom): StartedRoom {
  return {
    ...room,
    movements: dropHidden(room.movements),
    media: { ...room.media, reels: dropHidden(room.media.reels) },
  }
}

export function shapeBuiltRoom(room: BuiltRoom): BuiltRoom {
  return {
    ...room,
    movements: dropHidden(room.movements),
    media: { ...room.media, reels: dropHidden(room.media.reels) },
  }
}

export function shapePassedRoom(room: PassedRoom): PassedRoom {
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

export async function getStartedRoom(): Promise<StartedRoom> {
  return shapeStartedRoom(await fetchPublished('rooms', 'started', startedRoomSchema))
}

export async function getBuiltRoom(): Promise<BuiltRoom> {
  return shapeBuiltRoom(await fetchPublished('rooms', 'built', builtRoomSchema))
}

export async function getPassedRoom(): Promise<PassedRoom> {
  return shapePassedRoom(await fetchPublished('rooms', 'passed', passedRoomSchema))
}

export async function getShelfRoom(): Promise<ShelfRoom> {
  return fetchPublished('rooms', 'shelf', shelfRoomSchema)
}

/** The book's page (كتبتُ هنا), also read by the home page for the book's cover, title and line. */
export async function getBookRoom(): Promise<BookRoom> {
  return fetchPublished('rooms', 'book', bookRoomSchema)
}

/**
 * The scenes in the admin's order, without the hidden ones (C05). Before the
 * gallery is first published there are none, and the page says so instead
 * of failing the build.
 */
export async function getScenes(): Promise<Scene[]> {
  const scenes = await fetchPublishedOrNull('scenes', SCENES_DOC_ID, scenesSchema)
  return scenes ? dropHidden(scenes.items) : []
}

// Media-manifest reads (getImage/getVideo) intentionally do NOT live here:
// Picture and VideoTile are rendered from client components, and any
// value-import from this module pulls its dependencies into the client
// bundle. Each of Picture.tsx/VideoTile.tsx reads its own manifest JSON
// directly (P01 audit fix 10).
