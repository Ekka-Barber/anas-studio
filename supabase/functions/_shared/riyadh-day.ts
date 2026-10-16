/**
 * The Riyadh calendar day, in one place (RESIDUALS-1 round R3b, QUALITY-24): the owner's screens (`src/lib/admin-commerce.ts`,
 * `src/lib/admin-money.ts`) and the `admin` function's dispute action (`disputes.ts`) judge a day the same way, so a change to
 * one side cannot leave the other refusing, or accepting, something else. Pure: no imports, no runtime APIs beyond `Date`.
 */

/** Riyadh is UTC+3 all year, no daylight saving (the rule of `money-input.ts`'s datetime round trip). */
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000

/** Today's calendar day in Riyadh, `YYYY-MM-DD`. */
export function riyadhToday(now: number = Date.now()): string {
  return new Date(now + RIYADH_OFFSET_MS).toISOString().slice(0, 10)
}

/** A real calendar day as `<input type="date">` writes it (four-digit year: 2026-02-30 and 20261-01-01 are not days). */
export function isDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const time = Date.parse(`${text}T00:00:00Z`)
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === text
}
