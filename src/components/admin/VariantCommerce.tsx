'use client'

/**
 * What the variant form shows below it (P08 round 11c). The count of confirmed preorders, which the owner nets
 * out of the real stock, and, for a digital variant, its paid file with the owner's upload. The data is
 * `variant_admin_info`, called under the signed-in session: it rechecks the role inside (owner or operations),
 * and the screen only shapes itself by it — operations see the count and the file, and no upload.
 *
 * The upload is the `admin` function's two actions around a direct upload to Storage: `paid-file-ticket` (a
 * signed upload URL), the bytes to that URL, `paid-file-complete` (it checks the object and records it). The file
 * is checked before any call. A completion that answers `BUSY` leaves the object under its ticket, so «أعد المحاولة»
 * completes the same ticket again; every other refusal ends the ticket, and the next file starts a new one.
 *
 * The file may be recorded whatever a completion answers (an unknown outcome keeps the object), so the variant is
 * read again after every one, and the form is told (`onRecorded`): the record bumps the variant row's version.
 *
 * The status and alert lines are always mounted, for operations and a variant with no file too, so that what they
 * say is announced when it is filled. The result of an upload or of «تحديث» takes the focus, on the status line
 * or, for a refusal, the alert line.
 */
import { useEffect, useRef, useState, type ChangeEvent } from 'react'

import {
  BAD_REPLY,
  checkPaidFile,
  formatFileSize,
  LOAD_FAILED,
  NO_FILE,
  parseUploadDone,
  parseUploadTicket,
  parseVariantInfo,
  PREORDER_STOCK_NOTE,
  PREORDER_UNITS,
  REFRESHED,
  REPLACE_NOTE,
  UPLOAD_FAILED,
  UPLOADING,
  uploadedSentence,
  VARIANT_NOT_FOUND,
  type VariantInfo,
} from '@/lib/admin-commerce'
import { REREAD_FAILED } from '@/lib/admin-money'
import { formatNumber, formatRiyadh } from '@/lib/format'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { callFunction } from '@/lib/supabase/functions'

import styles from './admin.module.css'

interface Ticket {
  ticket: string
  filename: string
  mime: string
}

/** What a reading found: the info, `null` for the function's NOT_FOUND (the variant is gone), `'failed'` for a call or a reply that is no answer. */
type Reading = VariantInfo | null | 'failed'

async function readInfo(variantId: string): Promise<Reading> {
  try {
    const { data, error } = await getSupabaseBrowserClient().rpc('variant_admin_info', { p_variant: variantId })
    return error ? 'failed' : parseVariantInfo(data)
  } catch {
    return 'failed'
  }
}

