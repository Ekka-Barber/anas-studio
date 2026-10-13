// The mock database: realistic Arabic data in the register of the site, shaped
// exactly as the admin's parsers and queries expect it (src/lib/admin-orders.ts,
// admin-commerce.ts, the table configs under src/admin/tables, the content
// collections). Everything is plain JSON; `buildData` is pure for a given
// (now, site) pair so two runs draw the same screens.
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

import { groupImages, scanImages } from './images.mjs'
import { clockOf, hex, lexical, uid } from './util.mjs'

/** Arabic names and folders for the repository photos, keyed `dir/family`. */
const MEDIA_META = {
  'v2/khous-cover-b': { name: 'غلاف خوص', folder: 'الكتاب', alt: 'غلاف خوص: العنوان والطبق المنسوج، واسم أنس وتوقيعه في الزاوية', caption: 'الغلاف الأمامي للطبعة الأولى' },
  'v2/khous-standing-b': { name: 'خوص واقفًا', folder: 'الكتاب', alt: 'الكتاب واقفًا: الكعب إلى اليمين وفاصل الخوص بارز من أعلاه', caption: '' },
  'v2/street4-closed-door': { name: 'باب مغلق في شارع 4', folder: 'الكتاب/صور الحي', alt: 'باب بيت مغلق في الحي', caption: 'باب من الحي' },
  'v2/street4-majlis': { name: 'مجلس البيت', folder: 'الكتاب/صور الحي', alt: 'مجلس البيت بكنباته المزهّرة', caption: 'مجلس البيت' },
  'built/02-built-raha-millstone': { name: 'حجر الرحى', folder: 'الغرف/بنيتُ هنا', alt: 'حجر رحى قديم في مدخل المكان', caption: 'رحى: من هنا بدأ الاسم' },
  'built/02b-built-teacher-trust': { name: 'ثقة المعلّم', folder: 'الغرف/بنيتُ هنا', alt: 'معلّم يسلّم مفتاح المكان', caption: '' },
  'built/02c-built-seven-lanterns': { name: 'الفوانيس السبعة', folder: 'الغرف/بنيتُ هنا', alt: 'سبعة فوانيس معلّقة في سقف المقهى', caption: '' },
  'built/raha-logo': { name: 'شعار رحى', folder: 'الغرف/بنيتُ هنا', alt: 'شعار رحى', caption: '' },
  'started/01-started-mothers-kitchen': { name: 'مطبخ الأم', folder: 'الغرف/بدأتُ من هنا', alt: 'مطبخ الأم وعلى طاولته مكوّنات الطبخ', caption: 'مطبخ الأم، حيث بدأ كل شيء' },
  'started/01b-started-supplying-cafes': { name: 'توريد المقاهي', folder: 'الغرف/بدأتُ من هنا', alt: 'علب حلويات جاهزة للتوريد إلى المقاهي', caption: '' },
  'started/01c-started-story-becomes-product': { name: 'حين تصير الحكاية منتجًا', folder: 'الغرف/بدأتُ من هنا', alt: 'برطمان مربى بملصق مكتوب بخط اليد', caption: '' },
  'started/01d-started-not-yet-begun': { name: 'لم نبدأ بعد', folder: 'الغرف/بدأتُ من هنا', alt: 'طاولة فارغة في انتظار أول طلب', caption: '' },
  'started/started-closed-door': { name: 'الباب المغلق', folder: 'الغرف/بدأتُ من هنا', alt: 'باب خشبي مغلق في صباح هادئ', caption: '' },
  'started/started-street-4': { name: 'شارع 4', folder: 'الغرف/بدأتُ من هنا', alt: 'لوحة شارع رقم 4 في تبوك', caption: '' },
  'shelf/04-shelf-moonlit-shelf': { name: 'الرف المضاء بالقمر', folder: 'الغرف/على الرف', alt: 'رف خشبي يضيئه ضوء القمر', caption: '' },
  'shelf/04b-shelf-thura-najdi-triangles': { name: 'ثُرى: المثلثات النجدية', folder: 'الغرف/على الرف', alt: 'مثلثات نجدية بألوان القهوة', caption: '' },
  'shelf/04c-shelf-moonlight-shop-dream': { name: 'حلم متجر ضوء القمر', folder: 'الغرف/على الرف', alt: 'واجهة متجر صغير تحت ضوء القمر', caption: '' },
  'shelf/04d-shelf-boutique-open-book': { name: 'الكتاب المفتوح', folder: 'الغرف/على الرف', alt: 'كتاب مفتوح على طاولة البوتيك', caption: '' },
  'shelf/factory-yellow-mug_upscaled': { name: 'الكوب الأصفر', folder: 'المتجر', alt: 'كوب أصفر من مصنع الأكواب', caption: 'كوب ضوء القمر' },
  'passed/03-passed-street-of-shops': { name: 'شارع المحلات', folder: 'الغرف/مررتُ من هنا', alt: 'شارع المحلات في المساء', caption: '' },
  'passed/03b-passed-doorstep-delivery': { name: 'توصيل إلى عتبة الباب', folder: 'الغرف/مررتُ من هنا', alt: 'طلب موضوع عند عتبة الباب', caption: '' },
  'passed/31-murady-french-toast-banana': { name: 'فرنش توست بالموز', folder: 'الغرف/مررتُ من هنا/قوائم الطعام', alt: 'طبق فرنش توست بالموز', caption: '' },
  'passed/29-cheesecake-chocolate-hazelnut': { name: 'تشيز كيك الشوكولاتة والبندق', folder: 'الغرف/مررتُ من هنا/قوائم الطعام', alt: 'قطعة تشيز كيك بالشوكولاتة والبندق', caption: '' },
  'passed/33-brownie-vanilla-sauce': { name: 'براوني بصوص الفانيلا', folder: 'الغرف/مررتُ من هنا/قوائم الطعام', alt: 'براوني ساخن مع صوص الفانيلا', caption: '' },
  'passed/murady': { name: 'مراد', folder: 'الغرف/مررتُ من هنا/العلامات', alt: 'شعار مراد', caption: '' },
}
const MEDIA_RIGHTS = ['حقوق الصورة محفوظة لأنس القرني', 'تصوير أنس القرني', 'أرشيف المشروع، بإذن أصحابه']
const PRESET_WIDTHS = [360, 720, 1200, 1800]

/** The product catalogue the orders refer to (SKU -> its names, kind and price in halalas). */
const SKUS = {
  'KHOUS-PAPER': { product: 'خوص | حكايات شارع 4', variant: 'نسخة ورقية', fulfillment: 'physical', price: 6900 },
  'KHOUS-SIGNED': { product: 'خوص | حكايات شارع 4', variant: 'نسخة موقّعة', fulfillment: 'signed', price: 9900 },
  'KHOUS-EBOOK': { product: 'خوص | حكايات شارع 4', variant: 'نسخة إلكترونية', fulfillment: 'digital', price: 3500 },
  'MOON-CUP': { product: 'كوب ضوء القمر', variant: 'كوب أصفر', fulfillment: 'physical', price: 4500 },
}
const SHIPPING_FEES = { riyadh: 2500, jeddah: 3000, dammam: 3000, makkah: 3000, madinah: 3000, tabuk: 3500, abha: 3500 }
const CARRIERS = [
  ['سمسا إكسبرس', 'SMSA-529138841'],
  ['أرامكس', 'ARX-7730194825'],
  ['سبل: البريد السعودي', 'SPL-2026093381'],
]

