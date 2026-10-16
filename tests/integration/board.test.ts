// P12 round R1: the data of the projects board («لوحة المشاريع», PLANS/P12-CONTRACT.md, version 2) against the real local
// database: the schema `board` and its privileges, every `public.board_*` function called as every kind of caller, the versions
// and the lock order, the races, the activity (one row per write, never any text), the limits, `done_at`, the deletes, the
// links and the titles a caller may read, and the people (removal, deactivation, demotion). The wall outside the board (the four
// policies and the Data API) is `board-wall.test.ts`.
//
// Every function is called as a signed-in staff member through a direct `authenticated` session with that member's claims
// (`staffDb`), the way PostgREST would set them; the answers are read as the Data API would carry them (the SQLSTATE, the message
// that is the code, the detail). Fixtures are written as the local superuser, so the role table does not depend on the functions
// it tests. Everything the file makes is removed in `afterAll`: its projects (with their rows) by `created_by`, its content
// documents and its bulk staff. The shared local database holds hundreds of test owners (every owner is a person of every project),
// so no test counts people it did not make.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { anonClient, createStaff, serviceClient, settledWithin, signIn, staffDb, type Role } from './support'

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const MIGRATION = readFileSync('supabase/migrations/20261016120100_p12_board.sql', 'utf8')

/** Every function of the contract's section 4: its parameters, in the contract's order. */
const FN = {
  board_projects: [],
  board_project: [['p_project', 'uuid']],
  board_link_targets: [],
  board_archived: [['p_project', 'uuid']],
  board_mine: [],
  board_overview: [['p_project', 'uuid']],
  board_activity: [['p_project', 'uuid'], ['p_card', 'uuid'], ['p_before', 'bigint']],
  board_due: [],
  board_staff: [['p_project', 'uuid']],
  board_export: [['p_project', 'uuid']],
  board_card_create: [['p_column', 'uuid'], ['p_title', 'text']],
  board_card_update: [['p_card', 'uuid'], ['p_version', 'int'], ['p_changes', 'jsonb']],
  board_card_move: [['p_card', 'uuid'], ['p_version', 'int'], ['p_column', 'uuid'], ['p_position', 'int']],
  board_card_archive: [['p_card', 'uuid'], ['p_version', 'int']],
  board_card_restore: [['p_card', 'uuid']],
  board_project_create: [['p_name', 'text']],
  board_project_rename: [['p_project', 'uuid'], ['p_version', 'int'], ['p_name', 'text']],
  board_project_archive: [['p_project', 'uuid'], ['p_version', 'int']],
  board_project_restore: [['p_project', 'uuid']],
  board_project_delete: [['p_project', 'uuid'], ['p_version', 'int']],
  board_person_set: [['p_project', 'uuid'], ['p_user', 'uuid'], ['p_role', 'text']],
  board_person_remove: [['p_project', 'uuid'], ['p_user', 'uuid']],
  board_column_create: [['p_project', 'uuid'], ['p_name', 'text']],
  board_column_update: [['p_column', 'uuid'], ['p_version', 'int'], ['p_changes', 'jsonb']],
  board_column_move: [['p_column', 'uuid'], ['p_version', 'int'], ['p_position', 'int']],
  board_column_delete: [['p_column', 'uuid'], ['p_version', 'int']],
  board_label_create: [['p_project', 'uuid'], ['p_name', 'text'], ['p_tone', 'text']],
  board_label_update: [['p_label', 'uuid'], ['p_version', 'int'], ['p_changes', 'jsonb']],
  board_label_delete: [['p_label', 'uuid'], ['p_version', 'int']],
} as const satisfies Record<string, readonly (readonly [string, string])[]>
type Fn = keyof typeof FN
const FUNCTIONS = Object.keys(FN) as Fn[]

type Any = any
type Refusal = { code: string; message: string; detail: string }
/** A refusal as the contract transports it: STALE is 23505, every other code is P0001; the detail is empty unless named. */
const R = (message: string, detail = ''): Refusal => ({ code: message === 'STALE' ? '23505' : 'P0001', message, detail })

type Person = { userId: string; email: string; name: string; db: Client }

let pg: Client
const sessions: Client[] = []
const staffIds: string[] = []
const bulkIds: string[] = []
const docs: { collection: string; docId: string }[] = []
/** The projects a test made, removed after it: the cap of 50 open projects is a limit the functions enforce, fixtures written directly count against it. */
const mine: string[] = []

let owner: Person
let member: Person
let viewer: Person
let spare: Person
let editorOut: Person
let operationsOut: Person
let boardOut: Person

async function connect(): Promise<Client> {
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()
  sessions.push(client)
  return client
}

/** A staff member with a display name of their own (the fixtures' default is their email, which must never be a reply's tell). */
async function person(role: Role, name: string, overrides: { active?: boolean } = {}): Promise<Person> {
  const { userId, email } = await createStaff(role, overrides)
  await pg.query('update public.staff set display_name = $2 where user_id = $1', [userId, name])
  staffIds.push(userId)
  const db = await staffDb(userId)
  sessions.push(db)
  return { userId, email, name, db }
}

/** A function of the contract called with named arguments (the names the browser will send). */
async function call(db: Client, fn: Fn, args: Record<string, unknown> = {}): Promise<Any> {
  const types = Object.fromEntries(FN[fn] as readonly (readonly [string, string])[])
  const names = Object.keys(args)
  const text = names.map((name, i) => `${name} => $${i + 1}::${types[name]}`).join(', ')
  const values = names.map((name) => {
    const value = args[name]
    return value !== null && typeof value === 'object' ? JSON.stringify(value) : value
  })
  return (await db.query(`select public.${fn}(${text}) as r`, values)).rows[0].r
}

/** What a refused call raised, as the Data API carries it; fails when the call was not refused. */
async function refusal(db: Client, fn: Fn, args: Record<string, unknown> = {}): Promise<Refusal> {
  try {
    await call(db, fn, args)
  } catch (error) {
    const e = error as { code?: string; message: string; detail?: string }
    return { code: e.code ?? '', message: e.message, detail: e.detail ?? '' }
  }
  throw new Error(`${fn} was not refused`)
}

const rows = async (sql: string, params: unknown[] = []): Promise<Any[]> => (await pg.query(sql, params)).rows
const one = async (sql: string, params: unknown[] = []): Promise<Any> => {
  const found = await rows(sql, params)
  if (found.length !== 1) throw new Error(`expected one row, got ${found.length}: ${sql}`)
  return found[0]
}
/** A calendar day in Riyadh, `offset` days from today, as `YYYY-MM-DD` (the day the functions count with). */
const day = async (offset = 0): Promise<string> =>
  (await one("select ((now() at time zone 'Asia/Riyadh')::date + $1::int)::text as d", [offset])).d as string

// --- fixtures -------------------------------------------------------------------------------------------------------------

type Fx = { project: string; cols: [string, string, string]; label: string; card: string; card2: string; archived: string }

/** A project written directly (three columns, the third done; a label; `member` and `viewer` on it; two open cards and an archived one). */
async function fixture(opts: { archivedProject?: boolean } = {}): Promise<Fx> {
  const project = randomUUID()
  mine.push(project)
  const cols: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()]
  const label = randomUUID()
  const card = randomUUID()
  const card2 = randomUUID()
  const archived = randomUUID()
  await pg.query('insert into board.projects (id, name, created_by, archived_at) values ($1, $2, $3, $4)', [
    project,
    'مشروع',
    owner.userId,
    opts.archivedProject ? new Date() : null,
  ])
  for (const [i, id] of cols.entries()) {
    await pg.query('insert into board.columns (id, project_id, name, position, is_done) values ($1, $2, $3, $4, $5)', [id, project, `عمود ${i + 1}`, i + 1, i === 2])
  }
  await pg.query("insert into board.labels (id, project_id, name, tone) values ($1, $2, 'وسم', 'coral')", [label, project])
  await pg.query("insert into board.members (project_id, user_id, role, added_by) values ($1, $2, 'member', $4), ($1, $3, 'viewer', $4)", [
    project,
    member.userId,
    viewer.userId,
    owner.userId,
  ])
  await pg.query(
    "insert into board.cards (id, project_id, column_id, position, title, created_by) values ($1, $3, $4, 1, 'بطاقة 1', $5), ($2, $3, $4, 2, 'بطاقة 2', $5)",
    [card, card2, project, cols[0], owner.userId],
  )
  await pg.query(
    "insert into board.cards (id, project_id, column_id, position, title, created_by, archived_at) values ($1, $2, $3, null, 'بطاقة مؤرشفة', $4, now())",
    [archived, project, cols[0], owner.userId],
  )
  return { project, cols, label, card, card2, archived }
}

/** A project built the way a person would: through the functions, as the owner (the third column is the done one). */
type Proj = { id: string; version: number; todo: Any; doing: Any; done: Any }
async function makeProject(name = 'مشروع'): Promise<Proj> {
  const project = await call(owner.db, 'board_project_create', { p_name: name })
  mine.push(project.id)
  const add = (n: string) => call(owner.db, 'board_column_create', { p_project: project.id, p_name: n })
  const todo = await add('للعمل')
  const doing = await add('قيد التنفيذ')
  const done = await add('تم')
  const marked = await call(owner.db, 'board_column_update', { p_column: done.id, p_version: done.version, p_changes: { isDone: true } })
  return { id: project.id, version: project.version, todo, doing, done: marked }
}

const addMember = (p: Proj, who: Person, role: 'member' | 'viewer' = 'member') =>
  call(owner.db, 'board_person_set', { p_project: p.id, p_user: who.userId, p_role: role })
const newCard = (p: Proj, column: Any, title: string, by: Person = owner): Promise<Any> =>
  call(by.db, 'board_card_create', { p_column: column.id, p_title: title })

/** A project's open cards as `board_project` gives them, by column: the ids in position order. */
async function layout(db: Client, project: string): Promise<Record<string, string[]>> {
  const state = await call(db, 'board_project', { p_project: project })
  const out: Record<string, string[]> = {}
  for (const column of state.columns) out[column.id] = []
  for (const card of state.cards) out[card.columnId]!.push(card.id)
  return out
}

const activity = (project: string): Promise<Any[]> =>
  rows(
    'select id, action, fields, card_id, subject, role, actor, from_column, to_column from board.activity where project_id = $1 order by id',
    [project],
  )

beforeAll(async () => {
  pg = await connect()
  owner = await person('owner', 'مالك اللوحة')
  member = await person('board', 'مشاركة اللوحة')
  viewer = await person('board', 'مطّلع اللوحة')
  spare = await person('board', 'شخص جديد')
  editorOut = await person('editor', 'محرر خارجي')
  operationsOut = await person('operations', 'عمليات خارجية')
  boardOut = await person('board', 'لوحة خارجية')
})

afterEach(async () => {
  if (mine.length > 0) await pg.query('delete from board.projects where id = any($1::uuid[])', [mine.splice(0)])
})

afterAll(async () => {
  for (const doc of docs) {
    await pg.query('delete from public.published_documents where collection = $1::public.content_collection and doc_id = $2', [doc.collection, doc.docId])
    await pg.query('delete from public.content_versions where collection = $1::public.content_collection and doc_id = $2', [doc.collection, doc.docId])
  }
  await pg.query('delete from board.projects where created_by = any($1::uuid[])', [[...staffIds, ...bulkIds]])
  // The bulk staff are raw rows (no Auth user of GoTrue's making): both tables go.
  await pg.query('delete from public.staff where user_id = any($1::uuid[])', [bulkIds])
  await pg.query('delete from auth.users where id = any($1::uuid[])', [bulkIds])
  for (const client of sessions) await client.end()
})

// --- the schema and its privileges --------------------------------------------------------------------------------------

describe('the schema board and the functions: privileges and shape', () => {
  it('the functions of the contract exist, exactly: security definer, owned by postgres, search_path empty, authenticated only', async () => {
    const found = await rows(
      `select p.oid::regprocedure::text as sig, p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as owner,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('service_role', p.oid, 'execute') as service_role,
              (select count(*)::int from aclexplode(p.proacl) a where a.grantee = 0) as public_entries
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'board\\_%' order by p.proname`,
    )
    expect(found.map((f) => f.proname)).toEqual([...FUNCTIONS].sort())
    for (const f of found) {
      expect(f.prosecdef, f.sig).toBe(true)
      expect(f.proconfig, f.sig).toContain('search_path=""')
      expect(f.owner, f.sig).toBe('postgres')
      expect({ authenticated: f.authenticated, anon: f.anon, service_role: f.service_role, public_entries: f.public_entries }, f.sig).toEqual({
        authenticated: true,
        anon: false,
        service_role: false,
        public_entries: 0,
      })
    }
  })

  it('the parameters are the contract names, in the contract order', async () => {
    for (const fn of FUNCTIONS) {
      const found = await one(
        `select coalesce(string_agg(n || ' ' || t, ', ' order by o), '') as params
           from (select u.n, format_type(u.t, null) as t, u.o
                   from pg_proc p, unnest(coalesce(p.proargnames, '{}'), string_to_array(p.proargtypes::text, ' ')::oid[]) with ordinality as u(n, t, o)
                  where p.pronamespace = 'public'::regnamespace and p.proname = $1) s`,
        [fn],
      )
      const wanted = (FN[fn] as readonly (readonly [string, string])[])
        .map(([n, t]) => `${n} ${{ int: 'integer', bigint: 'bigint', uuid: 'uuid', text: 'text', jsonb: 'jsonb' }[t]}`)
        .join(', ')
      expect(found.params, fn).toBe(wanted)
    }
  })

  it('the schema is closed: no usage for any client role, RLS on every table with no policy, no table or sequence granted, and no helper callable', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const found = await one(
        "select has_schema_privilege($1, 'board', 'usage') as usage, has_schema_privilege($1, 'board', 'create') as create",
        [role],
      )
      expect(found, role).toEqual({ usage: false, create: false })
    }
    expect((await one("select count(*)::int as n from pg_namespace n, aclexplode(n.nspacl) a where n.nspname = 'board' and a.grantee = 0")).n).toBe(0)
    const tables = await rows(
      `select c.relname, c.relrowsecurity, c.relkind,
              (select count(*)::int from pg_policies p where p.schemaname = 'board' and p.tablename = c.relname) as policies,
              array(select r from unnest(array['anon', 'authenticated', 'service_role']) r
                     where has_any_column_privilege(r, c.oid, 'select, insert, update, references')
                        or has_table_privilege(r, c.oid, 'select, insert, update, delete, truncate, references, trigger')) as granted
         from pg_class c where c.relnamespace = 'board'::regnamespace and c.relkind in ('r', 'S') order by 1`,
    )
    expect(tables.filter((t) => t.relkind === 'r').map((t) => t.relname)).toEqual(
      ['activity', 'card_labels', 'card_people', 'cards', 'checklist', 'columns', 'labels', 'members', 'projects'],
    )
    for (const t of tables.filter((x) => x.relkind === 'r')) {
      expect(t.relrowsecurity, t.relname).toBe(true)
      expect(t.policies, t.relname).toBe(0)
    }
    for (const t of tables) expect(t.granted, t.relname).toEqual([])
    const helpers = await rows(
      `select p.oid::regprocedure::text as sig, has_function_privilege('anon', p.oid, 'execute') as a,
              has_function_privilege('authenticated', p.oid, 'execute') as u, has_function_privilege('service_role', p.oid, 'execute') as s
         from pg_proc p where p.pronamespace = 'board'::regnamespace`,
    )
    expect(helpers.length).toBeGreaterThan(10)
    for (const h of helpers) expect({ a: h.a, u: h.u, s: h.s }, h.sig).toEqual({ a: false, u: false, s: false })
  })

  it('a client role reaches nothing of the schema directly', async () => {
    for (const role of ['anon', 'authenticated']) {
      const client = await connect()
      await client.query(`set role ${role}`)
      for (const sql of ['select * from board.projects', 'select * from board.cards', 'select board.caller()', 'insert into board.projects (name, created_by) values (\'x\', gen_random_uuid())']) {
        const error = await client.query(sql).then(
          () => null,
          (e: { code?: string }) => e,
        )
        expect(error?.code, `${role}: ${sql}`).toBe('42501')
      }
    }
  })

  it('the constraints are the contract\'s: the deferrable uniques, the one done column, the case-folded label names, the card rules', async () => {
    const deferrable = await rows(
      "select conname, condeferrable, condeferred from pg_constraint where conrelid in ('board.columns'::regclass, 'board.cards'::regclass) and contype = 'u' order by 1",
    )
    expect(deferrable).toEqual([
      { conname: 'cards_column_position', condeferrable: true, condeferred: true },
      { conname: 'columns_id_project', condeferrable: false, condeferred: false },
      { conname: 'columns_project_position', condeferrable: true, condeferred: true },
    ])
    const indexes = Object.fromEntries(
      (await rows("select indexname, indexdef from pg_indexes where schemaname = 'board' and indexname in ('columns_one_done', 'labels_project_name')")).map((i) => [i.indexname, i.indexdef as string]),
    )
    expect(indexes.columns_one_done).toMatch(/CREATE UNIQUE INDEX columns_one_done ON board\.columns USING btree \(project_id\) WHERE is_done/)
    expect(indexes.labels_project_name).toMatch(/UNIQUE INDEX labels_project_name ON board\.labels USING btree \(project_id, lower\(name\)\)/)

    const f = await fixture()
    const sqlState = (sql: string, params: unknown[]) =>
      pg.query(sql, params).then(
        () => 'accepted',
        (e: { code?: string }) => e.code,
      )
    // A second done column, a card with a position and an archive date, an open card without a position, one half of a link.
    expect(await sqlState('update board.columns set is_done = true where id = $1', [f.cols[0]])).toBe('23505')
    expect(await sqlState("update board.cards set archived_at = now() where id = $1", [f.card])).toBe('23514')
    expect(await sqlState('update board.cards set position = null where id = $1', [f.card])).toBe('23514')
    expect(await sqlState("update board.cards set link_collection = 'posts' where id = $1", [f.card])).toBe('23514')
    expect(await sqlState("update board.cards set link_collection = 'taxonomies', link_doc_id = 'x' where id = $1", [f.card])).toBe('23514')
    expect(await sqlState("update board.cards set priority = 'high' where id = $1", [f.card])).toBe('23514')
    // Two open cards at one position of a column clash at the end of the transaction (deferred), not before.
    await pg.query('begin')
    await pg.query('update board.cards set position = 1 where id = $1', [f.card2])
    expect(await pg.query('commit').then(() => 'accepted', (e: { code?: string }) => e.code)).toBe('23505')
    // A card's column is in the card's project.
    const other = await fixture()
    expect(await sqlState('update board.cards set column_id = $2 where id = $1', [f.card, other.cols[0]])).toBe('23503')
    // A label name is unique per project, case folded.
    expect(await sqlState("insert into board.labels (project_id, name, tone) values ($1, 'وسم', 'sand')", [f.project])).toBe('23505')
    await pg.query("insert into board.labels (project_id, name, tone) values ($1, 'Bug', 'sand')", [f.project])
    expect(await sqlState("insert into board.labels (project_id, name, tone) values ($1, 'bUG', 'aub')", [f.project])).toBe('23505')
    // The tone is one of the four.
    expect(await sqlState("insert into board.labels (project_id, name, tone) values ($1, 'x', 'purple')", [f.project])).toBe('23514')
  })

  it('the activity holds field names only: a check refuses any text, and the vocabulary is the contract\'s', async () => {
    const f = await fixture()
    const insert = (fields: string, action = 'card_edited') =>
      pg
        .query(`insert into board.activity (project_id, actor, action, fields) values ($1, $2, $3, ${fields})`, [f.project, owner.userId, action])
        .then(
          () => 'accepted',
          (e: { code?: string }) => e.code,
        )
    expect(await insert("array['title', 'notes']")).toBe('accepted')
    expect(await insert("array['سر البطاقة']")).toBe('23514')
    expect(await insert("array['a title typed by a person']")).toBe('23514')
    expect(await insert("array['title']", 'card_renamed')).toBe('23514')
    // The role a person row keeps is one of the two project roles, never a text.
    const withRole = (role: string) =>
      pg
        .query("insert into board.activity (project_id, actor, action, role) values ($1, $2, 'person_added', $3)", [f.project, owner.userId, role])
        .then(
          () => 'accepted',
          (e: { code?: string }) => e.code,
        )
    expect(await withRole('viewer')).toBe('accepted')
    expect(await withRole('owner')).toBe('23514')
    const vocabulary = ['title', 'notes', 'priority', 'due_on', 'labels', 'people', 'checklist', 'link', 'name', 'hidden', 'done', 'tone']
    for (const name of vocabulary) expect(await insert(`array['${name}']`), name).toBe('accepted')
    const actions = (await one("select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'board.activity'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%project_created%'")).def as string
    for (const a of ['project_created', 'project_renamed', 'project_archived', 'project_restored', 'person_added', 'person_role_changed', 'person_removed', 'column_created', 'column_changed', 'column_moved', 'column_deleted', 'label_created', 'label_changed', 'label_deleted', 'card_created', 'card_edited', 'card_moved', 'card_archived', 'card_restored']) {
      expect(actions, a).toContain(`'${a}'`)
    }
  })

  it('no function reads the Auth users: an email can reach no reply', async () => {
    expect(MIGRATION).not.toMatch(/auth\.users/)
    const bodies = await rows("select proname, prosrc from pg_proc where pronamespace in ('public'::regnamespace, 'board'::regnamespace) and (proname like 'board\\_%' or pronamespace = 'board'::regnamespace)")
    expect(bodies.length).toBeGreaterThan(40)
    for (const b of bodies) {
      expect(b.prosrc, b.proname).not.toMatch(/auth\.users|\bemail\b/i)
    }
  })
})

