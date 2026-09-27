import { Suspense } from 'react'
import { notFound } from 'next/navigation'

import { tables, type TableKey } from '@/admin/tables'
import { AdminShell } from '@/components/admin/AdminShell'
import { TableForm } from '@/components/admin/TableForm'

// D32: one static page per table; the row id travels in `?id=` (and
// `?product=` for a variant), because a static export cannot know the ids
// created after the build. Variants are edited here, never listed.
export const dynamicParams = false

export function generateStaticParams(): Array<{ table: string }> {
  return (Object.keys(tables) as TableKey[]).map((table) => ({ table }))
}

/** `/admin/store/[table]/edit?id=…`: edit one catalog row. */
export default async function StoreEditPage({ params }: { params: Promise<{ table: string }> }) {
  const { table } = await params
  if (!(table in tables)) notFound()

  return (
    <AdminShell>
      <Suspense>
        <TableForm table={table as TableKey} />
      </Suspense>
    </AdminShell>
  )
}
