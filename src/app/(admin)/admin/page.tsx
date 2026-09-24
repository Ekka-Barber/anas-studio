'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { AdminShell } from '@/components/admin/AdminShell'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

const ROLE_LABEL: Record<string, string> = { owner: 'مالك', editor: 'محرر', operations: 'تشغيل' }

function AdminHome() {
  const [own, setOwn] = useState<{ display_name: string; role: string } | null>(null)

  useEffect(() => {
    let active = true
    async function load() {
      const supabase = getSupabaseBrowserClient()
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) return
      const { data } = await supabase
        .from('staff')
        .select('display_name, role')
        .eq('user_id', userData.user.id)
        .maybeSingle()
      if (active && data) setOwn(data)
    }
    load()
    return () => {
      active = false
    }
  }, [])

  return (
    <div>
      <h1>لوحة أنس</h1>
      {own && (
        <p>
          مرحبًا {own.display_name} — {ROLE_LABEL[own.role] ?? own.role}
        </p>
      )}
      <ul>
        <li>
          <Link href="/admin/security">الأمان</Link>
        </li>
        {own?.role === 'owner' && (
          <li>
            <Link href="/admin/team">الفريق</Link>
          </li>
        )}
      </ul>
    </div>
  )
}

export default function AdminHomePage() {
  return (
    <AdminShell>
      <AdminHome />
    </AdminShell>
  )
}
