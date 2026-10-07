// P08 round 7: the owner's paid-file actions of the `admin` Edge Function
// (`paid-file-ticket` and `paid-file-complete`), with every dependency faked — staff
// identity, the database (`Rpc`) and the paid files' storage — so the role gate, the
// upload checks and the clean-up run without a Supabase stack. The real Storage and the
// real database are proven in tests/integration/orders-http.test.ts and
// tests/integration/download.test.ts. The checks are the handlers': a ticket is a signed
// upload under incoming/ with a uuid the function mints; completion reads the stored type,
// the size and a few first bytes (never the object), refuses and removes a renamed
// executable, a ZIP that is not an EPUB, a wrong stored type and an oversize object, moves
// a good one to assets/<variant>/<asset>, and removes it again when the database refuses.
import { randomUUID } from 'node:crypto'

import { StorageApiError } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CONSOLE_METHODS, expectOnlyFaultLines } from '../support/console'

import { handleAdmin, type MediaStore } from '../../supabase/functions/_shared/admin.ts'
import { DbError, type Rpc } from '../../supabase/functions/_shared/db.ts'
import { PAID_BUCKET, PAID_FILE_MAX_BYTES, type PaidFileStore, paidFileHeadMatches, paidFileStore } from '../../supabase/functions/_shared/paid-files.ts'
import type { StaffIdentity } from '../../supabase/functions/_shared/staff.ts'

// Only the service-role client is faked (for the storage adapter's own test below); `db.ts` is otherwise the real module,
// and `DbError` is what the real rpc throws on every database failure.
const hoisted = vi.hoisted(() => ({ client: undefined as unknown }))
vi.mock('../../supabase/functions/_shared/db.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../supabase/functions/_shared/db.ts')>()),
  serviceClient: () => hoisted.client,
}))

const USER = '11111111-1111-4111-8111-111111111111'
const VARIANT = randomUUID()
const TICKET = randomUUID()
const INCOMING = `incoming/${TICKET}`
const PDF = 'application/pdf'
const EPUB = 'application/epub+zip'

const text = (value: string): Uint8Array => new TextEncoder().encode(value)
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** The head of a PDF. */
const pdfHead = (): Uint8Array => concat(text('%PDF-1.7\n%'), new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]), text('\n1 0 obj\n<< /Type /Catalog >>\nendobj\n'))

/**
 * The first bytes of a ZIP: one local file header (30 bytes), its name, an optional extra field, its content, then the
 * start of a second entry. `size` is what the header says the content measures.
 */
function zipHead(
  over: { name?: string; content?: string; method?: number; flags?: number; extra?: number; size?: number; signature?: number } = {},
): Uint8Array {
  const name = text(over.name ?? 'mimetype')
  const content = text(over.content ?? EPUB)
  const flags = over.flags ?? 0
  const size = over.size ?? (flags & 0x08 ? 0 : content.length)
  const header = new Uint8Array(30)
  const view = new DataView(header.buffer)
  view.setUint32(0, over.signature ?? 0x04034b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, flags, true)
  view.setUint16(8, over.method ?? 0, true)
  view.setUint32(18, size, true)
  view.setUint32(22, size, true)
  view.setUint16(26, name.length, true)
  view.setUint16(28, over.extra ?? 0, true)
  return concat(header, name, new Uint8Array(over.extra ?? 0), content, text('PK\x03\x04META-INF/container.xml'))
}

const MEDIA_STORE = (): MediaStore => ({ signedUpload: vi.fn(), read: vi.fn(), write: vi.fn(), move: vi.fn(), remove: vi.fn() })

