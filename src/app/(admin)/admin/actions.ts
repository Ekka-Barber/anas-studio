'use server'

/**
 * Thin server actions over `src/lib/publish.ts` (P04 part 2),
 * `src/lib/media-delete.ts` (P05 round 2) and the environment status for the
 * settings screen (P06 round 2). Each takes the client's
 * `session.access_token` and forwards it; all real checks and validation
 * happen in those modules.
 */
import type { Collection } from '@/admin/collections'
import { emailProvider } from '@/lib/email'
import { optionalEnv } from '@/lib/env'
import { deleteMedia, type MediaDeleteResult } from '@/lib/media-delete'
import { archiveDocument, cancelSchedule, publishDocument, scheduleDocument, type PublishActionResult } from '@/lib/publish'
import { staffFromToken } from '@/lib/staff-auth'

export async function publishAction(
  accessToken: string,
  collection: Collection,
  docId: string,
  seq: number,
): Promise<PublishActionResult> {
  return publishDocument({ accessToken, collection, docId, seq })
}

export async function scheduleAction(
  accessToken: string,
  collection: Collection,
  docId: string,
  seq: number,
  at: string,
): Promise<PublishActionResult> {
  return scheduleDocument({ accessToken, collection, docId, seq, at })
}

export async function cancelScheduleAction(
  accessToken: string,
  collection: Collection,
  docId: string,
): Promise<PublishActionResult> {
  return cancelSchedule({ accessToken, collection, docId })
}

export async function archiveAction(
  accessToken: string,
  collection: Collection,
  docId: string,
): Promise<PublishActionResult> {
  return archiveDocument({ accessToken, collection, docId })
}

export async function deleteMediaAction(accessToken: string, id: string): Promise<MediaDeleteResult> {
  return deleteMedia({ accessToken, id })
}

export interface SettingsStatus {
  email: { provider: 'resend' | 'mailpit' | 'none'; fromSet: boolean }
  turnstile: { configured: boolean; testSecret: boolean }
  webhook: boolean
  jobs: boolean
  siteHost: string
  analytics: boolean
}

/**
 * Owner-only configuration status (P06 round 2): booleans and names only,
 * never a secret's value. `null` means not the owner (or not signed in).
 */
export async function settingsStatusAction(accessToken: string): Promise<SettingsStatus | null> {
  const staff = await staffFromToken(accessToken)
  if (!staff || staff.role !== 'owner') return null

  let provider: 'resend' | 'mailpit' | 'none' = 'none'
  try {
    provider = emailProvider() ?? 'none'
  } catch {
    // emailProvider() refuses a production build with a dev Mailpit URL; the
    // status screen shows "none" rather than throwing at the owner.
    provider = 'none'
  }

  // The three documented Turnstile test secrets, duplicated from
  // `src/lib/turnstile.ts` (which stays untouched this round).
  const turnstileSecret = optionalEnv('TURNSTILE_SECRET_KEY')
  const testSecrets = new Set([
    '1x0000000000000000000000000000000AA',
    '2x0000000000000000000000000000000AA',
    '3x0000000000000000000000000000000AA',
  ])

  let siteHost = ''
  const siteUrl = optionalEnv('SITE_URL')
  if (siteUrl) {
    try {
      siteHost = new URL(siteUrl).hostname
    } catch {
      siteHost = ''
    }
  }

  return {
    email: { provider, fromSet: optionalEnv('EMAIL_FROM') !== undefined },
    turnstile: {
      configured: turnstileSecret !== undefined,
      testSecret: turnstileSecret !== undefined && testSecrets.has(turnstileSecret),
    },
    webhook: optionalEnv('RESEND_WEBHOOK_SECRET') !== undefined,
    jobs: optionalEnv('JOBS_SECRET') !== undefined,
    siteHost,
    analytics: optionalEnv('ANALYTICS_TOKEN') !== undefined && optionalEnv('CLOUDFLARE_ZONE_ID') !== undefined,
  }
}
