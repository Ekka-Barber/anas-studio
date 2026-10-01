// AUDIT-2 R05 (ADMIN-editor-10): `imageSources` looks the manifest up by own key,
// matching the admin field gate, so an inherited key is a missing entry and not
// an image with nothing to show.
import { describe, expect, it } from 'vitest'

import { imageSources } from '../../src/lib/images'

describe('imageSources', () => {
  it.each(['constructor', 'toString', '__proto__'])('throws for the inherited key %s', (id) => {
    expect(() => imageSources(id)).toThrow(/Missing image manifest entry/)
  })
})
