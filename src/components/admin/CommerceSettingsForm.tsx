'use client'

/**
 * The store's seller details (P06 round 3, D34): one singleton row the owner
 * fills before the store opens. Read through `commerce_settings_get`, saved
 * through the `admin` Edge Function's `commerce-settings-save` action behind
 * the same TOTP step-up dialog as the team screen; a STEP_UP_REQUIRED reply
 * opens the dialog and the same save retries exactly once. Payment stays off
 * until the payment gateway (P08) and there is no tax field of any kind
 * (D34): prices are what the buyer pays. Only existing admin CSS classes.
 */
import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'

import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { callFunction } from '@/lib/supabase/functions'
import { commerceSettingsSchema } from '../../../supabase/functions/_shared/commerce-settings.ts'

import { StepUp } from './StepUp'
import { formatRiyadh } from './PublishBar'
import styles from './admin.module.css'

type CommerceRow = {
  currency: string
  version: number
  configuredAt: string | null
  policyRevisions: Record<string, unknown>
  sellerLegalName: string | null
  sellerAddress: string | null
  sellerRegistration: string | null
}

async function loadRow(): Promise<CommerceRow | null> {
  const { data, error } = await getSupabaseBrowserClient().rpc('commerce_settings_get')
  if (error || !data) return null
  return data as CommerceRow
}

/** An empty input clears the field; the schema and the SQL take it from there. */
const orNull = (value: string): string | null => (value.trim() === '' ? null : value)

export function CommerceSettingsForm() {
  const [row, setRow] = useState<CommerceRow | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [legalName, setLegalName] = useState('')
  const [address, setAddress] = useState('')
  const [registration, setRegistration] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [needsEnrollment, setNeedsEnrollment] = useState(false)
  const [stepUp, setStepUp] = useState<{ factorId: string; body: Record<string, unknown> } | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      const loaded = await loadRow()
      if (!active) return
      if (!loaded) {
        setLoadError(true)
        return
      }
      setRow(loaded)
      setLegalName(loaded.sellerLegalName ?? '')
      setAddress(loaded.sellerAddress ?? '')
      setRegistration(loaded.sellerRegistration ?? '')
    })()
    return () => {
      active = false
    }
  }, [])

  async function applyResult(ok: boolean, code: string, message: string, body: Record<string, unknown>) {
    if (ok) {
      setSaved(true)
      const loaded = await loadRow()
      if (loaded) setRow(loaded)
      return
    }
    if (code === 'STEP_UP_REQUIRED') {
      const supabase = getSupabaseBrowserClient()
      const { data } = await supabase.auth.mfa.listFactors()
      const verified = data?.totp.find((factor) => factor.status === 'verified')
      if (!verified) {
        setNeedsEnrollment(true)
        return
      }
      setStepUp({ factorId: verified.id, body })
      return
    }
    setError(message)
  }

  async function runSave(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    setSaved(false)
    setNeedsEnrollment(false)
    const result = await callFunction<{ version: number }>('admin', body)
    setBusy(false)
    await applyResult(result.ok, result.ok ? '' : result.error.code, result.ok ? '' : result.error.message, body)
  }

  async function onStepUpVerified() {
    if (!stepUp) return
    const { body } = stepUp
    setStepUp(null)
    setBusy(true)
    setError(null)
    const result = await callFunction<{ version: number }>('admin', body)
    setBusy(false)
    await applyResult(result.ok, result.ok ? '' : result.error.code, result.ok ? '' : result.error.message, body)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = commerceSettingsSchema.safeParse({
      sellerLegalName: orNull(legalName),
      sellerAddress: orNull(address),
      sellerRegistration: orNull(registration),
    })
    if (!parsed.success) {
      setSaved(false)
      setError(parsed.error.issues[0]?.message ?? 'تحقق من الحقول.')
      return
    }
    await runSave({ action: 'commerce-settings-save', expectedVersion: row?.version ?? 0, settings: parsed.data })
  }

  if (loadError) return <p className={styles.error}>تعذّر تحميل إعدادات المتجر.</p>
  if (!row) return <p className={styles.message}>يحمّل...</p>

  const policyEntries = Object.entries(row.policyRevisions)

  return (
    <div>
      <p>بيانات البائع كما في شهادة العمل الحر؛ تُستخدم عند فتح المتجر.</p>
      <ul className={styles.metaList}>
        <li>
          العملة: ريال سعودي (<span dir="ltr">SAR</span>)، للقراءة فقط.
        </li>
        <li>الدفع مغلق حاليًا؛ يُفتح بعد ربط بوابة الدفع.</li>
        <li>
          مراجعات السياسات:{' '}
          {policyEntries.length === 0
            ? 'لم تُعتمد بعد'
            : policyEntries.map(([kind, revision]) => `${kind}: ${String(revision)}`).join('، ')}
        </li>
        <li>إصدار الإعدادات: {row.version}</li>
        <li>آخر تغيير: {row.configuredAt ? formatRiyadh(row.configuredAt) : 'لا يوجد بعد'}</li>
      </ul>

      <form className={styles.form} onSubmit={submit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="seller-legal-name">
            الاسم القانوني للبائع
          </label>
          <input
            id="seller-legal-name"
            className={styles.input}
            type="text"
            maxLength={200}
            value={legalName}
            disabled={busy}
            onChange={(event) => setLegalName(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="seller-address">
            عنوان البائع
          </label>
          <input
            id="seller-address"
            className={styles.input}
            type="text"
            maxLength={500}
            value={address}
            disabled={busy}
            onChange={(event) => setAddress(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="seller-registration">
            رقم قيد شهادة العمل الحر
          </label>
          <input
            id="seller-registration"
            className={styles.input}
            type="text"
            maxLength={100}
            value={registration}
            disabled={busy}
            onChange={(event) => setRegistration(event.target.value)}
          />
        </div>
        <button type="submit" className={styles.button} disabled={busy}>
          حفظ
        </button>
      </form>

      {needsEnrollment && (
        <p className={styles.error} role="alert">
          يلزم تفعيل تطبيق المصادقة أولًا. اذهب إلى <Link href="/admin/security">صفحة الأمان</Link>.
        </p>
      )}
      {saved && (
        <p className={styles.message} role="status">
          تم الحفظ.
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {stepUp && (
        <StepUp open factorId={stepUp.factorId} onVerified={onStepUpVerified} onClose={() => setStepUp(null)} />
      )}
    </div>
  )
}
