'use client'

/**
 * Publish, schedule, cancel, archive and preview one document (P04 part 2).
 * Publish/schedule act on the given `seq` (the latest saved version); the
 * parent disables everything while the saved version is invalid or the form
 * has unsaved changes. D32: publishing rebuilds the static site, so a change
 * appears publicly a few minutes later, and preview opens the admin's own
 * preview page instead of switching the public site into draft mode.
 */
import { useState } from 'react'

import type { Collection } from '@/admin/collections'
// Relative, like the money-input import: the unit tests render this bar, and they do not resolve `@/`.
import {
  archiveDocument,
  ARCHIVE_CONFIRM,
  cancelSchedule,
  POLICY_PUBLISH_NOTE,
  publishDocument,
  scheduleDocument,
  scheduleIsBehind,
  successMessage,
} from '../../lib/admin-publish'
import { formatRiyadh } from '../../lib/format'
import { riyadhLocalToIsoOrNull } from '../../lib/money-input'

import styles from './admin.module.css'

interface PublishBarProps {
  collection: Collection
  docId: string
  seq: number
  liveSeq: number | null
  scheduledAt: string | null
  /** The version the pending schedule will publish; null when nothing is scheduled. */
  scheduledSeq: number | null
  canPublish: boolean
  canArchive: boolean
  /** A post whose «ظاهر» is off: publishing it does not put it on the site, and the message says so. */
  siteHidden?: boolean
  previewPath: string | null
  onChanged: () => void
}

export function PublishBar({
  collection,
  docId,
  seq,
  liveSeq,
  scheduledAt,
  scheduledSeq,
  canPublish,
  canArchive,
  siteHidden = false,
  previewPath,
  onChanged,
}: PublishBarProps) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [scheduleValue, setScheduleValue] = useState('')
  const scheduleId = `${collection}-${docId}-schedule`
  const policy = collection === 'policies'

  async function run(
    label: string,
    task: () => Promise<{ ok: boolean; error?: { message: string } }>,
    shown: { rebuilds?: boolean; hidden?: boolean; policy?: boolean } = {},
  ) {
    setBusy(true)
    setMessage(null)
    // A task that throws must not leave every button disabled.
    const result = await task().catch(() => ({ ok: false, error: { message: 'تعذّر إكمال الإجراء.' } }))
    setBusy(false)
    if (result.ok) {
      setMessage(successMessage(label, shown))
      onChanged()
    } else {
      setMessage(`${label}: ${result.error?.message ?? 'تعذّر إكمال الإجراء.'}`)
    }
  }

  // The bar says why a schedule does not go ahead instead of disabling the button.
  function schedule() {
    const at = riyadhLocalToIsoOrNull(scheduleValue)
    if (at === null) {
      setMessage('جدولة: اكتب موعدًا صالحًا، بسنة من أربع خانات.')
      return
    }
    if (Date.parse(at) <= Date.now()) {
      setMessage('جدولة: يجب أن يكون موعد الجدولة في المستقبل.')
      return
    }
    void run('جدولة', () => scheduleDocument(collection, docId, seq, at), { policy })
  }

  const behind = scheduledAt !== null && scheduleIsBehind(scheduledSeq, seq)

  return (
    <div className={styles.field}>
      {policy && <p className={styles.message}>{POLICY_PUBLISH_NOTE}</p>}
      <div className={styles.row}>
        <button
          type="button"
          className={styles.button}
          disabled={busy || !canPublish}
          onClick={() => run('نشر', () => publishDocument(collection, docId, seq), { rebuilds: true, hidden: siteHidden, policy })}
        >
          نشر
        </button>
        {/* A document never published has nothing to take off the site. */}
        {canArchive && liveSeq !== null && (
          <button
            type="button"
            className={styles.buttonSecondary}
            disabled={busy}
            onClick={() => {
              if (window.confirm(ARCHIVE_CONFIRM)) void run('أرشفة', () => archiveDocument(collection, docId), { rebuilds: true })
            }}
          >
            أرشفة
          </button>
        )}
        {previewPath && (
          <a className={styles.buttonSecondary} href={previewPath} target="_blank" rel="noopener">
            معاينة
          </a>
        )}
      </div>
      {/* The schedule time, its label and its buttons wrap as one group, so
          on a phone the time never sits beside «نشر» as if it belonged there. */}
      <div className={styles.row}>
        <label className={styles.label} htmlFor={scheduleId}>
          موعد الجدولة
        </label>
        <input
          id={scheduleId}
          className={styles.input}
          type="datetime-local"
          value={scheduleValue}
          onChange={(event) => setScheduleValue(event.target.value)}
        />
        <button
          type="button"
          className={styles.buttonSecondary}
          disabled={busy || !canPublish || !scheduleValue}
          onClick={schedule}
        >
          جدولة
        </button>
        {scheduledAt && (
          <button
            type="button"
            className={styles.buttonSecondary}
            disabled={busy}
            onClick={() => run('إلغاء الجدولة', () => cancelSchedule(collection, docId))}
          >
            إلغاء الجدولة
          </button>
        )}
      </div>
      {liveSeq !== null && <p className={styles.message}>منشور حاليًا: نسخة {liveSeq}.</p>}
      {scheduledAt && (
        <p className={styles.message}>
          {scheduledSeq !== null ? `مجدول: نسخة ${scheduledSeq} في ` : 'مجدول في '}
          {formatRiyadh(scheduledAt)}.
        </p>
      )}
      {scheduledAt && behind && (
        // One click moves the schedule to the latest version, at the same time.
        <div className={styles.row}>
          <p role="alert" className={styles.error}>
            الجدولة على نسخة أقدم: ستُنشر النسخة {scheduledSeq} في الموعد، وآخر نسخة محفوظة هي {seq}.
          </p>
          <button
            type="button"
            className={styles.buttonSecondary}
            disabled={busy || !canPublish}
            onClick={() => void run('جدولة', () => scheduleDocument(collection, docId, seq, scheduledAt), { policy })}
          >
            جدولة النسخة {seq} في الموعد نفسه
          </button>
        </div>
      )}
      <p role="status" className={styles.message}>
        {message}
      </p>
    </div>
  )
}
