// I40: `pnpm check:export` fails when a page shows the demo catalog (D37) in
// a build against a non-loopback Supabase. The fixtures mimic `out/`: the
// Supabase URL inlined into minified JavaScript, and pages whose inline
// scripts repeat their content.
import { describe, expect, it } from 'vitest'

import { checkDemoContent } from '../../scripts/lib/demo-guard.mjs'

const KEY = 'sb_publishable_not-a-real-key-0123456789'

/** A public chunk as the build writes it: the URL inlined, supabase-js's own default beside it. */
const chunk = (origin: string) => ({
  path: '_next/static/chunks/0abc.js',
  text:
    `let mo="${origin}/storage/v1/object/public/media-public";` +
    `async function c(e){return await fetch("${origin}/functions/v1/contact",{method:"POST",body:e})}` +
    `i=new si("${origin}","${KEY}");const G="http://localhost:9999";`,
})

/** The admin chunk: it names the demo badge in JavaScript on every build. */
const adminChunk = {
  path: '_next/static/chunks/1def.js',
  text: 'listBadge:e=>!0===e.demo?"تجريبي":null',
}

const page = (path: string, body: string) => ({
  path,
  text: `<!DOCTYPE html><html lang="ar" dir="rtl"><head><title>أنس</title></head><body>${body}<script>self.__next_f.push([1,"${body.replace(/"/g, '\\"')}"])</script></body></html>`,
})

const demoStore = page('store.html', '<h2>خوص (تجريبي)</h2>')
const demoPolicy = page('policies/store.html', '<p>نص تجريبي يكتبه أنس ويعتمده قبل فتح المتجر.</p>')
const home = page('index.html', '<h1>أنس</h1>')

describe('checkDemoContent', () => {
  it.each(['http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:54321', 'http://kong.localhost:8000'])(
    'a loopback build (%s) with demo content passes, with a local-only note',
    (origin) => {
      const result = checkDemoContent([chunk(origin), adminChunk, home, demoStore, demoPolicy])
      expect(result.ok).toBe(true)
      expect(result.message).toContain('2 page(s)')
      expect(result.message).toContain('loopback')
      expect(result.message).toContain(origin)
    },
  )

  it('a hosted build with demo content fails, naming the pages and I40 but never a key', () => {
    const result = checkDemoContent([chunk('https://abcdefgh.supabase.co'), adminChunk, home, demoStore, demoPolicy])
    expect(result.ok).toBe(false)
    expect(result.message).toContain('https://abcdefgh.supabase.co')
    expect(result.message).toContain('store.html, policies/store.html')
    expect(result.message).not.toContain('index.html')
    expect(result.message).toContain('I40')
    expect(result.message).not.toContain(KEY)
  })

  it('a hosted build without demo content passes, though the admin chunk names the badge', () => {
    const result = checkDemoContent([chunk('https://abcdefgh.supabase.co'), adminChunk, home])
    expect(result).toEqual({ ok: true, message: 'no demo content; Supabase origin https://abcdefgh.supabase.co' })
  })

  it.each(['https://localhost.example.com', 'https://127.0.0.1.nip.io'])(
    'a lookalike of a loopback host (%s) counts as hosted',
    (origin) => {
      expect(checkDemoContent([chunk(origin), demoStore]).ok).toBe(false)
    },
  )

  it('demo text only inside a page script or attribute is not shown, so a hosted build passes', () => {
    const hidden = {
      path: 'index.html',
      text: '<html><body><h1 title="تجريبي">أنس</h1><script>self.__next_f.push([1,"تجريبي"])</script></body></html>',
    }
    expect(checkDemoContent([chunk('https://abcdefgh.supabase.co'), hidden]).ok).toBe(true)
  })

  it('finds the origin when NEXT_PUBLIC_SUPABASE_URL ends in a slash', () => {
    const result = checkDemoContent([chunk('https://abcdefgh.supabase.co/'), home])
    expect(result).toEqual({ ok: true, message: 'no demo content; Supabase origin https://abcdefgh.supabase.co' })
  })

  it('a build that mixes a loopback and a hosted origin counts as hosted', () => {
    const result = checkDemoContent([chunk('http://127.0.0.1:54321'), chunk('https://abcdefgh.supabase.co'), demoStore])
    expect(result.ok).toBe(false)
  })

  it('an export without a findable Supabase origin fails with a clear message', () => {
    const result = checkDemoContent([{ path: '_next/static/chunks/2ghi.js', text: 'const G="http://localhost:9999"' }, home])
    expect(result.ok).toBe(false)
    expect(result.message).toContain('cannot find the Supabase origin (NEXT_PUBLIC_SUPABASE_URL)')
    expect(result.message).toContain('I40')
  })
})
