// Builds the owner's review page, admin-review.html in this evidence folder, from review/template.html, the screen list
// (review/meta.json, written by tools/meta.mjs), the WebP manifests of the two sets (shots/*/manifest.json, written by
// tools/webp.mjs) and review/config.json (the commits, and the "what changed" and "what was checked" lists).
// Usage: node review/build.mjs
import fs from 'node:fs'
import path from 'node:path'

const evidence = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const repo = path.resolve(evidence, '../../..')
const read = (p) => fs.readFileSync(path.join(evidence, p), 'utf8')
const meta = JSON.parse(read('review/meta.json'))
const config = JSON.parse(read('review/config.json'))
const manifest = {
  before: JSON.parse(read('shots/before/manifest.json')),
  after: JSON.parse(read('shots/after/manifest.json')),
}

const LABELS = {
  home: 'Owner home', 'home-editor': 'Editor home', 'home-operations': 'Operations home', 'gate-error': 'Gate, role unreadable',
  email: 'Mail problems', 'email-replay-dialog': 'Replay confirmation',
  content: 'Collections', 'content-rooms': 'Rooms', 'content-rooms-edit-built': 'Room form, unpublished changes',
  'content-rooms-edit-book': 'Room form, scheduled', 'content-posts': 'Posts', 'content-posts-edit': 'Post form, live',
  'content-posts-edit-overdue': 'Post form, overdue schedule', 'content-posts-new': 'New post',
  'content-site-settings': 'Site settings', 'content-site-settings-edit': 'Site settings form',
  'content-taxonomies': 'Taxonomies', 'content-taxonomies-edit': 'Taxonomy form', 'content-policies': 'Policies',
  'content-policies-edit': 'Policy form', 'content-scenes': 'Scenes', 'content-scenes-edit': 'Scenes gallery form',
  media: 'Library', 'media-upload-dialog': 'Upload dialog', 'media-delete-dialog': 'Delete confirmation',
  'media-picker-dialog': 'Picker, from a post cover',
  store: 'Store home', 'store-products': 'Products', 'store-products-edit': 'Product form', 'store-products-new': 'New product',
  'store-variants-edit-ebook': 'Variant form, digital', 'store-variants-edit-preorder': 'Variant form, preorder',
  'store-shipping-rates': 'Delivery rates', 'store-shipping-rates-edit': 'Delivery rate form', 'store-coupons': 'Coupons',
  'store-coupons-edit': 'Coupon form', 'store-customers': 'Customers', 'store-customers-edit': 'Customer form',
  'store-notifications': 'Availability sign-ups', 'store-editor': 'Store, as an editor (no access)',
  orders: 'Orders', 'orders-operations': 'Orders, as operations', 'orders-empty': 'Orders, none yet',
  'orders-failed': 'Orders, failed to load', 'orders-view': 'Order, paid', 'orders-view-resolution': 'Order, needs resolution',
  'orders-view-operations': 'Order, as operations', 'orders-view-refund-confirm': 'Refund confirmation',
  'orders-view-dispute-form': 'Dispute form', 'orders-reconciliation': 'Reconciliation',
  stats: 'Statistics', settings: 'Settings', security: 'Security, enrolled', 'security-enroll': 'Security, enrolment',
  team: 'Team', 'team-step-up-dialog': 'Step-up code dialog', 'team-editor': 'Team, as an editor (no access)',
  'sign-in': 'Sign-in', 'sign-in-widget': 'Sign-in with the check widget', 'sign-in-code': 'Sign-in code step',
  'preview-built': 'Room preview', 'preview-post': 'Post preview',
}
const AREAS = [
  { key: 'home', name: 'Home', ar: 'الرئيسية', ids: ['home', 'home-editor', 'home-operations', 'gate-error'] },
  { key: 'email', name: 'Mail', ar: 'البريد', ids: ['email', 'email-replay-dialog'] },
  { key: 'content', name: 'Content', ar: 'المحتوى', ids: ['content', 'content-rooms', 'content-rooms-edit-built', 'content-rooms-edit-book', 'content-posts', 'content-posts-edit', 'content-posts-edit-overdue', 'content-posts-new', 'content-site-settings', 'content-site-settings-edit', 'content-taxonomies', 'content-taxonomies-edit', 'content-policies', 'content-policies-edit', 'content-scenes', 'content-scenes-edit'] },
  { key: 'media', name: 'Library', ar: 'المكتبة', ids: ['media', 'media-upload-dialog', 'media-delete-dialog', 'media-picker-dialog'] },
  { key: 'store', name: 'Store', ar: 'المتجر', ids: ['store', 'store-products', 'store-products-edit', 'store-products-new', 'store-variants-edit-ebook', 'store-variants-edit-preorder', 'store-shipping-rates', 'store-shipping-rates-edit', 'store-coupons', 'store-coupons-edit', 'store-customers', 'store-customers-edit', 'store-notifications', 'store-editor'] },
  { key: 'orders', name: 'Orders', ar: 'الطلبات', ids: ['orders', 'orders-operations', 'orders-empty', 'orders-failed', 'orders-view', 'orders-view-resolution', 'orders-view-operations', 'orders-view-refund-confirm', 'orders-view-dispute-form', 'orders-reconciliation'] },
  { key: 'stats', name: 'Statistics', ar: 'الإحصاءات', ids: ['stats'] },
  { key: 'settings', name: 'Settings', ar: 'الإعدادات', ids: ['settings'] },
  { key: 'security', name: 'Security', ar: 'الأمان', ids: ['security', 'security-enroll'] },
  { key: 'team', name: 'Team', ar: 'الفريق', ids: ['team', 'team-step-up-dialog', 'team-editor'] },
  { key: 'sign-in', name: 'Sign-in', ar: 'تسجيل الدخول', ids: ['sign-in', 'sign-in-widget', 'sign-in-code'] },
  { key: 'preview', name: 'Previews', ar: 'المعاينة', ids: ['preview-built', 'preview-post'] },
]
const ROLE = { owner: 'Owner', editor: 'Editor', operations: 'Operations' }
const AR_TITLE = { 'store-editor': 'لا تملك صلاحية الوصول', 'team-editor': 'الفريق', 'gate-error': 'تعذّر التحقق من صلاحيتك' }

