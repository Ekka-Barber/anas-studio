/**
 * Typed loader for `content/initial-content.json` (P01: static fixture, no
 * Payload call — P04 replaces this with published CMS reads). Reads
 * Anas's texts verbatim; nothing here rewrites or trims his copy.
 */
import raw from '../../content/initial-content.json'

export interface NavItem {
  label: string
  href: string
}

export interface FooterContent {
  poem: string[]
  signature: string
  domain: string
}

export type RoomJewel = 'forest' | 'midnight' | 'plum' | 'oud'

export interface RoomVignette {
  id: string
}

export interface ReelMedia {
  id: string
  alt: string
}

export interface StartedMovement {
  year: string
  vignette: string | null
  paragraphs: string[]
}

export interface StartedRoom {
  slug: 'started'
  roomLabel: string
  title: string
  jewel: RoomJewel
  vignette: RoomVignette
  heroLine: string
  movements: StartedMovement[]
  pullLines: string[]
  closingLine: string
  signature: string
  media: { reels: ReelMedia[] }
}

export interface BuiltMovement {
  label: string
  vignette: string | null
  vignetteWide?: boolean
  paragraphs: string[]
}

export interface BuiltRoom {
  slug: 'built'
  roomLabel: string
  title: string
  jewel: RoomJewel
  vignette: RoomVignette
  heroLine: string
  intro: { vignette: string | null; paragraphs: string[] }
  movements: BuiltMovement[]
  closing: { paragraphs: string[]; displayLine: string }
  refrain: string
  signature: string
  media: {
    logo: { id: string; alt: string }
    reels: ReelMedia[]
    droneFilm: ReelMedia
  }
}

export interface Brand {
  id: string
  name: string
}

export interface GalleryPhoto {
  id: string
  alt: string
}

export interface PassedRoom {
  slug: 'passed'
  roomLabel: string
  title: string
  jewel: RoomJewel
  vignette: RoomVignette
  heroLine: string
  heroVignette: string
  paragraphs: string[]
  pullLines: string[]
  closingLine: string
  media: {
    reels: ReelMedia[]
    brandWall: Brand[]
    gallery: GalleryPhoto[]
  }
}

export interface ThuraFlavour {
  name: string
  description: string
}

export interface ThuraItem {
  name: string
  nameNote: string
  meaning: string
  definition: string
  vision: string
  goal: string
  flavours: ThuraFlavour[]
  inspiration: string
  inspirers: string
  slogan: string
  comingSoonLine: string
  vignette: string
  divider: string
  photos: GalleryPhoto[]
  posterId: string
}

export interface MoonlightCupItem {
  title: string
  paragraphs: string[]
  status: string
  vignette: string
  images: GalleryPhoto[]
}

export interface BoutiqueItem {
  title: string
  paragraphs: string[]
  closingLine: string
  vignette: string
}

export interface ShelfRoom {
  slug: 'shelf'
  roomLabel: string
  title: string
  jewel: RoomJewel
  vignette: RoomVignette
  items: {
    thura: ThuraItem
    moonlightCup: MoonlightCupItem
    boutique: BoutiqueItem
  }
}

export interface SiteContent {
  nav: NavItem[]
  footer: FooterContent
  home: { introAddition: string }
  rooms: {
    started: StartedRoom
    built: BuiltRoom
    passed: PassedRoom
    shelf: ShelfRoom
  }
}

const content = raw as unknown as SiteContent

export function getNav(): NavItem[] {
  return content.nav
}

export function getFooter(): FooterContent {
  return content.footer
}

export function getHomeIntroAddition(): string {
  return content.home.introAddition
}

export function getStartedRoom(): StartedRoom {
  return content.rooms.started
}

export function getBuiltRoom(): BuiltRoom {
  return content.rooms.built
}

export function getPassedRoom(): PassedRoom {
  return content.rooms.passed
}

export function getShelfRoom(): ShelfRoom {
  return content.rooms.shelf
}

// Media-manifest reads (getImage/getVideo) intentionally do NOT live here:
// Picture and VideoReel are rendered from client components, and any
// value-import from this module — even of an unrelated export — pulls this
// file's top-level `content/initial-content.json` import (Anas's texts) into
// the client bundle. Each of Picture.tsx/VideoReel.tsx reads its own manifest
// JSON directly (P01 audit fix 10).
