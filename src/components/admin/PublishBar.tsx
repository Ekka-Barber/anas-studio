'use client'

/**
 * Publish, schedule, cancel, archive and preview one document (P04 part 2).
 * Publish/schedule act on the given `seq` (the latest saved version); the
 * parent disables everything while the saved version is invalid or the form
 * has unsaved changes.
 */
import { useState } from 'react'

import type { Collection } from '@/admin/collections'

import { archiveAction, cancelScheduleAction, publishAction, scheduleAction } from '@/app/(admin)/admin/actions'

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
  accessToken: string
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
  accessToken,
  canPublish,
  canArchive,
  previewPath,
  onChanged,
}: PublishBarProps) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [scheduleValue, setScheduleValue] = useState('')
  const [previewing, setPreviewing] = useState(false)

  async function run(label: string, task: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setBusy(true)
    setMessage(null)
    const result = await task()
    setBusy(false)
    if (result.ok) {
      setMessage(`${label}: تم بنجاح.`)
      onChanged()
    } else {
      setMessage(`${label}: ${result.error?.message ?? 'تعذّر إكمال الإجراء.'}`)
    }
  }

  async function preview() {
    if (!previewPath) return
    setBusy(true)
    setMessage(null)
    const response = await fetch('/api/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken, path: previewPath }),
    })
    const result = (await response.json()) as { ok: boolean; error?: { message: string } }
    setBusy(false)
    if (result.ok) {
      setPreviewing(true)
      setMessage('المعاينة مفعّلة.')
      window.open(previewPath, '_blank')
    } else {
      setMessage(result.error?.message ?? 'تعذّرت المعاينة.')
    }
  }

  async function endPreview() {
    setBusy(true)
    await fetch('/api/preview', { method: 'DELETE' })
    setBusy(false)
    setPreviewing(false)
    setMessage('انتهت المعاينة.')
  }

  return (
    <div className={styles.field}>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.button}
          disabled={busy || !canPublish}
          onClick={() => run('نشر', () => publishAction(accessToken, collection, docId, seq))}
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
            run('جدولة', () => scheduleAction(accessToken, collection, docId, seq, riyadhLocalToIso(scheduleValue)))
          }
        >
          جدولة
        </button>
        {scheduledAt && (
          <button
            type="button"
            className={styles.buttonSecondary}
            disabled={busy}
            onClick={() => run('إلغاء الجدولة', () => cancelScheduleAction(accessToken, collection, docId))}
          >
            إلغاء الجدولة
          </button>
        )}
        {canArchive && (
          <button
            type="button"
            className={styles.buttonSecondary}
            disabled={busy}
            onClick={() => run('أرشفة', () => archiveAction(accessToken, collection, docId))}
          >
            أرشفة
          </button>
        )}
        {previewPath &&
          (previewing ? (
            <button type="button" className={styles.buttonSecondary} disabled={busy} onClick={endPreview}>
              إنهاء المعاينة
            </button>
          ) : (
            <button type="button" className={styles.buttonSecondary} disabled={busy} onClick={preview}>
              معاينة
            </button>
          ))}
      </div>
      {liveSeq !== null && <p className={styles.message}>منشور حاليًا: نسخة {liveSeq}.</p>}
      {scheduledAt && <p className={styles.message}>مجدول في {formatRiyadh(scheduledAt)}.</p>}
      {message && <p className={styles.message}>{message}</p>}
    </div>
  )
}
