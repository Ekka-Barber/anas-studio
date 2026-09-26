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

import styles from './admin.module.css'

/**
 * Riyadh wall-clock date and time for every admin screen. The calendar is
 * pinned: current Chromium defaults `ar-SA` to Umm al-Qura (Hijri) while Node
 * and older browsers give Gregorian, so without `-u-ca-gregory` the same
 * timestamp read differently per viewer.
 */
export function formatRiyadh(iso: string): string {
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
    timeZone: 'Asia/Riyadh',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

/** `<input type="datetime-local">`'s value, read as Riyadh wall-clock time. */
function riyadhLocalToIso(localValue: string): string {
  return new Date(`${localValue}:00+03:00`).toISOString()
}

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
        <input
          className={styles.input}
          type="datetime-local"
          aria-label="موعد الجدولة"
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
      {liveSeq !== null && <p className={styles.message}>منشور حاليًا: نسخة {liveSeq}.</p>}
      {scheduledAt && <p className={styles.message}>مجدول في {formatRiyadh(scheduledAt)}.</p>}
      {message && <p className={styles.message}>{message}</p>}
    </div>
  )
}
