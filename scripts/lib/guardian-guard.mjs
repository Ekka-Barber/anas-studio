/**
 * AUDIT-1 (G4.2): the five reels with a child (46-kid-picnic-jam,
 * 47-kid-bisht-honey-jar, 48-kid-supermarket-tomato-pesto, 49-kid-hotel-breakfast,
 * 50-kid-cafe-croissant-jam) stay out of the site until their guardians consent.
 * `public/` ships whole in the static export, so a hidden flag in the content
 * is not enough: `pnpm check:export` fails when a file name or a text file
 * (manifest, HTML, JavaScript) under `out/` carries one of their ids.
 */
const GUARDIAN_PENDING = /\b\d{2}-kid-/

/** True when `value` (a relative path, or a file's text) names one of those reels. */
export function namesGuardianPendingFilm(value) {
  return GUARDIAN_PENDING.test(value)
}