// --- the role table ----------------------------------------------------------------------------------------------------

type Kind = 'any' | 'access' | 'ownerRead' | 'member' | 'owner' | 'create'
type Who = 'anon' | 'editorOut' | 'operationsOut' | 'boardOut' | 'viewer' | 'member' | 'owner'
const WHO: Who[] = ['anon', 'editorOut', 'operationsOut', 'boardOut', 'viewer', 'member', 'owner']

const CARD_KEYS = ['checklist', 'columnId', 'doneAt', 'dueOn', 'id', 'labels', 'link', 'notes', 'people', 'position', 'priority', 'title', 'version']

/** For each function: who may call it, valid arguments on a fixture, and the keys of what it answers. */
const CASES: Record<Fn, { kind: Kind; args: (f: Fx) => Record<string, unknown>; keys?: string[]; archivedProject?: boolean }> = {
  board_projects: { kind: 'any', args: () => ({}) },
  board_link_targets: { kind: 'any', args: () => ({}) },
  board_mine: { kind: 'any', args: () => ({}) },
  board_due: { kind: 'any', args: () => ({}) },
  board_project: { kind: 'access', args: (f) => ({ p_project: f.project }), keys: ['cards', 'columns', 'labels', 'people', 'project', 'role'] },
  board_archived: { kind: 'access', args: (f) => ({ p_project: f.project }) },
  board_overview: { kind: 'access', args: (f) => ({ p_project: f.project }), keys: ['columns', 'doneThisWeek', 'hasDone', 'overdue', 'thisWeek'] },
  board_activity: { kind: 'ownerRead', args: (f) => ({ p_project: f.project }) },
  board_staff: { kind: 'ownerRead', args: (f) => ({ p_project: f.project }) },
  board_export: { kind: 'ownerRead', args: (f) => ({ p_project: f.project }) },
  board_card_create: { kind: 'member', args: (f) => ({ p_column: f.cols[0], p_title: 'بطاقة جديدة' }), keys: CARD_KEYS },
  board_card_update: { kind: 'member', args: (f) => ({ p_card: f.card, p_version: 1, p_changes: { title: 'عنوان آخر' } }), keys: CARD_KEYS },
  board_card_move: { kind: 'member', args: (f) => ({ p_card: f.card, p_version: 1, p_column: f.cols[1], p_position: 1 }), keys: ['card', 'columns'] },
  board_card_archive: { kind: 'member', args: (f) => ({ p_card: f.card, p_version: 1 }), keys: CARD_KEYS },
  board_card_restore: { kind: 'member', args: (f) => ({ p_card: f.archived }), keys: CARD_KEYS },
  board_project_create: { kind: 'create', args: () => ({ p_name: 'مشروع جديد' }), keys: ['archived', 'id', 'name', 'version'] },
  board_project_rename: { kind: 'owner', args: (f) => ({ p_project: f.project, p_version: 1, p_name: 'اسم آخر' }), keys: ['archived', 'id', 'name', 'version'] },
  board_project_archive: { kind: 'owner', args: (f) => ({ p_project: f.project, p_version: 1 }), keys: ['archived', 'id', 'name', 'version'] },
  board_project_restore: { kind: 'owner', args: (f) => ({ p_project: f.project }), keys: ['archived', 'id', 'name', 'version'], archivedProject: true },
  board_project_delete: { kind: 'owner', args: (f) => ({ p_project: f.project, p_version: 1 }), keys: ['id'], archivedProject: true },
  board_person_set: { kind: 'owner', args: (f) => ({ p_project: f.project, p_user: spare.userId, p_role: 'member' }), keys: ['id', 'name', 'role'] },
  board_person_remove: { kind: 'owner', args: (f) => ({ p_project: f.project, p_user: member.userId }), keys: ['id'] },
  board_column_create: { kind: 'owner', args: (f) => ({ p_project: f.project, p_name: 'عمود رابع' }), keys: ['hidden', 'id', 'isDone', 'name', 'position', 'version'] },
  board_column_update: { kind: 'owner', args: (f) => ({ p_column: f.cols[0], p_version: 1, p_changes: { name: 'اسم آخر' } }), keys: ['hidden', 'id', 'isDone', 'name', 'position', 'version'] },
  board_column_move: { kind: 'owner', args: (f) => ({ p_column: f.cols[0], p_version: 1, p_position: 2 }), keys: ['hidden', 'id', 'isDone', 'name', 'position', 'version'] },
  board_column_delete: { kind: 'owner', args: (f) => ({ p_column: f.cols[1], p_version: 1 }), keys: ['id'] },
  board_label_create: { kind: 'owner', args: (f) => ({ p_project: f.project, p_name: 'وسم جديد', p_tone: 'sand' }), keys: ['id', 'name', 'tone', 'version'] },
  board_label_update: { kind: 'owner', args: (f) => ({ p_label: f.label, p_version: 1, p_changes: { tone: 'aub' } }), keys: ['id', 'name', 'tone', 'version'] },
  board_label_delete: { kind: 'owner', args: (f) => ({ p_label: f.label, p_version: 1 }), keys: ['id'] },
}

/** Section 2: what each kind of caller gets from each kind of function. */
function expected(fn: Fn, who: Who): 'ok' | Refusal {
  const c = CASES[fn]
  if (c.kind === 'any') return 'ok'
  if (c.kind === 'create') return who === 'owner' ? 'ok' : R('FORBIDDEN')
  if (who.endsWith('Out')) return R('NOT_FOUND')
  if (c.archivedProject && who !== 'owner') return R('NOT_FOUND')
  if (c.kind === 'access') return 'ok'
  if (c.kind === 'member') return who === 'viewer' ? R('FORBIDDEN') : 'ok'
  return who === 'owner' ? 'ok' : R('FORBIDDEN')
}

describe('every function, as anon, an editor, an operations member, a board person off the project, a viewer, a member and an owner', () => {
  const dbOf = (who: Exclude<Who, 'anon'>): Client =>
    ({ editorOut, operationsOut, boardOut, viewer, member, owner })[who as 'editorOut'].db

  it.each(FUNCTIONS)('%s', async (fn) => {
    const c = CASES[fn]
    const shared = await fixture({ archivedProject: c.archivedProject })
    for (const who of WHO) {
      const want = expected(fn, who)
      if (who === 'anon') {
        // Not granted: the Data API refuses before the function runs.
        const args = Object.fromEntries((FN[fn] as readonly (readonly [string, string])[]).map(([n, t]) => [n, t === 'uuid' ? randomUUID() : t === 'jsonb' ? {} : t === 'text' ? 'x' : 1]))
        const answer = await anonClient().rpc(fn, args)
        expect(answer.error?.code, `${fn} as anon`).toBe('42501')
        continue
      }
      const db = dbOf(who)
      if (want === 'ok') {
        // An allowed call changes the fixture: on its own copy.
        const f = await fixture({ archivedProject: c.archivedProject })
        const reply = await call(db, fn, c.args(f))
        expect(reply, `${fn} as ${who}`).not.toBeNull()
        if (c.keys) expect(Object.keys(reply).sort(), `${fn} as ${who}`).toEqual(c.keys)
        else expect(Array.isArray(reply), `${fn} as ${who}`).toBe(true)
      } else {
        const before = await one('select (select count(*)::int from board.activity where project_id = $1) as a, (select count(*)::int from board.cards where project_id = $1) as c', [shared.project])
        expect(await refusal(db, fn, c.args(shared)), `${fn} as ${who}`).toEqual(want)
        // A refused call leaves no trace.
        expect(await one('select (select count(*)::int from board.activity where project_id = $1) as a, (select count(*)::int from board.cards where project_id = $1) as c', [shared.project])).toEqual(before)
      }
    }
  })

  it('an account that is not a staff member, an inactive one and a stranger to the Auth users are FORBIDDEN on every function', async () => {
    const inactive = await person('board', 'خامل', { active: false })
    const stranger = await staffDb(randomUUID())
    sessions.push(stranger)
    const f = await fixture()
    for (const fn of FUNCTIONS) {
      for (const db of [inactive.db, stranger]) {
        expect(await refusal(db, fn, CASES[fn].args(f)), fn).toEqual(R('FORBIDDEN'))
      }
    }
  })

  it('a project that does not exist is NOT_FOUND, for an owner too', async () => {
    for (const fn of FUNCTIONS) {
      const c = CASES[fn]
      if (c.kind === 'any' || c.kind === 'create') continue
      const nothing = Object.fromEntries(Object.entries(c.args(await fixture())).map(([k, v]) => [k, typeof v === 'string' && /^[0-9a-f]{8}-/.test(v) ? randomUUID() : v]))
      expect(await refusal(owner.db, fn, nothing), fn).toEqual(R('NOT_FOUND'))
    }
  })
})

// --- the reads ----------------------------------------------------------------------------------------------------------

/** A card changed through the function, as a person would (the version is read from the card just made). */
const edit = (by: Person, card: Any, changes: Record<string, unknown>): Promise<Any> =>
  call(by.db, 'board_card_update', { p_card: card.id, p_version: card.version, p_changes: changes })
const archive = (by: Person, card: Any): Promise<Any> => call(by.db, 'board_card_archive', { p_card: card.id, p_version: card.version })

