// Seeds the local demo catalog (D37): three demo products with their variants,
// seven city rates, the DEMO10 coupon, the three demo policy documents and the
// local commerce settings with checkout enabled — so the store can be exercised
// end to end before Anas replaces every value with real ones. Local only:
// refuses unless DATABASE_URL points at a loopback host. Idempotent: rows are
// upserted by slug / sku / city key / code, a policy version is added only when
// its data changed, and a second run writes nothing.
//
// Usage: node scripts/seed-demo-catalog.mjs
import { Client } from 'pg'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  console.error('Refusing: DATABASE_URL is not set.')
  process.exit(1)
}
let parsed
try {
  parsed = new URL(dbUrl)
} catch {
  parsed = null
}
if (!parsed || (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') || !LOCAL_HOSTS.has(parsed.hostname)) {
  console.error('Refusing: DATABASE_URL does not point at a local PostgreSQL host.')
  process.exit(1)
}

/** A one-paragraph Lexical root, the node shape the admin editor writes. */
function lexicalParagraph(text) {
  return {
    root: {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [{ text, type: 'text', version: 1 }],
          direction: null,
          format: '',
          indent: 0,
          version: 1,
        },
      ],
      direction: null,
      format: '',
      indent: 0,
      version: 1,
    },
  }
}

const DEMO_SUMMARY = 'منتج تجريبي يعرض شكل المتجر قبل الافتتاح.'
const DEMO_BODY = 'هذه بيانات تجريبية سيستبدلها أنس قبل فتح المتجر.'

const PRODUCTS = [
  {
    slug: 'demo-khous',
    title: 'خوص (تجريبي)',
    variants: [
      { sku: 'DEMO-KHOUS-EBOOK', title: 'نسخة إلكترونية', fulfillment: 'digital', price: 3500, stock: null, low: null },
      { sku: 'DEMO-KHOUS-PAPER', title: 'نسخة ورقية', fulfillment: 'physical', price: 6900, stock: 40, low: 5 },
      { sku: 'DEMO-KHOUS-SIGNED', title: 'نسخة موقعة', fulfillment: 'signed', price: 9900, stock: 10, low: 3 },
    ],
  },
  {
    slug: 'demo-moonlight-cup',
    title: 'كوب ضوء القمر (تجريبي)',
    variants: [{ sku: 'DEMO-MOON-CUP', title: 'كوب', fulfillment: 'physical', price: 4500, stock: 25, low: null }],
  },
  {
    slug: 'demo-room-wallpapers',
    title: 'خلفيات من الغرف (تجريبي)',
    variants: [{ sku: 'DEMO-WALLPAPERS', title: 'ملف رقمي', fulfillment: 'digital', price: 1500, stock: null, low: null }],
  },
]

const RATES = [
  ['riyadh', 'الرياض', 2500],
  ['jeddah', 'جدة', 3000],
  ['dammam', 'الدمام', 3000],
  ['makkah', 'مكة المكرمة', 3000],
  ['madinah', 'المدينة المنورة', 3000],
  ['tabuk', 'تبوك', 3500],
  ['abha', 'أبها', 3500],
]

const POLICIES = [
  { id: 'store', title: 'سياسة المتجر' },
  { id: 'delivery', title: 'سياسة التوصيل' },
  { id: 'refund', title: 'سياسة الاسترجاع' },
]
const POLICY_BODY = 'نص تجريبي يكتبه أنس ويعتمده قبل فتح المتجر.'

const SELLER_NAME = 'متجر أنس (بيانات تجريبية)'
const SELLER_ADDRESS = 'تبوك، المملكة العربية السعودية (تجريبي)'
const SELLER_REGISTRATION = 'DEMO-0000'

const done = { products: 0, variants: 0, rates: 0, coupons: 0, policies: 0, settings: 0 }
const kept = { products: 0, variants: 0, rates: 0, coupons: 0, policies: 0, settings: 0 }

