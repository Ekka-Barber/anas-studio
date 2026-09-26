'use client'

/**
 * Owner-only settings (P06 round 2): a link to the site settings document,
 * a WhatsApp preview through `whatsappLink`, the configuration status from
 * `settingsStatusAction` (booleans and names only — never a value), and the
 * static domain/mail steps. No editable secret fields anywhere.
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { settingsStatusAction, type SettingsStatus } from '@/app/(admin)/admin/actions'
import { whatsappLink } from '@/lib/format'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import styles from './admin.module.css'

// Resend domain verification steps: resend.com/docs/add-a-domain (fetched
// 2026-09-26, artifacts/acceptance/P06/source-resend-domains.md) — the
// dashboard's Records tab shows the DKIM/SPF records (TXT and MX or CNAME),
// a CNAME must not be proxied (Cloudflare's orange cloud), verification
// usually completes within 15 minutes and can take up to 72 hours.
const PROVIDER_LABEL: Record<SettingsStatus['email']['provider'], string> = {
  resend: 'Resend',
  mailpit: 'Mailpit (محلي)',
  none: 'غير مُعد',
}

type WhatsAppPreview = { state: 'loading' } | { state: 'not-set' } | { state: 'ok'; url: string } | { state: 'invalid' }

function setOrNot(set: boolean): string {
  return set ? 'مضبوط' : 'غير مضبوط'
}

export function SettingsView() {
  const [whatsapp, setWhatsapp] = useState<WhatsAppPreview>({ state: 'loading' })
  const [status, setStatus] = useState<SettingsStatus | null>(null)
  const [statusError, setStatusError] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      const supabase = getSupabaseBrowserClient()
      // The published settings first; the latest draft when nothing is live.
      const { data: published } = await supabase
        .from('published_documents')
        .select('data')
        .eq('collection', 'site_settings')
        .eq('doc_id', 'site')
        .maybeSingle()
      let data = (published?.data as { contact?: { whatsapp?: unknown } } | null)?.contact
      if (!data) {
        const { data: row } = await supabase
          .from('content_documents')
          .select('latest_data')
          .eq('collection', 'site_settings')
          .eq('doc_id', 'site')
          .maybeSingle()
        data = (row?.latest_data as { contact?: { whatsapp?: unknown } } | null)?.contact
      }
      if (!active) return
      const raw = data?.whatsapp
      if (typeof raw !== 'string' || raw.trim() === '') {
        setWhatsapp({ state: 'not-set' })
        return
      }
      const url = whatsappLink(raw)
      setWhatsapp(url ? { state: 'ok', url } : { state: 'invalid' })
    })()

    void (async () => {
      const { data: sessionData } = await getSupabaseBrowserClient().auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) return
      const result = await settingsStatusAction(token)
      if (!active) return
      if (result) setStatus(result)
      else setStatusError(true)
    })()

    return () => {
      active = false
    }
  }, [])

  return (
    <div>
      <h1>الإعدادات</h1>

      <section>
        <h2>إعدادات الموقع</h2>
        <p>
          التنقل والتذييل وحقول SEO والتواصل تُحرَّر في{' '}
          <Link href="/admin/content/site_settings/site">مستند إعدادات الموقع</Link>.
        </p>
        <p>معاينة رابط واتساب:</p>
        {whatsapp.state === 'loading' && <p className={styles.message}>يحمّل...</p>}
        {whatsapp.state === 'not-set' && <p className={styles.message}>غير مُعدّ بعد.</p>}
        {whatsapp.state === 'ok' && (
          <p>
            <a dir="ltr" href={whatsapp.url}>
              {whatsapp.url}
            </a>
          </p>
        )}
        {whatsapp.state === 'invalid' && <p className={styles.error}>رقم غير صالح</p>}
      </section>

      <section>
        <h2>حالة الإعداد</h2>
        {statusError && <p className={styles.error}>تعذّر تحميل الحالة — هذه الصفحة للمالك فقط.</p>}
        {!statusError && !status && <p className={styles.message}>يحمّل...</p>}
        {status && (
          <ul className={styles.metaList}>
            <li>
              البريد: {PROVIDER_LABEL[status.email.provider]} — عنوان المُرسِل {setOrNot(status.email.fromSet)}
            </li>
            <li>
              حماية النماذج (Turnstile): {setOrNot(status.turnstile.configured)}
              {status.turnstile.configured && status.turnstile.testSecret ? ' — بمفتاح اختباري' : ''}
            </li>
            <li>أحداث تسليم البريد (Webhook): {setOrNot(status.webhook)}</li>
            <li>مهام التشغيل: {setOrNot(status.jobs)}</li>
            <li>
              الموقع: <span dir="ltr">{status.siteHost || 'غير مضبوط'}</span>
            </li>
            <li>الإحصاءات: {setOrNot(status.analytics)}</li>
          </ul>
        )}
      </section>

      <section>
        <h2>خطوات النطاق والبريد</h2>
        <ol className={styles.metaList}>
          <li>
            توثيق النطاق <span dir="ltr">anas.studio</span> في Resend: من صفحة Domains أضف النطاق، ثم انسخ سجلات
            التحقق التي تظهرها (DKIM و SPF؛ سجلات TXT و MX أو CNAME) إلى DNS في Cloudflare. لا تفعّل البروكسي
            (السحابة البرتقالية) على سجل CNAME. يكتمل التوثيق عادة خلال دقائق وقد يصل إلى 72 ساعة.
          </li>
          <li>
            إضافة Webhook في Resend لأحداث التسليم (delivered, bounced, complained…) يشير إلى{' '}
            <span dir="ltr">anas.studio/api/email/resend/webhook</span>، وحفظ سرّه كسرّ Worker باسم{' '}
            <span dir="ltr">RESEND_WEBHOOK_SECRET</span>.
          </li>
          <li>
            إنشاء عنصر Turnstile للنطاق <span dir="ltr">anas.studio</span> وتخزين مفتاحيه.
          </li>
          <li>
            ضبط بريد Supabase Auth على SMTP الخاص بـ Resend عند الانتقال للمستضاف (I28)، فتصبح رموز الدخول عبر
            القناة نفسها.
          </li>
        </ol>
        <p className={styles.message}>
          المرجع: <span dir="ltr">resend.com/docs/add-a-domain</span>
        </p>
      </section>
    </div>
  )
}
