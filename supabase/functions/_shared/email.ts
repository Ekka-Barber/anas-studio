/**
 * Outbound email (P06, DATA "Email delivery and retries").
 *
 * Plain text only: user-supplied content is never placed in HTML, so it can
 * never inject markup. Nothing here logs a recipient, a body or an
 * idempotency key.
 *
 * Provider selection (`emailProvider()` below):
 * 1. A hosted site (non-local `SITE_URL`) with `RESEND_API_KEY` set —
 *    Resend (`POST https://api.resend.com/emails`,
 *    fetched 2026-09-26, resend.com/docs/api-reference/emails/send-email).
 *    The `Idempotency-Key` header (1–256 characters, kept 24 hours; the same
 *    key and payload give the same response without sending again —
 *    resend.com/docs/dashboard/emails/idempotency-keys) makes the retry
 *    classification below safe: a retried send cannot send twice within 24
 *    hours.
 * 2. a local site (local `SITE_URL`) with `EMAIL_DEV_MAILPIT_URL` set — the
 *    local Supabase stack's Mailpit (`POST /api/v1/send`, verified locally
 *    2026-09-26). Local hosts only (the functions reach it from Docker as
 *    `host.docker.internal`), never for a hosted site.
 * 3. else `EmailNotConfiguredError` — unconfigured means unavailable.
 */

import { isHostedSite, LOCAL_HOSTS, optionalEnv, requireEnv, secretsMatch } from './env.ts'

const RESEND_SEND_URL = 'https://api.resend.com/emails'
const RESEND_TIMEOUT_MS = 10_000

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('No email provider is configured (RESEND_API_KEY or EMAIL_DEV_MAILPIT_URL).')
    this.name = 'EmailNotConfiguredError'
  }
}

/**
 * `accepted` — the provider took the message (`providerId` is its id).
 * `retry` — a transient error; the caller backs off and tries again (the
 * idempotency key makes that safe).
 * `permanent` — retrying with this key/payload cannot succeed.
 * `uncertain` — the request may have left; reconcile before/inside the retry
 * window (the outbox re-claims uncertain rows while the key is still valid).
 * `error` is a short ASCII code only, safe to store in `last_error`.
 */
export type SendOutcome =
  | { outcome: 'accepted'; providerId: string }
  | { outcome: 'retry' | 'permanent' | 'uncertain'; error: string }

/** Resend error classification, from the fetched errors page
 * (resend.com/docs/api-reference/errors, 2026-09-26):
 * - 409 `concurrent_idempotent_requests` "Try the request again later" → retry;
 * - 409 `resource_locked` "Retry the request after a short delay" → retry;
 * - 409 `invalid_idempotent_request` "Change your idempotency key or payload"
 *   → permanent (retrying the same key and payload is useless);
 * - 429 `daily_quota_exceeded` / `monthly_quota_exceeded` → retry as `QUOTA`
 *   (the daily quota resets at midnight UTC; the outbox gives the attempt
 *   back and waits for the reset instead of counting it), and
 *   `rate_limit_exceeded` → retry as `RATE_LIMIT` (a short backoff;
 *   resend.com/docs/api-reference/errors, fetched 2026-09-30);
 * - other 4xx (400 `validation_error`, 401, 403 unverified domain or
 *   suspended key, 404, 405, 422 …) → permanent;
 * - 5xx (`application_error` 500, `service_unavailable` 503) "Try the request
 *   again later" → retry. */
function classifyResendFailure(status: number, name: string | undefined): { outcome: 'retry' | 'permanent'; error: string } {
  if (status === 429) {
    const quota = name === 'daily_quota_exceeded' || name === 'monthly_quota_exceeded'
    return { outcome: 'retry', error: quota ? 'QUOTA' : 'RATE_LIMIT' }
  }
  if (status === 409) {
    if (name === 'concurrent_idempotent_requests') return { outcome: 'retry', error: 'CONCURRENT_IDEMPOTENT' }
    if (name === 'resource_locked') return { outcome: 'retry', error: 'RESOURCE_LOCKED' }
    return { outcome: 'permanent', error: 'IDEMPOTENCY_CONFLICT' }
  }
  if (status >= 500) return { outcome: 'retry', error: `HTTP_${status}` }
  return { outcome: 'permanent', error: `HTTP_${status}` }
}

/** `EMAIL_FROM` is a display address like `Name <user@host>`; split it. */
function parseFrom(from: string): { email: string; name?: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from)
  if (match) return { name: match[1] || undefined, email: match[2]! }
  return { email: from.trim() }
}