describe('the reads', () => {
  it('board_projects: the open cards, the overdue ones (not in the done column) and the people; owners see every project, archived ones flagged', async () => {
    const p = await makeProject('مشروع ظاهر')
    await addMember(p, member)
    await addMember(p, viewer, 'viewer')
    const late = await newCard(p, p.todo, 'متأخرة')
    await edit(owner, late, { dueOn: await day(-3) })
    const later = await newCard(p, p.todo, 'لاحقًا')
    await edit(owner, later, { dueOn: await day(10) })
    const finished = await newCard(p, p.done, 'منجزة')
    await edit(owner, finished, { dueOn: await day(-5) })
    const gone = await newCard(p, p.todo, 'مؤرشفة')
    await edit(owner, gone, { dueOn: await day(-9) }).then((g) => archive(owner, g))

    const seen = (await call(owner.db, 'board_projects')).find((x: Any) => x.id === p.id)
    expect(Object.keys(seen).sort()).toEqual(['archived', 'cards', 'id', 'name', 'overdue', 'people'])
    expect(seen).toMatchObject({ name: 'مشروع ظاهر', archived: false, cards: 3, overdue: 1 })
    expect(seen.people).toEqual(
      expect.arrayContaining([
        { id: owner.userId, name: owner.name },
        { id: member.userId, name: member.name },
        { id: viewer.userId, name: viewer.name },
      ]),
    )
    // The people are display names, owners first.
    expect(seen.people.findIndex((x: Any) => x.id === owner.userId)).toBeLessThan(seen.people.findIndex((x: Any) => x.id === member.userId))
    for (const who of [member, viewer]) expect((await call(who.db, 'board_projects')).map((x: Any) => x.id), who.name).toEqual([p.id])
    for (const who of [boardOut, editorOut, operationsOut]) expect(await call(who.db, 'board_projects'), who.name).toEqual([])

    await call(owner.db, 'board_project_archive', { p_project: p.id, p_version: p.version })
    expect((await call(owner.db, 'board_projects')).find((x: Any) => x.id === p.id)?.archived).toBe(true)
    for (const who of [member, viewer]) expect(await call(who.db, 'board_projects'), who.name).toEqual([])
  })

  it('board_project: columns, labels, people with their roles, and the open cards with everything search needs (notes and checklist)', async () => {
    const p = await makeProject()
    await addMember(p, member)
    await addMember(p, viewer, 'viewer')
    const label = await call(owner.db, 'board_label_create', { p_project: p.id, p_name: 'عاجل', p_tone: 'coral' })
    const label2 = await call(owner.db, 'board_label_create', { p_project: p.id, p_name: 'تصميم', p_tone: 'aub' })
    const card = await newCard(p, p.doing, 'بطاقة غنية', member)
    const rich = await edit(member, card, {
      notes: 'ملاحظات\nسطران',
      priority: 'urgent',
      dueOn: await day(2),
      labels: [label2.id, label.id],
      people: [member.userId, owner.userId],
      checklist: [{ id: null, text: 'أول', done: true }, { id: null, text: 'ثانٍ', done: false }],
      link: { collection: 'rooms', docId: 'book' },
    })
    const first = await newCard(p, p.todo, 'أولى')
    await newCard(p, p.todo, 'ثانية')
    await archive(owner, await newCard(p, p.todo, 'مؤرشفة'))

    for (const [who, role] of [[owner, 'owner'], [member, 'member'], [viewer, 'viewer']] as const) {
      const state = await call(who.db, 'board_project', { p_project: p.id })
      expect(Object.keys(state).sort(), who.name).toEqual(['cards', 'columns', 'labels', 'people', 'project', 'role'])
      expect(state.role).toBe(role)
      expect(state.project).toEqual({ id: p.id, name: 'مشروع', version: p.version, archived: false })
      expect(state.columns.map((c: Any) => [c.name, c.position, c.hidden, c.isDone])).toEqual([
        ['للعمل', 1, false, false],
        ['قيد التنفيذ', 2, false, false],
        ['تم', 3, false, true],
      ])
      expect(Object.keys(state.columns[0]).sort()).toEqual(['hidden', 'id', 'isDone', 'name', 'position', 'version'])
      expect(state.labels.map((l: Any) => [l.name, l.tone])).toEqual([['تصميم', 'aub'], ['عاجل', 'coral']])
      expect(Object.keys(state.labels[0]).sort()).toEqual(['id', 'name', 'tone', 'version'])
      const people = Object.fromEntries(state.people.map((x: Any) => [x.id, x]))
      expect(people[owner.userId]).toEqual({ id: owner.userId, name: owner.name, role: 'owner' })
      expect(people[member.userId]).toEqual({ id: member.userId, name: member.name, role: 'member' })
      expect(people[viewer.userId]).toEqual({ id: viewer.userId, name: viewer.name, role: 'viewer' })
      // Open cards only, in board order: the todo column, then the doing column.
      expect(state.cards.map((c: Any) => c.title)).toEqual(['أولى', 'ثانية', 'بطاقة غنية'])
      expect(state.cards.map((c: Any) => c.position)).toEqual([1, 2, 1])
      const shown = state.cards.find((c: Any) => c.id === card.id)
      expect(Object.keys(shown).sort()).toEqual(CARD_KEYS)
      expect(shown).toMatchObject({ notes: 'ملاحظات\nسطران', priority: 'urgent', dueOn: await day(2), doneAt: null, columnId: p.doing.id, version: rich.version })
      expect(shown.labels).toEqual([label2.id, label.id])
      expect([...shown.people].sort()).toEqual([member.userId, owner.userId].sort())
      expect(shown.checklist.map((i: Any) => [i.text, i.done])).toEqual([['أول', true], ['ثانٍ', false]])
      expect(Object.keys(shown.checklist[0]).sort()).toEqual(['done', 'id', 'text'])
      expect(shown.link).toMatchObject({ collection: 'rooms', docId: 'book' })
      expect(typeof shown.link.title).toBe('string')
      expect(state.cards.find((c: Any) => c.id === first.id).link).toBeNull()
    }
  })

  it('board_archived: the archived cards, newest first, with their column and date', async () => {
    const p = await makeProject()
    await addMember(p, viewer, 'viewer')
    const a = await archive(owner, await newCard(p, p.todo, 'أولى'))
    const b = await archive(owner, await newCard(p, p.doing, 'ثانية'))
    await newCard(p, p.todo, 'مفتوحة')
    for (const who of [owner, viewer]) {
      const listed = await call(who.db, 'board_archived', { p_project: p.id })
      expect(listed.map((c: Any) => c.id)).toEqual([b.id, a.id])
      expect(Object.keys(listed[0]).sort()).toEqual(['archivedAt', 'columnId', 'id', 'title'])
      expect(listed[0]).toMatchObject({ title: 'ثانية', columnId: p.doing.id })
      expect(typeof listed[0].archivedAt).toBe('string')
    }
  })

  it('board_mine: the caller\'s assigned open cards in projects they can see, outside done columns, by due day and priority', async () => {
    const p = await makeProject('الأول')
    const q = await makeProject('الثاني')
    const archivedProject = await makeProject('مؤرشف')
    for (const x of [p, q, archivedProject]) await addMember(x, member)
    await addMember(p, viewer, 'viewer')
    const assign = async (x: Proj, column: Any, title: string, changes: Record<string, unknown>) =>
      edit(owner, await newCard(x, column, title), { people: [member.userId], ...changes })
    const nodue = await assign(p, p.doing, 'بلا موعد', { priority: 'urgent' })
    const soon = await assign(p, p.todo, 'قريبة', { dueOn: await day(2), priority: 'low' })
    const soonUrgent = await assign(q, q.todo, 'قريبة عاجلة', { dueOn: await day(2), priority: 'urgent' })
    const overdue = await assign(q, q.todo, 'متأخرة', { dueOn: await day(-1) })
    await assign(p, p.done, 'منجزة', { dueOn: await day(-1) })
    await archive(owner, await assign(p, p.todo, 'مؤرشفة', {}))
    await edit(owner, await newCard(p, p.todo, 'ليست لها'), { people: [owner.userId] })
    await assign(archivedProject, archivedProject.todo, 'في مشروع مؤرشف', {})
    await call(owner.db, 'board_project_archive', { p_project: archivedProject.id, p_version: archivedProject.version })

    const listed = await call(member.db, 'board_mine')
    expect(listed.map((c: Any) => c.id)).toEqual([overdue.id, soonUrgent.id, soon.id, nodue.id])
    expect(Object.keys(listed[0]).sort()).toEqual(['column', 'dueOn', 'id', 'priority', 'project', 'title'])
    expect(listed[0]).toMatchObject({ title: 'متأخرة', project: { id: q.id, name: 'الثاني' }, column: { id: q.todo.id, name: 'للعمل' } })
    expect(Object.keys(listed[0].project).sort()).toEqual(['id', 'name'])
    expect(await call(viewer.db, 'board_mine')).toEqual([])
    expect(await call(boardOut.db, 'board_mine')).toEqual([])
    // An owner's own assigned card, in a live project.
    expect((await call(owner.db, 'board_mine')).filter((c: Any) => [p.id, q.id].includes(c.project.id)).map((c: Any) => c.title)).toEqual(['ليست لها'])
  })

  it('board_overview: the numbers come from the rows (hidden columns count, archived cards and the done column do not make cards late)', async () => {
    const p = await makeProject()
    await call(owner.db, 'board_column_update', { p_column: p.doing.id, p_version: p.doing.version, p_changes: { hidden: true } })
    const today = await day(0)
    const mk = async (column: Any, title: string, dueOn: string | null) => {
      const card = await newCard(p, column, title)
      return dueOn ? edit(owner, card, { dueOn }) : card
    }
    await mk(p.todo, 'متأخرة', await day(-2))
    await mk(p.doing, 'متأخرة مخفية', await day(-1))
    await mk(p.todo, 'اليوم', today)
    await mk(p.doing, 'بعد ستة أيام', await day(6))
    await mk(p.todo, 'بعد سبعة أيام', await day(7))
    await mk(p.todo, 'بلا موعد', null)
    await mk(p.done, 'منجزة متأخرة', await day(-4))
    await archive(owner, await mk(p.todo, 'مؤرشفة متأخرة', await day(-6)))
    // Done this week: the one just moved in, not the one finished eight days ago.
    const old = await mk(p.done, 'قديمة', null)
    await pg.query("update board.cards set done_at = now() - interval '8 days' where id = $1", [old.id])
    const overview = await call(owner.db, 'board_overview', { p_project: p.id })
    expect(overview).toEqual({
      columns: [
        { id: p.todo.id, name: 'للعمل', cards: 4 },
        { id: p.doing.id, name: 'قيد التنفيذ', cards: 2 },
        { id: p.done.id, name: 'تم', cards: 2 },
      ],
      overdue: 2,
      thisWeek: 2,
      doneThisWeek: 1,
      hasDone: true,
    })
    // A project with no done column says so, and has no done cards.
    const bare = await call(owner.db, 'board_project_create', { p_name: 'بلا إنجاز' })
    mine.push(bare.id)
    const column = await call(owner.db, 'board_column_create', { p_project: bare.id, p_name: 'وحيد' })
    await call(owner.db, 'board_card_create', { p_column: column.id, p_title: 'x' })
    expect(await call(owner.db, 'board_overview', { p_project: bare.id })).toEqual({
      columns: [{ id: column.id, name: 'وحيد', cards: 1 }],
      overdue: 0,
      thisWeek: 0,
      doneThisWeek: 0,
      hasDone: false,
    })
  })

  it('board_due: overdue and this week, outside done columns and archived projects, earliest first, at most 20; owners see every project, others their own', async () => {
    const p = await makeProject()
    await addMember(p, member)
    const archivedProject = await makeProject('مؤرشف')
    await addMember(archivedProject, member)
    // 22 cards a long time overdue (so they come first whatever else this database holds), one a day apart.
    await pg.query(
      `insert into board.cards (project_id, column_id, position, title, due_on, created_by)
       select $1, $2, g, 'مستحقة ' || g, (now() at time zone 'Asia/Riyadh')::date - 4000 + g, $3 from generate_series(1, 22) g`,
      [p.id, p.todo.id, owner.userId],
    )
    const listed = await call(owner.db, 'board_due')
    expect(listed.length).toBe(20)
    expect(Object.keys(listed[0]).sort()).toEqual(['dueOn', 'id', 'project', 'title'])
    expect(listed.map((c: Any) => c.dueOn)).toEqual([...listed.map((c: Any) => c.dueOn)].sort())
    const mineOnly = listed.filter((c: Any) => c.project.id === p.id)
    expect(mineOnly.map((c: Any) => c.title)).toEqual(Array.from({ length: mineOnly.length }, (_, i) => `مستحقة ${i + 1}`))
    expect(mineOnly[0]!.project).toEqual({ id: p.id, name: 'مشروع' })

    // The details, on a project of their own: this week and overdue count, later and done ones do not.
    const q = await makeProject('التفاصيل')
    await addMember(q, member)
    await pg.query('delete from board.cards where project_id = $1', [p.id])
    const mk = async (x: Proj, column: Any, title: string, dueOn: string, people: string[] = []) => edit(owner, await newCard(x, column, title), { dueOn, people })
    const a = await mk(q, q.todo, 'اليوم', await day(0), [member.userId])
    const b = await mk(q, q.doing, 'بعد ستة', await day(6), [member.userId])
    await mk(q, q.todo, 'بعد سبعة', await day(7), [member.userId])
    await mk(q, q.done, 'منجزة', await day(-1), [member.userId])
    const unassigned = await mk(q, q.todo, 'ليست لها', await day(1))
    await mk(archivedProject, archivedProject.todo, 'في مؤرشف', await day(-1), [member.userId])
    await call(owner.db, 'board_project_archive', { p_project: archivedProject.id, p_version: archivedProject.version })
    const ownersView = (await call(owner.db, 'board_due')).filter((c: Any) => c.project.id === q.id).map((c: Any) => c.id)
    expect(ownersView.sort()).toEqual([a.id, b.id, unassigned.id].sort())
    expect((await call(member.db, 'board_due')).map((c: Any) => c.id)).toEqual([a.id, b.id])
    expect(await call(viewer.db, 'board_due')).toEqual([])
    expect(await call(boardOut.db, 'board_due')).toEqual([])
  })

  it('board_activity: 50 rows, newest first, pageable by id and by card; a deleted column is named null; owners only', async () => {
    const p = await makeProject()
    const card = await newCard(p, p.todo, 'بطاقة السجل')
    await pg.query(
      "insert into board.activity (project_id, actor, action) select $1, $2, 'project_renamed' from generate_series(1, 120)",
      [p.id, owner.userId],
    )
    const moved = await call(owner.db, 'board_card_move', { p_card: card.id, p_version: card.version, p_column: p.doing.id, p_position: 1 })
    const first = await call(owner.db, 'board_activity', { p_project: p.id })
    expect(first.length).toBe(50)
    expect(first.map((r: Any) => r.id)).toEqual([...first.map((r: Any) => r.id)].sort((a: number, b: number) => b - a))
    expect(Object.keys(first[0]).sort()).toEqual(['action', 'actor', 'at', 'card', 'fields', 'from', 'id', 'role', 'subject', 'to'])
    expect(first[0]).toMatchObject({
      action: 'card_moved',
      actor: { id: owner.userId, name: owner.name },
      card: { id: card.id, title: 'بطاقة السجل' },
      subject: null,
      from: 'للعمل',
      to: 'قيد التنفيذ',
      fields: [],
    })
    const second = await call(owner.db, 'board_activity', { p_project: p.id, p_before: first.at(-1).id })
    expect(second.length).toBe(50)
    expect(second[0].id).toBeLessThan(first.at(-1).id)
    const third = await call(owner.db, 'board_activity', { p_project: p.id, p_before: second.at(-1).id })
    // 1 project_created + 3 columns + 1 done mark + 1 card + 120 + 1 move = 127.
    expect(first.length + second.length + third.length).toBe(127)
    expect(new Set([...first, ...second, ...third].map((r: Any) => r.id)).size).toBe(127)
    // A column row names its column (the sentence «أضاف العمود «…»»).
    const all = [...first, ...second, ...third]
    expect(all.filter((r: Any) => r.action === 'column_created').map((r: Any) => r.to)).toEqual(['تم', 'قيد التنفيذ', 'للعمل'])
    expect(all.find((r: Any) => r.action === 'column_changed')).toMatchObject({ to: 'تم', fields: ['done'], role: null })
    const ofCard = await call(owner.db, 'board_activity', { p_project: p.id, p_card: card.id })
    expect(ofCard.map((r: Any) => r.action)).toEqual(['card_moved', 'card_created'])
    // A column that is gone is named null.
    await archive(owner, moved.card)
    const empty = await call(owner.db, 'board_column_create', { p_project: p.id, p_name: 'عابر' })
    await call(owner.db, 'board_column_delete', { p_column: p.doing.id, p_version: p.doing.version })
    const afterDelete = await call(owner.db, 'board_activity', { p_project: p.id, p_card: card.id })
    expect(afterDelete.find((r: Any) => r.action === 'card_moved')).toMatchObject({ from: 'للعمل', to: null })
    expect(empty.id).toBeTruthy()
  })

  it('board_staff: the active staff who are not owners and not on the project', async () => {
    const p = await makeProject()
    await addMember(p, member)
    const gone = await person('board', 'خامل للإضافة', { active: false })
    const listed = await call(owner.db, 'board_staff', { p_project: p.id })
    const byId = Object.fromEntries(listed.map((x: Any) => [x.id, x]))
    expect(Object.keys(listed[0]).sort()).toEqual(['id', 'name', 'role'])
    expect(byId[spare.userId]).toEqual({ id: spare.userId, name: spare.name, role: 'board' })
    expect(byId[editorOut.userId]).toMatchObject({ role: 'editor' })
    expect(byId[member.userId]).toBeUndefined()
    expect(byId[owner.userId]).toBeUndefined()
    expect(byId[gone.userId]).toBeUndefined()
    expect(listed.every((x: Any) => x.role !== 'owner')).toBe(true)
  })

  it('board_export: every card, archived ones included, with its notes, the names of its labels and people, and its checklist', async () => {
    const p = await makeProject()
    await addMember(p, member)
    const label = await call(owner.db, 'board_label_create', { p_project: p.id, p_name: 'وسم التصدير', p_tone: 'sand' })
    const one1 = await edit(owner, await newCard(p, p.todo, 'أولى'), {
      notes: 'ملاحظات التصدير',
      labels: [label.id],
      people: [member.userId],
      checklist: [{ id: null, text: 'بند', done: true }],
      dueOn: await day(1),
      priority: 'low',
      link: { collection: 'rooms', docId: 'book' },
    })
    await newCard(p, p.doing, 'ثانية')
    await archive(owner, await newCard(p, p.todo, 'مؤرشفة'))
    const exported = await call(owner.db, 'board_export', { p_project: p.id })
    expect(exported.map((c: Any) => [c.title, c.archived])).toEqual([['أولى', false], ['ثانية', false], ['مؤرشفة', true]])
    const row = exported.find((c: Any) => c.id === one1.id)
    expect(row).toMatchObject({
      title: 'أولى',
      column: 'للعمل',
      priority: 'low',
      dueOn: await day(1),
      labels: ['وسم التصدير'],
      people: ['مشاركة اللوحة'],
      checklist: [{ text: 'بند', done: true }],
      notes: 'ملاحظات التصدير',
      archived: false,
    })
    expect(row.link).toMatchObject({ collection: 'rooms', docId: 'book' })
  })
})

// --- versions -------------------------------------------------------------------------------------------------------------

const versionOf = async (table: string, id: string): Promise<number> => (await one(`select version from board.${table} where id = $1`, [id])).version as number

describe('versions: a write that changes an existing row takes its version, raises STALE when it moved, and bumps it', () => {
  it('STALE (23505) on every versioned write, the row and the log untouched; the current version is accepted and bumps it by one', async () => {
    const p = await makeProject()
    await addMember(p, member)
    const label = await call(owner.db, 'board_label_create', { p_project: p.id, p_name: 'وسم', p_tone: 'coral' })
    const spareColumn = await call(owner.db, 'board_column_create', { p_project: p.id, p_name: 'فارغ' })
    const card = await newCard(p, p.todo, 'بطاقة')
    const cases: { fn: Fn; table: string; id: string; by: Person; args: (v: number | null) => Record<string, unknown> }[] = [
      { fn: 'board_project_rename', table: 'projects', id: p.id, by: owner, args: (v) => ({ p_project: p.id, p_version: v, p_name: 'اسم جديد' }) },
      { fn: 'board_column_update', table: 'columns', id: p.todo.id, by: owner, args: (v) => ({ p_column: p.todo.id, p_version: v, p_changes: { name: 'اسم' } }) },
      { fn: 'board_column_move', table: 'columns', id: p.doing.id, by: owner, args: (v) => ({ p_column: p.doing.id, p_version: v, p_position: 1 }) },
      { fn: 'board_label_update', table: 'labels', id: label.id, by: owner, args: (v) => ({ p_label: label.id, p_version: v, p_changes: { name: 'وسم آخر' } }) },
      { fn: 'board_card_update', table: 'cards', id: card.id, by: member, args: (v) => ({ p_card: card.id, p_version: v, p_changes: { title: 'عنوان آخر' } }) },
      { fn: 'board_card_move', table: 'cards', id: card.id, by: member, args: (v) => ({ p_card: card.id, p_version: v, p_column: p.doing.id, p_position: 1 }) },
      { fn: 'board_card_archive', table: 'cards', id: card.id, by: member, args: (v) => ({ p_card: card.id, p_version: v }) },
      { fn: 'board_label_delete', table: 'labels', id: label.id, by: owner, args: (v) => ({ p_label: label.id, p_version: v }) },
      { fn: 'board_column_delete', table: 'columns', id: spareColumn.id, by: owner, args: (v) => ({ p_column: spareColumn.id, p_version: v }) },
    ]
    for (const c of cases) {
      const current = await versionOf(c.table, c.id)
      const logged = (await activity(p.id)).length
      for (const wrong of [current - 1, 0, current + 1, null]) {
        expect(await refusal(c.by.db, c.fn, c.args(wrong)), `${c.fn} with ${wrong}`).toEqual(R('STALE'))
      }
      expect(await versionOf(c.table, c.id), `${c.fn}: the row is as it was`).toBe(current)
      expect((await activity(p.id)).length, `${c.fn}: nothing logged`).toBe(logged)
      await call(c.by.db, c.fn, c.args(current))
      if (c.fn.endsWith('_delete')) expect(await rows(`select 1 from board.${c.table} where id = $1`, [c.id]), c.fn).toHaveLength(0)
      else expect(await versionOf(c.table, c.id), `${c.fn}: bumped`).toBe(current + 1)
      expect((await activity(p.id)).length, `${c.fn}: one row`).toBe(logged + 1)
    }
  })

  it('a project: archive and delete take its version too, and creates, restores and person changes take none', async () => {
    const p = await makeProject()
    const stale = (fn: Fn, v: number | null) => refusal(owner.db, fn, { p_project: p.id, p_version: v })
    for (const wrong of [0, p.version + 1, null]) expect(await stale('board_project_archive', wrong), String(wrong)).toEqual(R('STALE'))
    expect(await versionOf('projects', p.id)).toBe(p.version)
    const archived = await call(owner.db, 'board_project_archive', { p_project: p.id, p_version: p.version })
    expect(archived.version).toBe(p.version + 1)
    for (const wrong of [p.version, 0, null]) expect(await stale('board_project_delete', wrong), String(wrong)).toEqual(R('STALE'))
    expect(await rows('select 1 from board.projects where id = $1', [p.id])).toHaveLength(1)
    await call(owner.db, 'board_project_delete', { p_project: p.id, p_version: archived.version })
    expect(await rows('select 1 from board.projects where id = $1', [p.id])).toHaveLength(0)
    // The signatures of the writes that take no version have none (the contract's rule).
    for (const fn of ['board_card_create', 'board_card_restore', 'board_project_create', 'board_project_restore', 'board_person_set', 'board_person_remove', 'board_column_create', 'board_label_create'] as const) {
      expect((FN[fn] as readonly (readonly [string, string])[]).some(([name]) => name === 'p_version'), fn).toBe(false)
    }
  })

  it('a move checks the moved card\'s version only, and the cards it passes change their position, not their version', async () => {
    const p = await makeProject()
    const [a, b, c] = [await newCard(p, p.todo, 'أ'), await newCard(p, p.todo, 'ب'), await newCard(p, p.todo, 'ج')]
    const before = await rows('select id, version, position from board.cards where project_id = $1', [p.id])
    // `c` goes first; `a` and `b` are passed, and their (older) versions are not looked at.
    await call(owner.db, 'board_card_move', { p_card: c!.id, p_version: c!.version, p_column: p.todo.id, p_position: 1 })
    const after = Object.fromEntries((await rows('select id, version, position from board.cards where project_id = $1', [p.id])).map((r) => [r.id, r]))
    expect(after[c!.id]).toMatchObject({ version: c!.version + 1, position: 1 })
    expect(after[a!.id]).toMatchObject({ version: before.find((r) => r.id === a!.id)!.version, position: 2 })
    expect(after[b!.id]).toMatchObject({ version: before.find((r) => r.id === b!.id)!.version, position: 3 })
    // The passed card's version is still good for its own write.
    await call(owner.db, 'board_card_update', { p_card: a!.id, p_version: a!.version, p_changes: { title: 'أ2' } })
  })
})

// --- the activity ---------------------------------------------------------------------------------------------------------