const client = new Client({ connectionString: dbUrl })
await client.connect()
try {
  await client.query('begin')
  try {
    for (const product of PRODUCTS) {
      const body = JSON.stringify(lexicalParagraph(DEMO_BODY))
      const current = await client.query(
        `select (title = $2 and summary = $3 and body = $4::jsonb and status = 'published' and demo) as same
           from public.products where slug = $1`,
        [product.slug, product.title, DEMO_SUMMARY, body],
      )
      if (current.rowCount === 0) {
        await client.query(
          `insert into public.products (slug, title, summary, body, status, demo) values ($1, $2, $3, $4::jsonb, 'published', true)`,
          [product.slug, product.title, DEMO_SUMMARY, body],
        )
        done.products += 1
      } else if (!current.rows[0].same) {
        await client.query(
          `update public.products set title = $2, summary = $3, body = $4::jsonb, status = 'published', demo = true where slug = $1`,
          [product.slug, product.title, DEMO_SUMMARY, body],
        )
        done.products += 1
      } else {
        kept.products += 1
      }
      const productId = (
        await client.query('select id from public.products where slug = $1', [product.slug])
      ).rows[0].id

      for (const variant of product.variants) {
        const seen = await client.query(
          `select (product_id = $2 and title = $3 and fulfillment = $4 and price_halalas = $5
                    and enabled and stock is not distinct from $6 and low_stock_threshold is not distinct from $7) as same
             from public.product_variants where sku = $1`,
          [variant.sku, productId, variant.title, variant.fulfillment, variant.price, variant.stock, variant.low],
        )
        if (seen.rowCount === 0) {
          await client.query(
            `insert into public.product_variants
               (product_id, sku, title, fulfillment, price_halalas, enabled, stock, low_stock_threshold)
             values ($1, $2, $3, $4, $5, true, $6, $7)`,
            [productId, variant.sku, variant.title, variant.fulfillment, variant.price, variant.stock, variant.low],
          )
          done.variants += 1
        } else if (!seen.rows[0].same) {
          await client.query(
            `update public.product_variants set product_id = $2, title = $3, fulfillment = $4, price_halalas = $5,
               enabled = true, stock = $6, low_stock_threshold = $7 where sku = $1`,
            [variant.sku, productId, variant.title, variant.fulfillment, variant.price, variant.stock, variant.low],
          )
          done.variants += 1
        } else {
          kept.variants += 1
        }
      }
    }

    for (const [key, name, fee] of RATES) {
      const seen = await client.query(
        'select (name_ar = $2 and fee_halalas = $3 and enabled) as same from public.shipping_rates where city_key = $1',
        [key, name, fee],
      )
      if (seen.rowCount === 0) {
        await client.query(
          'insert into public.shipping_rates (city_key, name_ar, fee_halalas, enabled) values ($1, $2, $3, true)',
          [key, name, fee],
        )
        done.rates += 1
      } else if (!seen.rows[0].same) {
        await client.query(
          'update public.shipping_rates set name_ar = $2, fee_halalas = $3, enabled = true where city_key = $1',
          [key, name, fee],
        )
        done.rates += 1
      } else {
        kept.rates += 1
      }
    }

    const couponSeen = await client.query(
      `select (kind = 'percent' and percent_bp = 1000 and starts_at is null and ends_at is null
                and min_subtotal_halalas = 0 and usage_limit is null and product_ids = '{}' and enabled) as same
         from public.coupons where code = 'DEMO10'`,
    )
    if (couponSeen.rowCount === 0) {
      await client.query(
        `insert into public.coupons (code, kind, percent_bp, enabled) values ('DEMO10', 'percent', 1000, true)`,
      )
      done.coupons += 1
    } else if (!couponSeen.rows[0].same) {
      await client.query(
        `update public.coupons set kind = 'percent', percent_bp = 1000, starts_at = null, ends_at = null,
           min_subtotal_halalas = 0, usage_limit = null, product_ids = '{}', enabled = true where code = 'DEMO10'`,
      )
      done.coupons += 1
    } else {
      kept.coupons += 1
    }

    for (const policy of POLICIES) {
      const data = JSON.stringify({ title: policy.title, body: lexicalParagraph(POLICY_BODY) })
      const published = await client.query(
        `select seq from public.published_documents where collection = 'policies' and doc_id = $1 and data = $2::jsonb`,
        [policy.id, data],
      )
      if (published.rowCount > 0) {
        kept.policies += 1
        continue
      }
      const seq = (
        await client.query(
          `select coalesce(max(seq), 0) + 1 as seq from public.content_versions where collection = 'policies' and doc_id = $1`,
          [policy.id],
        )
      ).rows[0].seq
      await client.query(
        `insert into public.content_versions (collection, doc_id, seq, data) values ('policies', $1, $2, $3::jsonb)`,
        [policy.id, seq, data],
      )
      await client.query(`select public.content_go_live('policies', $1, $2)`, [policy.id, seq])
      done.policies += 1
    }

    const revisions = {}
    for (const policy of POLICIES) {
      revisions[policy.id] = (
        await client.query(
          `select seq from public.published_documents where collection = 'policies' and doc_id = $1`,
          [policy.id],
        )
      ).rows[0].seq
    }
    const settingsSeen = await client.query(
      `select (seller_legal_name = $1 and seller_address = $2 and seller_registration = $3
                and policy_revisions = $4::jsonb and checkout_enabled) as same
         from finance.commerce_settings where id = 1`,
      [SELLER_NAME, SELLER_ADDRESS, SELLER_REGISTRATION, JSON.stringify(revisions)],
    )
    if (!settingsSeen.rows[0].same) {
      await client.query(
        `update finance.commerce_settings set seller_legal_name = $1, seller_address = $2, seller_registration = $3,
           policy_revisions = $4::jsonb, checkout_enabled = true, version = version + 1, configured_at = now()
         where id = 1`,
        [SELLER_NAME, SELLER_ADDRESS, SELLER_REGISTRATION, JSON.stringify(revisions)],
      )
      done.settings += 1
    } else {
      kept.settings += 1
    }

    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  }
} finally {
  await client.end()
}

console.log(
  `Demo catalog written: ${done.products} product(s), ${done.variants} variant(s), ${done.rates} city rate(s),` +
    ` ${done.coupons} coupon(s), ${done.policies} policy document(s), ${done.settings} settings update(s).`,
)
console.log(
  `Already current, untouched: ${kept.products} product(s), ${kept.variants} variant(s), ${kept.rates} rate(s),` +
    ` ${kept.coupons} coupon(s), ${kept.policies} policy document(s), ${kept.settings} settings.`,
)
console.log(
  'The store is now open locally with demo values (checkout on, DEMO10, demo policies); Anas replaces them before the store really opens.',
)
