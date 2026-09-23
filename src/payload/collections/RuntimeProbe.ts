import type { CollectionConfig } from 'payload'

import { isNodeRuntimeTarget } from '../../lib/env'
import { notifyRevalidate, runtimeProbeTag } from '../../lib/revalidate'
import { RUNTIME_PROBE_MEDIA_SLUG } from '../storage'

export const RUNTIME_PROBE_SLUG = 'runtime-probe'

/**
 * Prototype collection for the P00 runtime spike only.
 *
 * It carries exactly the features the spike has to prove on Workers:
 * native drafts/versions, one Lexical rich-text field, and one upload relation
 * pointing at an object stored in R2. It is deleted once the spike evidence is
 * retained; no production content depends on it.
 */
export const RuntimeProbe: CollectionConfig = {
  slug: RUNTIME_PROBE_SLUG,
  labels: {
    singular: 'سجل فحص',
    plural: 'سجلات الفحص',
  },
  versions: {
    drafts: true,
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', '_status', 'updatedAt'],
  },
  access: {
    create: ({ req }) => Boolean(req.user),
    // I20/D27: the only access change here. A signed-in user still sees every
    // document, draft or published, exactly as before. An anonymous reader —
    // the public probe page at `src/app/(public)/probe/[id]/page.tsx` — is now
    // allowed in, but only for `_status: 'published'` documents; a `Where`
    // constraint from an access function is Payload's own supported way to
    // scope read access, not a bypass of it. Drafts stay invisible to anyone
    // without a session.
    read: ({ req }) => (req.user ? true : { _status: { equals: 'published' } }),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
    // Unchanged: version history stays owner-only regardless of publish state.
    readVersions: ({ req }) => Boolean(req.user),
  },
  // I20/D27: node target only. The Worker never runs these — it has no
  // outbound reason to call its own `/api/revalidate`, and the public cache
  // it reads is invalidated by the node admin's save/delete instead.
  // `notifyRevalidate` never throws and is not awaited, so a revalidation
  // failure never blocks or fails an admin save (see `src/lib/revalidate.ts`).
  // Every save or delete revalidates the tag, not only ones that touch
  // `_status` — simpler than tracking publish transitions, and the only cost
  // is an occasional no-op revalidation of a page that did not visibly change.
  hooks: isNodeRuntimeTarget()
    ? {
        afterChange: [
          ({ doc }) => {
            void notifyRevalidate([runtimeProbeTag(String(doc.id))])
          },
        ],
        afterDelete: [
          ({ id }) => {
            void notifyRevalidate([runtimeProbeTag(String(id))])
          },
        ],
      }
    : undefined,
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      label: 'العنوان',
    },
    {
      name: 'body',
      type: 'richText',
      label: 'النص',
    },
    {
      name: 'attachment',
      type: 'upload',
      relationTo: RUNTIME_PROBE_MEDIA_SLUG,
      label: 'المرفق',
    },
    {
      name: 'lastScheduledRunAt',
      type: 'date',
      label: 'آخر تشغيل مجدول',
      admin: {
        readOnly: true,
        description: 'تكتبه المهمة المجدولة فقط.',
      },
    },
  ],
}
