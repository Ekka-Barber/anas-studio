/**
 * Owner step-up check (D13): the session is at aal2 and its `amr` claim holds
 * a TOTP verification from the last `maxAgeSeconds`. Pure, with no Deno or
 * Node imports, so the Edge Functions and Vitest share one implementation.
 */
export const STEP_UP_MAX_AGE_SECONDS = 300

export function hasRecentTotp(
  claims: { aal?: unknown; amr?: unknown },
  nowSeconds: number,
  maxAgeSeconds: number = STEP_UP_MAX_AGE_SECONDS,
): boolean {
  if (claims.aal !== 'aal2' || !Array.isArray(claims.amr)) return false
  return claims.amr.some((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return false
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown }
    return method === 'totp' && typeof timestamp === 'number' && nowSeconds - timestamp <= maxAgeSeconds
  })
}
