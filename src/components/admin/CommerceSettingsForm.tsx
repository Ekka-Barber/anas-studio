'use client'

/**
 * The store's seller details (P06 round 3, D34): one singleton row the owner
 * fills before the store opens. Read through `commerce_settings_get`, saved
 * through the `admin` Edge Function's `commerce-settings-save` action behind
 * the same TOTP step-up dialog as the team screen; a STEP_UP_REQUIRED reply
 * opens the dialog and the same save retries exactly once. P07 round 2 adds
 * the policy approval (`commerce-policies-approve`) through the same dialog:
 * the owner approves the published policy revisions, listed here with their
 * names and version numbers, and the checkout policy is what he approved.
 * P08 adds «الشراء»: the payments status the `admin` function's `status`
 * action reports (names and booleans, never a key) and the owner's checkout
 * switch (`commerce-checkout-set`), through the same dialog. There is no tax
 * field of any kind (D34): prices are what the buyer pays. Existing admin CSS
 * classes, plus one rule for the «الشراء» box.
 */
import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'

import { POLICY_DOC_LABELS, type PolicyDocId } from '@/admin/collections/policies'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { callFunction } from '@/lib/supabase/functions'
import type { SettingsStatus } from '../../../supabase/functions/_shared/admin.ts'
import { commerceSettingsSchema } from '../../../supabase/functions/_shared/commerce-settings.ts'

import { StepUp } from './StepUp'
import { formatRiyadh } from '@/lib/format'
import styles from './admin.module.css'

type PaymentsStatus = SettingsStatus['payments']

type CommerceRow = {
  checkoutEnabled: boolean
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

/** The approved revision's policy name and version, e.g. «سياسة المتجر: نسخة 3». */
function policyName(kind: string, revision: unknown): string {
  const label = POLICY_DOC_LABELS[kind as PolicyDocId] ?? kind
  return `${label}: نسخة ${String(revision)}`
}

/** What `status` says of the payments, in one plain sentence; nothing beyond it. */
function paymentsLine(payments: PaymentsStatus): string {
  if (!payments.configured) return 'الدفع غير مضبوط'
  if (payments.mode === 'live') return 'الدفع مضبوط: وضع حي'
  return payments.emulator ? 'الدفع مضبوط: وضع تجريبي، محاكٍ محلي' : 'الدفع مضبوط: وضع تجريبي'
}

export function CommerceSettingsForm() {
  const [row, setRow] = useState<CommerceRow | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [payments, setPayments] = useState<PaymentsStatus | 'loading' | 'failed'>('loading')
  const [legalName, setLegalName] = useState('')
  const [address, setAddress] = useState('')
  const [registration, setRegistration] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [needsEnrollment, setNeedsEnrollment] = useState(false)
  const [stepUp, setStepUp] = useState<{ factorId: string; body: Record<string, unknown>; successMessage: string } | null>(null)

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
    void (async () => {
      const result = await callFunction<{ payments: PaymentsStatus }>('admin', { action: 'status' })
      if (active) setPayments(result.ok ? result.data.payments : 'failed')
    })()
    return () => {
      active = false
    }
  }, [])

  async function applyResult(ok: boolean, code: string, message: string, body: Record<string, unknown>, successMessage: string) {
    if (ok) {
      setSaved(successMessage)
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
      setStepUp({ factorId: verified.id, body, successMessage })
      return
    }
    setError(message)
  }

  async function runAction(body: Record<string, unknown>, successMessage: string) {
    setBusy(true)
    setError(null)
    setSaved(null)
    setNeedsEnrollment(false)
    const result = await callFunction<{ version: number }>('admin', body)
    setBusy(false)
    await applyResult(result.ok, result.ok ? '' : result.error.code, result.ok ? '' : result.error.message, body, successMessage)
  }

  async function onStepUpVerified() {
    if (!stepUp) return
    const { body, successMessage } = stepUp
    setStepUp(null)
    setBusy(true)
    setError(null)
    const result = await callFunction<{ version: number }>('admin', body)
    setBusy(false)
    await applyResult(result.ok, result.ok ? '' : result.error.code, result.ok ? '' : result.error.message, body, successMessage)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = commerceSettingsSchema.safeParse({
      sellerLegalName: orNull(legalName),
      sellerAddress: orNull(address),
      sellerRegistration: orNull(registration),
    })
    if (!parsed.success) {
      setSaved(null)
      setError(parsed.error.issues[0]?.message ?? 'تحقق من الحقول.')
      return
    }
    await runAction({ action: 'commerce-settings-save', expectedVersion: row?.version ?? 0, settings: parsed.data }, 'تم الحفظ.')
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
        <li>
          مراجعات السياسات المعتمدة:{' '}
          {policyEntries.length === 0
            ? 'لم تُعتمد بعد'
            : policyEntries.map(([kind, revision]) => policyName(kind, revision)).join('، ')}
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

      <h3>اعتماد السياسات</h3>
      <p className={styles.message}>
        يثبّت الاعتماد النسخ المنشورة من سياسات المتجر والتوصيل والاسترجاع (والخصوصية إن نُشرت) كما يقبَلها المشتري عند الدفع؛
        انشر التعديلات من{' '}
        <Link href="/admin/content/policies">السياسات</Link> أولًا.
      </p>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.button}
          disabled={busy}
          onClick={() => void runAction({ action: 'commerce-policies-approve', expectedVersion: row.version }, 'تم اعتماد السياسات.')}
        >
          اعتماد السياسات المنشورة
        </button>
      </div>

      <fieldset className={`${styles.fieldset} ${styles.switchBox}`}>
        <legend className={styles.legend}>الشراء</legend>
        <p className={styles.message}>
          {payments === 'loading' ? 'يحمّل...' : payments === 'failed' ? 'تعذّر قراءة حالة الدفع.' : paymentsLine(payments)}
        </p>
        <p>{row.checkoutEnabled ? 'الشراء مفتوح' : 'الشراء مغلق'}</p>
        <p className={styles.message}>يتحكم المفتاح في استقبال الطلبات الجديدة فقط؛ الطلبات القائمة تُدفع وتُلغى كما هي.</p>
        <div className={styles.row}>
          <button
            type="button"
            className={styles.button}
            disabled={busy}
            onClick={() =>
              void runAction(
                { action: 'commerce-checkout-set', enabled: !row.checkoutEnabled, expectedVersion: row.version },
                row.checkoutEnabled ? 'تم إغلاق الشراء.' : 'تم فتح الشراء.',
              )
            }
          >
            {row.checkoutEnabled ? 'أغلق الشراء' : 'افتح الشراء'}
          </button>
        </div>
      </fieldset>

      {needsEnrollment && (
        <p className={styles.error} role="alert">
          يلزم تفعيل تطبيق المصادقة أولًا. اذهب إلى <Link href="/admin/security">صفحة الأمان</Link>.
        </p>
      )}
      {saved && (
        <p className={styles.message} role="status">
          {saved}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {/* Always mounted: closing it calls dialog.close(), which returns focus to where the owner was. */}
      <StepUp
        open={stepUp !== null}
        factorId={stepUp?.factorId ?? ''}
        onVerified={onStepUpVerified}
        onClose={() => setStepUp(null)}
      />
    </div>
  )
}
