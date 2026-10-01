'use client'

/**
 * Owner-only settings (P06 round 2): a link to the site settings document,
 * a WhatsApp preview through `normalizeSaudiMobile` (the publish gate's own
 * rule, so the two never disagree), the configuration status from
 * `settingsStatusAction` (booleans and names only — never a value), and the
 * static domain/mail steps. No editable secret fields anywhere.
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { WHATSAPP_ERROR } from '@/admin/collections/site-settings'
import { normalizeSaudiMobile } from '@/lib/format'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { callFunction, documentHref } from '@/lib/supabase/functions'
import type { SettingsStatus } from '../../../supabase/functions/_shared/admin.ts'

import { useStaffRole } from './AdminShell'
import { CommerceSettingsForm } from './CommerceSettingsForm'
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

type WhatsAppPreview =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'not-set' }
  | { state: 'ok'; url: string }
  | { state: 'invalid' }

function setOrNot(set: boolean): string {
  return set ? 'مضبوط' : 'غير مضبوط'
}

export function SettingsView() {
  const role = useStaffRole()
  const [whatsapp, setWhatsapp] = useState<WhatsAppPreview>({ state: 'loading' })
  const [status, setStatus] = useState<SettingsStatus | null>(null)
  const [statusError, setStatusError] = useState(false)

  useEffect(() => {
    if (role !== 'owner') return
    let active = true
    void (async () => {
      const supabase = getSupabaseBrowserClient()
      // The published settings first; the latest draft when nothing is live.
      const { data: published, error: publishedError } = await supabase
        .from('published_documents')
        .select('data')
        .eq('collection', 'site_settings')
        .eq('doc_id', 'site')
        .maybeSingle()
      let data = (published?.data as { contact?: { whatsapp?: unknown } } | null)?.contact
      let draftError: unknown = null
      if (!data) {
        const { data: row, error } = await supabase
          .from('content_documents')
          .select('latest_data')
          .eq('collection', 'site_settings')
          .eq('doc_id', 'site')
          .maybeSingle()
        draftError = error
        data = (row?.latest_data as { contact?: { whatsapp?: unknown } } | null)?.contact
      }
      if (!active) return
      // D21: when a failed read leaves the answer unknown, say so; «غير مُعدّ» is only for a real absence.
      if (!data && (publishedError || draftError)) {
        setWhatsapp({ state: 'error' })
        return
      }
      const raw = data?.whatsapp
      if (typeof raw !== 'string' || raw.trim() === '') {
        setWhatsapp({ state: 'not-set' })
        return
      }
      // The same helper the settings schema enforces server-side (L5), so
      // the preview and the publish rule can never disagree.
      const normalized = normalizeSaudiMobile(raw)
      setWhatsapp(normalized !== null ? { state: 'ok', url: `https://wa.me/${normalized}` } : { state: 'invalid' })
    })()

    void (async () => {
      const { data: sessionData } = await getSupabaseBrowserClient().auth.getSession()
      if (!sessionData.session) return
      const result = await callFunction<SettingsStatus>('admin', { action: 'status' })
      if (!active) return
      if (result.ok) setStatus(result.data)
      else setStatusError(true)
    })()

    return () => {
      active = false
    }
  }, [role])

  if (role !== 'owner') {
    return (
      <div>
        <h1>الإعدادات</h1>
        <p className={styles.error}>هذه الصفحة للمالك فقط.</p>
      </div>
    )
  }

  return (
    <div>
      <h1>الإعدادات</h1>

      <section>
        <h2>إعدادات الموقع</h2>
        <p>
          التنقل والتذييل وحقول SEO والتواصل تُحرَّر في{' '}
          <Link href={documentHref('site_settings', 'site')}>مستند إعدادات الموقع</Link>.
        </p>
        <p>معاينة رابط واتساب:</p>
        {whatsapp.state === 'loading' && <p className={styles.message}>يحمّل...</p>}
        {whatsapp.state === 'error' && <p className={styles.error}>تعذّر التحميل</p>}
        {whatsapp.state === 'not-set' && <p className={styles.message}>غير مُعدّ بعد.</p>}
        {whatsapp.state === 'ok' && (
          <p>
            <a dir="ltr" href={whatsapp.url}>
              {whatsapp.url}
            </a>
          </p>
        )}
        {whatsapp.state === 'invalid' && <p className={styles.error}>{WHATSAPP_ERROR}</p>}
      </section>

      <section>
        <h2>إعدادات المتجر</h2>
        <CommerceSettingsForm />
      </section>

      <section>
        <h2>النسخ الاحتياطي</h2>
        <p>
          تُحفظ النسخة على جهازك أنت، مشفّرة بعبارة مرور لا يعرفها غيرك. لا يحتفظ Supabase المجاني بأي نسخة، فما
          يُضاف بعد آخر نسخة يضيع إن ضاع المشروع.
        </p>
        <ol className={styles.metaList}>
          <li>
            مرة واحدة: ثبّت Docker Desktop و Node 24 و pnpm و Supabase CLI، ثم نفّذ في مجلد المشروع{' '}
            <span dir="ltr">supabase login</span> ثم <span dir="ltr">supabase link</span> واختر مشروع{' '}
            <span dir="ltr">ANAS.STUDIO</span>.
          </li>
          <li>
            كل مرة، ويُستحسن بعد كل جلسة تحرير: شغّل Docker Desktop، ثم نفّذ في مجلد المشروع{' '}
            <span dir="ltr">pnpm backup</span> وأدخل عبارة المرور.
          </li>
          <li>
            تُحفظ الملفات في مجلد <span dir="ltr">ANASAQ-backups</span> داخل مجلدك الشخصي. انسخها من وقت لآخر إلى
            قرص خارجي أو خدمة سحابية، فهي مشفّرة.
          </li>
          <li>احفظ عبارة المرور في مدير كلمات المرور: من دونها لا تُفتح أي نسخة.</li>
        </ol>
      </section>

      <section>
        <h2>حالة الإعداد</h2>
        {statusError && <p className={styles.error}>تعذّر تحميل الحالة.</p>}
        {!statusError && !status && <p className={styles.message}>يحمّل...</p>}
        {status && (
          <ul className={styles.metaList}>
            <li>
              البريد: {PROVIDER_LABEL[status.email.provider]}، وعنوان المُرسِل {setOrNot(status.email.fromSet)}
            </li>
            <li>
              حماية النماذج (Turnstile): {setOrNot(status.turnstile.configured)}
              {status.turnstile.configured && status.turnstile.testSecret ? '، بمفتاح اختباري' : ''}
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
            بريدك الرسمي: في Cloudflare من Email Routing أضف <span dir="ltr">help@anas.studio</span> ووجّهه لبريدك
            الشخصي بعد ما توثّقه. رسائل نموذج التواصل توصل بريدك مباشرة، وتردّ عليها بزر «رد».
          </li>
          <li>
            توثيق النطاق <span dir="ltr">anas.studio</span> في Resend: من صفحة Domains أضف النطاق، ثم انسخ سجلات
            التحقق التي تظهرها (DKIM و SPF؛ سجلات TXT و MX أو CNAME) إلى DNS في Cloudflare. لا تفعّل البروكسي
            (السحابة البرتقالية) على سجل CNAME. يكتمل التوثيق عادة خلال دقائق وقد يصل إلى 72 ساعة.
          </li>
          <li>
            إضافة Webhook في Resend لأحداث التسليم (<span dir="ltr">delivered, bounced, complained…</span>) يشير إلى دالة{' '}
            <span dir="ltr">resend-webhook</span> في Supabase (<span dir="ltr">…supabase.co/functions/v1/resend-webhook</span>)،
            وحفظ سرّه كسرّ للدوال باسم <span dir="ltr">RESEND_WEBHOOK_SECRET</span>.
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
