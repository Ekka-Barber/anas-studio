/**
 * Cloudflare Turnstile server-side validation (P06, DATA "Media and session
 * boundaries": forms verify Turnstile action and hostname).
 *
 * Siteverify contract (fetched 2026-09-26,
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation):
 * `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` accepts JSON
 * `{secret, response, remoteip}` and replies
 * `{success, challenge_ts, hostname, "error-codes": [], action, cdata}`.
 *
 * Fails closed: an unreachable or malformed siteverify answer is "not
 * verified", never "assume ok" — the caller answers 503 for that case so a
 * Cloudflare outage cannot become an open form.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/**
 * The three documented test secret keys (fetched 2026-09-26,
 * https://developers.cloudflare.com/turnstile/troubleshooting/testing):
 * always-pass `1x…AA`, always-fail `2x…AA`, already-spent `3x…AA`. A test
 * secret is refused outright in production; elsewhere a live call with one
 * answers `success:true` with `hostname:"example.com"` and **no `action`
 * field** at all (verified live 2026-09-26, evidence
 * `artifacts/acceptance/P06/siteverify-live-test-secret.json`), so with a
 * test secret the hostname check *and* the action check are skipped —
 * otherwise the documented dummy-token flow could never pass locally.
 */
const TEST_SECRETS = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
])

export type TurnstileFailureCode =
  | 'INVALID_TOKEN'
  | 'ACTION_MISMATCH'
  | 'HOSTNAME_MISMATCH'
  | 'TEST_SECRET_IN_PRODUCTION'
  | 'UNREACHABLE'

export type TurnstileResult = { ok: true } | { ok: false; code: TurnstileFailureCode }

export async function verifyTurnstile(params: {
  token: string
  secret: string
  remoteIp?: string
  expectedAction: string
  expectedHostname: string
}): Promise<TurnstileResult> {
  const isTestSecret = TEST_SECRETS.has(params.secret)
  if (isTestSecret && process.env.NODE_ENV === 'production') {
    return { ok: false, code: 'TEST_SECRET_IN_PRODUCTION' }
  }

  let response: Response
  try {
    response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        secret: params.secret,
        response: params.token,
        ...(params.remoteIp && params.remoteIp !== 'local' ? { remoteip: params.remoteIp } : {}),
      }),
      signal: AbortSignal.timeout(5_000),
    })
  } catch {
    return { ok: false, code: 'UNREACHABLE' }
  }

  let result: unknown
  try {
    result = await response.json()
  } catch {
    return { ok: false, code: 'UNREACHABLE' }
  }
  const verified = result as { success?: unknown; action?: unknown; hostname?: unknown }
  if (typeof verified !== 'object' || verified === null || verified.success !== true) {
    return { ok: false, code: 'INVALID_TOKEN' }
  }
  if (isTestSecret) {
    // See TEST_SECRETS above: the answer carries hostname "example.com" and no
    // action, so neither check can apply.
    return { ok: true }
  }
  if (verified.action !== params.expectedAction) {
    return { ok: false, code: 'ACTION_MISMATCH' }
  }
  if (verified.hostname !== params.expectedHostname) {
    return { ok: false, code: 'HOSTNAME_MISMATCH' }
  }
  return { ok: true }
}
