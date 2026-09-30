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
import { archiveDocument, cancelSchedule, publishDocument, scheduleDocument } from '@/lib/admin-publish'
import { formatRiyadh } from '@/lib/format'

import { riyadhLocalToIso } from '../../lib/money-input'

import styles from './admin.module.css'

interface PublishBarProps {
  collection: Collection
  docId: string
  seq: number
  liveSeq: number | null
  scheduledAt: string | null
  canPublish: boolean
  canArchive: boolean
  previewPath: string | null
  onChanged: () => void
}

export function PublishBar({
  collection,
  docId,
  seq,
  liveSeq,
  scheduledAt,
  canPublish,
  canArchive,
  previewPath,
  onChanged,
}: PublishBarProps) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [scheduleValue, setScheduleValue] = useState('')
  const scheduleId = `${collection}-${docId}-schedule`

  async function run(
    label: string,
    task: () => Promise<{ ok: boolean; error?: { message: string } }>,
    rebuilds = false,
  ) {
    setBusy(true)
    setMessage(null)
    const result = await task()
    setBusy(false)
    if (result.ok) {
      setMessage(rebuilds ? `${label}: تم بنجاح. يظهر التعديل على الموقع خلال دقائق.` : `${label}: تم بنجاح.`)
      onChanged()
    } else {
      setMessage(`${label}: ${result.error?.message ?? 'تعذّر إكمال الإجراء.'}`)
    }
  }

  return (
    <div className={styles.field}>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.button}
          disabled={busy || !canPublish}
          onClick={() => run('نشر', () => publishDocument(collection, docId, seq), true)}
        >
          نشر
        </button>
        {canArchive && (
          <button
            type="button"
            className={styles.buttonSecondary}
            disabled={busy}
            onClick={() => run('أرشفة', () => archiveDocument(collection, docId), true)}
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
          onClick={() =>
            run('جدولة', () => scheduleDocument(collection, docId, seq, riyadhLocalToIso(scheduleValue)))
          }
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
      {scheduledAt && <p className={styles.message}>مجدول في {formatRiyadh(scheduledAt)}.</p>}
      <p role="status" className={styles.message}>
        {message}
      </p>
    </div>
  )
}
