import type { CollectionConfig } from 'payload'

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
    read: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
    readVersions: ({ req }) => Boolean(req.user),
  },
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