describe('the activity: one row per write, names only', () => {
  it('every write that changes something logs exactly one row (who, what, which fields), and one that changes nothing logs none', async () => {
    const created = await call(owner.db, 'board_project_create', { p_name: 'سري-اسم-المشروع' })
    const P = created.id as string
    mine.push(P)
    type Want = Partial<{ action: string; fields: string[]; subject: string | null; role: string | null; card_id: string | null; from_column: string | null; to_column: string | null; actor: string }>
    let seen = 0
    const step = async <T,>(label: string, run: () => Promise<T>, ...want: Want[]): Promise<T> => {
      const out = await run()
      const now = await activity(P)
      expect(now.length - seen, `${label}: rows`).toBe(want.length)
      want.forEach((w, i) => expect(now[seen + i], label).toMatchObject(w))
      seen = now.length
      return out
    }
    await step('the project is created', async () => undefined, { action: 'project_created', fields: [], actor: owner.userId, subject: null, card_id: null })
    let project = created
    project = await step('rename', () => call(owner.db, 'board_project_rename', { p_project: P, p_version: project.version, p_name: 'سري-اسم-جديد' }), { action: 'project_renamed', fields: ['name'], actor: owner.userId })
    await step('rename to the same name', () => call(owner.db, 'board_project_rename', { p_project: P, p_version: project.version, p_name: 'سري-اسم-جديد' }))

    let c1 = await step('column 1', () => call(owner.db, 'board_column_create', { p_project: P, p_name: 'سري-عمود-1' }), { action: 'column_created' })
    expect((await activity(P)).at(-1)).toMatchObject({ to_column: c1.id, from_column: null, role: null })
    const c2 = await step('column 2', () => call(owner.db, 'board_column_create', { p_project: P, p_name: 'سري-عمود-2' }), { action: 'column_created' })
    expect((await activity(P)).at(-1)).toMatchObject({ to_column: c2.id })
    let c3 = await step('column 3', () => call(owner.db, 'board_column_create', { p_project: P, p_name: 'سري-عمود-3' }), { action: 'column_created' })
    expect((await activity(P)).at(-1)).toMatchObject({ to_column: c3.id })
    c1 = await step('column renamed and hidden', () => call(owner.db, 'board_column_update', { p_column: c1.id, p_version: c1.version, p_changes: { name: 'سري-عمود-أول', hidden: true } }), { action: 'column_changed', fields: ['name', 'hidden'], to_column: c1.id })
    c3 = await step('column marked done', () => call(owner.db, 'board_column_update', { p_column: c3.id, p_version: c3.version, p_changes: { isDone: true } }), { action: 'column_changed', fields: ['done'], to_column: c3.id })
    await step('column update with the same values', () => call(owner.db, 'board_column_update', { p_column: c3.id, p_version: c3.version, p_changes: { isDone: true, name: 'سري-عمود-3' } }))
    c3 = await step('column moved', () => call(owner.db, 'board_column_move', { p_column: c3.id, p_version: c3.version, p_position: 1 }), { action: 'column_moved', to_column: c3.id })
    await step('column moved to where it is', () => call(owner.db, 'board_column_move', { p_column: c3.id, p_version: c3.version, p_position: 1 }))

    let label = await step('label', () => call(owner.db, 'board_label_create', { p_project: P, p_name: 'سري-وسم', p_tone: 'coral' }), { action: 'label_created' })
    label = await step('label changed', () => call(owner.db, 'board_label_update', { p_label: label.id, p_version: label.version, p_changes: { tone: 'sand', name: 'سري-وسم-2' } }), { action: 'label_changed', fields: ['name', 'tone'] })
    await step('label changed to what it is', () => call(owner.db, 'board_label_update', { p_label: label.id, p_version: label.version, p_changes: { tone: 'sand' } }))

    const setPerson = (role: string) => call(owner.db, 'board_person_set', { p_project: P, p_user: member.userId, p_role: role })
    await step('person added', () => setPerson('member'), { action: 'person_added', subject: member.userId, actor: owner.userId, role: 'member' })
    await step('the same role again', () => setPerson('member'))
    await step('role changed', () => setPerson('viewer'), { action: 'person_role_changed', subject: member.userId, role: 'viewer' })
    await step('role changed back', () => setPerson('member'), { action: 'person_role_changed', subject: member.userId, role: 'member' })

    let card = await step('card created', () => call(member.db, 'board_card_create', { p_column: c1.id, p_title: 'سري-عنوان' }), { action: 'card_created', actor: member.userId })
    expect((await activity(P)).at(-1)).toMatchObject({ card_id: card.id, subject: null, fields: [] })
    const due = await day(3)
    card = await step(
      'card edited: every field',
      () =>
        call(member.db, 'board_card_update', {
          p_card: card.id,
          p_version: card.version,
          // The keys in any order: the row lists the fields in the contract's order.
          p_changes: {
            link: { collection: 'rooms', docId: 'book' },
            checklist: [{ id: null, text: 'سري-بند', done: false }],
            people: [member.userId],
            labels: [label.id],
            dueOn: due,
            priority: 'urgent',
            notes: 'سري-ملاحظات',
            title: 'سري-عنوان-2',
          },
        }),
      { action: 'card_edited', fields: ['title', 'notes', 'priority', 'due_on', 'labels', 'people', 'checklist', 'link'], card_id: card.id },
    )
    card = await step('card edited: two fields', () => call(member.db, 'board_card_update', { p_card: card.id, p_version: card.version, p_changes: { notes: 'سري-ملاحظات-2', dueOn: null } }), { action: 'card_edited', fields: ['notes', 'due_on'] })
    await step('card edited to what it is', () => call(member.db, 'board_card_update', { p_card: card.id, p_version: card.version, p_changes: { notes: 'سري-ملاحظات-2', title: 'سري-عنوان-2', labels: [label.id], people: [member.userId] } }))
    await step('card edited with nothing', () => call(member.db, 'board_card_update', { p_card: card.id, p_version: card.version, p_changes: {} }))
    const moved = await step('card moved', () => call(member.db, 'board_card_move', { p_card: card.id, p_version: card.version, p_column: c2.id, p_position: 1 }), { action: 'card_moved', from_column: c1.id, to_column: c2.id, card_id: card.id })
    card = moved.card
    await step('card moved to where it is', () => call(member.db, 'board_card_move', { p_card: card.id, p_version: card.version, p_column: c2.id, p_position: 1 }))
    card = await step('card archived', () => call(member.db, 'board_card_archive', { p_card: card.id, p_version: card.version }), { action: 'card_archived', card_id: card.id })
    await step('card archived again', () => call(member.db, 'board_card_archive', { p_card: card.id, p_version: card.version }))
    card = await step('card restored', () => call(member.db, 'board_card_restore', { p_card: card.id }), { action: 'card_restored', card_id: card.id })
    await step('card restored again', () => call(member.db, 'board_card_restore', { p_card: card.id }))

    await step('label deleted', () => call(owner.db, 'board_label_delete', { p_label: label.id, p_version: label.version }), { action: 'label_deleted' })
    await step('column deleted', () => call(owner.db, 'board_column_delete', { p_column: c1.id, p_version: c1.version }), { action: 'column_deleted' })
    await step('person removed', () => call(owner.db, 'board_person_remove', { p_project: P, p_user: member.userId }), { action: 'person_removed', subject: member.userId, role: null })
    await step('a person who is not on the project removed', () => call(owner.db, 'board_person_remove', { p_project: P, p_user: member.userId }))

    // No title, note or checklist text, no name of anything, anywhere in the log: not in any column of any row.
    const everything = JSON.stringify(await rows('select to_jsonb(a) as r from board.activity a where a.project_id = $1', [P]))
    for (const secret of ['سري', 'سري-عنوان', 'سري-ملاحظات', 'سري-بند', 'سري-وسم', 'سري-عمود', 'سري-اسم']) expect(everything, secret).not.toContain(secret)
    const vocabulary = new Set(['title', 'notes', 'priority', 'due_on', 'labels', 'people', 'checklist', 'link', 'name', 'hidden', 'done', 'tone'])
    for (const row of await activity(P)) for (const field of row.fields) expect(vocabulary.has(field), field).toBe(true)
    // The owner's reply carries the card's title now, never a note, a checklist item or the name of a label.
    const log = await call(owner.db, 'board_activity', { p_project: P })
    const reply = JSON.stringify(log)
    for (const secret of ['سري-ملاحظات', 'سري-بند', 'سري-وسم']) expect(reply, secret).not.toContain(secret)
    // What the sentences name: the column of a column row (read now; a deleted one is null), and the role a person row gave
    // then, not the person's role today.
    expect(log.filter((r: Any) => r.action === 'column_created').map((r: Any) => r.to)).toEqual(['سري-عمود-3', 'سري-عمود-2', null])
    expect(log.filter((r: Any) => r.action === 'column_moved').map((r: Any) => r.to)).toEqual(['سري-عمود-3'])
    expect(log.find((r: Any) => r.action === 'person_added')).toMatchObject({ subject: { id: member.userId, name: member.name }, role: 'member' })
    expect(log.filter((r: Any) => r.action === 'person_role_changed').map((r: Any) => r.role)).toEqual(['member', 'viewer'])

    // The delete: the audit event is the one record (the project's id, no name), and the log goes with the project.
    const current = (await call(owner.db, 'board_project', { p_project: P })).project.version
    project = await step('project archived', () => call(owner.db, 'board_project_archive', { p_project: P, p_version: current }), { action: 'project_archived' })
    await step('project archived again', () => call(owner.db, 'board_project_archive', { p_project: P, p_version: project.version }))
    project = await step('project restored', () => call(owner.db, 'board_project_restore', { p_project: P }), { action: 'project_restored' })
    await step('project restored again', () => call(owner.db, 'board_project_restore', { p_project: P }))
    project = await call(owner.db, 'board_project_archive', { p_project: P, p_version: project.version })
    const events = await rows("select actor, action, entity, entity_id, summary from public.audit_events where action = 'board.project_deleted' and entity_id = $1", [P])
    expect(events).toHaveLength(0)
    await call(owner.db, 'board_project_delete', { p_project: P, p_version: project.version })
    expect(await rows('select 1 from board.activity where project_id = $1', [P])).toHaveLength(0)
    const recorded = await rows("select actor, action, entity, entity_id, summary from public.audit_events where action = 'board.project_deleted' and entity_id = $1", [P])
    expect(recorded).toEqual([{ actor: owner.userId, action: 'board.project_deleted', entity: 'board', entity_id: P, summary: {} }])
    expect(JSON.stringify(recorded)).not.toContain('سري')
  })
})

// --- moving cards ---------------------------------------------------------------------------------------------------------

describe('moving cards: positions stay dense, a position is clamped, only the moved card is versioned', () => {
  const dense = async (project: string) => {
    for (const r of await rows(
      "select column_id, count(*)::int as n, min(position) as lo, max(position) as hi, count(distinct position)::int as d from board.cards where project_id = $1 and archived_at is null group by column_id",
      [project],
    )) {
      expect({ n: r.n, lo: r.lo, hi: r.hi, d: r.d }, r.column_id).toEqual({ n: r.n, lo: 1, hi: r.n, d: r.n })
    }
    expect(await rows('select 1 from board.cards where project_id = $1 and archived_at is not null and position is not null', [project])).toHaveLength(0)
  }

  it('within a column, across columns, to the ends and past them', async () => {
    const p = await makeProject()
    const [a, b, c, d] = [await newCard(p, p.todo, 'أ'), await newCard(p, p.todo, 'ب'), await newCard(p, p.todo, 'ج'), await newCard(p, p.todo, 'د')] as Any[]
    const ids = (column: Any) => layout(owner.db, p.id).then((l) => l[column.id])
    const move = (card: Any, column: Any, position: number) => call(owner.db, 'board_card_move', { p_card: card.id, p_version: card.version, p_column: column.id, p_position: position })
    const fresh = (id: string) => one('select id, version from board.cards where id = $1', [id])

    const first = await move(d, p.todo, 1)
    expect(await ids(p.todo)).toEqual([d.id, a.id, b.id, c.id])
    expect(first.columns).toEqual([{ id: p.todo.id, cards: [d, a, b, c].map((x, i) => ({ id: x.id, position: i + 1 })) }])
    expect(first.card).toMatchObject({ id: d.id, position: 1, columnId: p.todo.id, version: d.version + 1 })

    await move(await fresh(a.id), p.todo, 99)
    expect(await ids(p.todo)).toEqual([d.id, b.id, c.id, a.id])
    await move(await fresh(b.id), p.todo, 0)
    expect(await ids(p.todo)).toEqual([b.id, d.id, c.id, a.id])
    await move(await fresh(a.id), p.todo, -5)
    expect(await ids(p.todo)).toEqual([a.id, b.id, d.id, c.id])
    await move(await fresh(a.id), p.todo, 3)
    expect(await ids(p.todo)).toEqual([b.id, d.id, a.id, c.id])
    await dense(p.id)

    // Across: the gap closes behind, the column that receives it makes room.
    const across = await move(await fresh(d.id), p.doing, 1)
    expect(await ids(p.todo)).toEqual([b.id, a.id, c.id])
    expect(await ids(p.doing)).toEqual([d.id])
    expect(across.columns.map((x: Any) => x.id)).toEqual([p.todo.id, p.doing.id])
    expect(across.columns[0].cards.map((x: Any) => x.id)).toEqual([b.id, a.id, c.id])
    expect(across.card).toMatchObject({ id: d.id, columnId: p.doing.id, position: 1 })
    await move(await fresh(c.id), p.doing, 9)
    expect(await ids(p.doing)).toEqual([d.id, c.id])
    await move(await fresh(b.id), p.doing, 2)
    expect(await ids(p.doing)).toEqual([d.id, b.id, c.id])
    expect(await ids(p.todo)).toEqual([a.id])
    await dense(p.id)

    // Where it already is: nothing changes, no version, no row.
    const stay = await fresh(b.id)
    const logged = (await activity(p.id)).length
    const same = await move(stay, p.doing, 2)
    expect(same.card.version).toBe(stay.version)
    expect((await activity(p.id)).length).toBe(logged)
  })

  it('refuses a missing position, a column of another project, an archived card and a column that is not there', async () => {
    const p = await makeProject()
    const q = await makeProject('آخر')
    const card = await newCard(p, p.todo, 'بطاقة')
    expect(await refusal(owner.db, 'board_card_move', { p_card: card.id, p_version: card.version, p_column: p.doing.id, p_position: null })).toEqual(R('INVALID', 'position'))
    expect(await refusal(owner.db, 'board_card_move', { p_card: card.id, p_version: card.version, p_column: q.todo.id, p_position: 1 })).toEqual(R('NOT_FOUND'))
    expect(await refusal(owner.db, 'board_card_move', { p_card: card.id, p_version: card.version, p_column: randomUUID(), p_position: 1 })).toEqual(R('NOT_FOUND'))
    const archived = await archive(owner, card)
    expect(await refusal(owner.db, 'board_card_move', { p_card: card.id, p_version: archived.version, p_column: p.doing.id, p_position: 1 })).toEqual(R('NOT_FOUND'))
    expect(await refusal(owner.db, 'board_card_update', { p_card: card.id, p_version: archived.version, p_changes: { title: 'x' } })).toEqual(R('NOT_FOUND'))
    await dense(p.id)
  })

  it('archive closes the gap and restore goes last: the positions stay dense', async () => {
    const p = await makeProject()
    const [a, b, c] = [await newCard(p, p.todo, 'أ'), await newCard(p, p.todo, 'ب'), await newCard(p, p.todo, 'ج')] as Any[]
    const archived = await archive(owner, b)
    expect(archived).toMatchObject({ id: b.id, position: null, version: b.version + 1, columnId: p.todo.id })
    expect((await layout(owner.db, p.id))[p.todo.id]).toEqual([a.id, c.id])
    expect(await rows('select position from board.cards where id = $1', [c.id])).toEqual([{ position: 2 }])
    const restored = await call(owner.db, 'board_card_restore', { p_card: b.id })
    expect(restored).toMatchObject({ id: b.id, position: 3, columnId: p.todo.id, version: archived.version + 1 })
    expect((await layout(owner.db, p.id))[p.todo.id]).toEqual([a.id, c.id, b.id])
    await dense(p.id)
  })
})

// --- editing a card -------------------------------------------------------------------------------------------------------

