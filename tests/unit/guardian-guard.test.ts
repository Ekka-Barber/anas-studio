// AUDIT-1 (G4.2): `pnpm check:export` fails when the export names one of the
// five reels with a child, which stay out until their guardians consent.
import { describe, expect, it } from 'vitest'

import { namesGuardianPendingFilm } from '../../scripts/lib/guardian-guard.mjs'

const REELS = [
  '46-kid-picnic-jam',
  '47-kid-bisht-honey-jar',
  '48-kid-supermarket-tomato-pesto',
  '49-kid-hotel-breakfast',
  '50-kid-cafe-croissant-jam',
]

describe('namesGuardianPendingFilm', () => {
  it.each(REELS)('catches %s as a file name, in any of its derivatives, and in text', (id) => {
    expect(namesGuardianPendingFilm(`media/${id}.mp4`)).toBe(true)
    expect(namesGuardianPendingFilm(`media\\${id}.mp4`)).toBe(true)
    expect(namesGuardianPendingFilm(`images/started/${id}-poster-720.webp`)).toBe(true)
    expect(namesGuardianPendingFilm(`{"videos":{"${id}":{"room":"started"}}}`)).toBe(true)
  })

  it('leaves the two reels shown, other files and ordinary words alone', () => {
    for (const fine of [
      'media/44-animated-kitchen.mp4',
      'media/45-animated-pottery-signature.mp4',
      'images/started/started-child-door-360.webp',
      '_next/static/chunks/0abc.js',
      'a skid-row and kid-friendly text, 4-kid-x',
    ]) {
      expect(namesGuardianPendingFilm(fine)).toBe(false)
    }
  })
})