const byId = new Map(meta.map((s) => [s.id, s]))
const ordered = AREAS.flatMap((a) => a.ids)
const missing = meta.filter((s) => !ordered.includes(s.id)).map((s) => s.id)
const unknown = ordered.filter((id) => !byId.has(id))
if (missing.length || unknown.length || ordered.length !== new Set(ordered).size) throw new Error(`screen list mismatch: missing ${missing}, unknown ${unknown}`)

const shots = (id, w, kind) => manifest[kind][`${id}-${w}`].map((p) => ({ src: `shots/${kind}/${p.name}`, w: p.width, h: p.height }))
let n = 0
const screens = []
for (const area of AREAS) for (const id of area.ids) {
  const s = byId.get(id)
  const plainH1 = s.h1 && !/[.+*?^$()[\]{}|\\]/.test(s.h1) ? s.h1 : null
  screens.push({
    id, n: ++n, label: LABELS[id], areaName: area.name, note: s.note, path: s.path,
    roleLabel: s.signedOut ? 'Signed out' : ROLE[s.role],
    ar: AR_TITLE[id] ?? plainH1,
    shots: Object.fromEntries(['360', '1440'].map((w) => [w, { before: shots(id, w, 'before'), after: shots(id, w, 'after') }])),
  })
}
const data = { screens, areas: AREAS.map(({ name, ar, ids }) => ({ name, ar, ids })) }

const font = (file) => fs.readFileSync(path.join(repo, 'public/fonts/thmanyah', file)).toString('base64')
const weave = 'data:image/svg+xml,' + encodeURIComponent(fs.readFileSync(path.join(repo, 'public/brand/weave.svg'), 'utf8').trim())
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// list items: plain text, with «…» runs set as Arabic; a leading ! marks an item still open
const li = (items) => items.map((t) => `<li${t.startsWith('!') ? ' class="pending"' : ''}>${esc(t.replace(/^!/, '')).replace(/«([^»]+)»/g, '<span lang="ar" dir="rtl">«$1»</span>')}</li>`).join('')
const json = JSON.stringify(data).replace(/</g, '\\u003c')
const shotCount = screens.length * 2

let html = read('review/template.html')
const fill = {
  FONT_SANS_400: font('thmanyahsans-Regular.woff2'),
  FONT_SANS_700: font('thmanyahsans-Bold.woff2'),
  FONT_SERIF_500: font('thmanyahserifdisplay-Medium.woff2'),
  WEAVE: weave,
  SCREEN_COUNT: String(screens.length),
  SHOT_COUNT: `${shotCount} (${screens.length} × 2 widths)`,
  BEFORE: esc(config.before),
  AFTER: esc(config.after),
  CHANGED: li(config.changed),
  CHECKED: li(config.checked),
  DATA: json,
}
for (const [key, value] of Object.entries(fill)) {
  if (!html.includes(`{{${key}}}`)) throw new Error(`template has no {{${key}}}`)
  html = html.split(`{{${key}}}`).join(value)
}
if (/\{\{[A-Z_0-9]+\}\}/.test(html)) throw new Error('unfilled placeholder: ' + html.match(/\{\{[A-Z_0-9]+\}\}/)[0])
fs.writeFileSync(path.join(evidence, 'admin-review.html'), html)
// The images the page shows, for a publish that serves them beside it.
const files = screens.flatMap((s) => ['360', '1440'].flatMap((w) => ['before', 'after'].flatMap((k) => s.shots[w][k].map((p) => p.src))))
fs.writeFileSync(path.join(evidence, 'review', 'files.json'), JSON.stringify(files, null, 1) + '\n')
console.log(`admin-review.html ${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB, ${files.length} images, ${(files.reduce((t, f) => t + fs.statSync(path.join(evidence, f)).size, 0) / 1e6).toFixed(1)} MB`)