describe('editing a card: only the keys sent change, each is checked, and a bad one changes nothing', () => {
  it('refuses what is not valid, under the field, and leaves the card as it was', async () => {
    const p = await makeProject()
    const q = await makeProject('آخر')
    await addMember(p, member)
    await addMember(p, viewer, 'viewer')
    await addMember(q, member)
    const otherLabel = await call(owner.db, 'board_label_create', { p_project: q.id, p_name: 'وسم آخر', p_tone: 'aub' })
    const foreign = await edit(owner, await newCard(q, q.todo, 'غريبة'), { checklist: [{ id: null, text: 'بند غريب', done: false }] })
    const card = await edit(owner, await newCard(p, p.todo, 'بطاقة'), { checklist: [{ id: null, text: 'بند', done: false }] })
    const here = card.checklist[0].id as string
    const bad: [string, Record<string, unknown> | string | null | unknown[], Refusal][] = [
      ['a string', '"changes"', R('INVALID')],
      ['an array', [], R('INVALID')],
      ['a null', null, R('INVALID')],
      ['an unknown key', { colour: 'red' }, R('INVALID')],
      ['a null title', { title: null }, R('INVALID', 'title')],
      ['a number title', { title: 5 }, R('INVALID', 'title')],
      ['a null note', { notes: null }, R('INVALID', 'notes')],
      ['a number note', { notes: 5 }, R('INVALID', 'notes')],
      ['an unknown priority', { priority: 'high' }, R('INVALID')],
      ['a null priority', { priority: null }, R('INVALID')],
      ['a date in words', { dueOn: 'tomorrow' }, R('INVALID', 'due_on')],
      ['a day that is not', { dueOn: '2026-02-30' }, R('INVALID', 'due_on')],
      ['a month 13', { dueOn: '2026-13-01' }, R('INVALID', 'due_on')],
      ['a day with a time', { dueOn: '2026-10-16T10:00:00Z' }, R('INVALID', 'due_on')],
      ['a day in Arabic digits', { dueOn: '٢٠٢٦-١٠-١٦' }, R('INVALID', 'due_on')],
      ['a number day', { dueOn: 20261016 }, R('INVALID', 'due_on')],
      ['labels that are no array', { labels: 'x' }, R('INVALID', 'labels')],
      ['labels that are null', { labels: null }, R('INVALID', 'labels')],
      ['labels that are no uuid', { labels: ['x'] }, R('INVALID', 'labels')],
      ['a label of another project', { labels: [otherLabel.id] }, R('INVALID', 'labels')],
      ['a label that is not there', { labels: [randomUUID()] }, R('INVALID', 'labels')],
      ['people that are no array', { people: {} }, R('INVALID', 'people')],
      ['a person who is a viewer', { people: [viewer.userId] }, R('INVALID', 'people')],
      ['a person who is not on the project', { people: [boardOut.userId] }, R('INVALID', 'people')],
      ['a person who is no uuid', { people: ['nope'] }, R('INVALID', 'people')],
      ['a checklist that is no array', { checklist: {} }, R('INVALID', 'checklist')],
      ['a checklist item that is no object', { checklist: ['x'] }, R('INVALID', 'checklist')],
      ['a checklist item without text', { checklist: [{ id: null, done: false }] }, R('INVALID', 'checklist')],
      ['a checklist item with blank text', { checklist: [{ id: null, text: '   ', done: false }] }, R('INVALID', 'checklist')],
      ['a checklist item with too long a text', { checklist: [{ id: null, text: 'ب'.repeat(201), done: false }] }, R('INVALID', 'checklist')],
      ['a checklist item with a control character', { checklist: [{ id: null, text: 'أ\u0007ب', done: false }] }, R('INVALID', 'checklist')],
      ['a checklist item without done', { checklist: [{ id: null, text: 'x' }] }, R('INVALID', 'checklist')],
      ['a checklist item with a key of its own', { checklist: [{ id: null, text: 'x', done: false, extra: 1 }] }, R('INVALID', 'checklist')],
      ['a checklist item that is not the card\'s', { checklist: [{ id: randomUUID(), text: 'x', done: false }] }, R('INVALID', 'checklist')],
      ['a checklist item of another card', { checklist: [{ id: foreign.checklist[0].id, text: 'x', done: false }] }, R('INVALID', 'checklist')],
      ['a checklist item twice', { checklist: [{ id: here, text: 'x', done: false }, { id: here, text: 'y', done: false }] }, R('INVALID', 'checklist')],
      ['a link that is no object', { link: 'x' }, R('INVALID', 'link')],
      ['a link without a document', { link: { collection: 'posts' } }, R('INVALID', 'link')],
      ['a link to a collection that is not linkable', { link: { collection: 'taxonomies', docId: 'x' } }, R('INVALID', 'link')],
      ['a link to a bad id', { link: { collection: 'posts', docId: 'Bad Id' } }, R('INVALID', 'link')],
      ['a link with a key of its own', { link: { collection: 'rooms', docId: 'book', extra: 1 } }, R('INVALID', 'link')],
      ['a link to a document that is not there', { link: { collection: 'posts', docId: 'p12-no-such-post' } }, R('INVALID', 'link')],
    ]
    const before = await rows('select * from board.cards where id = $1', [card.id])
    const logged = (await activity(p.id)).length
    for (const [what, changes, want] of bad) {
      expect(await refusal(owner.db, 'board_card_update', { p_card: card.id, p_version: card.version, p_changes: changes }), what).toEqual(want)
    }
    expect(await rows('select * from board.cards where id = $1', [card.id])).toEqual(before)
    expect((await activity(p.id)).length).toBe(logged)
    expect(await rows('select count(*)::int as n from board.checklist where card_id = $1', [card.id])).toEqual([{ n: 1 }])
    // Too many people, too long a checklist: the limits have their own code.
    expect(await refusal(owner.db, 'board_card_update', { p_card: card.id, p_version: card.version, p_changes: { checklist: Array.from({ length: 51 }, () => ({ id: null, text: 'x', done: false })) } })).toEqual(R('LIMIT', 'checklist'))
  })

  it('changes only what is sent, replaces labels, people and the checklist whole, and keeps what it is told to keep', async () => {
    const p = await makeProject()
    await addMember(p, member)
    const [l1, l2] = [
      await call(owner.db, 'board_label_create', { p_project: p.id, p_name: 'أول', p_tone: 'coral' }),
      await call(owner.db, 'board_label_create', { p_project: p.id, p_name: 'ثانٍ', p_tone: 'sand' }),
    ]
    let card = await newCard(p, p.todo, 'بطاقة')
    card = await edit(owner, card, { notes: 'ملاحظات', priority: 'low', dueOn: '2030-05-06' })
    expect(card).toMatchObject({ title: 'بطاقة', notes: 'ملاحظات', priority: 'low', dueOn: '2030-05-06', version: 2 })
    // Only the title: the rest stays.
    card = await edit(owner, card, { title: '  عنوان جديد  ' })
    expect(card).toMatchObject({ title: 'عنوان جديد', notes: 'ملاحظات', priority: 'low', dueOn: '2030-05-06' })
    // Clearing the day, and the notes.
    card = await edit(owner, card, { dueOn: null, notes: '' })
    expect(card).toMatchObject({ dueOn: null, notes: '' })

    card = await edit(owner, card, { labels: [l2.id, l1.id, l1.id] })
    expect(card.labels).toEqual([l1.id, l2.id])
    card = await edit(owner, card, { labels: [l2.id] })
    expect(card.labels).toEqual([l2.id])
    card = await edit(owner, card, { labels: [] })
    expect(card.labels).toEqual([])
    card = await edit(owner, card, { people: [member.userId, owner.userId, member.userId] })
    expect([...card.people].sort()).toEqual([member.userId, owner.userId].sort())
    card = await edit(owner, card, { people: [owner.userId] })
    expect(card.people).toEqual([owner.userId])

    // The checklist is replaced whole, in order: ids are kept, a missing item goes, a new one gets an id.
    card = await edit(owner, card, { checklist: [{ id: null, text: 'أول', done: false }, { id: null, text: 'ثانٍ', done: true }, { id: null, text: 'ثالث', done: false }] })
    const [i1, i2, i3] = card.checklist as Any[]
    expect(card.checklist.map((i: Any) => i.text)).toEqual(['أول', 'ثانٍ', 'ثالث'])
    card = await edit(owner, card, { checklist: [{ id: i3.id, text: 'ثالث', done: false }, { id: i1.id, text: 'أول معدّل', done: true }, { id: null, text: 'جديد', done: false }] })
    expect(card.checklist.map((i: Any) => [i.text, i.done])).toEqual([['ثالث', false], ['أول معدّل', true], ['جديد', false]])
    expect(card.checklist[0].id).toBe(i3.id)
    expect(card.checklist[1].id).toBe(i1.id)
    expect(card.checklist.map((i: Any) => i.id)).not.toContain(i2.id)
    expect(await rows('select count(*)::int as n from board.checklist where card_id = $1', [card.id])).toEqual([{ n: 3 }])
    // The same list again changes nothing: no version.
    const same = await edit(owner, card, { checklist: card.checklist.map((i: Any) => ({ id: i.id, text: i.text, done: i.done })) })
    expect(same.version).toBe(card.version)
    card = await edit(owner, card, { checklist: [] })
    expect(card.checklist).toEqual([])
    // Fifty items are allowed.
    card = await edit(owner, card, { checklist: Array.from({ length: 50 }, (_, i) => ({ id: null, text: `بند ${i + 1}`, done: i % 2 === 0 })) })
    expect(card.checklist).toHaveLength(50)
    expect(card.checklist[49].text).toBe('بند 50')
    // And nothing at all, or what it already is, is no change.
    expect((await edit(owner, card, {})).version).toBe(card.version)
    expect((await edit(owner, card, { title: card.title, priority: card.priority, labels: card.labels })).version).toBe(card.version)
  })
})

// --- columns and labels ---------------------------------------------------------------------------------------------------

describe('columns', () => {
  it('are created last, renamed, hidden and marked done by the owner alone; a bad change is refused under its field', async () => {
    const project = await call(owner.db, 'board_project_create', { p_name: 'أعمدة' })
    mine.push(project.id)
    const add = (n: string) => call(owner.db, 'board_column_create', { p_project: project.id, p_name: n })
    const [a, b, c] = [await add('أ'), await add('ب'), await add('ج')]
    expect([a, b, c].map((x) => [x.name, x.position, x.hidden, x.isDone, x.version])).toEqual([['أ', 1, false, false, 1], ['ب', 2, false, false, 1], ['ج', 3, false, false, 1]])
    const upd = (col: Any, changes: unknown) => call(owner.db, 'board_column_update', { p_column: col.id, p_version: col.version, p_changes: changes })
    const named = await upd(a, { name: '  اسم جديد ' })
    expect(named).toMatchObject({ name: 'اسم جديد', hidden: false, isDone: false, version: 2 })
    expect(await upd(named, { hidden: true })).toMatchObject({ hidden: true, version: 3 })
    for (const [what, changes, want] of [
      ['a null name', { name: null }, R('INVALID', 'name')],
      ['a blank name', { name: '  ' }, R('INVALID', 'name')],
      ['a name of 41 letters', { name: 'ب'.repeat(41) }, R('INVALID', 'name')],
      ['a hidden that is no boolean', { hidden: 'yes' }, R('INVALID')],
      ['an isDone that is no boolean', { isDone: 1 }, R('INVALID')],
      ['an unknown key', { position: 1 }, R('INVALID')],
      ['no object', [], R('INVALID')],
    ] as [string, unknown, Refusal][]) {
      expect(await refusal(owner.db, 'board_column_update', { p_column: a.id, p_version: 3, p_changes: changes }), what).toEqual(want)
    }
    expect((await upd({ id: a.id, version: 3 }, {})).version).toBe(3)
    expect(await refusal(owner.db, 'board_column_create', { p_project: project.id, p_name: '' })).toEqual(R('INVALID', 'name'))
    expect(await one('select count(*)::int as n from board.columns where project_id = $1', [project.id])).toEqual({ n: 3 })
  })

  it('move: clamped to 1..n, the columns they pass change position only, not version', async () => {
    const p = await makeProject()
    const state = async () => (await call(owner.db, 'board_project', { p_project: p.id })).columns.map((c: Any) => [c.name, c.position, c.version])
    expect(await state()).toEqual([['للعمل', 1, 1], ['قيد التنفيذ', 2, 1], ['تم', 3, 2]])
    const moved = await call(owner.db, 'board_column_move', { p_column: p.done.id, p_version: p.done.version, p_position: 0 })
    expect(moved).toMatchObject({ name: 'تم', position: 1, version: 3, isDone: true })
    expect(await state()).toEqual([['تم', 1, 3], ['للعمل', 2, 1], ['قيد التنفيذ', 3, 1]])
    await call(owner.db, 'board_column_move', { p_column: p.todo.id, p_version: 1, p_position: 99 })
    expect(await state()).toEqual([['تم', 1, 3], ['قيد التنفيذ', 2, 1], ['للعمل', 3, 2]])
    expect(await refusal(owner.db, 'board_column_move', { p_column: p.todo.id, p_version: 2, p_position: null })).toEqual(R('INVALID', 'position'))
  })

  it('the done mark moves: the cards of the column that loses it are no longer done, those of the one that gets it are done now', async () => {
    const p = await makeProject()
    const inDone = await newCard(p, p.done, 'منجزة')
    expect(inDone.doneAt).not.toBeNull()
    const inDoing = await newCard(p, p.doing, 'قيد العمل')
    const inTodo = await newCard(p, p.todo, 'للعمل')
    expect([inDoing.doneAt, inTodo.doneAt]).toEqual([null, null])
    const marked = await call(owner.db, 'board_column_update', { p_column: p.doing.id, p_version: p.doing.version, p_changes: { isDone: true } })
    expect(marked.isDone).toBe(true)
    const cards = Object.fromEntries((await call(owner.db, 'board_project', { p_project: p.id })).cards.map((c: Any) => [c.id, c.doneAt]))
    expect(cards[inDone.id]).toBeNull()
    expect(cards[inDoing.id]).not.toBeNull()
    expect(cards[inTodo.id]).toBeNull()
    const columns = Object.fromEntries((await call(owner.db, 'board_project', { p_project: p.id })).columns.map((c: Any) => [c.id, c]))
    expect(columns[p.done.id]).toMatchObject({ isDone: false, version: p.done.version + 1 })
    expect(columns[p.doing.id]).toMatchObject({ isDone: true, version: p.doing.version + 1 })
    expect(await rows('select count(*)::int as n from board.columns where project_id = $1 and is_done', [p.id])).toEqual([{ n: 1 }])
    // The mark taken away: no card is done, and the overview says there is no done column.
    await call(owner.db, 'board_column_update', { p_column: p.doing.id, p_version: marked.version, p_changes: { isDone: false } })
    expect(await rows('select count(*)::int as n from board.cards where project_id = $1 and done_at is not null', [p.id])).toEqual([{ n: 0 }])
    expect((await call(owner.db, 'board_overview', { p_project: p.id })).hasDone).toBe(false)
  })

  it('delete: only a column with no open card; its archived cards go to the first column; the rest close up', async () => {
    const p = await makeProject()
    const open = await newCard(p, p.doing, 'مفتوحة')
    expect(await refusal(owner.db, 'board_column_delete', { p_column: p.doing.id, p_version: p.doing.version })).toEqual(R('NOT_EMPTY'))
    const archived = await archive(owner, open)
    const other = await archive(owner, await newCard(p, p.doing, 'أخرى'))
    const kept = await newCard(p, p.todo, 'باقية')
    const deleted = await call(owner.db, 'board_column_delete', { p_column: p.doing.id, p_version: p.doing.version })
    expect(deleted).toEqual({ id: p.doing.id })
    const columns = (await call(owner.db, 'board_project', { p_project: p.id })).columns
    expect(columns.map((c: Any) => [c.name, c.position])).toEqual([['للعمل', 1], ['تم', 2]])
    // The archived cards are in the first column, still archived and without a position.
    const moved = await rows('select id, column_id, position, archived_at is not null as archived, done_at from board.cards where id = any($1::uuid[]) order by id', [[archived.id, other.id]])
    expect(moved).toHaveLength(2)
    for (const m of moved) expect(m).toMatchObject({ column_id: p.todo.id, position: null, archived: true, done_at: null })
    expect((await layout(owner.db, p.id))[p.todo.id]).toEqual([kept.id])
    // Restored, one lands at the end of the column it was sent to.
    expect(await call(owner.db, 'board_card_restore', { p_card: archived.id })).toMatchObject({ columnId: p.todo.id, position: 2 })

    // The first column, and the done one: archived cards of the done column are no longer done wherever they go.
    const doneOne = await archive(owner, await newCard(p, p.done, 'منجزة مؤرشفة'))
    await call(owner.db, 'board_column_delete', { p_column: p.done.id, p_version: (await call(owner.db, 'board_project', { p_project: p.id })).columns[1].version })
    expect(await rows('select column_id, done_at from board.cards where id = $1', [doneOne.id])).toEqual([{ column_id: p.todo.id, done_at: null }])
    expect((await call(owner.db, 'board_overview', { p_project: p.id })).hasDone).toBe(false)

    // The only column: with archived cards it has nowhere to send them; with nothing in it, it goes.
    const lone = await call(owner.db, 'board_project_create', { p_name: 'وحيد' })
    mine.push(lone.id)
    const only = await call(owner.db, 'board_column_create', { p_project: lone.id, p_name: 'الوحيد' })
    await archive(owner, await call(owner.db, 'board_card_create', { p_column: only.id, p_title: 'x' }))
    expect(await refusal(owner.db, 'board_column_delete', { p_column: only.id, p_version: only.version })).toEqual(R('NOT_EMPTY'))
    const empty = await call(owner.db, 'board_project_create', { p_name: 'فارغ' })
    mine.push(empty.id)
    const nothing = await call(owner.db, 'board_column_create', { p_project: empty.id, p_name: 'لا شيء' })
    expect(await call(owner.db, 'board_column_delete', { p_column: nothing.id, p_version: nothing.version })).toEqual({ id: nothing.id })
  })

  it('delete of the first column: its archived cards go to the column that is first after it', async () => {
    const p = await makeProject()
    const gone = await archive(owner, await newCard(p, p.todo, 'في الأول'))
    await call(owner.db, 'board_column_delete', { p_column: p.todo.id, p_version: p.todo.version })
    expect(await rows('select column_id, position from board.cards where id = $1', [gone.id])).toEqual([{ column_id: p.doing.id, position: null }])
    expect(await call(owner.db, 'board_card_restore', { p_card: gone.id })).toMatchObject({ columnId: p.doing.id, position: 1 })
  })
})

// --- done_at --------------------------------------------------------------------------------------------------------------

describe('done_at: set when a card enters the done column, cleared when it leaves, and when the mark leaves its column', () => {
  const stamp = async (id: string): Promise<Date | null> => (await one('select done_at from board.cards where id = $1', [id])).done_at as Date | null
  const move = (card: Any, column: Any, position = 1): Promise<Any> =>
    call(owner.db, 'board_card_move', { p_card: card.id, p_version: card.version, p_column: column.id, p_position: position })

  it('a create, a move and a restore into the done column set it; a move within the column keeps it; a move out clears it', async () => {
    const p = await makeProject()
    const born = await newCard(p, p.done, 'وُلدت منجزة')
    expect(born.doneAt).not.toBeNull()
    expect(Date.now() - Date.parse(born.doneAt)).toBeLessThan(60_000)
    const card = await newCard(p, p.todo, 'تتحرك')
    expect(card.doneAt).toBeNull()
    const entered = (await move(card, p.done, 1)).card
    expect(entered.doneAt).not.toBeNull()
    const enteredAt = await stamp(entered.id)
    // Past the other card, still in the column: the date stays.
    const within = (await move(entered, p.done, 2)).card
    expect(within.position).toBe(2)
    expect(await stamp(within.id)).toEqual(enteredAt)
    // Archived in the done column the date is kept; restored into it, the card is done now.
    const archived = await archive(owner, within)
    expect(archived.doneAt).toBe(within.doneAt)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const restored = await call(owner.db, 'board_card_restore', { p_card: within.id })
    expect(restored.columnId).toBe(p.done.id)
    expect(Date.parse(restored.doneAt)).toBeGreaterThan(Date.parse(within.doneAt))
    const out = (await move(restored, p.doing, 1)).card
    expect(out.doneAt).toBeNull()
    expect(await stamp(out.id)).toBeNull()
    // The card that was born done is untouched by all of it.
    expect((await call(owner.db, 'board_project', { p_project: p.id })).cards.find((c: Any) => c.id === born.id).doneAt).toBe(born.doneAt)
  })

  it('the mark leaving a column clears the cards in it, archived ones too; a card is done again only by entering a done column', async () => {
    const p = await makeProject()
    const open = await newCard(p, p.done, 'مفتوحة')
    const closed = await archive(owner, await newCard(p, p.done, 'مؤرشفة'))
    expect(closed.doneAt).not.toBeNull()
    await call(owner.db, 'board_column_update', { p_column: p.done.id, p_version: p.done.version, p_changes: { isDone: false } })
    expect(await rows('select done_at from board.cards where id = any($1::uuid[]) order by title', [[open.id, closed.id]])).toEqual([{ done_at: null }, { done_at: null }])
    // Restored into a column that is not done any more: not done.
    expect((await call(owner.db, 'board_card_restore', { p_card: closed.id })).doneAt).toBeNull()
    // The mark put on another column: its open cards are done now; an archived one there is done only once restored.
    const elsewhere = await newCard(p, p.todo, 'في العمل')
    const archivedThere = await archive(owner, await newCard(p, p.todo, 'مؤرشفة في العمل'))
    await call(owner.db, 'board_column_update', { p_column: p.todo.id, p_version: p.todo.version, p_changes: { isDone: true } })
    expect((await call(owner.db, 'board_project', { p_project: p.id })).cards.find((c: Any) => c.id === elsewhere.id).doneAt).not.toBeNull()
    expect(await stamp(archivedThere.id)).toBeNull()
    expect((await call(owner.db, 'board_card_restore', { p_card: archivedThere.id })).doneAt).not.toBeNull()
  })
})