type FakeStore = { [K in keyof PaidFileStore]: ReturnType<typeof vi.fn> & PaidFileStore[K] }
/** A paid-file storage that holds one good PDF at `incoming/<ticket>`; every call is recorded. */
function fakeFiles(over: Partial<PaidFileStore> = {}): FakeStore {
  return {
    signedUpload: vi.fn(async (key: string) => ({ path: key, token: `upload-token-for-${key}` })),
    info: vi.fn(async (_key: string) => ({ size: 5000, contentType: PDF })),
    head: vi.fn(async (_key: string, _bytes: number): Promise<Uint8Array | null> => pdfHead()),
    move: vi.fn(async (_from: string, _to: string) => undefined),
    remove: vi.fn(async (_keys: string[]) => undefined),
    ...over,
  } as FakeStore
}

const rpcDefault = async (fn: string): Promise<unknown> => (fn === 'paid_asset_set' ? { ok: true, assetId: randomUUID(), filled: 2 } : null)
/** What the real rpc (`serviceRpc`) throws when the database refuses: a `DbError` whose code is the SQLSTATE. */
const dbError = (code: string): Error => new DbError('detail that must never leave', code)

function post(body: unknown): Request {
  return new Request('http://127.0.0.1:54321/functions/v1/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer staff-token' },
    body: JSON.stringify(body),
  })
}
const staffAs = (role: StaffIdentity['role'] | 'none', recentTotp = false) => async () => (role === 'none' ? null : ({ userId: USER, role, recentTotp } as StaffIdentity))

function run(body: unknown, files: PaidFileStore, rpc: Rpc, role: StaffIdentity['role'] | 'none' = 'owner'): Promise<Response> {
  return handleAdmin(post(body), { rpc, staff: staffAs(role), store: MEDIA_STORE(), paidFiles: files })
}

const ticketBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ action: 'paid-file-ticket', variantId: VARIANT, filename: 'كتاب أنس.pdf', mime: PDF, bytes: 5000, ...over })
const completeBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ action: 'paid-file-complete', variantId: VARIANT, ticket: TICKET, filename: 'كتاب أنس.pdf', mime: PDF, ...over })

type Reply = { ok: boolean; error?: { code: string; message: string; fields?: any }; data?: any }
const replyOf = async (response: Response): Promise<Reply> => (await response.json()) as Reply

const logs = CONSOLE_METHODS.map((method) => vi.spyOn(console, method).mockImplementation(() => undefined))
beforeEach(() => {
  for (const spy of logs) spy.mockClear()
})
afterEach(() => {
  // Whatever a test did, nothing was logged but the fault lines of F3-1 (tests/support/console.ts): no token, key, URL, name or body.
  expectOnlyFaultLines(logs)
})

