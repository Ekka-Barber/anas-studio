import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { schemaFor } from '../../src/admin/collections'
import content from '../../content/initial-content.json'

const ROOM_SLUGS = ['started', 'built', 'passed', 'shelf'] as const

const siteSettingsData = { nav: content.nav, footer: content.footer, home: content.home }

describe('schemaFor: the real content fixture', () => {
  it('parses the site_settings document', () => {
    expect(() => schemaFor('site_settings', 'site').parse(siteSettingsData)).not.toThrow()
  })

  it.each(ROOM_SLUGS)('parses the %s room document', (slug) => {
    const room = (content.rooms as Record<string, unknown>)[slug]
    expect(() => schemaFor('rooms', slug).parse(room)).not.toThrow()
  })

  it('throws for an unknown room slug', () => {
    expect(() => schemaFor('rooms', 'not-a-room')).toThrow('Unknown room')
  })
})

describe('schemaFor: rejects malformed data', () => {
  it('rejects a paragraphs field of the wrong type', () => {
    const bad = structuredClone(content.rooms.started)
    // @ts-expect-error deliberately wrong type for the test
    bad.pullLines = 'not an array'
    expect(schemaFor('rooms', 'started').safeParse(bad).success).toBe(false)
  })

  it('rejects an unknown image id', () => {
    const bad = structuredClone(content.rooms.started)
    bad.vignette.id = 'not-a-real-image-id'
    expect(schemaFor('rooms', 'started').safeParse(bad).success).toBe(false)
  })

  it('accepts a media-library id for an image field (P05)', () => {
    const doc = structuredClone(content.rooms.started)
    doc.vignette.id = randomUUID()
    expect(schemaFor('rooms', 'started').safeParse(doc).success).toBe(true)
  })

  it('rejects an unknown video id', () => {
    const bad = structuredClone(content.rooms.started)
    bad.media.reels[0]!.id = 'not-a-real-video-id'
    expect(schemaFor('rooms', 'started').safeParse(bad).success).toBe(false)
  })

  it('rejects a slug with characters outside a-z0-9-', () => {
    const bad = structuredClone(content.rooms.started)
    bad.slug = 'Not A Valid Slug!'
    expect(schemaFor('rooms', 'started').safeParse(bad).success).toBe(false)
  })

  it('rejects a document missing a required field', () => {
    const bad = structuredClone(content.rooms.started) as Record<string, unknown>
    delete bad.roomLabel
    expect(schemaFor('rooms', 'started').safeParse(bad).success).toBe(false)
  })
})

describe('hideable lists', () => {
  it('accepts an item marked hidden, and the loader-style filter drops it', () => {
    const bad = structuredClone(content.rooms.started)
    // @ts-expect-error `hidden` is the hideable-list addition, not on the base type
    bad.movements[0].hidden = true
    const parsed = schemaFor('rooms', 'started').parse(bad) as { movements: Array<{ hidden?: boolean }> }
    expect(parsed.movements[0]!.hidden).toBe(true)
    const visible = parsed.movements.filter((item) => !item.hidden)
    expect(visible).toHaveLength(content.rooms.started.movements.length - 1)
  })

  it('the real fixture has no hidden items to begin with', () => {
    for (const slug of ROOM_SLUGS) {
      const room = (content.rooms as Record<string, unknown>)[slug]
      expect(JSON.stringify(room)).not.toContain('"hidden":true')
    }
  })
})