describe('labels', () => {
  it('are created with one of the four tones, unique by name per project (case folded), renamed, recoloured and deleted off the cards', async () => {
    const p = await makeProject()
    const label = await call(owner.db, 'board_label_create', { p_project: p.id, p_name: '  Bug  ', p_tone: 'aub' })
    expect(label).toMatchObject({ name: 'Bug', tone: 'aub', version: 1 })
    expect(await refusal(owner.db, 'board_label_create', { p_project: p.id, p_name: 'bUG', p_tone: 'sand' })).toEqual(R('INVALID', 'name'))
    expect(await refusal(owner.db, 'board_label_create', { p_project: p.id, p_name: 'ثانٍ', p_tone: 'purple' })).toEqual(R('INVALID', 'tone'))
    expect(await refusal(owner.db, 'board_label_create', { p_project: p.id, p_name: 'ثانٍ', p_tone: null })).toEqual(R('INVALID', 'tone'))
    expect(await refusal(owner.db, 'board_label_create', { p_project: p.id, p_name: 'ب'.repeat(25), p_tone: 'sand' })).toEqual(R('INVALID', 'name'))
    const second = await call(owner.db, 'board_label_create', { p_project: p.id, p_name: 'ب'.repeat(24), p_tone: 'saffron' })
    expect(second.name).toHaveLength(24)
    // A name may change case, but not become another label's.
    expect(await call(owner.db, 'board_label_update', { p_label: label.id, p_version: 1, p_changes: { name: 'bug' } })).toMatchObject({ name: 'bug', version: 2 })
    expect(await refusal(owner.db, 'board_label_update', { p_label: label.id, p_version: 2, p_changes: { name: second.name.toUpperCase() } })).toEqual(R('INVALID', 'name'))
    expect(await refusal(owner.db, 'board_label_update', { p_label: label.id, p_version: 2, p_changes: { tone: 'green' } })).toEqual(R('INVALID', 'tone'))
    expect(await refusal(owner.db, 'board_label_update', { p_label: label.id, p_version: 2, p_changes: { colour: 'sand' } })).toEqual(R('INVALID'))
    expect((await call(owner.db, 'board_label_update', { p_label: label.id, p_version: 2, p_changes: {} })).version).toBe(2)
    // Deleting a label takes it off the cards; their versions stay.
    const card = await edit(owner, await newCard(p, p.todo, 'موسومة'), { labels: [label.id, second.id] })
    await call(owner.db, 'board_label_delete', { p_label: label.id, p_version: 2 })
    const after = (await call(owner.db, 'board_project', { p_project: p.id })).cards.find((c: Any) => c.id === card.id)
    expect(after.labels).toEqual([second.id])
    expect(after.version).toBe(card.version)
  })
})

// --- cards: create, archive, restore --------------------------------------------------------------------------------------

describe('cards: create, archive, restore', () => {
  it('a card is created last in its column with the defaults; a title is needed', async () => {
    const p = await makeProject()
    await addMember(p, member)
    await addMember(p, viewer, 'viewer')
    const a = await call(member.db, 'board_card_create', { p_column: p.todo.id, p_title: '  أولى  ' })
    const b = await call(owner.db, 'board_card_create', { p_column: p.todo.id, p_title: 'ثانية' })
    expect(a).toMatchObject({ title: 'أولى', position: 1, notes: '', priority: 'normal', dueOn: null, doneAt: null, labels: [], people: [], checklist: [], link: null, version: 1, columnId: p.todo.id })
    expect(b.position).toBe(2)
    expect(await refusal(member.db, 'board_card_create', { p_column: p.todo.id, p_title: '   ' })).toEqual(R('INVALID', 'title'))
    expect(await refusal(viewer.db, 'board_card_create', { p_column: p.todo.id, p_title: 'x' })).toEqual(R('FORBIDDEN'))
    expect(await rows('select created_by from board.cards where id = $1', [a.id])).toEqual([{ created_by: member.userId }])
  })

  it('archive keeps the card off the board and in the archive; restore brings it back last, a second restore changes nothing', async () => {
    const p = await makeProject()
    const card = await newCard(p, p.todo, 'بطاقة')
    const archived = await archive(owner, card)
    expect((await call(owner.db, 'board_project', { p_project: p.id })).cards).toEqual([])
    expect((await call(owner.db, 'board_archived', { p_project: p.id })).map((c: Any) => c.id)).toEqual([card.id])
    // Archiving it again, with the version it has now, is answered as it is.
    const again = await archive(owner, archived)
    expect(again).toMatchObject({ position: null, version: archived.version })
    const restored = await call(owner.db, 'board_card_restore', { p_card: card.id })
    expect(restored).toMatchObject({ position: 1, version: archived.version + 1 })
    const twice = await call(owner.db, 'board_card_restore', { p_card: card.id })
    expect(twice).toEqual(restored)
    expect(await call(owner.db, 'board_archived', { p_project: p.id })).toEqual([])
    expect((await activity(p.id)).filter((r) => r.action === 'card_restored')).toHaveLength(1)
  })
})

// --- the lifecycle of a project -------------------------------------------------------------------------------------------

describe('a project: archive, restore, delete', () => {
  it('an archived project is gone for its people and flagged for owners; restoring brings it back; restoring a live one changes nothing', async () => {
    const p = await makeProject()
    await addMember(p, member)
    await newCard(p, p.todo, 'بطاقة')
    const archived = await call(owner.db, 'board_project_archive', { p_project: p.id, p_version: p.version })
    expect(archived).toMatchObject({ archived: true, version: p.version + 1 })
    expect(await refusal(member.db, 'board_project', { p_project: p.id })).toEqual(R('NOT_FOUND'))
    expect(await call(member.db, 'board_projects')).toEqual([])
    expect((await call(owner.db, 'board_project', { p_project: p.id })).project.archived).toBe(true)
    // An owner still works on it, and the log keeps growing.
    await call(owner.db, 'board_column_create', { p_project: p.id, p_name: 'عمود في مؤرشف' })
    const restored = await call(owner.db, 'board_project_restore', { p_project: p.id })
    expect(restored).toMatchObject({ archived: false, version: archived.version + 1 })
    expect((await call(member.db, 'board_project', { p_project: p.id })).project.id).toBe(p.id)
    const logged = (await activity(p.id)).length
    expect(await call(owner.db, 'board_project_restore', { p_project: p.id })).toEqual(restored)
    expect((await activity(p.id)).length).toBe(logged)
  })

  it('is deleted only once archived, with every row of it; the audit event is the record', async () => {
    const p = await makeProject()
    await addMember(p, member)
    const label = await call(owner.db, 'board_label_create', { p_project: p.id, p_name: 'وسم', p_tone: 'coral' })
    const card = await edit(owner, await newCard(p, p.todo, 'بطاقة'), { labels: [label.id], people: [member.userId], checklist: [{ id: null, text: 'بند', done: false }] })
    await archive(owner, await newCard(p, p.doing, 'مؤرشفة'))
    expect(await refusal(owner.db, 'board_project_delete', { p_project: p.id, p_version: p.version })).toEqual(R('INVALID'))
    const archived = await call(owner.db, 'board_project_archive', { p_project: p.id, p_version: p.version })
    expect(await call(owner.db, 'board_project_delete', { p_project: p.id, p_version: archived.version })).toEqual({ id: p.id })
    for (const table of ['projects', 'columns', 'labels', 'cards', 'members', 'activity']) {
      const column = table === 'projects' ? 'id' : 'project_id'
      expect(await rows(`select 1 from board.${table} where ${column} = $1`, [p.id]), table).toHaveLength(0)
    }
    for (const [table, column] of [['card_labels', 'card_id'], ['card_people', 'card_id'], ['checklist', 'card_id']]) {
      expect(await rows(`select 1 from board.${table} where ${column} = $1`, [card.id]), table).toHaveLength(0)
    }
    expect(await refusal(owner.db, 'board_project', { p_project: p.id })).toEqual(R('NOT_FOUND'))
    expect(await rows("select count(*)::int as n from public.audit_events where action = 'board.project_deleted' and entity_id = $1", [p.id])).toEqual([{ n: 1 }])
  })
})

// --- locks and races ------------------------------------------------------------------------------------------------------

/** Holds a project's row locked from another session until `release`: what makes calls queue behind it, as two writers would. */
async function holdProject(project: string): Promise<{ release: () => Promise<void> }> {
  const holder = await connect()
  await holder.query('begin')
  await holder.query('select id from board.projects where id = $1 for update', [project])
  return {
    release: async () => {
      await holder.query('commit')
    },
  }
}

/** Waits (up to ten seconds) until `count` backends wait for a lock: the queue has formed before the next call arrives, so the order is the test's. */
async function waitForWaiters(count: number): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const { n } = await one("select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()")
    if (n >= count) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`fewer than ${count} backends are waiting for a lock`)
}

/** Waits (up to ten seconds) until a backend is blocked by the session `pid`: that call is queued behind that very lock. */
async function waitBlockedBy(pid: number): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const { n } = await one('select count(*)::int as n from pg_stat_activity where $1::int = any (pg_blocking_pids(pid))', [pid])
    if (n >= 1) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`no backend is blocked by ${pid}`)
}

/** The positions of the open cards of every column of a project are 1..n, once each, and an archived card has none. */
async function assertDense(project: string): Promise<void> {
  for (const r of await rows(
    'select column_id, count(*)::int as n, min(position) as lo, max(position) as hi, count(distinct position)::int as d from board.cards where project_id = $1 and archived_at is null group by column_id',
    [project],
  )) {
    expect({ lo: r.lo, hi: r.hi, d: r.d }, r.column_id).toEqual({ lo: 1, hi: r.n, d: r.n })
  }
  expect(await rows('select 1 from board.cards where project_id = $1 and archived_at is not null and position is not null', [project])).toHaveLength(0)
  const columns = await rows('select count(*)::int as n, min(position) as lo, max(position) as hi, count(distinct position)::int as d from board.columns where project_id = $1', [project])
  expect({ lo: columns[0]!.lo, hi: columns[0]!.hi, d: columns[0]!.d }).toEqual({ lo: columns[0]!.n === 0 ? null : 1, hi: columns[0]!.n === 0 ? null : columns[0]!.n, d: columns[0]!.n })
}