export function VariantCommerce({
  variantId,
  digital,
  preorder,
  owner,
  onRecorded,
}: {
  variantId: string
  digital: boolean
  preorder: boolean
  owner: boolean
  /** The paid file's completion was answered (recorded or not): the form reads the row's version again. */
  onRecorded: () => Promise<void>
}) {
  const [info, setInfo] = useState<Reading | 'loading'>('loading')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [alert, setAlert] = useState('')
  const [focusLine, setFocusLine] = useState<{ line: 'status' | 'alert'; n: number } | null>(null)
  // A completion the function answered BUSY: the object waits under its ticket, so the same ticket completes again.
  const [retry, setRetry] = useState<Ticket | null>(null)
  const inFlight = useRef(false)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const alertRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    let active = true
    // Only while nothing has been read since: an upload may have read the variant again before this slow first answer.
    void readInfo(variantId).then((next) => {
      if (active) setInfo((current) => (current === 'loading' ? next : current))
    })
    return () => {
      active = false
    }
  }, [variantId])

  // The result of an upload, or of «تحديث», takes the focus.
  useEffect(() => {
    if (focusLine !== null) (focusLine.line === 'alert' ? alertRef : statusRef).current?.focus()
  }, [focusLine])

  function say(line: 'status' | 'alert', text: string) {
    setStatus(line === 'status' ? text : '')
    setAlert(line === 'alert' ? text : '')
    setFocusLine((current) => ({ line, n: (current?.n ?? 0) + 1 }))
  }

  /** «تحديث» after a reading that failed: what the new reading found is said on a line, which takes the focus. */
  async function refresh(): Promise<void> {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    const next = await readInfo(variantId)
    inFlight.current = false
    setBusy(false)
    setInfo(next)
    if (next === 'failed') say('alert', LOAD_FAILED)
    else if (next === null) say('alert', VARIANT_NOT_FOUND)
    else say('status', REFRESHED)
  }

  /** The variant read again after an upload. A reading that fails leaves what is drawn as it is; true when it failed, so that the screen says so. */
  async function reread(): Promise<boolean> {
    const next = await readInfo(variantId)
    setInfo((current) => (next === 'failed' && typeof current === 'object' && current !== null ? current : next))
    return next === 'failed'
  }

  /** One upload step at a time: the control is off while it runs, and a second press sends nothing. */
  async function run(task: () => Promise<void>): Promise<void> {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setRetry(null)
    setStatus(UPLOADING)
    setAlert('')
    try {
      await task()
    } catch {
      say('alert', UPLOAD_FAILED)
    }
    inFlight.current = false
    setBusy(false)
  }

  /** `paid-file-complete`: the function checks the uploaded object and records it, or says why not. */
  async function complete(ticket: Ticket): Promise<void> {
    const done = await callFunction<unknown>('admin', {
      action: 'paid-file-complete',
      variantId,
      ticket: ticket.ticket,
      filename: ticket.filename,
      mime: ticket.mime,
    })
    // The panel is read again after every attempt. The form takes the version a record bumped only when the file may have been
    // recorded: a success, or an outcome nobody knows (no reply, a failure of the function, a reply with no code). A refusal
    // recorded nothing (a check before the SQL, or a rolled-back transaction), so a version one step ahead after it is another
    // session's save, which the form's next save must meet as a conflict, never overwrite.
    const code = done.ok ? null : ((done.error ?? {}) as { code?: unknown }).code
    const mayHaveRecorded = done.ok || code === undefined || code === 'UNKNOWN' || code === 'FAILED'
    const [unread] = await Promise.all([reread(), mayHaveRecorded ? onRecorded() : Promise.resolve()])
    const report = (line: 'status' | 'alert', text: string) => (unread ? say('alert', `${text} ${REREAD_FAILED}`) : say(line, text))
    if (!done.ok) {
      // `callFunction` passes any 2xx body with an `ok` key through, so a «no» may carry no error at all.
      const error = (done.error ?? {}) as { code?: unknown; message?: unknown }
      if (error.code === 'BUSY') setRetry(ticket)
      report('alert', typeof error.message === 'string' && error.message !== '' ? error.message : BAD_REPLY)
      return
    }
    try {
      report('status', uploadedSentence(parseUploadDone(done.data).filled))
    } catch {
      report('alert', BAD_REPLY)
    }
  }

  async function upload(file: File, checked: { filename: string; mime: string }): Promise<void> {
    const ticket = await callFunction<unknown>('admin', {
      action: 'paid-file-ticket',
      variantId,
      filename: checked.filename,
      mime: checked.mime,
      bytes: file.size,
    })
    if (!ticket.ok) {
      const message = (ticket.error as { message?: unknown } | undefined)?.message
      say('alert', typeof message === 'string' && message !== '' ? message : BAD_REPLY)
      return
    }
    let signed: ReturnType<typeof parseUploadTicket>
    try {
      signed = parseUploadTicket(ticket.data)
    } catch {
      say('alert', BAD_REPLY)
      return
    }
    // A file the browser gave no type is sent as the type declared: the stored type is what the function checks.
    const body = file.type === checked.mime ? file : new Blob([file], { type: checked.mime })
    const { error } = await getSupabaseBrowserClient().storage.from(signed.bucket).uploadToSignedUrl(signed.path, signed.token, body, { contentType: checked.mime })
    if (error) {
      say('alert', UPLOAD_FAILED)
      return
    }
    await complete({ ticket: signed.ticket, filename: checked.filename, mime: checked.mime })
  }

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    // Emptied at once, so choosing the same file again is a change.
    event.target.value = ''
    if (file === null) return
    const checked = checkPaidFile(file)
    if (!checked.ok) {
      say('alert', checked.message)
      return
    }
    void run(() => upload(file, checked))
  }

  const loaded = typeof info === 'object' && info !== null ? info : null
  // A reading that failed, or found no variant, is said on the alert line until something else is said there.
  const readLine = info === 'failed' ? LOAD_FAILED : info === null ? VARIANT_NOT_FOUND : ''

  return (
    <div className={styles.field}>
      {info === 'loading' && <p className={styles.message}>يحمّل...</p>}
      {loaded !== null && (preorder || loaded.preorderUnits > 0) && (
        <>
          <p>
            {PREORDER_UNITS}: {formatNumber(loaded.preorderUnits)}
          </p>
          {!digital && <p className={styles.message}>{PREORDER_STOCK_NOTE}</p>}
        </>
      )}
      {digital && (
        <div className={styles.field}>
          <h2>الملف المدفوع</h2>
          {loaded !== null && (
            <p className={styles.break}>
              {loaded.file === null ? (
                NO_FILE
              ) : (
                <>
                  <bdi>{loaded.file.filename}</bdi>، {formatFileSize(loaded.file.bytes)}، رُفع {formatRiyadh(loaded.file.createdAt)}
                </>
              )}
            </p>
          )}
          {owner && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="variant-paid-file">
                رفع الملف المدفوع
              </label>
              <input
                id="variant-paid-file"
                className={styles.input}
                type="file"
                accept=".pdf,.epub"
                disabled={busy}
                aria-describedby="variant-paid-file-hint"
                onChange={choose}
              />
              <div id="variant-paid-file-hint">
                <p className={styles.message}>PDF أو EPUB، حتى 100 ميغابايت.</p>
                {loaded !== null && loaded.file !== null && <p className={styles.message}>{REPLACE_NOTE}</p>}
              </div>
            </div>
          )}
        </div>
      )}
      {/* Always mounted, so what they say is announced when it is filled. */}
      <p id="variant-commerce-status" role="status" ref={statusRef} tabIndex={-1} className={styles.message}>
        {status}
      </p>
      <p id="variant-commerce-alert" role="alert" ref={alertRef} tabIndex={-1} className={styles.error}>
        {alert === '' ? readLine : alert}
      </p>
      {info === 'failed' && (
        // aria-disabled, not disabled: the button keeps the focus while its own reading runs.
        <button type="button" className={styles.buttonSecondary} aria-disabled={busy || undefined} onClick={() => void refresh()}>
          تحديث
        </button>
      )}
      {retry !== null && (
        <button type="button" className={styles.buttonSecondary} disabled={busy} onClick={() => void run(() => complete(retry))}>
          أعد المحاولة
        </button>
      )}
    </div>
  )
}
