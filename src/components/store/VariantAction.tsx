'use client'

// Relative, not `@/`: the unit tests (tests/unit/store-availability.test.ts) import this file, and the unit config has no alias.
import { useEffect, useState } from 'react'

import { AddToCart } from './AddToCart'
import { AvailabilityForm } from './AvailabilityForm'
import styles from './store.module.css'

/**
 * One priced variant's row on the product page (P08 contract sections 4 and 10):
 * its price and what the visitor can do about it. The page stays a static
 * server component; this island asks `catalog_availability()` once for the
 * whole page (`loadAvailability`, shared by every row) and shows, per variant,
 * the add control, the preorder's date and note with «اطلب مسبقًا», «غير متوفر
 * حاليًا» with the availability form, «غير مسعّر», or «غير متاح حاليًا» for a
 * variant that is no longer on sale. Before the states arrive, and when the
 * read fails, the row is what the static page made it, the add control: the
 * checkout's quote is the real gate, so nothing here can sell what is not
 * there. A row's height may change once when the states arrive; nothing
 * animates. A variant that is not a preorder shows no preorder wording.
 *
 * The read and its parser live here, not in `quote.ts`: the product page's
 * first script is at the public budget (150 KiB gzip), and a page carries
 * every module it imports whole.
 */

/** Variant id → the state `catalog_availability()` gave it, as written: a state this file does not know is read as no information by `rowView`. */
export type Availability = ReadonlyMap<string, string>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function malformed(): never {
  throw new Error('تعذّر قراءة توفر المنتجات.')
}

/**
 * The reply of `catalog_availability()`, parsed strictly: an array of
 * `{variant_id, state}` and nothing else, each variant once. Anything that does
 * not fit throws, and the page then knows nothing (every row stays as the
 * static page made it).
 */
export function parseAvailability(value: unknown): Availability {
  if (!Array.isArray(value)) return malformed()
  const states = new Map<string, string>()
  for (const row of value as unknown[]) {
    if (typeof row !== 'object' || row === null || Array.isArray(row) || Object.keys(row).length !== 2) return malformed()
    const { variant_id: id, state } = row as Record<string, unknown>
    if (typeof id !== 'string' || !UUID.test(id) || typeof state !== 'string' || states.has(id)) return malformed()
    states.set(id, state)
  }
  return states
}

/** The states of every enabled variant of a published product, through the Data API as anon (the way the cart reads the cities); throws when they cannot be read. */
export async function fetchAvailability(): Promise<Availability> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/catalog_availability`, {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '' },
    // A stale answer would offer a control for something that is gone.
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('تعذّر قراءة توفر المنتجات.')
  return parseAvailability(await response.json())
}

/** How long a read serves the rows that mount after it: the rows of one page, never a visitor's whole session of client navigations. */
const FRESH_MS = 60_000
let availabilityRead: { at: number; read: Promise<Availability | null> } | null = null

/**
 * One read for every row of a page. A read that fails is null, no information:
 * the checkout's quote is the real gate, so a page that knows nothing offers
 * what it always did and sells nothing that is not there. A page opened by a
 * client navigation a minute or more after the last read asks again.
 */
export function loadAvailability(): Promise<Availability | null> {
  if (availabilityRead === null || Date.now() - availabilityRead.at >= FRESH_MS) {
    availabilityRead = { at: Date.now(), read: fetchAvailability().catch(() => null) }
  }
  return availabilityRead.read
}

/**
 * Whether the build's preorder date can still be shown: not before today in
 * Riyadh (contract section 4: a buyer is never shown a date that has passed).
 * A page built before the owner moved a lapsed date carries the old one; its
 * row then shows the plain add control, and the cart and the checkout show the
 * current date from the quote.
 */
export function preorderCurrent(shipsOn: string, now: Date = new Date()): boolean {
  return shipsOn >= new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(now)
}

/** What a variant's row offers. */
export type RowView = 'add' | 'preorder' | 'out_of_stock' | 'unpriced' | 'gone'

/**
 * The row of a variant the build priced. `states` is null while there is no
 * information (the read has not arrived, or it failed): the add control, as
 * before. A variant with no entry is disabled, or its product is no longer
 * published: «غير متاح حاليًا». A state this file does not know says nothing
 * about the row. A `preorder` state shows its wording only when the build
 * carried the preorder's date and note; without them the row stays the add
 * control, and the cart and the checkout show the note before payment.
 */
export function rowView(states: Availability | null, variantId: string, hasPreorder: boolean): RowView {
  if (states === null) return 'add'
  switch (states.get(variantId)) {
    case undefined:
      return 'gone'
    case 'preorder':
      return hasPreorder ? 'preorder' : 'add'
    case 'out_of_stock':
      return 'out_of_stock'
    case 'unpriced':
      return 'unpriced'
    default:
      return 'add'
  }
}

export function VariantAction({
  variantId,
  label,
  price,
  preorder,
  privacyRevision,
}: {
  variantId: string
  /** «<product>: <variant>», for the controls' accessible names. */
  label: string
  /** The price as the build formatted it. */
  price: string
  /** The variant's delivery date (YYYY-MM-DD), sentence and note, formatted by the build, when the owner made it a preorder; shown only while the live state says so and the date has not passed. */
  preorder: { shipsOn: string; sentence: string; note: string } | null
  /** The privacy policy revision this build rendered, or null while none is published. */
  privacyRevision: number | null
}) {
  // Null: no information yet.
  const [states, setStates] = useState<Availability | null>(null)
  useEffect(() => {
    let live = true
    void loadAvailability().then((read) => {
      if (live) setStates(read)
    })
    return () => {
      live = false
    }
  }, [])

  const view = rowView(states, variantId, preorder !== null && preorderCurrent(preorder.shipsOn))
  if (view === 'unpriced') return <p className={styles.unpriced}>غير مسعّر</p>
  if (view === 'gone') return <p className={styles.unpriced}>غير متاح حاليًا</p>
  return (
    <>
      <p className={styles.variantPrice}>{price}</p>
      {view === 'preorder' && preorder !== null && (
        <div className={styles.preorderNote}>
          <p className={styles.note}>{preorder.sentence}</p>
          <p className={`${styles.note} ${styles.wrap}`}>{preorder.note}</p>
        </div>
      )}
      {view === 'out_of_stock' ? (
        <>
          <p className={styles.unpriced}>غير متوفر حاليًا</p>
          <AvailabilityForm variantId={variantId} label={label} privacyRevision={privacyRevision} />
        </>
      ) : (
        <AddToCart variantId={variantId} label={label} preorder={view === 'preorder'} />
      )}
    </>
  )
}