describe('who may do what', () => {
  it.each([
    ['editor', 'paid-file-ticket'],
    ['operations', 'paid-file-ticket'],
    ['editor', 'paid-file-complete'],
    ['operations', 'paid-file-complete'],
  ] as const)('%s is refused %s with 403 and nothing is touched', async (role, action) => {
    const files = fakeFiles()
    const rpc = vi.fn(rpcDefault)
    const response = await run(action === 'paid-file-ticket' ? ticketBody() : completeBody(), files, rpc, role)
    expect(response.status).toBe(403)
    expect((await replyOf(response)).error?.code).toBe('FORBIDDEN')
    for (const fn of Object.values(files)) expect(fn).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('a caller with no staff identity is 401', async () => {
    const files = fakeFiles()
    expect((await run(ticketBody(), files, vi.fn(rpcDefault), 'none')).status).toBe(401)
    expect((await run(completeBody(), files, vi.fn(rpcDefault), 'none')).status).toBe(401)
    expect(files.signedUpload).not.toHaveBeenCalled()
  })

  it('an owner needs no fresh TOTP: nothing here moves money', async () => {
    const files = fakeFiles()
    expect((await handleAdmin(post(ticketBody()), { rpc: vi.fn(rpcDefault), staff: staffAs('owner', false), store: MEDIA_STORE(), paidFiles: files })).status).toBe(201)
    expect(
      (await handleAdmin(post(completeBody()), { rpc: vi.fn(rpcDefault), staff: staffAs('owner', false), store: MEDIA_STORE(), paidFiles: files })).status,
    ).toBe(201)
  })
})

describe('paid-file-ticket', () => {
  it('mints a ticket and a signed upload under incoming/<ticket> in the paid files\' bucket', async () => {
    const files = fakeFiles()
    const response = await run(ticketBody(), files, vi.fn(rpcDefault))
    expect(response.status).toBe(201)
    const { data } = await replyOf(response)
    expect(data).toEqual({ ticket: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/), bucket: PAID_BUCKET, path: expect.any(String), token: expect.any(String) })
    expect(PAID_BUCKET).toBe('paid-files')
    expect(data.path).toBe(`incoming/${data.ticket}`)
    expect(files.signedUpload).toHaveBeenCalledTimes(1)
    expect(files.signedUpload).toHaveBeenCalledWith(`incoming/${data.ticket}`)
    // Nothing else is touched: no object is read, moved or removed, and no row is written.
    expect(files.info).not.toHaveBeenCalled()
    expect(files.head).not.toHaveBeenCalled()
    expect(files.move).not.toHaveBeenCalled()
    expect(files.remove).not.toHaveBeenCalled()
  })

  it('mints a different ticket every time', async () => {
    const files = fakeFiles()
    const tickets = new Set<string>()
    for (let i = 0; i < 10; i += 1) tickets.add((await replyOf(await run(ticketBody(), files, vi.fn(rpcDefault)))).data.ticket)
    expect(tickets.size).toBe(10)
  })

  it.each([
    ['an unknown type', ticketBody({ mime: 'application/zip' })],
    ['a missing type', ticketBody({ mime: undefined })],
    ['no size', ticketBody({ bytes: undefined })],
    ['a size of zero', ticketBody({ bytes: 0 })],
    ['a negative size', ticketBody({ bytes: -1 })],
    ['a fractional size', ticketBody({ bytes: 1.5 })],
    ['a size above the bucket\'s limit', ticketBody({ bytes: PAID_FILE_MAX_BYTES + 1 })],
    ['a size as text', ticketBody({ bytes: '5000' })],
    ['an empty name', ticketBody({ filename: '   ' })],
    ['a name with a slash', ticketBody({ filename: 'a/b.pdf' })],
    ['a name with a backslash', ticketBody({ filename: 'a\\b.pdf' })],
    ['a name with a control character', ticketBody({ filename: 'a\u0001b.pdf' })],
    ['a name of 121 characters', ticketBody({ filename: `${'x'.repeat(117)}.pdf` })],
    ['a variant that is not a uuid', ticketBody({ variantId: 'x' })],
    ['no variant', ticketBody({ variantId: undefined })],
    ['an extra key', ticketBody({ ticket: TICKET })],
  ])('refuses %s with 422 and signs nothing', async (_label, body) => {
    const files = fakeFiles()
    const response = await run(body, files, vi.fn(rpcDefault))
    expect(response.status).toBe(422)
    expect((await replyOf(response)).error?.code).toBe('INVALID')
    expect(files.signedUpload).not.toHaveBeenCalled()
  })

  it('accepts the size limit itself and a name of 120 characters', async () => {
    const files = fakeFiles()
    const response = await run(ticketBody({ bytes: PAID_FILE_MAX_BYTES, filename: `${'x'.repeat(116)}.pdf`, mime: EPUB }), files, vi.fn(rpcDefault))
    expect(response.status).toBe(201)
  })

  it('answers a detail-free 500 when Storage cannot sign', async () => {
    const files = fakeFiles({ signedUpload: vi.fn(async () => { throw new Error('storage detail') }) })
    const response = await run(ticketBody(), files, vi.fn(rpcDefault))
    expect(response.status).toBe(500)
    expect(JSON.stringify(await replyOf(response))).not.toContain('storage detail')
  })
})

describe('paid-file-complete: a good file', () => {
  it('reads the metadata and a few first bytes, moves it to assets/<variant>/<asset> and records it', async () => {
    const files = fakeFiles({ info: vi.fn(async () => ({ size: 123_456, contentType: PDF })) })
    const rpc = vi.fn(async (fn: string, _args: Record<string, unknown>) => (fn === 'paid_asset_set' ? { ok: true, assetId: 'asset-id', filled: 3 } : null))
    const response = await run(completeBody(), files, rpc as unknown as Rpc)
    expect(response.status).toBe(201)
    expect(await replyOf(response)).toEqual({ ok: true, data: { assetId: 'asset-id', filled: 3 } })

    expect(files.info).toHaveBeenCalledWith(INCOMING)
    // A ranged read of the head, not the object: the call names how many bytes it wants.
    expect(files.head).toHaveBeenCalledTimes(1)
    expect(files.head).toHaveBeenCalledWith(INCOMING, 4096)
    expect(files.move).toHaveBeenCalledTimes(1)
    const [from, to] = files.move.mock.calls[0] as [string, string]
    expect(from).toBe(INCOMING)
    expect(to).toMatch(new RegExp(`^assets/${VARIANT}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`))
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('paid_asset_set', { p_actor: USER, p_variant: VARIANT, p_storage_key: to, p_filename: 'كتاب أنس.pdf', p_mime: PDF, p_bytes: 123_456 })
    expect(files.remove).not.toHaveBeenCalled()
    // The key is the database's and the storage's: it is not in the reply.
    expect(JSON.stringify(await replyOf(await run(completeBody(), fakeFiles(), vi.fn(rpcDefault))))).not.toContain('assets/')
  })

  it('takes a good EPUB: the first entry of the ZIP is the stored mimetype', async () => {
    for (const head of [zipHead(), zipHead({ flags: 0x08 }), zipHead({ extra: 4 })]) {
      const files = fakeFiles({ info: vi.fn(async () => ({ size: 9000, contentType: EPUB })), head: vi.fn(async () => head) })
      const response = await run(completeBody({ mime: EPUB, filename: 'كتاب.epub' }), files, vi.fn(rpcDefault))
      expect(response.status).toBe(201)
      expect(files.move).toHaveBeenCalledTimes(1)
    }
  })

  it('compares the stored type without its parameters and its case', async () => {
    const files = fakeFiles({ info: vi.fn(async () => ({ size: 5000, contentType: 'Application/PDF; charset=binary' })) })
    expect((await run(completeBody(), files, vi.fn(rpcDefault))).status).toBe(201)
  })

  it('takes a file of exactly the bucket\'s limit', async () => {
    const files = fakeFiles({ info: vi.fn(async () => ({ size: PAID_FILE_MAX_BYTES, contentType: PDF })) })
    expect((await run(completeBody(), files, vi.fn(rpcDefault))).status).toBe(201)
  })
})

describe('paid-file-complete: what is refused and removed', () => {
  /** Every refusal of the object: 422, the object removed, nothing moved or recorded. */
  async function refused(files: FakeStore, body: Record<string, unknown>, code: string): Promise<void> {
    const rpc = vi.fn(rpcDefault)
    const response = await run(body, files, rpc)
    expect(response.status).toBe(422)
    expect((await replyOf(response)).error?.code).toBe(code)
    expect(files.remove).toHaveBeenCalledWith([INCOMING])
    expect(files.move).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  }

  it('a renamed executable declared as a PDF', async () => {
    await refused(fakeFiles({ head: vi.fn(async () => concat(text('MZ'), new Uint8Array(200))) }), completeBody(), 'NOT_A_PDF')
  })

  it('a PDF whose magic is not at the first byte, an empty object and a ZIP declared as a PDF', async () => {
    await refused(fakeFiles({ head: vi.fn(async () => concat(text('\n%PDF-1.7'), new Uint8Array(100))) }), completeBody(), 'NOT_A_PDF')
    await refused(fakeFiles({ head: vi.fn(async () => new Uint8Array(0)) }), completeBody(), 'NOT_A_PDF')
    await refused(fakeFiles({ head: vi.fn(async () => zipHead()) }), completeBody(), 'NOT_A_PDF')
  })

  it('a PDF declared as an EPUB', async () => {
    await refused(fakeFiles({ info: vi.fn(async () => ({ size: 5000, contentType: EPUB })) }), completeBody({ mime: EPUB }), 'NOT_AN_EPUB')
  })

  it.each([
    ['a plain ZIP whose first entry is another file', zipHead({ name: 'META-INF/c.xml' })],
    ['a first entry that is called mimetype but compressed', zipHead({ method: 8 })],
    ['a first entry whose content is another type', zipHead({ content: 'application/zip', size: 15 })],
    ['a first entry whose size says more than the type', zipHead({ size: 21 })],
    ['a name that only starts with mimetype', zipHead({ name: 'mimetype2' })],
    ['a mimetype that is cut short', zipHead().subarray(0, 45)],
    ['a head that is not a ZIP at all', concat(text('MZ'), new Uint8Array(100))],
    ['a ZIP signature that is not a local file header', zipHead({ signature: 0x06054b50 })],
    ['an empty object', new Uint8Array(0)],
  ])('%s declared as an EPUB', async (_label, head) => {
    await refused(fakeFiles({ info: vi.fn(async () => ({ size: 5000, contentType: EPUB })), head: vi.fn(async () => head) }), completeBody({ mime: EPUB }), 'NOT_AN_EPUB')
  })

  it('a stored type that differs from the declared one: the head is not even read', async () => {
    const files = fakeFiles({ info: vi.fn(async () => ({ size: 5000, contentType: EPUB })) })
    await refused(files, completeBody({ mime: PDF }), 'TYPE_MISMATCH')
    expect(files.head).not.toHaveBeenCalled()
    const other = fakeFiles({ info: vi.fn(async () => ({ size: 5000, contentType: 'application/octet-stream' })) })
    await refused(other, completeBody(), 'TYPE_MISMATCH')
  })

  it('an object over the bucket\'s limit: the head is not read either', async () => {
    const files = fakeFiles({ info: vi.fn(async () => ({ size: PAID_FILE_MAX_BYTES + 1, contentType: PDF })) })
    await refused(files, completeBody(), 'TOO_LARGE')
    expect(files.head).not.toHaveBeenCalled()
  })

  it('says so, and removes nothing, when there is no such object: never uploaded, or already completed', async () => {
    const files = fakeFiles({ info: vi.fn(async () => null) })
    const rpc = vi.fn(rpcDefault)
    const response = await run(completeBody(), files, rpc)
    expect(response.status).toBe(422)
    expect((await replyOf(response)).error?.code).toBe('MISSING_FILE')
    expect(files.remove).not.toHaveBeenCalled()
    expect(files.head).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()

    const vanished = fakeFiles({ head: vi.fn(async () => null) })
    const second = await run(completeBody(), vanished, rpc)
    expect(second.status).toBe(422)
    expect((await replyOf(second)).error?.code).toBe('MISSING_FILE')
    expect(vanished.move).not.toHaveBeenCalled()
  })

  it('still answers the refusal when the removal itself fails: the daily sweep takes the part', async () => {
    const files = fakeFiles({
      head: vi.fn(async () => text('MZ')),
      remove: vi.fn(async () => {
        throw new Error('storage detail')
      }),
    })
    const response = await run(completeBody(), files, vi.fn(rpcDefault))
    expect(response.status).toBe(422)
    expect(JSON.stringify(await replyOf(response))).not.toContain('storage detail')
  })

  it.each([
    ['a ticket that is not a uuid', completeBody({ ticket: '../assets/x' })],
    ['a variant that is not a uuid', completeBody({ variantId: 'x' })],
    ['a name with a slash', completeBody({ filename: 'a/b.pdf' })],
    ['an unknown type', completeBody({ mime: 'application/zip' })],
    ['an extra key', completeBody({ bytes: 5000 })],
    ['no ticket', completeBody({ ticket: undefined })],
  ])('refuses %s with 422 before any object is read', async (_label, body) => {
    const files = fakeFiles()
    const rpc = vi.fn(rpcDefault)
    const response = await run(body, files, rpc)
    expect(response.status).toBe(422)
    expect((await replyOf(response)).error?.code).toBe('INVALID')
    for (const fn of Object.values(files)) expect(fn).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('paid-file-complete: storage and database failures', () => {
  it('answers a detail-free 500, and leaves the part for the sweep, when Storage cannot read it, cannot read its head or cannot move it', async () => {
    for (const over of [
      { info: vi.fn(async () => { throw new Error('storage detail') }) },
      { head: vi.fn(async () => { throw new Error('storage detail') }) },
      { move: vi.fn(async () => { throw new Error('storage detail') }) },
    ]) {
      const files = fakeFiles(over)
      const rpc = vi.fn(rpcDefault)
      const response = await run(completeBody(), files, rpc)
      expect(response.status).toBe(500)
      expect(JSON.stringify(await replyOf(response))).not.toContain('storage detail')
      expect(files.remove).not.toHaveBeenCalled()
      expect(rpc).not.toHaveBeenCalled()
    }
  })

  it.each([
    [{ ok: false, code: 'NOT_DIGITAL' }, 422, 'NOT_DIGITAL'],
    [{ ok: false, code: 'NOT_FOUND' }, 404, 'NOT_FOUND'],
    [{ ok: false, code: 'SOMETHING_NEW' }, 500, 'SOMETHING_NEW'],
  ])('a database answer of %j removes the moved object and is %i', async (reply, status, code) => {
    const files = fakeFiles()
    const response = await run(completeBody(), files, vi.fn(async () => reply) as unknown as Rpc)
    expect(response.status).toBe(status)
    expect((await replyOf(response)).error?.code).toBe(code)
    const moved = (files.move.mock.calls[0] as [string, string])[1]
    expect(files.remove).toHaveBeenCalledWith([moved])
  })

  it.each([
    ['42501', 403, 'FORBIDDEN'],
    ['23505', 409, 'CONFLICT'],
    ['23514', 422, 'INVALID'],
    ['22023', 422, 'INVALID'],
    ['22P02', 422, 'INVALID'],
    ['XX000', 500, 'FAILED'],
  ])('a database error %s removes the moved object, answers %i %s and shows no detail', async (sqlstate, status, code) => {
    const files = fakeFiles()
    const response = await run(completeBody(), files, vi.fn(async () => { throw dbError(sqlstate) }) as unknown as Rpc)
    expect(response.status).toBe(status)
    const reply = await replyOf(response)
    expect(reply.error?.code).toBe(code)
    expect(JSON.stringify(reply)).not.toContain('detail that must never leave')
    const moved = (files.move.mock.calls[0] as [string, string])[1]
    expect(files.remove).toHaveBeenCalledWith([moved])
  })

  it.each([[null], [{}], [{ ok: 'yes' }], [{ assetId: 'x' }]])('keeps the object when the database answers %j: neither a success nor a refusal says that nothing was recorded', async (reply) => {
    const files = fakeFiles()
    const response = await run(completeBody(), files, vi.fn(async () => reply) as unknown as Rpc)
    expect(response.status).toBe(500)
    expect((await replyOf(response)).error?.code).toBe('FAILED')
    expect(files.move).toHaveBeenCalledTimes(1)
    expect(files.remove).not.toHaveBeenCalled()
  })

  it.each([
    // What `serviceRpc` throws when the call never got an answer: postgrest-js gives a fetch failure or an abort an empty code.
    ['a network failure (an empty code)', new DbError('TypeError: fetch failed', '')],
    ['a timeout (an empty code)', new DbError('AbortError: This operation was aborted', '')],
    ['a failure with no code at all', new DbError('unreadable reply', undefined)],
    ['a bare error', new TypeError('fetch failed')],
    ['a code that is not a SQLSTATE', new DbError('function not found', 'PGRST202')],
    ['a connection lost on the way (class 08)', new DbError('connection failure', '08006')],
  ])('keeps the object when the database call ends in %s: it may have been recorded, and a recorded file must keep its object', async (_label, failure) => {
    const files = fakeFiles()
    const response = await run(completeBody(), files, vi.fn(async () => { throw failure }) as unknown as Rpc)
    expect(response.status).toBe(500)
    expect((await replyOf(response)).error?.code).toBe('FAILED')
    // Moved once, to assets/: neither removed nor put back under its ticket.
    expect(files.move).toHaveBeenCalledTimes(1)
    expect(files.remove).not.toHaveBeenCalled()
  })
})

type Stored = { size: number; contentType: string; head: Uint8Array }
/** A paid-file storage that holds its objects in memory, so what one call leaves behind is what the next one finds. */
function memoryFiles(over: Partial<PaidFileStore> = {}): FakeStore & { objects: Map<string, Stored> } {
  const objects = new Map<string, Stored>([[INCOMING, { size: 5000, contentType: PDF, head: pdfHead() }]])
  const files = fakeFiles({
    info: vi.fn(async (key: string) => {
      const stored = objects.get(key)
      return stored ? { size: stored.size, contentType: stored.contentType } : null
    }),
    head: vi.fn(async (key: string) => objects.get(key)?.head ?? null),
    move: vi.fn(async (from: string, to: string) => {
      const stored = objects.get(from)
      if (!stored) throw new Error('MOVE_FAILED')
      objects.delete(from)
      objects.set(to, stored)
    }),
    remove: vi.fn(async (keys: string[]) => {
      for (const key of keys) objects.delete(key)
    }),
    ...over,
  })
  return Object.assign(files, { objects })
}

describe('paid-file-complete: where the object is left when the database recorded nothing', () => {
  const keysOf = (files: { objects: Map<string, unknown> }): string[] => [...files.objects.keys()]

  it('a lock held elsewhere (55P03) puts it back under its ticket, so the same ticket completes when the owner tries again', async () => {
    const files = memoryFiles()
    let calls = 0
    const rpc = vi.fn(async (fn: string) => {
      calls += 1
      if (calls === 1) throw dbError('55P03')
      return rpcDefault(fn)
    }) as unknown as Rpc

    const first = await run(completeBody(), files, rpc)
    expect(first.status).toBe(409)
    expect((await replyOf(first)).error?.code).toBe('BUSY')
    expect(files.remove).not.toHaveBeenCalled()
    expect(keysOf(files)).toEqual([INCOMING])

    const second = await run(completeBody(), files, rpc)
    expect(second.status).toBe(201)
    // Completed: the object is under assets/ and nowhere else.
    expect(keysOf(files)).toHaveLength(1)
    expect(keysOf(files)[0]).toMatch(new RegExp(`^assets/${VARIANT}/[0-9a-f-]{36}$`))
  })

  it('a refusal of the database removes it: nothing is left under assets/, which nothing sweeps', async () => {
    const files = memoryFiles()
    const response = await run(completeBody(), files, vi.fn(async () => ({ ok: false, code: 'NOT_DIGITAL' })) as unknown as Rpc)
    expect(response.status).toBe(422)
    expect(keysOf(files)).toEqual([])
  })

  it('a removal that Storage refuses puts it back under incoming/, where the daily sweep owns it, and the refusal is still answered', async () => {
    const files = memoryFiles({ remove: vi.fn(async () => { throw new Error('storage detail') }) })
    const refusals: Array<[answer: Rpc, status: number]> = [
      [vi.fn(async () => ({ ok: false, code: 'NOT_DIGITAL' })) as unknown as Rpc, 422],
      [vi.fn(async () => { throw dbError('XX000') }) as unknown as Rpc, 500],
    ]
    // The object is back under its ticket after each, so the second refusal finds it again.
    for (const [answer, status] of refusals) {
      const response = await run(completeBody(), files, answer)
      expect(response.status).toBe(status)
      expect(JSON.stringify(await replyOf(response))).not.toContain('storage detail')
      expect(keysOf(files)).toEqual([INCOMING])
    }
  })

  it('when it cannot be put back either, the answer is still the refusal and nothing leaks', async () => {
    const files = fakeFiles({
      move: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('storage detail 2')),
      remove: vi.fn(async () => { throw new Error('storage detail') }),
    })
    const response = await run(completeBody(), files, vi.fn(async () => ({ ok: false, code: 'NOT_FOUND' })) as unknown as Rpc)
    expect(response.status).toBe(404)
    const text = JSON.stringify(await replyOf(response))
    expect(text).not.toContain('storage detail')
    expect(files.move).toHaveBeenCalledTimes(2)
  })
})

describe('paidFileStore().remove', () => {
  const removing = (result: unknown, keys = ['incoming/x']): { done: Promise<void>; calls: Array<[string, string[]]> } => {
    const calls: Array<[string, string[]]> = []
    hoisted.client = {
      storage: {
        from: (bucket: string) => ({
          remove: async (names: string[]) => {
            calls.push([bucket, names])
            return result
          },
        }),
      },
    }
    return { done: paidFileStore().remove(keys), calls }
  }

  it('throws when Storage refuses, so a removal that did not happen is never silent', async () => {
    const { done } = removing({ data: null, error: new StorageApiError('Bad Gateway', 503, '503') })
    await expect(done).rejects.toThrow('REMOVE_FAILED')
  })

  it('removes from the paid files\' bucket and answers nothing when Storage did', async () => {
    const { done, calls } = removing({ data: [{ name: 'incoming/x' }], error: null })
    await expect(done).resolves.toBeUndefined()
    expect(calls).toEqual([[PAID_BUCKET, ['incoming/x']]])
  })

  it('asks Storage nothing for no keys', async () => {
    const { done, calls } = removing({ data: null, error: new StorageApiError('never asked', 500, '500') }, [])
    await expect(done).resolves.toBeUndefined()
    expect(calls).toEqual([])
  })
})

describe('paidFileHeadMatches', () => {
  it('knows a PDF by its first five bytes only', () => {
    expect(paidFileHeadMatches(PDF, text('%PDF-'))).toBe(true)
    expect(paidFileHeadMatches(PDF, pdfHead())).toBe(true)
    expect(paidFileHeadMatches(PDF, text('%PDF'))).toBe(false)
    expect(paidFileHeadMatches(PDF, text('%pdf-1.4'))).toBe(false)
    expect(paidFileHeadMatches(PDF, new Uint8Array(0))).toBe(false)
  })

  it('knows an EPUB by its first ZIP entry, and nothing else', () => {
    expect(paidFileHeadMatches(EPUB, zipHead())).toBe(true)
    expect(paidFileHeadMatches(EPUB, zipHead({ flags: 0x08 }))).toBe(true)
    expect(paidFileHeadMatches(EPUB, zipHead({ extra: 4 }))).toBe(true)
    expect(paidFileHeadMatches(EPUB, zipHead({ method: 8 }))).toBe(false)
    expect(paidFileHeadMatches(EPUB, zipHead({ name: 'a.txt' }))).toBe(false)
    expect(paidFileHeadMatches(EPUB, zipHead({ content: 'application/epub+zi' }))).toBe(false)
    expect(paidFileHeadMatches(EPUB, pdfHead())).toBe(false)
    // A type that is neither never matches.
    expect(paidFileHeadMatches('application/zip', zipHead())).toBe(false)
    expect(paidFileHeadMatches('', pdfHead())).toBe(false)
  })

  it('reads a head that is a view into a larger buffer', () => {
    const big = new Uint8Array(200)
    big.set(zipHead(), 50)
    expect(paidFileHeadMatches(EPUB, big.subarray(50))).toBe(true)
    big.set(pdfHead(), 10)
    expect(paidFileHeadMatches(PDF, big.subarray(10))).toBe(true)
  })
})
