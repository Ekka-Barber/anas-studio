import type { Metadata } from 'next'
import { Suspense } from 'react'
import { notFound } from 'next/navigation'

import { tables, type TableKey } from '@/admin/tables'
import { TableForm } from '@/components/admin/TableForm'

// D32: one static page per table; the row id travels in `?id=` (and
// `?product=` for a variant), because a static export cannot know the ids
// created after the build. Variants are edited here, never listed. A read-only
// list (`edit: false`, the availability sign-ups) has no edit page at all.
export const dynamicParams = false

export function generateStaticParams(): Array<{ table: string }> {
  return (Object.keys(tables) as TableKey[])
    .filter((table) => tables[table].edit !== false)
    .map((table) => ({ table }))
}

export async function generateMetadata({ params }: { params: Promise<{ table: string }> }): Promise<Metadata> {
  const { table } = await params
  return { title: `تحرير: ${table in tables ? tables[table as TableKey].label : 'المتجر'}` }
}

/** `/admin/store/[table]/edit?id=…`: edit one catalog row. */
export default async function StoreEditPage({ params }: { params: Promise<{ table: string }> }) {
  const { table } = await params
  // A read-only list has no edit page: no static param for it, and a 404 here if a request reaches the page anyway.
  if (!(table in tables) || tables[table as TableKey].edit === false) notFound()

  return (
    <Suspense>
      <TableForm table={table as TableKey} />
    </Suspense>
  )
}
