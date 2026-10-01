/**
 * Table configs (P07 round 2): the catalog tables are plain rows with a
 * `version` column, not content documents — no drafts, no publish step. A
 * save is a Data API write under the caller's JWT; RLS and the column grants
 * of `20260927160000_catalog_and_checkout.sql` decide what is allowed, and
 * each config's `toRow` outputs only columns that migration grants on insert
 * and update (proven by tests/unit/collections.test.ts).
 *
 * Who does what (DATA "Authorization"): only the owner writes; operations
 * reads products, variants, rates and customers and writes nothing; editors
 * see nothing of the store. Coupons are owner-only even to read (RLS).
 */
import type { Field } from '../fields'

import { couponsConfig } from './coupons'
import { customersConfig } from './customers'
import { productsConfig } from './products'
import { shippingRatesConfig } from './shipping-rates'
import { variantsConfig } from './variants'

export type TableKey = 'products' | 'variants' | 'shipping-rates' | 'coupons' | 'customers'

/** A form field plus the visibility rule a table form needs (a variant's
 *  stock exists only for physical and signed editions). */
export type TableField = Field & { visibleWhen?: (values: Record<string, unknown>) => boolean }

export interface ListColumn {
  /** The row column shown. */
  key: string
  label: string
  /** A column the generic renderer cannot derive (the coupon's value). */
  text?: (row: Record<string, unknown>) => string
  /** Other row columns `text` reads, added to the list's select. */
  extra?: readonly string[]
}

export interface TableConfig {
  /** The Postgres table the Data API reads and writes. */
  table: string
  /** Arabic label for headings, back links and lists. */
  label: string
  /** `owner` when RLS limits the read to owners (coupons), else `staff`. */
  read: 'staff' | 'owner'
  /** The owner is the only writer; `insert: false` also removes «جديد». */
  insert: boolean
  listColumns: readonly ListColumn[]
  fields: readonly TableField[]
  /** Field names rendered as values, not inputs (the customer's email). */
  readOnly?: readonly string[]
  order: readonly { column: string; ascending: boolean }[]
  /** The unique-violation message; each table has one unique column in the form. */
  uniqueMessage: string
  /** Form values → row columns (only granted columns). */
  toRow: (values: Record<string, unknown>) => Record<string, unknown>
  /** Row columns → form values; the identity when the names match. */
  fromRow?: (row: Record<string, unknown>) => Record<string, unknown>
  /** Rules a field's own schema cannot state (the customer's phone spellings):
   *  each issue names its field, and the form keeps Save off until there are none. */
  validate?: (values: Record<string, unknown>) => Array<{ field: string; message: string }>
  /** A «تجريبي» badge's text on list rows, or null (D37; only products carry the flag). */
  listBadge?: (row: Record<string, unknown>) => string | null
}

export const tables = {
  products: productsConfig,
  variants: variantsConfig,
  'shipping-rates': shippingRatesConfig,
  coupons: couponsConfig,
  customers: customersConfig,
} as const satisfies Record<TableKey, TableConfig>