async function sendWithResend(params: {
  to: string
  subject: string
  text: string
  idempotencyKey: string
  from: string
  replyTo?: string
}): Promise<SendOutcome> {
  let response: Response
  try {
    response = await fetch(RESEND_SEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${requireEnv('RESEND_API_KEY')}`,
        'content-type': 'application/json',
        'idempotency-key': params.idempotencyKey,
      },
      body: JSON.stringify({
        from: params.from,
        to: [params.to],
        subject: params.subject,
        text: params.text,
        ...(params.replyTo ? { reply_to: params.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    })
  } catch {
    // The request may already have left; only a same-key retry is safe.
    return { outcome: 'uncertain', error: 'NETWORK' }
  }
  if (response.ok) {
    try {
      const body = (await response.json()) as { id?: unknown }
      if (typeof body.id === 'string' && body.id.length > 0) return { outcome: 'accepted', providerId: body.id }
    } catch {
      // fall through to uncertain
    }
    // Accepted but unusable reply: never resend blindly.
    return { outcome: 'uncertain', error: 'MALFORMED_REPLY' }
  }
  let name: string | undefined
  try {
    name = ((await response.json()) as { name?: unknown }).name as string | undefined
  } catch {
    // Classification below works from the status alone.
  }
  const failure = classifyResendFailure(response.status, name)
  return { outcome: failure.outcome, error: failure.error }
}

async function sendWithMailpit(params: {
  to: string
  subject: string
  text: string
  mailpitUrl: string
  from: string
  replyTo?: string
}): Promise<SendOutcome> {
  const url = new URL(params.mailpitUrl)
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error('EMAIL_DEV_MAILPIT_URL must point at a loopback host.')
  }
  const from = parseFrom(params.from)
  let response: Response
  try {
    response = await fetch(new URL('/api/v1/send', url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        From: { Email: from.email, ...(from.name ? { Name: from.name } : {}) },
        To: [{ Email: params.to }],
        ...(params.replyTo ? { ReplyTo: [{ Email: params.replyTo }] } : {}),
        Subject: params.subject,
        Text: params.text,
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    })
  } catch {
    return { outcome: 'uncertain', error: 'NETWORK' }
  }
  if (response.ok) {
    try {
      const body = (await response.json()) as { ID?: unknown }
      if (typeof body.ID === 'string' && body.ID.length > 0) return { outcome: 'accepted', providerId: body.ID }
    } catch {
      // fall through
    }
    return { outcome: 'uncertain', error: 'MALFORMED_REPLY' }
  }
  return { outcome: 'retry', error: `HTTP_${response.status}` }
}

/**
 * Which provider this process may use. Real email goes out only for a hosted
 * site (`SITE_URL` not a local address): a local run once reached Resend with
 * the real key (P06 audit), so a local `SITE_URL` never sends real email,
 * whatever keys are present. Mailpit is used only for a local site.
 */
export function emailProvider(): 'resend' | 'mailpit' | null {
  if (isHostedSite()) {
    if (optionalEnv('EMAIL_DEV_MAILPIT_URL')) {
      throw new Error('EMAIL_DEV_MAILPIT_URL must never be set for a hosted site.')
    }
    return optionalEnv('RESEND_API_KEY') ? 'resend' : null
  }
  return optionalEnv('EMAIL_DEV_MAILPIT_URL') ? 'mailpit' : null
}

/**
 * `replyTo` must be an address already validated by a strict grammar (the
 * contact route's, shared with the database CHECK); providers take it as a
 * JSON field, never as a raw header.
 */
export async function sendEmail(params: {
  to: string
  subject: string
  text: string
  idempotencyKey: string
  replyTo?: string
}): Promise<SendOutcome> {
  const provider = emailProvider()
  if (provider === 'resend') return sendWithResend({ ...params, from: requireEnv('EMAIL_FROM') })
  if (provider === 'mailpit') {
    return sendWithMailpit({ ...params, mailpitUrl: requireEnv('EMAIL_DEV_MAILPIT_URL'), from: requireEnv('EMAIL_FROM') })
  }
  throw new EmailNotConfiguredError()
}

// ---------------------------------------------------------------------------
// Templates

/** How much of a submitted message an email ever carries. */
export const NOTICE_MESSAGE_LIMIT = 5_000

const FSI = '⁨'
const PDI = '⁩'

/** One user-supplied value, isolated so mixed-direction text cannot reorder the line around it. */
function isolated(value: string): string {
  return `${FSI}${value}${PDI}`
}

export interface ContactNoticeData {
  name: string
  email: string
  message: string
  createdAt: string
}

/**
 * The staff notice about one contact message: plain text, isolates around
 * every user line. It is the whole inbox (D31): the full message, sent with
 * Reply-To set to the visitor, so the owner answers from their own mailbox.
 */
export function renderContactNotice(data: ContactNoticeData): { subject: string; text: string } {
  const message = data.message.slice(0, NOTICE_MESSAGE_LIMIT)
  // The name is one line: a line break in it would forge the lines below.
  const name = data.name.replace(/[\r\n\u0085\u2028\u2029]+/gu, ' ')
  const lines = [
    'رسالة جديدة من نموذج التواصل',
    '',
    `الاسم: ${isolated(name)}`,
    `البريد: ${isolated(data.email)}`,
    `الوقت: ${data.createdAt}`,
    '',
    'نص الرسالة:',
    ...message.split('\n').map((line) => isolated(line)),
    '',
    'للرد: اضغط «رد»، ويوصل ردّك للمرسل مباشرة.',
  ]
  return { subject: 'رسالة جديدة من نموذج التواصل', text: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// Order mail (P08, contract sections 6 and 7)
//
// One pure function per kind, plain text like `renderContactNotice`. Every value
// a buyer, the catalog or the provider supplied goes through `one()`: a single
// line, with no bidi control of its own, isolated. Money is integer halalas
// through `money()`. Every link is built here from the site origin and the
// token the dispatcher derived; nothing in this section reads the environment.
// A receipt is never called a tax invoice and states no tax (D34).

export interface RenderedEmail {
  subject: string
  text: string
}

export interface OrderEmailLine {
  itemId: string
  title: string
  variantTitle: string
  quantity: number
  total: number
  fulfillment: string
  preorder: { shipsOn: string; note: string } | null
  /** true: the file is there; false: the entitlement waits for it (a preorder); null: no file will come (not digital, revoked, refunded). */
  hasFile: boolean | null
}

/** `order_email_data` (round 5): everything from the order's own snapshots; `refund` and `shipment` only when asked for. */
export interface OrderEmailData {
  orderId: string
  orderNumber: string
  status: string
  environment: string
  customerName: string
  customerEmail: string
  idempotencyKey: string
  tokenVersion: number
  totals: { subtotal: number; discount: number; shipping: number; total: number }
  lines: OrderEmailLine[]
  seller: { legalName?: string; address?: string; registration?: string }
  paidAt: string | null
  refundedHalalas: number
  refund?: { amount: number }
  shipment?: { carrier: string; tracking: string; itemIds: string[] }
}

/** `notify_email_data` (round 5). */
export interface NotifyEmailData {
  status: string
  tokenVersion: number
  email: string
  productTitle: string
  variantTitle: string
  slug: string
}

/** `alert_email_data` (round 5): the facts an owner needs, by alert type; an alert it does not know carries only `alert`. */
export interface AlertEmailData {
  alert: string | null
  orderNumber?: string | null
  amount?: number | null
  total?: number | null
  reason?: string | null
  sku?: string | null
  stock?: number | null
  threshold?: number | null
  status?: string | null
  eventType?: string | null
  paymentId?: string | null
}

/**
 * One value on one line, isolated: line breaks and other control characters
 * become spaces, and the value's own bidi controls (which could close our
 * isolate or reorder the line around it) are dropped.
 */
function one(value: string | number | null | undefined): string {
  return isolated(
    String(value ?? '')
      .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ')
      .replace(/\p{Bidi_Control}/gu, '')
      .trim(),
  )
}

/**
 * Integer halalas as SAR: Latin digits and two decimals (D06), like the site's
 * `formatMoney` but without Intl's grouping, so the text is the same under Deno
 * and Node.
 */
function money(halalas: number): string {
  const abs = Math.abs(Math.trunc(halalas))
  return `${halalas < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')} ر.س`
}

const TEST_NOTICE = 'وضع تجريبي: لا يُخصم أي مبلغ حقيقي.'
const UNKNOWN = 'غير معروف'

/**
 * The frame of every buyer mail about an order: the test notice, the greeting,
 * the body and the personal order link. The token travels in the link's
 * fragment, so it never reaches a server log or a Referer (contract section 5).
 */
function orderMail(order: OrderEmailData, subject: string, body: string[], siteUrl: string, token: string): RenderedEmail {
  const test = order.environment === 'test'
  return {
    subject: test ? `(تجريبي) ${subject}` : subject,
    text: [
      ...(test ? [TEST_NOTICE, ''] : []),
      `مرحبًا ${one(order.customerName)}،`,
      '',
      ...body,
      '',
      'صفحة طلبك (الرابط شخصي، لا تشاركه):',
      `${siteUrl}/orders#${encodeURIComponent(order.orderNumber)}.${token}`,
    ].join('\n'),
  }
}

function sellerLines(order: OrderEmailData): string[] {
  const { legalName, registration } = order.seller
  return [
    ...(legalName ? [`البائع: ${one(legalName)}`] : []),
    ...(registration ? [`رقم التسجيل: ${one(registration)}`] : []),
  ]
}

function lineLines(line: OrderEmailLine): string[] {
  return [
    `- ${one(line.title)} (${one(line.variantTitle)}) × ${line.quantity}: ${money(line.total)}`,
    ...(line.preorder ? [`  طلب مسبق: التسليم المتوقع ${one(line.preorder.shipsOn)}. ${one(line.preorder.note)}`] : []),
    ...(line.fulfillment === 'digital' && line.hasFile !== null
      ? [line.hasFile ? '  الملف الرقمي: تجده في صفحة طلبك.' : '  الملف الرقمي: سنضيفه إلى صفحة طلبك عند توفره.']
      : []),
  ]
}

/**
 * The receipt of a paid order. An order that is not plainly paid (the payment
 * arrived but a line cannot be delivered, or it was refunded since) only says
 * that the payment arrived and the order is being reviewed.
 */
export function renderReceipt(order: OrderEmailData, siteUrl: string, token: string): RenderedEmail {
  const number = one(order.orderNumber)
  const { subtotal, discount, shipping, total } = order.totals
  if (order.status !== 'paid') {
    return orderMail(
      order,
      `وصلتنا دفعتك للطلب رقم ${number}`,
      [`وصلتنا دفعتك للطلب رقم ${number} بمبلغ ${money(total)}، ونراجع الطلب الآن.`, '', ...sellerLines(order)],
      siteUrl,
      token,
    )
  }
  return orderMail(
    order,
    `إيصال طلبك رقم ${number}`,
    [
      `وصلتنا دفعتك وتم تأكيد طلبك رقم ${number}. هذا إيصال بالمبلغ الذي دفعته.`,
      '',
      'الأصناف:',
      ...order.lines.flatMap(lineLines),
      '',
      `المجموع الفرعي: ${money(subtotal)}`,
      ...(discount > 0 ? [`الخصم: ${money(discount)}`] : []),
      ...(shipping > 0 ? [`التوصيل: ${money(shipping)}`] : []),
      `الإجمالي المدفوع: ${money(total)}`,
      '',
      ...sellerLines(order),
    ],
    siteUrl,
    token,
  )
}

/** The recovery link a buyer asked for. */
export function renderOrderLink(order: OrderEmailData, siteUrl: string, token: string): RenderedEmail {
  const number = one(order.orderNumber)
  return orderMail(
    order,
    `رابط طلبك رقم ${number}`,
    [`هذا رابط طلبك رقم ${number}. من صفحة الطلب تتابع حالته وتحمّل ملفاته الرقمية إن وُجدت.`, 'إن لم تطلب هذا الرابط فتجاهل الرسالة.'],
    siteUrl,
    token,
  )
}

/** The files of the listed items are ready on the order page. */
export function renderOrderReady(order: OrderEmailData, files: OrderEmailLine[], siteUrl: string, token: string): RenderedEmail {
  const number = one(order.orderNumber)
  return orderMail(
    order,
    `ملفات طلبك رقم ${number} جاهزة`,
    [
      `أصبحت الملفات التالية من طلبك رقم ${number} جاهزة للتحميل من صفحة الطلب:`,
      ...files.map((line) => `- ${one(line.title)} (${one(line.variantTitle)})`),
    ],
    siteUrl,
    token,
  )
}

/** A shipment: its carrier, its tracking value and the items it carries. */
export function renderOrderShipped(
  order: OrderEmailData,
  shipment: NonNullable<OrderEmailData['shipment']>,
  siteUrl: string,
  token: string,
): RenderedEmail {
  const number = one(order.orderNumber)
  return orderMail(
    order,
    `شحنة جديدة من طلبك رقم ${number}`,
    [
      `تم شحن الأصناف التالية من طلبك رقم ${number}:`,
      ...order.lines
        .filter((line) => shipment.itemIds.includes(line.itemId))
        .map((line) => `- ${one(line.title)} (${one(line.variantTitle)}) × ${line.quantity}`),
      '',
      `شركة الشحن: ${one(shipment.carrier)}`,
      `رقم التتبع: ${one(shipment.tracking)}`,
    ],
    siteUrl,
    token,
  )
}

/** A refund: its amount and what has been refunded of the order in all. */
export function renderOrderRefunded(
  order: OrderEmailData,
  refund: NonNullable<OrderEmailData['refund']>,
  siteUrl: string,
  token: string,
): RenderedEmail {
  const number = one(order.orderNumber)
  return orderMail(
    order,
    `استرداد من طلبك رقم ${number}`,
    [`تم استرداد ${money(refund.amount)} من طلبك رقم ${number}.`, `إجمالي ما استُرد من هذا الطلب حتى الآن: ${money(order.refundedHalalas)}.`],
    siteUrl,
    token,
  )
}

/** The confirmation of a "tell me when it is back" request; the link is valid for 7 days (contract section 5). */
export function renderNotifyConfirm(data: NotifyEmailData, siteUrl: string, token: string): RenderedEmail {
  return {
    subject: 'أكّد طلب التنبيه',
    text: [
      `طلبت أن نخبرك عندما يتوفر ${one(data.productTitle)} (${one(data.variantTitle)}) من جديد.`,
      'لتأكيد الطلب افتح الرابط التالي، وهو صالح لمدة 7 أيام:',
      `${siteUrl}/notify/confirm#${token}`,
      '',
      'إن لم تطلب ذلك فتجاهل الرسالة ولن نراسلك.',
    ].join('\n'),
  }
}

/** The product is back: its page and the link that stops these messages. */
export function renderAvailability(data: NotifyEmailData, siteUrl: string, token: string): RenderedEmail {
  return {
    subject: `توفّر ${one(data.productTitle)}`,
    text: [
      `توفّر ${one(data.productTitle)} (${one(data.variantTitle)}) الذي طلبت أن نخبرك عنه.`,
      'صفحة المنتج:',
      `${siteUrl}/store/${encodeURIComponent(data.slug)}`,
      '',
      'لإيقاف هذه الرسائل افتح الرابط التالي:',
      `${siteUrl}/notify/unsubscribe#${token}`,
    ].join('\n'),
  }
}

function alertText(alert: AlertEmailData): RenderedEmail {
  const order = alert.orderNumber ? one(alert.orderNumber) : UNKNOWN
  const amount = typeof alert.amount === 'number' ? money(alert.amount) : UNKNOWN
  switch (alert.alert) {
    case 'low_stock':
      return {
        subject: 'تنبيه: مخزون منخفض',
        text: `انخفض مخزون الصنف ${one(alert.sku)} إلى ${one(alert.stock)} (حدّ التنبيه ${one(alert.threshold)}). آخر طلب أثّر عليه: ${order}.`,
      }
    case 'needs_resolution':
      return {
        subject: 'تنبيه: طلب مدفوع يحتاج قرارك',
        text: `دُفع الطلب ${order} بمبلغ ${amount} وتعذّر تجهيز كل أصنافه. المبلغ محفوظ ولم يُسلَّم شيء بعد. راجع الطلب من لوحة الطلبات.`,
      }
    case 'payment_review':
      return {
        subject: 'تنبيه: دفعة تحتاج مراجعة',
        text: `وصلت دفعة بمبلغ ${amount} لا يمكن ربطها بطلب بشكل صحيح (السبب: ${one(alert.reason)}). الطلب: ${order}. الدفعة: ${one(alert.paymentId)}. لم يُسلَّم شيء مقابلها.`,
      }
    case 'external_refund':
      return {
        subject: 'تنبيه: استرداد غير مسجّل',
        text: `ظهر لدى مزوّد الدفع استرداد للطلب ${order} إجماليه ${typeof alert.total === 'number' ? money(alert.total) : UNKNOWN} ولا يطابق ما سجّلناه. سجّله من لوحة الطلبات.`,
      }
    case 'provider_status':
      return {
        subject: 'تنبيه: تغيّرت حالة دفعة',
        text: `تغيّرت حالة دفعة الطلب ${order} لدى مزوّد الدفع إلى ${one(alert.status)}. راجعها من لوحة الطلبات.`,
      }
    case 'event_exhausted':
      return {
        subject: 'تنبيه: تعذّرت معالجة حدث دفع',
        text: `تعذّرت معالجة حدث دفع (${one(alert.eventType)}) للدفعة ${one(alert.paymentId)} بعد محاولات متكرّرة. راجعه من لوحة الطلبات.`,
      }
    case 'attempt_unverified':
      return {
        subject: 'تنبيه: دفعة لم يتم التحقق منها',
        text: `لم نتمكن من التحقق من دفعة الطلب ${order} (${amount}) لدى مزوّد الدفع قبل انتهاء مهلة المتابعة. تحقق منها يدويًا.`,
      }
    case 'attempt_duplicate_invoices':
      return {
        subject: 'تنبيه: أكثر من فاتورة دفع للطلب',
        text: `وُجدت أكثر من فاتورة دفع لدى مزوّد الدفع تعود للطلب ${order} (${amount}). راجعها قبل أي إجراء.`,
      }
    case 'refund_mismatch':
      return {
        subject: 'تنبيه: اختلاف في استرداد',
        text: `أفاد مزوّد الدفع بنجاح استرداد للطلب ${order} (${amount}) سبق أن سجّلناه كفاشل. راجع الاسترداد من لوحة الطلبات.`,
      }
    case 'refund_total_decreased':
      return {
        subject: 'تنبيه: انخفض إجمالي المسترد لدى مزوّد الدفع',
        text: `أثناء استرداد للطلب ${order} (${amount}) أظهر مزوّد الدفع إجمالي مبالغ مستردة أقل مما سجّلناه. سُجّل الاسترداد كفاشل. راجعه من لوحة الطلبات.`,
      }
    case 'refund_unverified':
      return {
        subject: 'تنبيه: استرداد لم يتم التحقق منه',
        text: `لم نتمكن من التحقق من استرداد الطلب ${order} (${amount}) منذ أكثر من 24 ساعة. أعد الفحص من لوحة الطلبات.`,
      }
    default:
      return { subject: 'تنبيه جديد في المتجر', text: `وصل تنبيه جديد (${one(alert.alert)}) يحتاج مراجعتك.` }
  }
}

/** An alert for an owner: one short text by type, the admin link, and no buyer contact detail (the data has none). */
export function renderOwnerAlert(alert: AlertEmailData, siteUrl: string): RenderedEmail {
  const { subject, text } = alertText(alert)
  return { subject, text: [text, '', 'لوحة الطلبات:', `${siteUrl}/admin/orders`].join('\n') }
}

// ---------------------------------------------------------------------------
// Resend delivery webhooks (Svix signatures)
//
// Fetched 2026-09-26: resend.com/docs/dashboard/webhooks/verify-webhooks-requests
// and docs.svix.com/receiving/verifying-payloads/how-manual. The signed content
// is `${svix_id}.${svix_timestamp}.${rawBody}`; the key is the base64 after
// `whsec_`; the signature is HMAC-SHA256, base64; `svix-signature` is a
// space-separated list of `v1,<sig>` entries and any one match accepts.

const SVIX_TOLERANCE_MS = 5 * 60 * 1000

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * Verifies a Svix-signed Resend webhook against the raw body text. Accepts
 * only a well-formed `v1` signature list with a timestamp inside the 5-minute
 * tolerance; every comparison is constant-time.
 */
export async function verifySvixSignature(params: {
  secret: string
  svixId: string
  timestamp: string
  signatureHeader: string
  rawBody: string
  now?: Date
}): Promise<boolean> {
  const when = Number(params.timestamp)
  if (!/^\d+$/.test(params.timestamp) || !Number.isFinite(when)) return false
  const now = params.now ?? new Date()
  if (Math.abs(now.getTime() - when * 1000) > SVIX_TOLERANCE_MS) return false

  const keyText = params.secret.startsWith('whsec_') ? params.secret.slice('whsec_'.length) : params.secret
  let keyBytes: Uint8Array<ArrayBuffer>
  try {
    keyBytes = base64ToBytes(keyText)
  } catch {
    return false
  }

  const content = new TextEncoder().encode(`${params.svixId}.${params.timestamp}.${params.rawBody}`)
  let cryptoKey: CryptoKey
  let expected: Uint8Array
  try {
    cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    expected = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, content))
  } catch {
    return false
  }

  // Svix's own libraries compare the base64 signature strings the same way.
  const expectedSignature = bytesToBase64(expected)
  for (const entry of params.signatureHeader.split(' ')) {
    if (entry.startsWith('v1,') && secretsMatch(entry.slice('v1,'.length), expectedSignature)) return true
  }
  return false
}
