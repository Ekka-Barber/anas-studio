/**
 * Build-time store loaders (P07, D32): the published products and their
 * enabled variants, read through the Data API with the publishable key
 * exactly as `src/lib/content.ts` reads `published_documents`. Anon's grants
 * (migration 20260927160000, and 20261002100000 for a preorder's date and
 * note) allow exactly these columns — stock and preorder capacity never reach
 * the browser — and every row is parsed with Zod, so a malformed catalog row
 * fails the build and the last good deployment stays live.
 *
 * The cover resolves like a content image: a manifest id renders through
 * `public/images/manifest.json` (`<Picture>`), a media-library id is read
 * from `/rest/v1/media` (public since 20260927180000) and replaced with a
 * `media|…` reference.
 */
import { cache } from 'react'
import { z } from 'zod'

import { richTextSchema } from '../admin/richtext'
import { mediaById, replaceMediaIds } from './content'
import { requireEnv } from './env'
import { collectMediaIds, MEDIA_ORIGIN } from './media-ref'

const productRowSchema = z.object({
  id: z.string().regex(/^[0-9a-f-]{36}$/),
  slug: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  body: richTextSchema,
  cover_image: z.string().nullable(),
  sort_order: z.number().int(),
  demo: z.boolean(),
})

const variantRowSchema = z.object({
  id: z.string().regex(/^[0-9a-f-]{36}$/),
  product_id: z.string().regex(/^[0-9a-f-]{36}$/),
  sku: z.string().min(1),
  title: z.string().min(1),
  fulfillment: z.enum(['digital', 'physical', 'signed']),
  price_halalas: z.number().int().nullable(),
  sort_order: z.number().int(),
  preorder: z.boolean(),
  preorder_ships_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  preorder_note: z.string().nullable(),
})

export interface StoreVariant {
  id: string
  productId: string
  sku: string
  title: string
  fulfillment: 'digital' | 'physical' | 'signed'
  priceHalalas: number | null
  sortOrder: number
  /** The delivery date (YYYY-MM-DD) and note of a variant the owner made a preorder; null for every other. */
  preorder: { shipsOn: string; note: string } | null
}

export interface StoreProduct {
  id: string
  slug: string
  title: string
  summary: string
  body: z.infer<typeof richTextSchema>
  /** A manifest id or a resolved `media|…` reference; null when unset. */
  cover: string | null
  sortOrder: number
  demo: boolean
  variants: StoreVariant[]
}

async function fetchCatalog(): Promise<StoreProduct[]> {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  const key = requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')

  const productParams = new URLSearchParams({
    select: 'id,slug,title,summary,body,cover_image,sort_order,demo',
    status: 'eq.published',
    order: 'sort_order.asc,title.asc',
  })
  const productResponse = await fetch(`${url}/rest/v1/products?${productParams}`, { headers: { apikey: key } })
  if (!productResponse.ok) {
    throw new Error(`Failed to fetch products: ${productResponse.status}`)
  }
  const productRows = productRowSchema.array().parse(await productResponse.json())

  const variantParams = new URLSearchParams({
    select: 'id,product_id,sku,title,fulfillment,price_halalas,sort_order,preorder,preorder_ships_on,preorder_note',
    enabled: 'eq.true',
    order: 'sort_order.asc',
  })
  const variantResponse = await fetch(`${url}/rest/v1/product_variants?${variantParams}`, { headers: { apikey: key } })
  if (!variantResponse.ok) {
    throw new Error(`Failed to fetch variants: ${variantResponse.status}`)
  }
  const variantRows = variantRowSchema.array().parse(await variantResponse.json())

  const covers = await mediaById([
    ...new Set(productRows.flatMap((row) => (row.cover_image ? collectMediaIds(row.cover_image) : []))),
  ])
  const byProduct = new Map<string, StoreVariant[]>()
  for (const row of variantRows) {
    const list = byProduct.get(row.product_id) ?? []
    list.push({
      id: row.id,
      productId: row.product_id,
      sku: row.sku,
      title: row.title,
      fulfillment: row.fulfillment,
      priceHalalas: row.price_halalas,
      sortOrder: row.sort_order,
      // The date and the note count only while the flag is on (the owner may leave them in the row after turning it off), and a check constraint fills them in whenever it is: never half of a preorder.
      preorder:
        row.preorder && row.preorder_ships_on !== null && row.preorder_note !== null
          ? { shipsOn: row.preorder_ships_on, note: row.preorder_note }
          : null,
    })
    byProduct.set(row.product_id, list)
  }
  return productRows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    body: row.body,
    cover: row.cover_image ? replaceMediaIds(row.cover_image, covers, MEDIA_ORIGIN) : null,
    sortOrder: row.sort_order,
    demo: row.demo,
    variants: (byProduct.get(row.id) ?? []).sort(
      (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'ar'),
    ),
  }))
}

/** The published catalog, ordered by `sort_order` then title; one fetch per render via React `cache`. */
export const getProducts = cache(fetchCatalog)

/**
 * The privacy policy revision an availability sign-up records (P08 contract
 * section 6): the `seq` of the policy this build rendered (`getPublishedPolicies`),
 * or null while none is published. Stored as given: the policy's wording is the owner's.
 */
export function consentRevision(policies: { privacy: { seq: number } | null }): number | null {
  return policies.privacy?.seq ?? null
}