/** The twelve orders of the list, newest first; a line is `[sku, quantity, dedication?]`. */
const ORDER_SPECS = [
  { n: 'K7M2XQ4D', status: 'paid', env: 'live', created: 190, name: 'سارة العتيبي', email: 'sara.otaibi@example.com', phone: '966501234567', city: 'riyadh', cityName: 'الرياض', address: 'حي الملقا، شارع أنس بن مالك، مبنى 12، شقة 4', lines: [['KHOUS-PAPER', 1]], ship: 'preparing' },
  { n: 'R3VN8HC5', status: 'paid', env: 'live', created: 310, name: 'محمد الشمري', email: 'm.shamri@example.net', phone: '966555019283', city: 'jeddah', cityName: 'جدة', address: 'حي الشاطئ، طريق الكورنيش، برج النخيل، الدور 6', lines: [['KHOUS-SIGNED', 1, 'إلى أمي ليلى، في ذكرى الحارة'], ['MOON-CUP', 1], ['KHOUS-EBOOK', 1]], coupon: 'DEMO10', featured: 'main' },
  { n: 'W9TD4PZ2', status: 'paid_needs_resolution', env: 'live', created: 1100, name: 'نورة القحطاني', email: 'noura.qahtani@example.org', phone: '966541002288', city: 'abha', cityName: 'أبها', address: 'حي المنهل، شارع الملك فيصل، فيلا 7', lines: [['KHOUS-PAPER', 1]], featured: 'resolution' },
  { n: 'B6GJ3SKX', status: 'pending_payment', env: 'live', created: 40, name: 'عبدالرحمن الحربي', email: 'a.harbi@example.com', phone: '966560771402', city: 'dammam', cityName: 'الدمام', address: 'حي الشاطئ الغربي، شارع الأمير محمد بن فهد، مبنى 3', lines: [['KHOUS-PAPER', 1], ['KHOUS-EBOOK', 1]], ship: 'preparing' },
  { n: 'Q2FZ7MLN', status: 'paid', env: 'live', created: 1500, name: 'ريم الدوسري', email: 'rim.dosari@example.net', phone: '966500385519', city: null, cityName: null, address: null, lines: [['KHOUS-EBOOK', 1]] },
  { n: 'H8CX5RV3', status: 'refunded', env: 'live', created: 2900, name: 'فهد المطيري', email: 'f.mutairi@example.org', phone: '966553310976', city: 'madinah', cityName: 'المدينة المنورة', address: 'حي العزيزية، شارع سلطانة، مبنى 21', lines: [['KHOUS-PAPER', 1]], refund: 'full' },
  { n: 'T4NP9WB6', status: 'expired', env: 'live', created: 3000, name: 'لينا الزهراني', email: 'lina.zahrani@example.com', phone: '966548820731', city: 'makkah', cityName: 'مكة المكرمة', address: 'حي الشوقية، شارع إبراهيم الخليل، مبنى 9', lines: [['KHOUS-SIGNED', 1]] },
  { n: 'D5KQ2JY8', status: 'paid', env: 'live', created: 4400, name: 'يوسف الغامدي', email: 'y.ghamdi@example.net', phone: '966507742165', city: 'riyadh', cityName: 'الرياض', address: 'حي النرجس، طريق الأمير محمد بن سلمان، فيلا 15', lines: [['KHOUS-PAPER', 1], ['MOON-CUP', 1]], ship: 'shipped', uncertainRefund: 4500 },
  { n: 'M3ZW6GA7', status: 'paid', env: 'test', created: 5800, name: 'هند السبيعي', email: 'hind.subaie@example.org', phone: '966582290014', city: 'tabuk', cityName: 'تبوك', address: 'حي المروج، شارع الأمير فهد بن سلطان، مبنى 5', lines: [['KHOUS-PAPER', 1]], ship: 'preparing' },
  { n: 'X7PH4CE9', status: 'cancelled', env: 'live', created: 6200, name: 'خالد البلوي', email: 'k.balawi@example.com', phone: '966536650872', city: 'tabuk', cityName: 'تبوك', address: 'حي الفيصلية، شارع ضباء، مبنى 18', lines: [['MOON-CUP', 1], ['KHOUS-EBOOK', 1]] },
  { n: 'F2RB8TN5', status: 'paid', env: 'live', created: 7300, name: 'منيرة الشهراني', email: 'm.shahrani@example.net', phone: '966559984420', city: 'jeddah', cityName: 'جدة', address: 'حي الروضة، شارع صاري، مبنى 30', lines: [['KHOUS-SIGNED', 2]], ship: 'shipped', refund: 'partial' },
  { n: 'V6LD3KQ4', status: 'paid', env: 'live', created: 8600, name: 'سلمان العنزي', email: 's.enezi@example.org', phone: '966565503391', city: 'riyadh', cityName: 'الرياض', address: 'حي الياسمين، شارع التخصصي، مبنى 44', lines: [['KHOUS-PAPER', 1]], ship: 'delivered' },
]

