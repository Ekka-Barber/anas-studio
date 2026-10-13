import { uid } from './util.mjs'

// The screens to shoot. `calls` lists the mocked calls the screen must have
// made before it can count as settled ("kind:name": rest:<table>, rpc:<fn>,
// function:<fn>:<action>, auth:<METHOD path>); `h1` is what its heading says;
// `steps` runs after the first settle (clicking a tile, say).

const GATE_TEXT = ['لا تملك صلاحية الوصول', 'هذه الصفحة للمالك فقط']

export function buildScreens(data) {
  const { ids } = data
  const content = (collection) => `/admin/content/${collection}`
  const edit = (collection, id) => `/admin/content/${collection}/edit?id=${encodeURIComponent(id)}`

  return [
    // ---------------------------------------------------------------- home
    {
      id: 'home',
      path: '/admin',
      h1: 'لوحة أنس',
      note: 'Owner home with every section filled.',
      allowText: ['تعذّر نشر'],
      calls: ['rest:staff', 'rpc:outbox_attention', 'rpc:job_runs_latest', 'rpc:orders_alerts', 'rpc:cron_failures_recent', 'rest:content_documents', 'rest:audit_events', 'function:admin:stats'],
    },
    { id: 'home-editor', path: '/admin', role: 'editor', h1: 'لوحة أنس', note: 'Editor role: the nav and the sections differ.', calls: ['rest:staff', 'rest:content_documents'] },
    { id: 'home-operations', path: '/admin', role: 'operations', h1: 'لوحة أنس', note: 'Operations role.', calls: ['rest:staff', 'rpc:outbox_attention', 'rpc:job_runs_latest', 'rpc:orders_alerts', 'rpc:cron_failures_recent'] },

    // ------------------------------------------------------------- content
    { id: 'content', path: '/admin/content', h1: 'المحتوى', note: 'The content collections (tiles).', calls: [] },
    { id: 'content-rooms', path: content('rooms'), h1: 'الغرف', note: 'The five rooms with their states.', calls: ['rest:content_documents'] },
    { id: 'content-rooms-edit-built', path: edit('rooms', 'built'), h1: /بنيتُ هنا/, note: 'The long room form (unpublished changes).', calls: ['rest:content_documents', 'rest:content_versions'] },
    { id: 'content-rooms-edit-book', path: edit('rooms', 'book'), h1: /خوص/, note: 'A room with a pending schedule.', calls: ['rest:content_documents', 'rest:content_versions'] },
    { id: 'content-posts', path: content('posts'), h1: 'المقالات', note: 'Posts in mixed states: live, unpublished changes, draft, overdue and future schedule.', calls: ['rest:content_documents'] },
    { id: 'content-posts-edit', path: edit('posts', ids.firstPost), h1: /لماذا أكتب عن الأماكن/, note: 'A live post: rich text, taxonomies, cover, publish bar, version history.', calls: ['rest:content_documents', 'rest:content_versions', 'rest:published_documents'] },
    { id: 'content-posts-edit-overdue', path: edit('posts', ids.overduePost), h1: /يوم افتتاح المقهى/, note: 'A post whose schedule time has passed.', calls: ['rest:content_documents', 'rest:content_versions', 'rest:published_documents'] },
    { id: 'content-site-settings', path: content('site_settings'), h1: 'إعدادات الموقع', note: 'The one site-settings document, listed.', calls: ['rest:content_documents'] },
    { id: 'content-site-settings-edit', path: edit('site_settings', 'site'), h1: 'إعدادات الموقع', note: 'The longest form: nav, footer, home, SEO, contact, socials, contact page.', calls: ['rest:content_documents', 'rest:content_versions'] },
    { id: 'content-taxonomies', path: content('taxonomies'), h1: 'التصنيفات', note: 'Categories and tags, with the new-slug field.', calls: ['rest:content_documents'] },
    { id: 'content-taxonomies-edit', path: edit('taxonomies', 'places'), h1: /أماكن/, note: 'One taxonomy (a category).', calls: ['rest:content_documents', 'rest:content_versions'] },
    { id: 'content-policies', path: content('policies'), h1: 'السياسات', note: 'The four policy documents (one never published).', calls: ['rest:content_documents'] },
    { id: 'content-policies-edit', path: edit('policies', 'store'), h1: /سياسة المتجر/, note: 'A policy: title and rich text, with the approval warning.', calls: ['rest:content_documents', 'rest:content_versions'] },
    { id: 'content-scenes', path: content('scenes'), h1: 'المَشاهد', note: 'The scenes gallery document, listed.', calls: ['rest:content_documents'] },
    { id: 'content-scenes-edit', path: edit('scenes', 'gallery'), h1: 'المَشاهد', note: 'The gallery: 19 photos as repeating groups.', calls: ['rest:content_documents', 'rest:content_versions'] },

    // --------------------------------------------------------------- media
    {
      id: 'media',
      path: '/admin/media',
      h1: 'المكتبة',
      note: 'Library grid with the first image selected (details, where-used).',
      calls: ['rest:media'],
      images: true,
      async steps({ page, settle }) {
        await page.locator('button[class*="mediaTile"]').first().click()
        await page.getByRole('heading', { name: 'غلاف خوص' }).waitFor({ timeout: 15_000 })
        await settle(['rpc:media_where_used', 'rpc:media_product_usage'])
      },
    },

    // --------------------------------------------------------------- store
    { id: 'store', path: '/admin/store', h1: 'المتجر', note: 'The store tiles, with the demo-data line.', calls: ['rest:products'] },
    { id: 'store-products', path: '/admin/store/products', h1: 'المنتجات', note: 'Five products (one demo, one draft, one archived).', calls: ['rest:products'], waitSelector: 'table tbody tr' },
    { id: 'store-products-edit', path: `/admin/store/products/edit?id=${ids.khousProduct}`, h1: /خوص/, note: 'A product with its variants listed below.', calls: ['rest:products', 'rest:product_variants'] },
    { id: 'store-variants-edit-ebook', path: `/admin/store/variants/edit?id=${ids.khousEbook}&product=${ids.khousProduct}`, h1: /نسخة إلكترونية/, note: 'A digital variant with its paid file.', calls: ['rest:product_variants', 'rpc:variant_admin_info'] },
    { id: 'store-variants-edit-preorder', path: `/admin/store/variants/edit?id=${ids.preorderVariant}&product=${data.products[1].id}`, h1: /الدفعة الثانية/, note: 'A preorder variant.', calls: ['rest:product_variants', 'rpc:variant_admin_info'] },
    { id: 'store-shipping-rates', path: '/admin/store/shipping-rates', h1: 'التوصيل', note: 'Nine city rates (one unpriced, one switched off).', calls: ['rest:shipping_rates'], waitSelector: 'table tbody tr' },
    { id: 'store-shipping-rates-edit', path: `/admin/store/shipping-rates/edit?id=${ids.firstRate}`, h1: /الرياض/, note: 'A city rate form.', calls: ['rest:shipping_rates'] },
    { id: 'store-coupons', path: '/admin/store/coupons', h1: 'أكواد الخصم', note: 'Three coupons (percent, fixed, expired).', calls: ['rest:coupons'], waitSelector: 'table tbody tr' },
    { id: 'store-coupons-edit', path: `/admin/store/coupons/edit?id=${ids.firstCoupon}`, h1: /DEMO10/, note: 'A coupon form with its product scope.', calls: ['rest:coupons', 'rest:products'] },
    { id: 'store-customers', path: '/admin/store/customers', h1: 'العملاء', note: 'Customers with their «طلباته» links.', calls: ['rest:customers'], waitSelector: 'table tbody tr' },
    { id: 'store-customers-edit', path: `/admin/store/customers/edit?id=${ids.firstCustomer}`, h1: /.+/, note: 'A customer: read-only email, editable name and phone.', calls: ['rest:customers'] },
    { id: 'store-notifications', path: '/admin/store/notifications', h1: 'طلبات الإشعار', note: 'Availability sign-ups (a read-only list).', calls: ['rest:notifications'], waitSelector: 'table tbody tr' },
    { id: 'store-editor', path: '/admin/store', role: 'editor', h1: null, note: 'Role gate: editors see nothing of the store.', allowText: GATE_TEXT, calls: [] },

    // -------------------------------------------------------------- orders
    { id: 'orders', path: '/admin/orders', h1: 'الطلبات', note: 'Twelve orders in mixed states.', calls: ['rpc:orders_list', 'rpc:orders_alerts'] },
    { id: 'orders-operations', path: '/admin/orders', role: 'operations', h1: 'الطلبات', note: 'Operations role: no reconciliation link.', calls: ['rpc:orders_list', 'rpc:orders_alerts'] },
    { id: 'orders-empty', path: '/admin/orders', h1: 'الطلبات', note: 'Empty state: orders_list answers no rows.', scenario: { ordersEmpty: true }, waitText: 'لا توجد طلبات.', calls: ['rpc:orders_list', 'rpc:orders_alerts'] },
    {
      id: 'orders-failed',
      path: '/admin/orders',
      h1: 'الطلبات',
      note: 'Failed state: orders_list answers 500.',
      scenario: { failRpc: { orders_list: 500 } },
      waitText: 'تعذّر التحميل.',
      allowText: ['تعذّر التحميل'],
      expectConsole: [/status of 500/],
      calls: ['rpc:orders_list', 'rpc:orders_alerts'],
    },
    { id: 'orders-view', path: `/admin/orders/view?id=${ids.mainOrder}`, h1: /R3VN8HC5/, note: 'Paid order: items, payment, shipping, files, return, refund, dispute, log.', calls: ['rpc:order_detail'] },
    { id: 'orders-view-resolution', path: `/admin/orders/view?id=${ids.resolutionOrder}`, h1: /W9TD4PZ2/, note: 'Paid but needs resolution: open review payment, chargeback in two steps.', calls: ['rpc:order_detail'] },
    { id: 'orders-view-operations', path: `/admin/orders/view?id=${ids.mainOrder}`, role: 'operations', h1: /R3VN8HC5/, note: 'Operations role: no money controls, disputes or log.', calls: ['rpc:order_detail'] },
    { id: 'orders-reconciliation', path: '/admin/orders/reconciliation', h1: 'المطابقة', note: 'Every section with rows.', calls: ['rpc:reconciliation_list', 'rpc:disputes_list'] },


    // ---------------------------------------------- dialogs and open forms
    // (`viewportOnly`: a modal dialog sits in the viewport, so these are shot at the viewport, not full page.)
    {
      id: 'media-upload-dialog',
      path: '/admin/media',
      h1: 'المكتبة',
      note: 'The upload dialog, open.',
      viewportOnly: true,
      calls: ['rest:media'],
      async steps({ page }) {
        await page.getByRole('button', { name: 'رفع صورة' }).click()
        await page.locator('dialog[open]').waitFor({ timeout: 10_000 })
      },
    },
    {
      id: 'media-delete-dialog',
      path: '/admin/media',
      h1: 'المكتبة',
      note: 'The delete confirmation of an image that is used nowhere.',
      viewportOnly: true,
      calls: ['rest:media'],
      async steps({ page }) {
        await page.locator('button[class*="mediaTile"]').nth(3).click()
        await page.waitForFunction(() => {
          const button = [...document.querySelectorAll('button')].find((el) => el.textContent?.trim() === 'حذف')
          return Boolean(button) && !button.disabled
        })
        await page.getByRole('button', { name: 'حذف', exact: true }).click()
        await page.locator('dialog[open]').waitFor({ timeout: 10_000 })
      },
    },
    {
      id: 'media-picker-dialog',
      path: edit('posts', ids.firstPost),
      h1: /لماذا أكتب عن الأماكن/,
      note: 'The library picker opened from a post cover.',
      viewportOnly: true,
      images: true,
      calls: ['rest:content_documents', 'rest:content_versions', 'rest:published_documents'],
      async steps({ page, settle }) {
        await page.getByRole('button', { name: 'تغيير' }).first().click()
        await page.locator('dialog[open]').waitFor({ timeout: 10_000 })
        await settle(['rest:media'])
      },
    },
    {
      id: 'email-replay-dialog',
      path: '/admin/email',
      h1: 'البريد',
      note: 'Confirmation before replaying mail that may already have been delivered.',
      viewportOnly: true,
      calls: ['rpc:outbox_attention'],
      async steps({ page }) {
        await page.getByRole('button', { name: /إعادة الإرسال: m\.shamri/ }).click()
        await page.locator('dialog[open]').waitFor({ timeout: 10_000 })
      },
    },
    {
      id: 'orders-view-refund-confirm',
      path: `/admin/orders/view?id=${ids.mainOrder}`,
      h1: /R3VN8HC5/,
      note: 'The refund form filled in, at its confirmation step.',
      calls: ['rpc:order_detail'],
      async steps({ page }) {
        await page.locator('form input[inputmode="decimal"]').first().fill('45')
        await page.getByLabel('السبب', { exact: true }).fill('كسر في حافة الكوب عند الاستلام')
        await page.getByRole('button', { name: 'إعادة المبلغ', exact: true }).click()
        await page.getByRole('button', { name: 'تأكيد الاسترداد' }).waitFor({ timeout: 10_000 })
      },
    },
    {
      id: 'orders-view-dispute-form',
      path: `/admin/orders/view?id=${ids.mainOrder}`,
      h1: /R3VN8HC5/,
      note: 'The «تسجيل اعتراض» form, open.',
      calls: ['rpc:order_detail'],
      async steps({ page }) {
        await page.getByRole('button', { name: 'تسجيل اعتراض' }).first().click()
        await page.locator('#dispute-amount').waitFor({ timeout: 10_000 })
      },
    },
    {
      id: 'team-step-up-dialog',
      path: '/admin/team',
      h1: 'الفريق',
      note: 'An invitation asks for a fresh authenticator code (the step-up dialog).',
      scenario: { stepUp: true },
      expectConsole: [/status of 403/],
      viewportOnly: true,
      calls: ['rpc:staff_directory'],
      async steps({ page }) {
        await page.locator('#invite-email').fill('nasser.otaibi@example.com')
        await page.locator('#invite-name').fill('ناصر العتيبي')
        await page.getByRole('button', { name: 'دعوة', exact: true }).click()
        await page.locator('dialog[open]').waitFor({ timeout: 10_000 })
      },
    },
    { id: 'content-posts-new', path: edit('posts', uid('post:new')), h1: 'بلا عنوان', note: 'A new post: the empty form (no publish bar, no history).', allowText: ['هناك مشاكل في البيانات'], calls: ['rest:content_documents', 'rest:published_documents'] },
    { id: 'store-products-new', path: '/admin/store/products/edit?id=new', h1: 'المنتجات', note: 'A new product: the empty form.', allowText: ['هناك مشاكل في البيانات'], calls: [] },

    // ------------------------------------------------------- the rest
    { id: 'email', path: '/admin/email', h1: 'البريد', note: 'Mail problems listed.', calls: ['rpc:outbox_attention'], waitSelector: 'table tbody tr' },
    { id: 'stats', path: '/admin/stats', h1: 'الإحصاءات', note: 'The store figures for 30 days and the visits.', calls: ['function:admin:stats'] },
    { id: 'settings', path: '/admin/settings', h1: 'الإعدادات', note: 'Commerce settings, site state, socials.', calls: ['rest:published_documents', 'function:admin:status', 'rpc:commerce_settings_get'] },
    { id: 'security', path: '/admin/security', h1: 'الأمان', note: 'TOTP enrolled.', calls: ['auth:GET user'] },
    { id: 'security-enroll', path: '/admin/security', role: 'editor', h1: 'الأمان', note: 'No authenticator yet: the enrolment step with a placeholder QR.', calls: ['auth:GET user', 'auth:POST factors'] },
    { id: 'team', path: '/admin/team', h1: 'الفريق', note: 'Four members, one revoked.', calls: ['rpc:staff_directory'] },
    { id: 'team-editor', path: '/admin/team', role: 'editor', h1: 'الفريق', note: 'Role gate: owner only.', allowText: GATE_TEXT, calls: [] },
    // The shell's own gate: the role cannot be read (the no-role gate draws the same box with its own sentence).
    { id: 'gate-error', path: '/admin', h1: null, note: 'The shell\'s gate when the role cannot be read.', scenario: { failRpc: { current_staff_role: 500 } }, expectConsole: [/status of 500/], allowText: ['تعذّر'], waitText: 'تعذّر التحقق من صلاحيتك', calls: ['rpc:current_staff_role'] },
    { id: 'sign-in', path: '/admin/sign-in', shell: false, signedOut: true, h1: /لوحة أنس/, note: 'Signed out. Turnstile cannot load here, so the send button stays off.', calls: [] },
    {
      id: 'sign-in-widget',
      path: '/admin/sign-in',
      shell: false,
      signedOut: true,
      fakeTurnstile: true,
      h1: /لوحة أنس/,
      note: 'Signed out, with a 300x65 placeholder where Cloudflare\'s widget would be (the real one is never loaded); the send button is on.',
      waitSelector: 'button[type="submit"]:not(:disabled)',
      calls: [],
    },
    {
      id: 'sign-in-code',
      path: '/admin/sign-in',
      shell: false,
      signedOut: true,
      fakeTurnstile: true,
      h1: /لوحة أنس/,
      note: 'The second step of the sign-in: the 8-digit code.',
      waitSelector: 'button[type="submit"]:not(:disabled)',
      calls: [],
      async steps({ page, settle }) {
        await page.locator('#email').fill('anas@example.com')
        await page.getByRole('button', { name: 'أرسل الرمز' }).click()
        await page.locator('#code').waitFor({ timeout: 10_000 })
        await settle(['auth:POST otp'])
      },
    },
    { id: 'preview-built', path: '/admin/preview?collection=rooms&id=built', shell: false, h1: null, note: 'Draft preview of a room, drawn with the public view.', waitSelector: '[data-surface="site"]', images: true, calls: ['rest:content_versions', 'rest:published_documents'] },
    { id: 'preview-post', path: `/admin/preview?collection=posts&id=${ids.firstPost}`, shell: false, h1: null, note: 'Draft preview of a post.', waitSelector: '[data-surface="site"]', images: true, calls: ['rest:content_versions', 'rest:published_documents', 'rest:content_documents'] },
  ]
}
