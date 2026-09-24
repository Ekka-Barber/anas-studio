// Creates the first owner (P03). Local only, and only while no staff row
// exists — after that, invites go through the staff-admin Edge Function.
// The secret key lives only in this process's memory; never printed.
//
// Usage: node scripts/bootstrap-owner.mjs --email X --name Y
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'

import { createClient } from '@supabase/supabase-js'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])

const { values } = parseArgs({
  options: { email: { type: 'string' }, name: { type: 'string' } },
})
if (!values.email || !values.name) {
  console.error('Usage: node scripts/bootstrap-owner.mjs --email X --name Y')
  process.exit(1)
}

const raw = execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' })
const status = JSON.parse(raw)

const apiUrl = new URL(status.API_URL)
if (!LOCAL_HOSTS.has(apiUrl.hostname)) {
  console.error('Refusing: supabase status API_URL is not a local host.')
  process.exit(1)
}

const admin = createClient(status.API_URL, status.SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { count, error: countError } = await admin.from('staff').select('user_id', { count: 'exact', head: true })
if (countError) {
  console.error('Refusing: could not read the staff table.', countError.message)
  process.exit(1)
}
if (count && count > 0) {
  console.error('Refusing: a staff row already exists. Use the team screen to invite instead.')
  process.exit(1)
}

const email = values.email.trim().toLowerCase()
const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  email_confirm: true,
})
if (createError || !created.user) {
  console.error('Could not create the user.', createError?.message)
  process.exit(1)
}

const { error: staffError } = await admin
  .from('staff')
  .insert({ user_id: created.user.id, display_name: values.name.trim(), role: 'owner' })
if (staffError) {
  await admin.auth.admin.deleteUser(created.user.id)
  console.error('Could not create the owner staff row.', staffError.message)
  process.exit(1)
}

console.log(created.user.id)
