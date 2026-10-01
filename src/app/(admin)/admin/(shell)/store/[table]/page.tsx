import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { tables, type TableKey } from '@/admin/tables'
import { TableList } from '@/components/admin/TableList'

// D32: one static page per table, generated at build time. Variants have no
// list of their own: they are edited from their product's page.
export const dynamicParams = false

export function generateStaticParams(): Array<{ table: string }> {
  return (Object.keys(tables) as TableKey[])
    .filter((table) => table !== 'variants')
    .map((table) => ({ table }))
}

export async function generateMetadata({ params }: { params: Promise<{ table: string }> }): Promise<Metadata> {
  const { table } = await params
  return { title: table in tables ? tables[table as TableKey].label : 'المتجر' }
}

/** `/admin/store/[table]`: one catalog table's rows. */
export default async function StoreTablePage({ params }: { params: Promise<{ table: string }> }) {
  const { table } = await params
  if (!(table in tables)) notFound()

  return <TableList table={table as TableKey} />
}
