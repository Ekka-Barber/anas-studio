'use server'

/**
 * Thin server actions over `src/lib/publish.ts` (P04 part 2) and
 * `src/lib/media-delete.ts` (P05 round 2). Each takes the client's
 * `session.access_token` and forwards it; all real checks and validation
 * happen in those modules.
 */
import type { Collection } from '@/admin/collections'
import { deleteMedia, type MediaDeleteResult } from '@/lib/media-delete'
import { archiveDocument, cancelSchedule, publishDocument, scheduleDocument, type PublishActionResult } from '@/lib/publish'

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