function readContent(siteDir) {
  const file = path.join(siteDir, 'content', 'initial-content.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

export function buildData({ now, siteDir }) {
  const T = clockOf(now)
  const content = readContent(siteDir)

  // ------------------------------------------------------------------ media
  const groups = groupImages(scanImages(siteDir))
  const curated = Object.keys(MEDIA_META).flatMap((key) => groups.filter((g) => g.key === key))
  const extras = groups.filter((g) => !MEDIA_META[g.key] && g.served.bytes < 400_000).slice(0, Math.max(0, 14 - curated.length))
  const media = []
  const mediaFiles = new Map()
  ;[...curated, ...extras].forEach((group, index) => {
    const meta = MEDIA_META[group.key] ?? { name: `صورة ${index + 1}`, folder: group.dir ? `الغرف/${group.dir}` : '', alt: `صورة من مجلد ${group.dir}`, caption: '' }
    const id = uid(`media:${group.key}`)
    const crop = { width: group.original.width, height: group.original.height }
    const widths = PRESET_WIDTHS.filter((w) => w <= crop.width)
    const used = widths.length > 0 ? widths : [crop.width]
    media.push({
      id,
      name: meta.name,
      folder: meta.folder,
      alt_ar: meta.alt,
      caption: meta.caption || null,
      rights: MEDIA_RIGHTS[index % MEDIA_RIGHTS.length],
      original_bytes: Math.max(group.original.bytes * 3, 400_000),
      original_width: crop.width,
      original_height: crop.height,
      original_mime: 'image/webp',
      derivatives: used.map((width) => {
        const height = Math.round((width * crop.height) / crop.width)
        return { width, height, bytes: Math.round(width * height * 0.28), key: `m/${id}/${width}.webp` }
      }),
      created_at: T.pg(T.ago(180 + index * 410)),
    })
    mediaFiles.set(id, group.served.abs)
  })
  const mediaId = (key, fallbackIndex = 0) => media.find((m) => m.id === uid(`media:${key}`))?.id ?? media[fallbackIndex % Math.max(media.length, 1)]?.id ?? null
  const khousCover = mediaId('v2/khous-cover-b')
  const doorPhoto = mediaId('v2/street4-closed-door', 2)
  const mugPhoto = mediaId('shelf/factory-yellow-mug_upscaled', 5)

  // ----------------------------------------------------------------- people
  const people = {
    owner: { id: uid('staff:owner'), email: 'anas@example.com', name: 'أنس القرني', role: 'owner' },
    editor: { id: uid('staff:editor'), email: 'reem.harbi@example.com', name: 'ريم الحربي', role: 'editor' },
    operations: { id: uid('staff:ops'), email: 'khaled.dosari@example.net', name: 'خالد الدوسري', role: 'operations' },
  }
  const staffDirectory = [
    { user_id: people.owner.id, email: people.owner.email, display_name: people.owner.name, role: 'owner', active: true, has_totp: true, created_at: T.pg(T.ago(60 * 24 * 220)) },
    { user_id: people.editor.id, email: people.editor.email, display_name: people.editor.name, role: 'editor', active: true, has_totp: false, created_at: T.pg(T.ago(60 * 24 * 90)) },
    { user_id: people.operations.id, email: people.operations.email, display_name: people.operations.name, role: 'operations', active: true, has_totp: true, created_at: T.pg(T.ago(60 * 24 * 41)) },
    { user_id: uid('staff:revoked'), email: 'salman.qahtani@example.org', display_name: 'سلمان القحطاني', role: 'editor', active: false, has_totp: false, created_at: T.pg(T.ago(60 * 24 * 150)) },
  ]

  // ---------------------------------------------------------------- content
  const docs = []
  const doc = (collection, docId, data, spec) => {
    const latestSeq = spec.latest
    docs.push({
      collection,
      doc_id: docId,
      data,
      latest_seq: latestSeq,
      live_seq: spec.live ?? null,
      scheduled_at: spec.scheduledAt ? T.pg(spec.scheduledAt) : null,
      scheduled_seq: spec.scheduledAt ? (spec.scheduledSeq ?? latestSeq) : null,
      latest_at: T.pg(spec.savedAt),
    })
  }
  if (content) {
    doc('site_settings', 'site', {
      nav: content.nav,
      footer: content.footer,
      home: content.home,
      seo: { title: 'أنس القرني | أبني الأفكار والأماكن والحكايات', description: 'موقع أنس القرني: رحلة من المطبخ الصغير إلى المشاريع التي بُنيت وتركت أثرها.' },
      contact: { email: 'help@anas.studio', whatsapp: '0551234567' },
      social: content.social,
      contactPage: content.contactPage,
    }, { latest: 6, live: 6, savedAt: T.ago(60 * 24 * 9) })
    doc('rooms', 'started', content.rooms.started, { latest: 4, live: 4, savedAt: T.ago(60 * 24 * 12) })
    doc('rooms', 'built', content.rooms.built, { latest: 7, live: 6, savedAt: T.ago(95) })
    doc('rooms', 'passed', content.rooms.passed, { latest: 3, live: 3, savedAt: T.ago(60 * 24 * 20) })
    doc('rooms', 'shelf', content.rooms.shelf, { latest: 2, live: 2, savedAt: T.ago(60 * 24 * 6) })
    doc('rooms', 'book', content.rooms.book, { latest: 5, live: 4, savedAt: T.ago(60 * 5), scheduledAt: T.ahead(60 * 24 * 2 + 150), scheduledSeq: 5 })
    doc('scenes', 'gallery', { items: content.scenes }, { latest: 3, live: 3, savedAt: T.ago(60 * 24 * 4) })
  }
  const policyBody = (lines) => lexical(lines.map((p) => ({ p })))
  doc('policies', 'store', { title: 'سياسة المتجر', body: policyBody(['نبيع الكتب والمنتجات المطبوعة من تبوك ونشحنها إلى مدن المملكة.', 'يُعدّ إتمام الدفع قبولًا لهذه السياسة، وتُرسل إليك رسالة تأكيد على بريدك.']) }, { latest: 2, live: 2, savedAt: T.ago(60 * 24 * 3) })
  doc('policies', 'delivery', { title: 'سياسة التوصيل', body: policyBody(['نشحن خلال يومَي عمل من تأكيد الطلب، ويصلك رقم التتبع عبر البريد.', 'تختلف رسوم التوصيل بحسب المدينة وتظهر قبل الدفع.']) }, { latest: 1, live: 1, savedAt: T.ago(60 * 24 * 30) })
  doc('policies', 'refund', { title: 'سياسة الاسترجاع', body: policyBody(['يمكنك طلب إرجاع المنتجات الورقية خلال سبعة أيام من الاستلام.', 'تُعاد المبالغ إلى وسيلة الدفع نفسها بعد استلام المرتجع.']) }, { latest: 1, live: 1, savedAt: T.ago(60 * 24 * 30) })
  doc('policies', 'privacy', { title: 'سياسة الخصوصية', body: policyBody(['نحفظ بريدك واسمك ورقم جوالك لإتمام الطلبات والتواصل معك فقط.']) }, { latest: 1, live: null, savedAt: T.ago(60 * 24 * 2) })

  const taxonomies = [
    ['places', 'category', 'أماكن'],
    ['stories', 'category', 'حكايات'],
    ['work', 'category', 'عمل'],
    ['tabuk', 'tag', 'تبوك'],
    ['books', 'tag', 'كتب'],
    ['coffee', 'tag', 'قهوة'],
  ]
  taxonomies.forEach(([slug, kind, label], i) => doc('taxonomies', slug, { kind, label }, { latest: 1, live: 1, savedAt: T.ago(60 * 24 * (30 + i)) }))

  const post = (n, spec, body) => ({ id: uid(`post:${n}`), ...spec, body })
  const posts = [
    post(1, { slug: 'why-i-write-about-places', title: 'لماذا أكتب عن الأماكن؟', excerpt: 'الأماكن لا تُحفظ في الخرائط وحدها؛ بعضها يسكن في تفاصيل صغيرة نمرّ بها كل يوم.', author: 'أنس القرني', categories: ['places'], tags: ['tabuk', 'books'], cover: doorPhoto, visible: true, latest: 3, live: 3, savedAt: T.ago(60 * 24 * 5) },
      lexical([{ h: 'h2', text: 'الباب الذي لا يُفتح' }, { p: 'في شارع 4 كان لكل بيت باب، ولكل باب حكاية. أكتب عن الأماكن لأنها تحفظ الناس حين ينسونها.' }, { quote: 'الطبق باب، والرائحة طريق، والبيت ذاكرة.' }, { p: 'ثلاثة أشياء تعلّمتها من الكتابة عن الأماكن:' }, { bullets: ['أن التفاصيل الصغيرة هي الأصدق', 'أن الصمت جزء من الحكاية', 'أن المكان يكبر بمن يسكنه'] }])),
    post(2, { slug: 'what-raha-taught-me', title: 'ما تعلّمته من رحى في أول سنة', excerpt: 'سنة واحدة كانت كافية لأفهم أن المقهى ليس قهوة فقط، بل وعد يتجدد كل صباح.', author: 'أنس القرني', categories: ['work', 'stories'], tags: ['coffee'], cover: mediaId('built/02-built-raha-millstone', 4), visible: true, latest: 2, live: 1, savedAt: T.ago(60 * 26) },
      lexical([{ p: 'حين فتحنا الباب أول مرة لم نكن نعرف كم كوبًا سنبيع، لكننا عرفنا من سيجلس عند النافذة.' }, { h: 'h2', text: 'الوعد الصغير' }, { p: 'كل صباح نفتح في الموعد نفسه. هذا وحده بنى الثقة.' }])),
    post(3, { slug: 'thura-how-a-coffee-starts', title: 'ثُرى: كيف تبدأ فكرة قهوة؟', excerpt: 'مسودة عن أول تحميصة وأول رفض وأول ابتسامة.', author: 'أنس القرني', categories: ['work'], tags: ['coffee', 'tabuk'], cover: mediaId('shelf/04b-shelf-thura-najdi-triangles', 6), visible: true, latest: 1, live: null, savedAt: T.ago(60 * 7) },
      lexical([{ p: 'لم تبدأ الفكرة بالقهوة، بل بالأرض التي تُنسب إليها.' }])),
    post(4, { slug: 'opening-day-of-the-cafe', title: 'يوم افتتاح المقهى', excerpt: 'ليلة قبل الافتتاح لم ينم أحد منا.', author: 'أنس القرني', categories: ['stories'], tags: ['coffee'], visible: true, latest: 1, live: null, savedAt: T.ago(60 * 20), scheduledAt: T.ago(180) },
      lexical([{ p: 'ليلة قبل الافتتاح رتّبنا الكراسي مرتين.' }])),
    post(5, { slug: 'bakery-diaries', title: 'يوميات المخبز', excerpt: 'ما يحدث قبل أن تصل الرائحة إلى الشارع.', author: 'أنس القرني', categories: ['stories'], tags: ['tabuk'], visible: false, latest: 2, live: null, savedAt: T.ago(60 * 3), scheduledAt: T.ahead(60 * 22) },
      lexical([{ p: 'الرائحة تسبق الخبّاز بساعة.' }])),
  ]
  for (const p of posts) {
    const { id, latest, live, savedAt, scheduledAt, body, ...rest } = p
    doc('posts', id, { ...rest, body }, { latest, live, savedAt, scheduledAt })
  }

  // content_versions: one row per saved seq (newer first in the UI), plus the published copies.
  const contentVersions = []
  const published = []
  for (const d of docs) {
    for (let seq = 1; seq <= d.latest_seq; seq++) {
      contentVersions.push({
        collection: d.collection,
        doc_id: d.doc_id,
        seq,
        data: d.data,
        created_at: T.pg(Date.parse(d.latest_at) - (d.latest_seq - seq) * 3 * T.DAY),
        publish_at: d.scheduled_seq === seq && d.scheduled_at ? d.scheduled_at : null,
      })
    }
    if (d.live_seq !== null) {
      published.push({ collection: d.collection, doc_id: d.doc_id, seq: d.live_seq, data: d.data, published_at: T.pg(Date.parse(d.latest_at) - 3600_000) })
    }
  }
  const contentDocuments = docs.map((d) => ({
    collection: d.collection,
    doc_id: d.doc_id,
    latest_seq: d.latest_seq,
    latest_data: d.data,
    latest_at: d.latest_at,
    live_seq: d.live_seq,
    scheduled_at: d.scheduled_at,
    scheduled_seq: d.scheduled_seq,
  }))
  const overduePost = posts[3]

  // ---------------------------------------------------------------- catalog
  const productRow = (n, spec) => ({ id: uid(`product:${n}`), demo: false, version: 1, created_at: T.pg(T.ago(60 * 24 * 40)), updated_at: T.pg(T.ago(60 * 24 * (n + 1))), ...spec })
  const products = [
    productRow(1, { slug: 'khous-street-4', title: 'خوص | حكايات شارع 4', summary: 'حكايات من شارع 4 في تبوك: الأطباق التي صارت ذاكرة، والجارات اللواتي صنعنها.', body: lexical([{ p: 'كتاب عن البيوت التي لا تُنسى وعن الأطباق التي كانت تسافر بين أبوابها.' }]), cover_image: khousCover, status: 'published', sort_order: 10, version: 4 }),
    productRow(2, { slug: 'moonlight-cup', title: 'كوب ضوء القمر', summary: 'كوب أصفر يحمل قهوة آخر الليل.', body: lexical([{ p: 'كوب خزفي من الدفعة الأولى.' }]), cover_image: mugPhoto, status: 'published', sort_order: 20, version: 2 }),
    productRow(3, { slug: 'room-wallpapers', title: 'خلفيات من الغرف', summary: 'حزمة خلفيات رقمية من صور الغرف.', body: lexical([{ p: 'ملف رقمي واحد بجودة عالية.' }]), cover_image: null, status: 'published', sort_order: 30, demo: true }),
    productRow(4, { slug: 'thura-coffee', title: 'ثُرى: قهوة نجدية', summary: 'قريبًا من الرف إلى المتجر.', body: lexical([{ p: 'تحميصة نجدية بنكهة الهيل.' }]), cover_image: null, status: 'draft', sort_order: 40 }),
    productRow(5, { slug: 'raha-notebook', title: 'دفتر رحى', summary: 'دفتر ملاحظات بغلاف الرحى.', body: lexical([{ p: 'نفدت الدفعة الأولى.' }]), cover_image: null, status: 'archived', sort_order: 90 }),
  ]
  const variantRow = (n, productIndex, spec) => ({
    id: uid(`variant:${n}`),
    product_id: products[productIndex].id,
    preorder: false,
    preorder_capacity: null,
    preorder_ships_on: null,
    preorder_note: null,
    low_stock_threshold: null,
    digital_asset: null,
    version: 1,
    created_at: T.pg(T.ago(60 * 24 * 40)),
    updated_at: T.pg(T.ago(60 * 24 * 3)),
    ...spec,
  })
  const variants = [
    variantRow(1, 0, { sku: 'KHOUS-PAPER', title: 'نسخة ورقية', fulfillment: 'physical', price_halalas: 6900, enabled: true, stock: 38, low_stock_threshold: 5, sort_order: 10 }),
    variantRow(2, 0, { sku: 'KHOUS-SIGNED', title: 'نسخة موقّعة', fulfillment: 'signed', price_halalas: 9900, enabled: true, stock: 4, low_stock_threshold: 5, sort_order: 20 }),
    variantRow(3, 0, { sku: 'KHOUS-EBOOK', title: 'نسخة إلكترونية', fulfillment: 'digital', price_halalas: 3500, enabled: true, stock: null, sort_order: 30 }),
    variantRow(4, 1, { sku: 'MOON-CUP', title: 'كوب أصفر', fulfillment: 'physical', price_halalas: 4500, enabled: true, stock: 2, low_stock_threshold: 3, sort_order: 10 }),
    variantRow(5, 1, { sku: 'MOON-CUP-PRE', title: 'الدفعة الثانية (طلب مسبق)', fulfillment: 'physical', price_halalas: 4900, enabled: true, stock: 0, preorder: true, preorder_capacity: 60, preorder_ships_on: '2026-11-20', preorder_note: 'تُشحن الدفعة الثانية في 20 نوفمبر.', sort_order: 20 }),
    variantRow(6, 2, { sku: 'WALLPAPERS', title: 'حزمة الخلفيات', fulfillment: 'digital', price_halalas: 1500, enabled: true, stock: null, sort_order: 10 }),
  ]
  const variantBySku = (sku) => variants.find((v) => v.sku === sku)
  const shippingRates = [
    ['riyadh', 'الرياض', 2500, true],
    ['jeddah', 'جدة', 3000, true],
    ['dammam', 'الدمام', 3000, true],
    ['makkah', 'مكة المكرمة', 3000, true],
    ['madinah', 'المدينة المنورة', 3000, true],
    ['tabuk', 'تبوك', 3500, true],
    ['abha', 'أبها', 3500, true],
    ['najran', 'نجران', null, true],
    ['hail', 'حائل', 4000, false],
  ].map(([city_key, name_ar, fee_halalas, enabled], i) => ({ id: uid(`rate:${city_key}`), city_key, name_ar, fee_halalas, enabled, sort_order: (i + 1) * 10, version: 1 }))
  const coupons = [
    { code: 'DEMO10', kind: 'percent', percent_bp: 1000, amount_halalas: null, starts_at: null, ends_at: null, min_subtotal_halalas: 0, usage_limit: null, product_ids: [], enabled: true },
    { code: 'KHOUS5', kind: 'fixed', percent_bp: null, amount_halalas: 500, starts_at: T.pg(T.ago(60 * 24 * 10)), ends_at: T.pg(T.ahead(60 * 24 * 20)), min_subtotal_halalas: 5000, usage_limit: 100, product_ids: [products[0].id], enabled: true },
    { code: 'EID25', kind: 'percent', percent_bp: 2500, amount_halalas: null, starts_at: T.pg(T.ago(60 * 24 * 160)), ends_at: T.pg(T.ago(60 * 24 * 150)), min_subtotal_halalas: 0, usage_limit: 50, product_ids: [], enabled: false },
  ].map((c, i) => ({ id: uid(`coupon:${c.code}`), version: 1, created_at: T.pg(T.ago(60 * 24 * (170 - i * 20))), updated_at: T.pg(T.ago(60 * 24 * (3 + i))), ...c }))

  // ----------------------------------------------------------------- orders
  const orders = ORDER_SPECS.map((spec, index) => buildOrder(spec, index))

  function buildOrder(spec, index) {
    const id = uid(`order:${spec.n}`)
    const createdMs = T.ago(spec.created)
    const paidMs = ['paid', 'paid_needs_resolution', 'refunded'].includes(spec.status) ? createdMs + 3 * 60_000 : null
    const lines = spec.lines.map(([sku, quantity, dedication], i) => {
      const sku$ = SKUS[sku]
      return { id: uid(`item:${spec.n}:${i}`), lineNo: i + 1, sku, productTitle: sku$.product, variantTitle: sku$.variant, fulfillment: sku$.fulfillment, quantity, unitPrice: sku$.price, discount: 0, dedication: dedication ?? null, variantId: variantBySku(sku)?.id }
    })
    const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0)
    const discountTotal = spec.coupon === 'DEMO10' ? Math.floor(subtotal / 10) : 0
    if (discountTotal > 0) {
      let left = discountTotal
      lines.forEach((l, i) => {
        const share = i === lines.length - 1 ? left : Math.floor((discountTotal * l.unitPrice * l.quantity) / subtotal)
        l.discount = share
        left -= share
      })
    }
    lines.forEach((l) => (l.total = l.unitPrice * l.quantity - l.discount))
    const physical = lines.some((l) => l.fulfillment !== 'digital')
    const shipping = physical && spec.city ? SHIPPING_FEES[spec.city] : 0
    const total = subtotal - discountTotal + shipping
    return { index, spec, id, createdMs, paidMs, lines, subtotal, discount: discountTotal, shipping, total, physical }
  }

  // Refunds, per order, that the list and the details both draw from.
  const refundsOf = new Map()
  for (const o of orders) {
    const list = []
    if (o.spec.refund === 'full') {
      list.push({ id: uid(`refund:${o.spec.n}:1`), status: 'succeeded', amount: o.total, reason: 'تعذّر توفير النسخة، أُعيد المبلغ كاملًا', source: 'admin', allocation: { items: o.lines.map((l) => ({ itemId: l.id, amount: l.total })), ...(o.shipping > 0 ? { shipping: o.shipping } : {}) }, ageMin: o.spec.created - 1400 })
    }
    if (o.spec.refund === 'partial') {
      list.push({ id: uid(`refund:${o.spec.n}:1`), status: 'succeeded', amount: 9900, reason: 'استرجاع نسخة واحدة بطلب العميلة', source: 'admin', allocation: { items: [{ itemId: o.lines[0].id, amount: 9900 }] }, ageMin: o.spec.created - 2600 })
    }
    if (o.spec.n === 'R3VN8HC5') {
      list.push({ id: uid(`refund:${o.spec.n}:1`), status: 'succeeded', amount: 2000, reason: 'تعويض جزئي عن تأخر الشحنة', source: 'admin', allocation: { items: [{ itemId: o.lines[1].id, amount: 2000 }] }, ageMin: o.spec.created - 120 })
    }
    refundsOf.set(o.id, list)
  }
  const refundedOf = (o) => (refundsOf.get(o.id) ?? []).filter((r) => r.status === 'succeeded').reduce((sum, r) => sum + r.amount, 0)

  const ordersListRows = orders.map((o) => ({
    id: o.id,
    orderNumber: o.spec.n,
    status: o.spec.status,
    environment: o.spec.env,
    createdAt: T.pg(o.createdMs),
    paidAt: o.paidMs ? T.pg(o.paidMs) : null,
    total: o.total,
    name: o.spec.name,
    email: o.spec.email,
    items: o.lines.reduce((sum, l) => sum + l.quantity, 0),
    toShip: toShipOf(o),
    refunded: refundedOf(o),
    review: o.spec.status === 'paid_needs_resolution',
  }))

  /** Lines still to ship: physical lines of a paid order whose shipping state is `preparing`. */
  function toShipOf(o) {
    if (o.spec.status !== 'paid') return 0
    if (o.spec.n === 'R3VN8HC5') return 1
    return o.spec.ship === 'preparing' ? o.lines.filter((l) => l.fulfillment !== 'digital').length : 0
  }

  // ---------------------------------------------------------- order details
  const orderDetails = new Map()
  const disputeRows = []
  const reviewRows = []
  for (const o of orders) orderDetails.set(o.id, detailOf(o))

  function itemRefunded(o, itemId) {
    return (refundsOf.get(o.id) ?? []).filter((r) => r.status === 'succeeded').reduce((sum, r) => sum + ((r.allocation.items ?? []).find((a) => a.itemId === itemId)?.amount ?? 0), 0)
  }

  function detailOf(o) {
    const { spec } = o
    const attemptId = uid(`attempt:${spec.n}`)
    const paid = o.paidMs !== null
    const attemptStatus = paid ? 'paid' : { pending_payment: 'pending', expired: 'expired', cancelled: 'cancelled' }[spec.status] ?? 'pending'
    const refunded = refundedOf(o)
    const fee = Math.round(o.total * 0.0235) + 100
    const attempt = {
      id: attemptId,
      orderId: o.id,
      status: attemptStatus,
      environment: spec.env,
      amount: o.total,
      currency: 'SAR',
      providerInvoiceId: uid(`invoice:${spec.n}`),
      providerPaymentId: paid ? uid(`payment:${spec.n}`) : null,
      providerStatus: paid ? 'paid' : attemptStatus === 'pending' ? 'initiated' : attemptStatus === 'expired' ? 'expired' : 'canceled',
      providerRefunded: refunded,
      captured: paid ? o.total : null,
      fee: paid ? fee : null,
      sourceType: paid ? (o.index % 3 === 0 ? 'applepay' : 'creditcard') : null,
      sourceCompany: paid ? (o.index % 3 === 0 ? 'mada' : o.index % 3 === 1 ? 'visa' : 'mastercard') : null,
      invoiceExpiresAt: T.pg(o.createdMs + 30 * 60_000),
      paidAt: paid ? T.pg(o.paidMs) : null,
      fetchedAt: paid ? T.pg(o.paidMs + 60_000) : null,
      checkCount: paid ? 2 : 0,
      errorCount: 0,
      lastError: null,
      createdAt: T.pg(o.createdMs),
    }
    const items = o.lines.map((l) => {
      const refundedLine = itemRefunded(o, l.id)
      return {
        id: l.id,
        lineNo: l.lineNo,
        sku: l.sku,
        productTitle: l.productTitle,
        variantTitle: l.variantTitle,
        fulfillment: l.fulfillment,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discount,
        total: l.total,
        dedication: l.dedication,
        preorder: null,
        refunded: refundedLine,
        fullyRefunded: refundedLine >= l.total && l.total > 0,
        stopped: false,
      }
    })
    const events = paid
      ? [
          { eventId: `evt_${hex(`${spec.n}:1`, 16)}`, type: 'invoice_paid', live: spec.env === 'live', paymentId: attempt.providerPaymentId, receivedAt: T.pg(o.paidMs + 20_000), processedAt: T.pg(o.paidMs + 22_000), outcome: 'applied', error: null, attempts: 1, nextCheckAt: null },
          { eventId: `evt_${hex(`${spec.n}:2`, 16)}`, type: 'payment_paid', live: spec.env === 'live', paymentId: attempt.providerPaymentId, receivedAt: T.pg(o.paidMs + 21_000), processedAt: T.pg(o.paidMs + 23_000), outcome: 'duplicate', error: null, attempts: 1, nextCheckAt: null },
        ]
      : []
    const shipState = (l, i) => {
      if (spec.n === 'R3VN8HC5') return i === 0 ? 'preparing' : 'shipped'
      return spec.ship ?? (spec.status === 'paid' ? 'delivered' : 'preparing')
    }
    const fulfillments = paid && spec.status !== 'paid_needs_resolution'
      ? o.lines.flatMap((l, i) => {
          if (l.fulfillment === 'digital') return []
          const state = shipState(l, i)
          const carrier = CARRIERS[(o.index + i) % CARRIERS.length]
          const shippedAt = state === 'preparing' ? null : T.pg(o.paidMs + 5 * 3600_000)
          return [
            {
              id: uid(`fulfilment:${spec.n}:${i}`),
              itemId: l.id,
              state,
              carrier: state === 'preparing' ? null : carrier[0],
              tracking: state === 'preparing' ? null : carrier[1],
              dedicationDone: l.fulfillment === 'signed' ? state !== 'preparing' : false,
              shippedAt,
              deliveredAt: state === 'delivered' ? T.pg(o.paidMs + 2 * T.DAY) : null,
              updatedAt: T.pg(o.paidMs + (state === 'preparing' ? 60_000 : 5 * 3600_000)),
            },
          ]
        })
      : []
    const entitlements = paid
      ? o.lines.filter((l) => l.fulfillment === 'digital').map((l, i) => ({ id: uid(`entitlement:${spec.n}:${i}`), itemId: l.id, grantedAt: T.pg(o.paidMs + 30_000), revokedAt: null, revokeReason: null, hasFile: true, filename: 'khous-ebook.epub' }))
      : []
    const refunds = (refundsOf.get(o.id) ?? []).map((r) => ({
      id: r.id,
      orderId: o.id,
      attemptId,
      reviewPaymentId: null,
      returnId: null,
      status: r.status,
      amount: r.amount,
      reason: r.reason,
      source: r.source,
      allocation: r.allocation,
      providerRefundedBefore: 0,
      providerRefundedAfter: r.amount,
      error: null,
      nextCheckAt: null,
      createdAt: T.pg(T.ago(r.ageMin)),
      succeededAt: T.pg(T.ago(r.ageMin) + 90_000),
    }))
    const audit = paid
      ? [
          { id: 9000 + o.index * 10 + 1, at: T.pg(o.paidMs + 25_000), actor: null, action: 'order.paid', entity: 'orders', entityId: o.id, summary: { attempt: attemptId, amount: o.total } },
          { id: 9000 + o.index * 10 + 2, at: T.pg(o.paidMs + 40_000), actor: null, action: 'email.queued', entity: 'orders', entityId: o.id, summary: { kind: 'receipt' } },
          ...refunds.map((r, i) => ({ id: 9000 + o.index * 10 + 3 + i, at: r.createdAt, actor: people.owner.id, action: 'refund.created', entity: 'orders', entityId: o.id, summary: { refund: r.id, amount: r.amount } })),
        ]
      : [{ id: 9000 + o.index * 10 + 1, at: T.pg(o.createdMs), actor: null, action: 'order.created', entity: 'orders', entityId: o.id, summary: { total: o.total } }]
    const detail = {
      order: {
        id: o.id,
        orderNumber: spec.n,
        status: spec.status,
        environment: spec.env,
        createdAt: T.pg(o.createdMs),
        updatedAt: T.pg(o.paidMs ?? o.createdMs),
        paidAt: o.paidMs ? T.pg(o.paidMs) : null,
        holdExpiresAt: T.pg(o.createdMs + 30 * 60_000),
        subtotal: o.subtotal,
        discount: o.discount,
        shipping: o.shipping,
        total: o.total,
        currency: 'SAR',
        couponCode: spec.coupon ?? null,
        refunded,
        contact: { name: spec.name, email: spec.email, phone: spec.phone },
        delivery: { cityKey: spec.city, city: spec.cityName, address: spec.address },
      },
      items,
      attempts: [attempt],
      reviews: [],
      events,
      fulfillments,
      entitlements,
      refunds,
      returns: [],
      disputes: [],
      audit,
    }

    if (spec.featured === 'main') {
      // A signed copy waiting for its dedication, a shipped mug (one return asked for it), the ebook, one small refund and one dispute.
      detail.returns.push({
        id: uid(`return:${spec.n}`),
        state: 'requested',
        items: [{ itemId: items[1].id, quantity: 1 }],
        reason: 'وصل الكوب وفي حافته كسر صغير، أرجو الاستبدال.',
        staffNote: null,
        restocked: null,
        refundId: null,
        createdAt: T.pg(T.ago(260)),
        updatedAt: T.pg(T.ago(260)),
      })
      const fee = {
        id: uid(`dispute:${spec.n}:1`),
        kind: 'fee_difference',
        providerRef: 'FD-2026-0007',
        seq: 1,
        attemptId,
        reviewPaymentId: null,
        environment: 'live',
        amount: 250,
        direction: 'against_seller',
        occurredOn: T.day(T.ago(60 * 24 * 2)),
        reason: 'فرق رسوم عن العملية في كشف التسوية',
        resolution: null,
        decision: 'none',
        itemIds: [],
        createdAt: T.pg(T.ago(60 * 24 * 2)),
      }
      detail.disputes.push(fee)
      disputeRows.push({ ...fee, orderNumber: spec.n })
      detail.audit.push(
        { id: 9100, at: T.pg(T.ago(60 * 24 * 2)), actor: people.owner.id, action: 'dispute.recorded', entity: 'orders', entityId: o.id, summary: { providerRef: 'FD-2026-0007', kind: 'fee_difference', amount: 250 } },
        { id: 9101, at: T.pg(T.ago(200)), actor: people.operations.id, action: 'fulfillment.updated', entity: 'orders', entityId: o.id, summary: { state: 'shipped', items: 1 } },
      )
    }

    if (spec.featured === 'resolution') {
      // Paid, but the copy was gone: a second payment is open for review and a chargeback has been decided in two steps.
      detail.fulfillments = []
      detail.items[0].stopped = false
      const review = {
        paymentId: uid(`review-payment:${spec.n}`),
        invoiceId: attempt.providerInvoiceId,
        attemptId,
        orderId: o.id,
        environment: 'live',
        amount: o.total,
        currency: 'SAR',
        providerStatus: 'paid',
        reason: 'SECOND_PAYMENT',
        providerRefunded: 0,
        refunded: 0,
        closedAt: null,
        closedReason: null,
        createdAt: T.pg(T.ago(1000)),
      }
      detail.reviews.push(review)
      reviewRows.push({ ...review, orderNumber: spec.n })
      const first = {
        id: uid(`dispute:${spec.n}:1`),
        kind: 'chargeback',
        providerRef: 'CB-2026-00418',
        seq: 1,
        attemptId,
        reviewPaymentId: null,
        environment: 'live',
        amount: o.total,
        direction: 'against_seller',
        occurredOn: T.day(T.ago(60 * 24 * 1)),
        reason: 'اعتراض البنك على العملية بدعوى عدم الاستلام',
        resolution: null,
        decision: 'fulfillment_stopped',
        itemIds: [items[0].id],
        createdAt: T.pg(T.ago(60 * 20)),
      }
      const second = {
        ...first,
        id: uid(`dispute:${spec.n}:2`),
        seq: 2,
        reason: 'تواصلنا مع العميلة وأكدت أنها صاحبة الطلب',
        resolution: 'سُحب الاعتراض من جهة العميلة وبقي المبلغ للبائع.',
        direction: 'for_seller',
        decision: 'none',
        itemIds: [],
        createdAt: T.pg(T.ago(60 * 8)),
      }
      detail.disputes.push(first, second)
      disputeRows.push({ ...first, orderNumber: spec.n }, { ...second, orderNumber: spec.n })
      detail.events.push({ eventId: `evt_${hex(`${spec.n}:3`, 16)}`, type: 'payment_paid', live: true, paymentId: review.paymentId, receivedAt: T.pg(T.ago(1000)), processedAt: T.pg(T.ago(998)), outcome: 'review', error: null, attempts: 1, nextCheckAt: null })
      detail.audit.push(
        { id: 9200, at: T.pg(T.ago(1000)), actor: null, action: 'review.opened', entity: 'orders', entityId: o.id, summary: { reason: 'SECOND_PAYMENT' } },
        { id: 9201, at: T.pg(T.ago(60 * 20)), actor: people.owner.id, action: 'dispute.recorded', entity: 'orders', entityId: o.id, summary: { providerRef: 'CB-2026-00418', seq: 1 } },
      )
    }
    return detail
  }

  // ------------------------------------------------------------- the counts
  const alerts = {
    needsResolution: orders.filter((o) => o.spec.status === 'paid_needs_resolution').length,
    review: 1,
    toShip: ordersListRows.filter((r) => r.toShip > 0).length,
    uncertainRefunds: 1,
    unverifiedAttempts: 1,
    exhaustedEvents: 1,
    externalRefunds: 1,
    lowStock: [
      { variantId: variantBySku('KHOUS-SIGNED').id, sku: 'KHOUS-SIGNED', title: 'نسخة موقّعة', stock: 4, threshold: 5 },
      { variantId: variantBySku('MOON-CUP').id, sku: 'MOON-CUP', title: 'كوب أصفر', stock: 2, threshold: 3 },
    ],
  }

  // ------------------------------------------------------- reconciliation
  const orderByNumber = (n) => orders.find((o) => o.spec.n === n)
  const detailByNumber = (n) => orderDetails.get(orderByNumber(n).id)
  const attemptView = (n, extra) => ({ ...detailByNumber(n).attempts[0], orderNumber: n, ...extra })
  const uncertainOrder = orderByNumber('D5KQ2JY8')
  const reconciliation = {
    attempts: [
      attemptView('B6GJ3SKX', { status: 'uncertain', refunded: 0, reasons: ['UNCERTAIN', 'UNVERIFIED'], providerStatus: null, lastError: 'مهلة الاتصال بـ Moyasar', errorCount: 3 }),
      attemptView('V6LD3KQ4', { refunded: 0, providerRefunded: 3000, reasons: ['EXTERNAL_REFUND'], providerStatus: 'refunded' }),
    ],
    reviews: [
      ...reviewRows,
      {
        paymentId: uid('review-payment:orphan'),
        invoiceId: uid('invoice:orphan'),
        attemptId: null,
        orderId: null,
        environment: 'live',
        amount: 4500,
        currency: 'SAR',
        providerStatus: 'paid',
        reason: 'UNMAPPED_INVOICE',
        providerRefunded: 0,
        refunded: 0,
        closedAt: null,
        closedReason: null,
        createdAt: T.pg(T.ago(60 * 30)),
        orderNumber: null,
      },
    ],
    refunds: [
      {
        id: uid('refund:uncertain'),
        orderId: uncertainOrder.id,
        attemptId: detailByNumber('D5KQ2JY8').attempts[0].id,
        reviewPaymentId: null,
        returnId: null,
        status: 'uncertain',
        amount: 4500,
        reason: 'كوب مكسور عند الوصول',
        source: 'admin',
        allocation: { items: [{ itemId: detailByNumber('D5KQ2JY8').items[1].id, amount: 4500 }] },
        providerRefundedBefore: 0,
        providerRefundedAfter: null,
        error: 'انتهت مهلة الرد من المزوّد',
        nextCheckAt: T.pg(T.ahead(6)),
        createdAt: T.pg(T.ago(55)),
        succeededAt: null,
        orderNumber: 'D5KQ2JY8',
      },
    ],
    events: [
      { eventId: `evt_${hex('exhausted', 16)}`, type: 'payment_paid', live: true, paymentId: uid('payment:orphan'), receivedAt: T.pg(T.ago(60 * 9)), processedAt: null, outcome: null, error: 'MOYASAR_TIMEOUT', attempts: 8, nextCheckAt: null },
    ],
  }
  const references = new Map()
  for (const row of disputeRows) {
    const key = `${row.kind}|${row.providerRef}`
    if (!references.has(key)) references.set(key, { kind: row.kind, providerRef: row.providerRef, rows: [] })
    references.get(key).rows.push(row)
  }
  const disputes = { references: [...references.values()].sort((a, b) => b.rows.at(-1).seq - a.rows.at(-1).seq) }

  // ------------------------------------------------------------ other lists
  const customers = ORDER_SPECS.map((s, i) => ({ id: uid(`customer:${s.n}`), email: s.email, name: s.name, phone: s.phone, created_at: T.pg(T.ago(s.created + 5)), version: 1, ordinal: i })).map(({ ordinal, ...row }) => row)
  const notifications = [
    ['ghanim.otaibi@example.com', 'KHOUS-SIGNED', 'pending', null, T.ago(35)],
    ['lama.shehri@example.net', 'MOON-CUP', 'confirmed', 2, T.ago(60 * 5)],
    ['abdullah.zahrani@example.org', 'KHOUS-SIGNED', 'confirmed', 2, T.ago(60 * 30)],
    ['hessa.mutlaq@example.com', 'MOON-CUP-PRE', 'unsubscribed', 1, T.ago(60 * 24 * 4)],
  ].map(([email, sku, status, consent, created], i) => ({
    id: uid(`notification:${i}`),
    email,
    status,
    consent_revision: consent,
    created_at: T.pg(created),
    confirmed_at: status === 'confirmed' ? T.pg(created + 4 * 60_000) : null,
    product_variants: { sku },
  }))
  const outbox = [
    { id: 4021, kind: 'receipt', recipient: 'sara.otaibi@example.com', status: 'exhausted', delivery: null, attempts: 5, last_error: 'smtp 451: temporary local problem', first_attempt_at: T.pg(T.ago(60 * 26)), created_at: T.pg(T.ago(60 * 27)), replay_needs_confirmation: false },
    { id: 4020, kind: 'order_shipped', recipient: 'm.shamri@example.net', status: 'uncertain', delivery: null, attempts: 1, last_error: 'انتهت مهلة انتظار رد المزوّد', first_attempt_at: T.pg(T.ago(60 * 25)), created_at: T.pg(T.ago(60 * 25)), replay_needs_confirmation: true },
    { id: 4018, kind: 'order_link', recipient: 'noura.qahtani@example.org', status: 'suppressed', delivery: 'bounced', attempts: 1, last_error: 'recipient suppressed after hard bounce', first_attempt_at: T.pg(T.ago(60 * 30)), created_at: T.pg(T.ago(60 * 30)), replay_needs_confirmation: false },
    { id: 4015, kind: 'availability', recipient: 'ghanim.otaibi@example.com', status: 'sent', delivery: 'complained', attempts: 1, last_error: null, first_attempt_at: T.pg(T.ago(60 * 50)), created_at: T.pg(T.ago(60 * 50)), replay_needs_confirmation: false },
    { id: 4012, kind: 'receipt', recipient: 'rim.dosari@example.net', status: 'exhausted', delivery: null, attempts: 5, last_error: 'resend 429: daily_quota_exceeded', first_attempt_at: T.pg(T.ago(60 * 52)), created_at: T.pg(T.ago(60 * 53)), replay_needs_confirmation: false },
    { id: 4009, kind: 'notify_confirm', recipient: 'lina.zahrani@example.com', status: 'sent', delivery: 'bounced', attempts: 1, last_error: null, first_attempt_at: T.pg(T.ago(60 * 70)), created_at: T.pg(T.ago(60 * 70)), replay_needs_confirmation: false },
    { id: 4004, kind: 'owner_alert', recipient: 'anas@example.com', status: 'uncertain', delivery: null, attempts: 2, last_error: 'connection reset by peer', first_attempt_at: T.pg(T.ago(60 * 80)), created_at: T.pg(T.ago(60 * 80)), replay_needs_confirmation: true },
  ]
  const jobRuns = [
    { job: 'email_outbox', status: 'ok', detail: { sent: 3 }, finished_at: T.pg(T.ago(4)) },
    { job: 'payments_reconcile', status: 'ok', detail: { checked: 2 }, finished_at: T.pg(T.ago(7)) },
    { job: 'site_build', status: 'failed', detail: { reason: 'BUILD_HOOK_HTTP_500' }, finished_at: T.pg(T.ago(38)) },
    { job: 'media_sweep', status: 'ok', detail: { removed: 0 }, finished_at: T.pg(T.ago(310)) },
    { job: 'backup', status: 'ok', detail: null, finished_at: T.pg(T.ago(60 * 24 * 12)) },
  ]
  const cronFailures = [{ jobname: 'publish-due-content', failures: 3, lastFailedAt: T.pg(T.ago(42)) }]

  const commerceSettings = {
    checkoutEnabled: true,
    checkoutOpen: false,
    checkoutClosedReason: 'POLICIES_UNAPPROVED',
    currency: 'SAR',
    version: 4,
    configuredAt: T.pg(T.ago(60 * 24 * 3)),
    policyRevisions: { store: 1, delivery: 1, refund: 1 },
    sellerLegalName: 'أنس عبدالله القرني',
    sellerAddress: 'تبوك، المملكة العربية السعودية',
    sellerRegistration: 'FL-000000000',
  }
  const stats = {
    generatedAt: T.iso(now),
    commerce: {
      environment: 'live',
      paidOrders: 47,
      grossPaid: 612300,
      refundsConfirmed: 23400,
      netCollected: 588900,
      customers: 41,
      review: { open: 1, captured: 10400, refunded: 0 },
      disputes: { count: 2, againstSeller: 10650, forSeller: 10400 },
    },
    analytics: {
      status: 'ok',
      range: { start: T.iso(now - 7 * T.DAY), end: T.iso(now) },
      visits: 1842,
      topPaths: [
        { path: '/', count: 612 },
        { path: '/book', count: 388 },
        { path: '/built', count: 241 },
        { path: '/store', count: 197 },
        { path: '/journal', count: 133 },
        { path: '/started', count: 96 },
        { path: '/contact', count: 54 },
      ],
      fetchedAt: T.iso(now - 4 * T.MIN),
    },
  }
  const settingsStatus = {
    email: { provider: 'resend', fromSet: true },
    turnstile: { configured: true, testSecret: false },
    webhook: true,
    jobs: true,
    siteHost: 'anas.studio',
    analytics: true,
    payments: { configured: true, mode: 'test', emulator: false },
  }
  const auditEvents = [
    { id: 701, at: T.pg(T.ago(180)), action: 'content.publish_due_failed', entity: 'posts', entity_id: overduePost.id, actor: null, summary: { reason: 'VALIDATION' } },
  ]
  const variantInfo = new Map(
    variants.map((v) => [
      v.id,
      {
        ok: true,
        preorderUnits: v.preorder ? 17 : 0,
        file: v.fulfillment === 'digital' && v.sku === 'KHOUS-EBOOK' ? { filename: 'khous-ebook.epub', mime: 'application/epub+zip', bytes: 4_412_345, createdAt: T.pg(T.ago(60 * 24 * 9)) } : null,
      },
    ]),
  )
  const whereUsed = new Map()
  if (khousCover) {
    whereUsed.set(khousCover, {
      content: [
        { collection: 'rooms', doc_id: 'book', state: 'live' },
        { collection: 'scenes', doc_id: 'gallery', state: 'draft' },
      ],
      products: [{ product_id: products[0].id, title: products[0].title, status: 'published' }],
    })
  }

  return {
    T,
    content,
    people,
    media,
    mediaFiles,
    staffDirectory,
    contentDocuments,
    contentVersions,
    published,
    posts,
    products,
    variants,
    shippingRates,
    coupons,
    customers,
    notifications,
    orders,
    ordersListRows,
    orderDetails,
    alerts,
    reconciliation,
    disputes,
    outbox,
    jobRuns,
    cronFailures,
    commerceSettings,
    stats,
    settingsStatus,
    auditEvents,
    variantInfo,
    whereUsed,
    ids: { khousCover, firstPost: posts[0].id, overduePost: overduePost.id, mainOrder: orders[1].id, resolutionOrder: orders[2].id, khousEbook: variantBySku('KHOUS-EBOOK').id, khousProduct: products[0].id, mugVariant: variantBySku('MOON-CUP').id, preorderVariant: variantBySku('MOON-CUP-PRE').id, firstCoupon: coupons[0].id, firstCustomer: customers[0].id, firstRate: shippingRates[0].id },
  }
}