/** A small seeded generator, so a stress run is the same run every time. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('the lock order and the races', () => {
  it('every write locks the project row first: with it held, a write waits and finishes when it is freed; a read does not wait', async () => {
    for (const fn of FUNCTIONS) {
      const c = CASES[fn]
      if (c.kind === 'create' || c.kind === 'any') continue
      const f = await fixture({ archivedProject: c.archivedProject })
      const hold = await holdProject(f.project)
      try {
        const reading = c.kind === 'access' || c.kind === 'ownerRead'
        const pending = call(c.kind === 'member' ? member.db : owner.db, fn, c.args(f))
        pending.catch(() => undefined)
        const first = await settledWithin(pending, reading ? 3000 : 600)
        if (reading) expect(first, `${fn} does not wait for the lock`).not.toBe('blocked')
        else expect(first, `${fn} waits for the project lock`).toBe('blocked')
        await hold.release()
        await expect(pending, fn).resolves.toBeDefined()
      } finally {
        await hold.release().catch(() => undefined)
      }
    }
  })

  it('creates in one column, started together, take one position each: 1 to 4, none twice', async () => {
    const p = await makeProject()
    await addMember(p, member)
    const dbs = [await staffDb(owner.userId), await staffDb(member.userId), await staffDb(owner.userId), await staffDb(member.userId)]
    sessions.push(...dbs)
    const hold = await holdProject(p.id)
    const calls = dbs.map((db, i) => call(db, 'board_card_create', { p_column: p.todo.id, p_title: `متزامنة ${i}` }))
    for (const c of calls) c.catch(() => undefined)
    expect(await settledWithin(Promise.all(calls), 500)).toBe('blocked')
    await hold.release()
    const made = await Promise.all(calls)
    expect(made.map((c) => c.position).sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
    expect(new Set(made.map((c) => c.id)).size).toBe(4)
    await assertDense(p.id)
  })

  it('two column creates with eleven columns: one takes the twelfth, the other is refused with LIMIT columns', async () => {
    const p = await makeProject()
    for (let i = 4; i <= 11; i += 1) await call(owner.db, 'board_column_create', { p_project: p.id, p_name: `عمود ${i}` })
    expect(await one('select count(*)::int as n from board.columns where project_id = $1', [p.id])).toEqual({ n: 11 })
    const dbs = [await staffDb(owner.userId), await staffDb(owner.userId)]
    sessions.push(...dbs)
    const hold = await holdProject(p.id)
    const calls = dbs.map((db, i) => call(db, 'board_column_create', { p_project: p.id, p_name: `متزامن ${i}` }))
    for (const c of calls) c.catch(() => undefined)
    expect(await settledWithin(Promise.all(calls), 500)).toBe('blocked')
    await hold.release()
    const results = await Promise.allSettled(calls)
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect({ code: failed.reason.code, message: failed.reason.message, detail: failed.reason.detail }).toEqual(R('LIMIT', 'columns'))
    expect(await one('select count(*)::int as n from board.columns where project_id = $1', [p.id])).toEqual({ n: 12 })
    await assertDense(p.id)
  })

  it.each(['the removal first', 'the assignment first'])('a removal racing an assignment, %s: the person ends off the project and on no card of it', async (order) => {
    const p = await makeProject()
    await addMember(p, member)
    const target = await person('board', 'مُزال')
    await addMember(p, target)
    const card = await newCard(p, p.todo, 'بطاقة')
    const remover = await staffDb(owner.userId)
    const assigner = await staffDb(member.userId)
    sessions.push(remover, assigner)
    const hold = await holdProject(p.id)
    const remove = () => call(remover, 'board_person_remove', { p_project: p.id, p_user: target.userId })
    const assign = () => call(assigner, 'board_card_update', { p_card: card.id, p_version: card.version, p_changes: { people: [target.userId] } })
    const first = order === 'the removal first' ? remove() : assign()
    first.catch(() => undefined)
    // Let it queue on the lock before the other arrives: the queue is first come, first served.
    await waitForWaiters(1)
    const second = order === 'the removal first' ? assign() : remove()
    second.catch(() => undefined)
    expect(await settledWithin(Promise.all([first, second]), 500)).toBe('blocked')
    await hold.release()
    const [one1, two] = await Promise.allSettled([first, second])
    expect(await rows('select 1 from board.members where project_id = $1 and user_id = $2', [p.id, target.userId])).toHaveLength(0)
    expect(await rows('select 1 from board.card_people cp join board.cards c on c.id = cp.card_id where c.project_id = $1 and cp.user_id = $2', [p.id, target.userId])).toHaveLength(0)
    if (order === 'the removal first') {
      expect(one1!.status).toBe('fulfilled')
      expect(two!.status).toBe('rejected')
      expect({ message: (two as PromiseRejectedResult).reason.message, detail: (two as PromiseRejectedResult).reason.detail }).toEqual({ message: 'INVALID', detail: 'people' })
    } else {
      expect([one1!.status, two!.status]).toEqual(['fulfilled', 'fulfilled'])
    }
  })

  // `board.enter` checks the access again once it holds the project row: what committed while the call waited is seen.
  const LOST: [string, (project: string, user: string) => [string, string[]], string][] = [
    ['removed from the project', (p, u) => ['delete from board.members where project_id = $1 and user_id = $2', [p, u]], 'NOT_FOUND'],
    ['made a viewer', (p, u) => ["update board.members set role = 'viewer' where project_id = $1 and user_id = $2", [p, u]], 'FORBIDDEN'],
    ['deactivated', (_p, u) => ['update public.staff set active = false where user_id = $1', [u]], 'NOT_FOUND'],
    ['shut out by an archive of the project', (p) => ['update board.projects set archived_at = now() where id = $1', [p]], 'NOT_FOUND'],
  ]
  it.each(LOST)('a write queued behind the project lock whose caller is %s meanwhile is refused, and changes nothing', async (_what, lose, code) => {
    const p = await makeProject()
    const waiter = await person('board', 'ينتظر القفل')
    await addMember(p, waiter)
    const card = await newCard(p, p.todo, 'قبل')
    const logged = (await activity(p.id)).length
    const holder = await connect()
    await holder.query('begin')
    await holder.query('select id from board.projects where id = $1 for update', [p.id])
    const pid = (await holder.query('select pg_backend_pid() as pid')).rows[0].pid as number
    const pending = call(waiter.db, 'board_card_update', { p_card: card.id, p_version: card.version, p_changes: { title: 'بعد' } })
    pending.catch(() => undefined)
    // Queued behind the holder (its first access check passed), then what takes the access away commits with the lock's release.
    await waitBlockedBy(pid)
    const [sql, params] = lose(p.id, waiter.userId)
    await holder.query(sql, params)
    await holder.query('commit')
    await expect(pending).rejects.toMatchObject({ code: 'P0001', message: code })
    expect(await one('select title, version from board.cards where id = $1', [card.id])).toEqual({ title: 'قبل', version: card.version })
    expect((await activity(p.id)).length).toBe(logged)
  })

  it('many writers at once on one project: no deadlock, no position twice, nothing lost', async () => {
    const p = await makeProject()
    await addMember(p, member)
    const writers = [owner, member, owner, member, owner, member]
    const dbs = await Promise.all(writers.map((w) => staffDb(w.userId)))
    sessions.push(...dbs)
    const columns = [p.todo, p.doing, p.done]
    for (let i = 0; i < 12; i += 1) await newCard(p, columns[i % 3], `بذرة ${i}`)
    const refused: string[] = []
    await Promise.all(
      dbs.map(async (db, w) => {
        const random = seeded(1000 + w)
        const pick = <T,>(list: T[]): T => list[Math.floor(random() * list.length)]!
        for (let i = 0; i < 25; i += 1) {
          const state = await call(db, 'board_project', { p_project: p.id })
          const archivedCards = await call(db, 'board_archived', { p_project: p.id })
          const open: Any[] = state.cards
          const roll = random()
          try {
            if (roll < 0.35 && open.length > 0) {
              const card = pick(open)
              await call(db, 'board_card_move', { p_card: card.id, p_version: card.version, p_column: pick<Any>(state.columns).id, p_position: 1 + Math.floor(random() * 6) })
            } else if (roll < 0.55) {
              await call(db, 'board_card_create', { p_column: pick<Any>(state.columns).id, p_title: 'جديدة' })
            } else if (roll < 0.75 && open.length > 0) {
              const card = pick(open)
              await call(db, 'board_card_archive', { p_card: card.id, p_version: card.version })
            } else if (archivedCards.length > 0) {
              await call(db, 'board_card_restore', { p_card: pick<Any>(archivedCards).id })
            } else if (open.length > 0) {
              const card = pick(open)
              await call(db, 'board_card_update', { p_card: card.id, p_version: card.version, p_changes: { title: `عنوان ${i}` } })
            }
          } catch (error) {
            refused.push((error as { message: string }).message)
          }
        }
      }),
    )
    // A refusal is a version that moved under the writer: never a deadlock (40P01), a serialization failure or a duplicate position.
    for (const message of refused) expect(['STALE', 'NOT_FOUND']).toContain(message)
    await assertDense(p.id)
    const total = await one('select count(*) filter (where archived_at is null)::int as open, count(*)::int as everything from board.cards where project_id = $1', [p.id])
    expect(total.everything).toBeGreaterThanOrEqual(12)
    const state = await call(owner.db, 'board_project', { p_project: p.id })
    expect(state.cards).toHaveLength(total.open)
  })
})

// --- the limits -----------------------------------------------------------------------------------------------------------

/** Staff written as raw rows (a limit needs many people, and an Auth user through GoTrue costs a call each); removed in `afterAll`. */
async function bulkStaff(count: number): Promise<string[]> {
  const ids = Array.from({ length: count }, () => randomUUID())
  await pg.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
     select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bulk-' || u || '@example.test', '', now(), now(), now()
       from unnest($1::uuid[]) u`,
    [ids],
  )
  await pg.query("insert into public.staff (user_id, display_name, role) select u, 'عضو ' || u, 'board' from unnest($1::uuid[]) u", [ids])
  bulkIds.push(...ids)
  return ids
}

describe('the limits', () => {
  it('50 open projects: the 51st is refused, and so is a restore that would make it', async () => {
    const open = (await one('select count(*)::int as n from board.projects where archived_at is null')).n as number
    expect(open, 'this database holds projects of its own: a test of the cap needs room').toBeLessThanOrEqual(46)
    for (let i = open; i < 49; i += 1) {
      const id = randomUUID()
      await pg.query('insert into board.projects (id, name, created_by) values ($1, $2, $3)', [id, `ملء ${i}`, owner.userId])
      mine.push(id)
    }
    const fiftieth = await call(owner.db, 'board_project_create', { p_name: 'الخمسون' })
    mine.push(fiftieth.id)
    expect(await refusal(owner.db, 'board_project_create', { p_name: 'الحادي والخمسون' })).toEqual(R('LIMIT', 'projects'))
    // An archived project frees a place, and its restore needs the place back.
    await call(owner.db, 'board_project_archive', { p_project: fiftieth.id, p_version: fiftieth.version })
    const instead = await call(owner.db, 'board_project_create', { p_name: 'بدل المؤرشف' })
    mine.push(instead.id)
    expect(await refusal(owner.db, 'board_project_restore', { p_project: fiftieth.id })).toEqual(R('LIMIT', 'projects'))
    // A project that is not archived is no new open project: answered, not refused.
    expect(await call(owner.db, 'board_project_restore', { p_project: instead.id })).toMatchObject({ id: instead.id, archived: false })
    await call(owner.db, 'board_project_archive', { p_project: instead.id, p_version: instead.version })
    expect(await call(owner.db, 'board_project_restore', { p_project: fiftieth.id })).toMatchObject({ id: fiftieth.id, archived: false })
  })

  it('two project creates at 49 open projects, started together: one takes the fiftieth, the other is refused with LIMIT projects', async () => {
    const open = (await one('select count(*)::int as n from board.projects where archived_at is null')).n as number
    expect(open, 'this database holds projects of its own: a test of the cap needs room').toBeLessThanOrEqual(47)
    for (let i = open; i < 49; i += 1) {
      const id = randomUUID()
      await pg.query('insert into board.projects (id, name, created_by) values ($1, $2, $3)', [id, `ملء ${i}`, owner.userId])
      mine.push(id)
    }
    const dbs = [await staffDb(owner.userId), await staffDb(owner.userId)]
    sessions.push(...dbs)
    // The cap's advisory lock, held from another session: both creates queue behind it, then meet the count one at a time.
    const holder = await connect()
    await holder.query('begin')
    await holder.query("select pg_advisory_xact_lock(hashtext('board.projects'))")
    const calls = dbs.map((db, i) => call(db, 'board_project_create', { p_name: `متزامن ${i}` }))
    for (const c of calls) c.catch(() => undefined)
    expect(await settledWithin(Promise.all(calls), 500)).toBe('blocked')
    await holder.query('commit')
    const results = await Promise.allSettled(calls)
    const made = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<Any>[]
    expect(made).toHaveLength(1)
    mine.push(made[0]!.value.id)
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect({ code: failed.reason.code, message: failed.reason.message, detail: failed.reason.detail }).toEqual(R('LIMIT', 'projects'))
    expect((await one('select count(*)::int as n from board.projects where archived_at is null')).n).toBe(50)
  })

  it('12 columns, 16 labels per project', async () => {
    const p = await makeProject()
    for (let i = 4; i <= 12; i += 1) await call(owner.db, 'board_column_create', { p_project: p.id, p_name: `عمود ${i}` })
    expect(await refusal(owner.db, 'board_column_create', { p_project: p.id, p_name: 'الثالث عشر' })).toEqual(R('LIMIT', 'columns'))
    for (let i = 1; i <= 16; i += 1) await call(owner.db, 'board_label_create', { p_project: p.id, p_name: `وسم ${i}`, p_tone: 'sand' })
    expect(await refusal(owner.db, 'board_label_create', { p_project: p.id, p_name: 'وسم 17', p_tone: 'sand' })).toEqual(R('LIMIT', 'labels'))
    // Deleting one makes room again.
    const label = (await call(owner.db, 'board_project', { p_project: p.id })).labels[0]
    await call(owner.db, 'board_label_delete', { p_label: label.id, p_version: label.version })
    expect(await call(owner.db, 'board_label_create', { p_project: p.id, p_name: 'وسم 18', p_tone: 'coral' })).toMatchObject({ name: 'وسم 18' })
    await assertDense(p.id)
  })

  it('30 people per project, counted over the people the owner sees: the 31st is refused, a role change at 30 is not an addition, an inactive member frees a place', async () => {
    const p = await makeProject()
    const ids = await bulkStaff(33)
    for (const id of ids.slice(0, 30)) await call(owner.db, 'board_person_set', { p_project: p.id, p_user: id, p_role: 'member' })
    expect(await refusal(owner.db, 'board_person_set', { p_project: p.id, p_user: ids[30], p_role: 'member' })).toEqual(R('LIMIT', 'people'))
    expect(await call(owner.db, 'board_person_set', { p_project: p.id, p_user: ids[0], p_role: 'viewer' })).toMatchObject({ role: 'viewer' })
    expect(await one('select count(*)::int as n from board.members where project_id = $1', [p.id])).toEqual({ n: 30 })
    await call(owner.db, 'board_person_remove', { p_project: p.id, p_user: ids[1] })
    expect(await call(owner.db, 'board_person_set', { p_project: p.id, p_user: ids[30], p_role: 'member' })).toMatchObject({ id: ids[30] })
    // An inactive member's row is out of the owner's sight and out of the count; reactivated, it may pass the cap, and then
    // nobody new is added until the project is back under it.
    await pg.query('update public.staff set active = false where user_id = $1', [ids[2]])
    expect(await call(owner.db, 'board_person_set', { p_project: p.id, p_user: ids[31], p_role: 'member' })).toMatchObject({ id: ids[31] })
    await pg.query('update public.staff set active = true where user_id = $1', [ids[2]])
    expect((await call(owner.db, 'board_project', { p_project: p.id })).people.filter((x: Any) => x.role !== 'owner')).toHaveLength(31)
    expect(await refusal(owner.db, 'board_person_set', { p_project: p.id, p_user: ids[32], p_role: 'member' })).toEqual(R('LIMIT', 'people'))
  })

  it('1,000 open cards per project: the 1,001st create and a restore past the cap are refused', async () => {
    const p = await makeProject()
    await pg.query("insert into board.cards (project_id, column_id, position, title, created_by) select $1, $2, g, 'ب' || g, $3 from generate_series(1, 998) g", [p.id, p.todo.id, owner.userId])
    const a = await newCard(p, p.doing, 'التاسعة والتسعمئة')
    const b = await newCard(p, p.doing, 'الألف')
    expect(b.position).toBe(2)
    expect(await refusal(owner.db, 'board_card_create', { p_column: p.doing.id, p_title: 'ألف وواحدة' })).toEqual(R('LIMIT', 'cards'))
    // Archived, a card frees a place; restored while the place is taken, it is refused.
    const archivedA = await archive(owner, a)
    const c = await newCard(p, p.doing, 'بدل المؤرشفة')
    expect(await refusal(owner.db, 'board_card_restore', { p_card: a.id })).toEqual(R('LIMIT', 'cards'))
    expect(archivedA.position).toBeNull()
    await archive(owner, c)
    expect(await call(owner.db, 'board_card_restore', { p_card: a.id })).toMatchObject({ id: a.id })
    expect(await one('select count(*)::int as n from board.cards where project_id = $1 and archived_at is null', [p.id])).toEqual({ n: 1000 })
    await assertDense(p.id)
  })

  it('10 people per card, once each however often they are named, counted over the people the card shows', async () => {
    const p = await makeProject()
    const ids = await bulkStaff(11)
    for (const id of ids) await pg.query("insert into board.members (project_id, user_id, role, added_by) values ($1, $2, 'member', $3)", [p.id, id, owner.userId])
    const card = await newCard(p, p.todo, 'مزدحمة')
    const full = await edit(owner, card, { people: [...ids.slice(0, 10), ...ids.slice(0, 3)] })
    expect(full.people).toHaveLength(10)
    expect(await refusal(owner.db, 'board_card_update', { p_card: card.id, p_version: full.version, p_changes: { people: ids } })).toEqual(R('LIMIT', 'card_people'))
    expect((await call(owner.db, 'board_project', { p_project: p.id })).cards[0].people).toHaveLength(10)
    // A deactivated person's assignment is out of sight and out of the count; reactivated, it returns past the cap, and the
    // next save of the people must come back within it.
    await pg.query('update public.staff set active = false where user_id = $1', [ids[0]])
    const swapped = await edit(owner, full, { people: ids.slice(1, 11) })
    expect(swapped.people).toHaveLength(10)
    await pg.query('update public.staff set active = true where user_id = $1', [ids[0]])
    const crowded = (await call(owner.db, 'board_project', { p_project: p.id })).cards[0]
    expect(crowded.people).toHaveLength(11)
    expect(await refusal(owner.db, 'board_card_update', { p_card: card.id, p_version: crowded.version, p_changes: { people: crowded.people } })).toEqual(R('LIMIT', 'card_people'))
    expect((await edit(owner, crowded, { people: ids.slice(0, 10) })).people).toHaveLength(10)
  })

  it('50 checklist items per card', async () => {
    const p = await makeProject()
    const card = await newCard(p, p.todo, 'طويلة')
    const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: null, text: `بند ${i + 1}`, done: false }))
    const fifty = await edit(owner, card, { checklist: items(50) })
    expect(fifty.checklist).toHaveLength(50)
    expect(await refusal(owner.db, 'board_card_update', { p_card: card.id, p_version: fifty.version, p_changes: { checklist: items(51) } })).toEqual(R('LIMIT', 'checklist'))
    expect(await one('select count(*)::int as n from board.checklist where card_id = $1', [card.id])).toEqual({ n: 50 })
  })
})

// --- the text rules -------------------------------------------------------------------------------------------------------

describe('text fields: control characters refused, trimmed, and the lengths of the contract (in characters, not bytes)', () => {
  const CONTROLS: [string, string][] = [
    ['U+0001', '\u0001'], ['U+0008', '\u0008'], ['a tab', '\t'], ['U+000B', '\u000b'], ['U+000C', '\u000c'], ['a carriage return', '\r'],
    ['U+001F', '\u001f'], ['U+007F', '\u007f'], ['U+0085', '\u0085'], ['U+009F', '\u009f'],
  ]

  type Field = { name: string; max: number; min: number; detail: string; lines: boolean; write: (value: string) => Promise<string> }
  const fields = async (): Promise<Field[]> => {
    const p = await makeProject()
    const column = p.todo
    return [
      { name: 'a project name', max: 80, min: 1, detail: 'name', lines: false, write: async (v) => { const made = await call(owner.db, 'board_project_create', { p_name: v }); mine.push(made.id); return made.name } },
      { name: 'a column name', max: 40, min: 1, detail: 'name', lines: false, write: async (v) => { const made = await call(owner.db, 'board_column_create', { p_project: p.id, p_name: v }); await call(owner.db, 'board_column_delete', { p_column: made.id, p_version: made.version }); return made.name } },
      { name: 'a label name', max: 24, min: 1, detail: 'name', lines: false, write: async (v) => { const made = await call(owner.db, 'board_label_create', { p_project: p.id, p_name: v, p_tone: 'sand' }); await call(owner.db, 'board_label_delete', { p_label: made.id, p_version: made.version }); return made.name } },
      { name: 'a card title', max: 200, min: 1, detail: 'title', lines: false, write: async (v) => (await call(owner.db, 'board_card_create', { p_column: column.id, p_title: v })).title },
      { name: 'a title through an edit', max: 200, min: 1, detail: 'title', lines: false, write: async (v) => (await edit(owner, await newCard(p, column, 'x'), { title: v })).title },
      { name: 'notes', max: 5000, min: 0, detail: 'notes', lines: true, write: async (v) => (await edit(owner, await newCard(p, column, 'x'), { notes: v })).notes },
      { name: 'a checklist item', max: 200, min: 1, detail: 'checklist', lines: false, write: async (v) => (await edit(owner, await newCard(p, column, 'x'), { checklist: [{ id: null, text: v, done: false }] })).checklist[0].text },
    ]
  }

  it('empty and blank are refused where a text is needed, notes may be empty; the longest text is accepted, one letter more is not; spaces are trimmed first', async () => {
    for (const f of await fields()) {
      const refused = (value: string) => f.write(value).then(() => 'accepted', (e: { message: string; detail: string }) => `${e.message}/${e.detail}`)
      const invalid = `INVALID/${f.detail}`
      expect(await refused('ب'.repeat(f.max + 1)), `${f.name}: ${f.max + 1} letters`).toBe(invalid)
      expect(await f.write('ب'.repeat(f.max)), `${f.name}: ${f.max} letters`).toBe('ب'.repeat(f.max))
      expect(await f.write(`   ${'ب'.repeat(f.max)}  `), `${f.name}: trimmed before it is counted`).toBe('ب'.repeat(f.max))
      expect(await refused(`  ${'ب'.repeat(f.max + 1)}`), `${f.name}: still too long once trimmed`).toBe(invalid)
      if (f.min === 1) {
        expect(await refused(''), `${f.name}: empty`).toBe(invalid)
        expect(await refused('     '), `${f.name}: blank`).toBe(invalid)
      } else {
        expect(await f.write(''), `${f.name}: empty`).toBe('')
        expect(await f.write('     '), `${f.name}: blank`).toBe('')
      }
      expect(await f.write('  نص بين فراغين  '), `${f.name}: trimmed`).toBe('نص بين فراغين')
    }
  })

  it('a control character anywhere is refused under the field; a line feed is allowed in notes alone', async () => {
    for (const f of await fields()) {
      const refused = (value: string) => f.write(value).then(() => 'accepted', (e: { message: string; detail: string }) => `${e.message}/${e.detail}`)
      for (const [what, char] of CONTROLS) {
        expect(await refused(`قبل${char}بعد`), `${f.name}: ${what} inside`).toBe(`INVALID/${f.detail}`)
        expect(await refused(`${char}نص`), `${f.name}: ${what} at the start`).toBe(`INVALID/${f.detail}`)
      }
      if (f.lines) {
        expect(await f.write('سطر\nسطر\n\nسطر'), `${f.name}: line feeds`).toBe('سطر\nسطر\n\nسطر')
        expect(await f.write('\n  سطر\n  '), `${f.name}: trimmed of spaces and line feeds`).toBe('سطر')
        expect(await refused('سطر\r\nسطر'), `${f.name}: a carriage return`).toBe(`INVALID/${f.detail}`)
      } else {
        expect(await refused('سطر\nسطر'), `${f.name}: a line feed`).toBe(`INVALID/${f.detail}`)
      }
    }
  })
})

// --- links and the titles a caller may read -------------------------------------------------------------------------------

describe('links: a card stores a reference, and a title is read under the caller\'s own content rights', () => {
  const suffix = randomUUID().slice(0, 8)
  const doc = { draft: `p12-draft-${suffix}`, visible: `p12-visible-${suffix}`, hidden: `p12-hidden-${suffix}`, newer: `p12-newer-${suffix}` }
  const TITLE = { draft: 'عنوان المسودة الخفي', visible: 'منشور ظاهر', hidden: 'منشور مخفي', published: 'العنوان المنشور', newest: 'العنوان الأحدث' }
  const addVersion = (docId: string, seq: number, title: string, visible = true) =>
    pg.query("insert into public.content_versions (collection, doc_id, seq, data) values ('posts', $1, $2, $3::jsonb)", [docId, seq, JSON.stringify({ title, visible })])
  const publish = (docId: string, seq: number, title: string, visible = true) =>
    pg.query("insert into public.published_documents (collection, doc_id, seq, data) values ('posts', $1, $2, $3::jsonb)", [docId, seq, JSON.stringify({ title, visible })])
  const key = (list: Any[]) => Object.fromEntries(list.map((t) => [`${t.collection}/${t.docId}`, t.title]))

  beforeAll(async () => {
    for (const docId of Object.values(doc)) docs.push({ collection: 'posts', docId })
    // A draft never published; a published visible post; a published hidden post; a published post with a newer draft after it.
    await addVersion(doc.draft, 1, TITLE.draft)
    await addVersion(doc.visible, 1, TITLE.visible)
    await publish(doc.visible, 1, TITLE.visible)
    await addVersion(doc.hidden, 1, TITLE.hidden, false)
    await publish(doc.hidden, 1, TITLE.hidden, false)
    await addVersion(doc.newer, 1, TITLE.published)
    await publish(doc.newer, 1, TITLE.published)
    await addVersion(doc.newer, 2, TITLE.newest)
  })

  it('board_link_targets: owners and editors get every post and room by its latest title; everyone else the rooms and the published, visible posts by the published title', async () => {
    const forOwner = key(await call(owner.db, 'board_link_targets'))
    expect(forOwner[`posts/${doc.draft}`]).toBe(TITLE.draft)
    expect(forOwner[`posts/${doc.hidden}`]).toBe(TITLE.hidden)
    expect(forOwner[`posts/${doc.visible}`]).toBe(TITLE.visible)
    expect(forOwner[`posts/${doc.newer}`]).toBe(TITLE.newest)
    expect(key(await call(editorOut.db, 'board_link_targets'))).toEqual(forOwner)
    const list = await call(owner.db, 'board_link_targets')
    expect(Object.keys(list[0]).sort()).toEqual(['collection', 'docId', 'title'])
    expect(list.every((t: Any) => ['posts', 'rooms'].includes(t.collection) && typeof t.title === 'string' && t.title.length > 0)).toBe(true)
    for (const who of [boardOut, operationsOut, viewer, member]) {
      const reply = await call(who.db, 'board_link_targets')
      const seen = key(reply)
      expect(seen[`posts/${doc.visible}`], who.name).toBe(TITLE.visible)
      expect(seen[`posts/${doc.newer}`], who.name).toBe(TITLE.published)
      expect(seen[`posts/${doc.draft}`], who.name).toBeUndefined()
      expect(seen[`posts/${doc.hidden}`], who.name).toBeUndefined()
      expect(Object.keys(seen).filter((k) => k.startsWith('rooms/')).sort(), who.name).toEqual(['rooms/book', 'rooms/built', 'rooms/passed', 'rooms/shelf', 'rooms/started'])
      expect(JSON.stringify(reply), who.name).not.toContain(TITLE.draft)
      expect(JSON.stringify(reply), who.name).not.toContain(TITLE.newest)
      expect(JSON.stringify(reply), who.name).not.toContain(TITLE.hidden)
    }
  })

  it('board_card_update accepts only a link the caller\'s own targets hold', async () => {
    const p = await makeProject()
    await addMember(p, member)
    const card = await newCard(p, p.todo, 'بطاقة')
    const link = (who: Person, c: Any, collection: string, docId: string) => edit(who, c, { link: { collection, docId } })
    const bad = (who: Person, c: Any, collection: string, docId: string) =>
      refusal(who.db, 'board_card_update', { p_card: c.id, p_version: c.version, p_changes: { link: { collection, docId } } })
    // A member whose role cannot read drafts: only what is public.
    expect(await bad(member, card, 'posts', doc.draft)).toEqual(R('INVALID', 'link'))
    expect(await bad(member, card, 'posts', doc.hidden)).toEqual(R('INVALID', 'link'))
    expect(await bad(member, card, 'posts', 'p12-no-such-post')).toEqual(R('INVALID', 'link'))
    expect(await bad(member, card, 'rooms', 'nowhere')).toEqual(R('INVALID', 'link'))
    const linked = await link(member, card, 'posts', doc.visible)
    expect(linked.link).toEqual({ collection: 'posts', docId: doc.visible, title: TITLE.visible })
    const room = await link(member, linked, 'rooms', 'book')
    expect(room.link).toMatchObject({ collection: 'rooms', docId: 'book' })
    expect(room.version).toBe(linked.version + 1)
    // The same link again is no change; taking it off is always allowed.
    expect((await link(member, room, 'rooms', 'book')).version).toBe(room.version)
    const unlinked = await edit(member, room, { link: null })
    expect(unlinked.link).toBeNull()
    expect(await rows('select link_collection, link_doc_id from board.cards where id = $1', [card.id])).toEqual([{ link_collection: null, link_doc_id: null }])
    // An owner reads drafts: the draft is a link for her.
    const draft = await link(owner, unlinked, 'posts', doc.draft)
    expect(draft.link).toEqual({ collection: 'posts', docId: doc.draft, title: TITLE.draft })
    // A link a member cannot see stays when she changes something else, and she cannot link another one like it.
    const retitled = await edit(member, draft, { title: 'عنوان جديد' })
    expect(retitled.link).toMatchObject({ docId: doc.draft, title: null })
    expect((await link(member, retitled, 'posts', doc.draft)).version).toBe(retitled.version)
    expect(await bad(member, retitled, 'posts', doc.hidden)).toEqual(R('INVALID', 'link'))
  })

  it('a title is read under the reader\'s own rights: a viewer never receives a draft\'s title, an editor does, and publishing is the content screens\' doing', async () => {
    const p = await makeProject()
    const editorViewer = await person('editor', 'محرر مطّلع')
    await addMember(p, viewer, 'viewer')
    await addMember(p, editorViewer, 'viewer')
    await addMember(p, operationsOut, 'viewer')
    const linkedCard = async (docId: string, title: string) => edit(owner, await newCard(p, p.todo, title), { link: { collection: 'posts', docId } })
    const draftCard = await linkedCard(doc.draft, 'مسودة')
    const newerCard = await linkedCard(doc.newer, 'أحدث')
    const hiddenCard = await linkedCard(doc.hidden, 'مخفي')
    const visibleCard = await linkedCard(doc.visible, 'ظاهر')
    const titles = async (who: Person): Promise<Record<string, string | null>> => {
      const state = await call(who.db, 'board_project', { p_project: p.id })
      return Object.fromEntries(state.cards.map((c: Any) => [c.id, c.link.title]))
    }
    const expectTitles = (seen: Record<string, string | null>, want: [Any, string | null][], who: string) => {
      for (const [card, title] of want) expect(seen[card.id], `${who}: ${card.link.docId}`).toBe(title)
    }
    expectTitles(await titles(owner), [[draftCard, TITLE.draft], [newerCard, TITLE.newest], [hiddenCard, TITLE.hidden], [visibleCard, TITLE.visible]], 'owner')
    expectTitles(await titles(editorViewer), [[draftCard, TITLE.draft], [newerCard, TITLE.newest], [hiddenCard, TITLE.hidden], [visibleCard, TITLE.visible]], 'editor (a viewer)')
    for (const who of [viewer, operationsOut]) {
      expectTitles(await titles(who), [[draftCard, null], [newerCard, TITLE.published], [hiddenCard, null], [visibleCard, TITLE.visible]], who.name)
      const everything = JSON.stringify(await call(who.db, 'board_project', { p_project: p.id }))
      for (const secret of [TITLE.draft, TITLE.newest, TITLE.hidden]) expect(everything, `${who.name}: ${secret}`).not.toContain(secret)
      // The reference itself is not a secret: the screen says «محتوى غير منشور».
      expect((await call(who.db, 'board_project', { p_project: p.id })).cards.find((c: Any) => c.id === draftCard.id).link).toEqual({ collection: 'posts', docId: doc.draft, title: null })
    }
    // The owner's export carries the latest title.
    expect((await call(owner.db, 'board_export', { p_project: p.id })).find((c: Any) => c.id === draftCard.id).link.title).toBe(TITLE.draft)
    // Published (by the content screens, not by the board), the draft is public and the viewer reads its published title.
    await publish(doc.draft, 1, TITLE.draft)
    try {
      expectTitles(await titles(viewer), [[draftCard, TITLE.draft]], 'viewer after publishing')
    } finally {
      await pg.query("delete from public.published_documents where collection = 'posts' and doc_id = $1", [doc.draft])
    }
    expectTitles(await titles(viewer), [[draftCard, null]], 'viewer after the post is archived')
    expectTitles(await titles(owner), [[draftCard, TITLE.draft]], 'owner after the post is archived')
    // Nothing the board does changes the content.
    expect(await rows("select count(*)::int as n from public.published_documents where collection = 'posts' and doc_id = $1", [doc.draft])).toEqual([{ n: 0 }])
  })
})

// --- people: roles, removal, deactivation, demotion -----------------------------------------------------------------------

describe('people', () => {
  it('board_person_set: not an owner, not an inactive or unknown person, only member or viewer; it answers the person with their role', async () => {
    const p = await makeProject()
    const owner2 = await person('owner', 'مالك آخر')
    const inactive = await person('board', 'غير نشط', { active: false })
    const set = (user: string, role: unknown) => refusal(owner.db, 'board_person_set', { p_project: p.id, p_user: user, p_role: role })
    expect(await set(owner2.userId, 'member')).toEqual(R('INVALID', 'people'))
    expect(await set(inactive.userId, 'member')).toEqual(R('INVALID', 'people'))
    expect(await set(randomUUID(), 'member')).toEqual(R('INVALID', 'people'))
    expect(await set(spare.userId, 'admin')).toEqual(R('INVALID', 'role'))
    expect(await set(spare.userId, 'owner')).toEqual(R('INVALID', 'role'))
    expect(await set(spare.userId, null)).toEqual(R('INVALID', 'role'))
    expect(await rows('select 1 from board.members where project_id = $1', [p.id])).toHaveLength(0)
    expect(await call(owner.db, 'board_person_set', { p_project: p.id, p_user: spare.userId, p_role: 'viewer' })).toEqual({ id: spare.userId, name: spare.name, role: 'viewer' })
    expect(await call(owner.db, 'board_person_set', { p_project: p.id, p_user: spare.userId, p_role: 'member' })).toEqual({ id: spare.userId, name: spare.name, role: 'member' })
    expect(await rows('select role, added_by from board.members where project_id = $1', [p.id])).toEqual([{ role: 'member', added_by: owner.userId }])
  })

  it('a viewer is never assigned; turning a member into a viewer takes them off this project\'s cards and no other\'s', async () => {
    const p = await makeProject()
    const q = await makeProject('آخر')
    await addMember(p, member)
    await addMember(q, member)
    const c1 = await edit(owner, await newCard(p, p.todo, 'أولى'), { people: [member.userId, owner.userId] })
    const c2 = await edit(owner, await newCard(p, p.doing, 'ثانية'), { people: [member.userId] })
    const other = await edit(owner, await newCard(q, q.todo, 'في آخر'), { people: [member.userId] })
    await call(owner.db, 'board_person_set', { p_project: p.id, p_user: member.userId, p_role: 'viewer' })
    const state = await call(owner.db, 'board_project', { p_project: p.id })
    expect(state.cards.find((c: Any) => c.id === c1.id).people).toEqual([owner.userId])
    expect(state.cards.find((c: Any) => c.id === c2.id).people).toEqual([])
    expect(await rows('select 1 from board.card_people cp join board.cards c on c.id = cp.card_id where c.project_id = $1 and cp.user_id = $2', [p.id, member.userId])).toHaveLength(0)
    expect((await call(owner.db, 'board_project', { p_project: q.id })).cards.find((c: Any) => c.id === other.id).people).toEqual([member.userId])
    expect(await refusal(owner.db, 'board_card_update', { p_card: c2.id, p_version: c2.version, p_changes: { people: [member.userId] } })).toEqual(R('INVALID', 'people'))
    // Back to a member, they are not put back on the cards.
    await call(owner.db, 'board_person_set', { p_project: p.id, p_user: member.userId, p_role: 'member' })
    expect((await call(owner.db, 'board_project', { p_project: p.id })).cards.find((c: Any) => c.id === c2.id).people).toEqual([])
  })

  it('removal takes the access away at once, with the person\'s assignments on this project', async () => {
    const p = await makeProject()
    const q = await makeProject('آخر')
    await addMember(p, member)
    await addMember(q, member)
    const card = await edit(owner, await newCard(p, p.todo, 'بطاقة'), { people: [member.userId] })
    const elsewhere = await edit(owner, await newCard(q, q.todo, 'هناك'), { people: [member.userId] })
    expect((await call(member.db, 'board_project', { p_project: p.id })).role).toBe('member')
    expect(await call(owner.db, 'board_person_remove', { p_project: p.id, p_user: member.userId })).toEqual({ id: member.userId })
    expect(await refusal(member.db, 'board_project', { p_project: p.id })).toEqual(R('NOT_FOUND'))
    expect(await refusal(member.db, 'board_card_update', { p_card: card.id, p_version: card.version, p_changes: { title: 'x' } })).toEqual(R('NOT_FOUND'))
    expect((await call(member.db, 'board_projects')).map((x: Any) => x.id)).toEqual([q.id])
    expect((await call(member.db, 'board_mine')).map((c: Any) => c.id)).toEqual([elsewhere.id])
    expect(await rows('select 1 from board.card_people cp join board.cards c on c.id = cp.card_id where c.project_id = $1 and cp.user_id = $2', [p.id, member.userId])).toHaveLength(0)
    expect((await call(owner.db, 'board_staff', { p_project: p.id })).some((x: Any) => x.id === member.userId)).toBe(true)
  })

  it('deactivation takes the access away at once and keeps the rows; they leave every read; reactivation brings access and assignments back', async () => {
    const p = await makeProject()
    const sleeper = await person('board', 'ستُعطَّل')
    await addMember(p, sleeper)
    const card = await edit(owner, await newCard(p, p.todo, 'بطاقة'), { people: [sleeper.userId, owner.userId] })
    expect((await call(sleeper.db, 'board_mine')).map((c: Any) => c.id)).toEqual([card.id])
    await pg.query('update public.staff set active = false where user_id = $1', [sleeper.userId])
    // At once: nothing answers them.
    for (const [fn, args] of [
      ['board_projects', {}], ['board_project', { p_project: p.id }], ['board_mine', {}], ['board_due', {}], ['board_link_targets', {}],
      ['board_card_update', { p_card: card.id, p_version: card.version, p_changes: { title: 'x' } }], ['board_card_create', { p_column: p.todo.id, p_title: 'x' }],
    ] as [Fn, Record<string, unknown>][]) {
      expect(await refusal(sleeper.db, fn, args), fn).toEqual(R('FORBIDDEN'))
    }
    // Out of every read: the project's people, the card's, the tiles, the owner's list to add, the export.
    const state = await call(owner.db, 'board_project', { p_project: p.id })
    expect(state.people.some((x: Any) => x.id === sleeper.userId)).toBe(false)
    expect(state.cards[0].people).toEqual([owner.userId])
    expect((await call(owner.db, 'board_projects')).find((x: Any) => x.id === p.id).people.some((x: Any) => x.id === sleeper.userId)).toBe(false)
    expect((await call(owner.db, 'board_staff', { p_project: p.id })).some((x: Any) => x.id === sleeper.userId)).toBe(false)
    expect((await call(owner.db, 'board_export', { p_project: p.id }))[0].people).toEqual([owner.name])
    expect(await refusal(owner.db, 'board_card_update', { p_card: card.id, p_version: card.version, p_changes: { people: [sleeper.userId] } })).toEqual(R('INVALID', 'people'))
    // The rows are kept, and an edit of the people does not drop what it cannot see.
    const edited = await edit(owner, card, { people: [] })
    expect(edited.people).toEqual([])
    expect(await rows('select 1 from board.members where project_id = $1 and user_id = $2', [p.id, sleeper.userId])).toHaveLength(1)
    expect(await rows('select 1 from board.card_people where card_id = $1 and user_id = $2', [card.id, sleeper.userId])).toHaveLength(1)
    // Reactivated: access, the person in the lists, and the assignment.
    await pg.query('update public.staff set active = true where user_id = $1', [sleeper.userId])
    const back = await call(sleeper.db, 'board_project', { p_project: p.id })
    expect(back.role).toBe('member')
    expect(back.cards[0].people).toEqual([sleeper.userId])
    expect(back.people.some((x: Any) => x.id === sleeper.userId)).toBe(true)
    expect((await call(sleeper.db, 'board_mine')).map((c: Any) => c.id)).toEqual([card.id])
  })

  it('a demoted owner loses every project not theirs, and their cards leave «مهامي» and the home; a member promoted to an owner is an owner, listed once', async () => {
    const p = await makeProject()
    const wanderer = await person('owner', 'مالك عابر')
    const theirs = await edit(owner, await newCard(p, p.todo, 'للعابر'), { people: [wanderer.userId], dueOn: await day(1) })
    expect((await call(wanderer.db, 'board_mine')).map((c: Any) => c.id)).toEqual([theirs.id])
    expect((await call(wanderer.db, 'board_project', { p_project: p.id })).role).toBe('owner')
    await pg.query("update public.staff set role = 'editor' where user_id = $1", [wanderer.userId])
    expect(await refusal(wanderer.db, 'board_project', { p_project: p.id })).toEqual(R('NOT_FOUND'))
    expect(await refusal(wanderer.db, 'board_project_rename', { p_project: p.id, p_version: p.version, p_name: 'x' })).toEqual(R('NOT_FOUND'))
    expect(await call(wanderer.db, 'board_projects')).toEqual([])
    // Their assignment row stays (an owner needs no `members` row to be on a card), but no read of theirs shows it.
    expect(await rows('select 1 from board.card_people where card_id = $1 and user_id = $2', [theirs.id, wanderer.userId])).toHaveLength(1)
    expect(await call(wanderer.db, 'board_mine')).toEqual([])
    expect(await call(wanderer.db, 'board_due')).toEqual([])

    const promoted = await person('board', 'مشارك سيُرقّى')
    await addMember(p, promoted)
    await pg.query("update public.staff set role = 'owner' where user_id = $1", [promoted.userId])
    const state = await call(promoted.db, 'board_project', { p_project: p.id })
    expect(state.role).toBe('owner')
    expect(state.people.filter((x: Any) => x.id === promoted.userId)).toEqual([{ id: promoted.userId, name: promoted.name, role: 'owner' }])
    expect((await call(owner.db, 'board_staff', { p_project: p.id })).some((x: Any) => x.id === promoted.userId)).toBe(false)
    expect(await call(promoted.db, 'board_project_rename', { p_project: p.id, p_version: p.version, p_name: 'باسم المرقّى' })).toMatchObject({ name: 'باسم المرقّى' })
  })
})

// --- the Data API ---------------------------------------------------------------------------------------------------------

describe('through the Data API: the refusals arrive as the contract says', () => {
  it('NOT_FOUND, FORBIDDEN, INVALID, STALE and LIMIT carry their SQLSTATE, their code as the message and their detail', async () => {
    const ownerClient = await signIn(owner.email)
    const boardClient = await signIn(boardOut.email)
    const created = await ownerClient.rpc('board_project_create', { p_name: 'عبر الواجهة' })
    expect(created.error).toBeNull()
    const project = created.data as Any
    mine.push(project.id)
    expect(project).toMatchObject({ name: 'عبر الواجهة', version: 1, archived: false })

    const notFound = await boardClient.rpc('board_project', { p_project: project.id })
    expect(notFound.error).toMatchObject({ code: 'P0001', message: 'NOT_FOUND', details: '' })
    expect(notFound.status).toBe(400)
    const forbidden = await boardClient.rpc('board_project_create', { p_name: 'x' })
    expect(forbidden.error).toMatchObject({ code: 'P0001', message: 'FORBIDDEN', details: '' })
    const invalid = await ownerClient.rpc('board_column_create', { p_project: project.id, p_name: '' })
    expect(invalid.error).toMatchObject({ code: 'P0001', message: 'INVALID', details: 'name' })
    const stale = await ownerClient.rpc('board_project_rename', { p_project: project.id, p_version: 99, p_name: 'x' })
    expect(stale.error).toMatchObject({ code: '23505', message: 'STALE', details: '' })
    expect(stale.status).toBe(409)
    const column = (await ownerClient.rpc('board_column_create', { p_project: project.id, p_name: 'عمود' })).data as Any
    const notEmpty = await ownerClient.rpc('board_card_create', { p_column: column.id, p_title: 'بطاقة' })
    expect(notEmpty.error).toBeNull()
    const refused = await ownerClient.rpc('board_column_delete', { p_column: column.id, p_version: column.version })
    expect(refused.error).toMatchObject({ code: 'P0001', message: 'NOT_EMPTY', details: '' })
    const limit = await ownerClient.rpc('board_card_update', { p_card: (notEmpty.data as Any).id, p_version: 1, p_changes: { checklist: Array.from({ length: 51 }, () => ({ id: null, text: 'x', done: false })) } })
    expect(limit.error).toMatchObject({ code: 'P0001', message: 'LIMIT', details: 'checklist' })
    // The reads answer the same JSON the SQL gives.
    const read = await ownerClient.rpc('board_project', { p_project: project.id })
    expect(Object.keys(read.data as object).sort()).toEqual(['cards', 'columns', 'labels', 'people', 'project', 'role'])
    // Every email of the people made here stays out of every reply.
    for (const who of [owner, member, viewer, spare, editorOut, operationsOut, boardOut]) {
      expect(JSON.stringify(read.data), who.name).not.toContain(who.email)
    }
    // A staff-less account is FORBIDDEN, and the service role has no way in.
    const stranger = anonClient()
    expect((await stranger.rpc('board_projects')).error?.code).toBe('42501')
    expect((await serviceClient.rpc('board_projects')).error?.code).toBe('42501')
  })
})
