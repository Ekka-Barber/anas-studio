// Relative, not `@/`: the unit tests (tests/unit/projects.test.ts) import this file, and the unit config has no alias.
import { isDay, riyadhToday } from '../../supabase/functions/_shared/riyadh-day.ts'

/**
 * The projects board's screens, the parts that need no React (P12 round R2, PLANS/P12-CONTRACT.md, version 2): the
 * words of section 7, the strict parsers of what the `public.board_*` functions answer (supabase/migrations/
 * 20261016120100_p12_board.sql builds the replies), the reading of a refusal (section 1: the code in `message`, the
 * field or the limit in `detail`), search and the filters, the keyboard's arrows in reading terms, the positions a
 * drop and «نقل إلى…» send, the days' wording, the plural forms and the owner's CSV.
 *
 * A reply is read key by key: a key too few, a value of the wrong type or a card in a column the project does not
 * have throws, and the screen then says it could not load, never a half-drawn board. Extra keys are ignored.
 */

// ---------------------------------------------------------------------------
// Words (section 7)
// ---------------------------------------------------------------------------

export const LOAD_FAILED = 'تعذّر التحميل.'
export const LOADING = 'يحمّل...'
export const SAVE_FAILED = 'تعذّر الحفظ؛ أعد المحاولة.'
export const MOVE_FAILED = 'تعذّر نقل البطاقة؛ أعدناها إلى مكانها.'
export const STALE_CARD = 'تغيّرت هذه البطاقة منذ فتحتها؛ هذه نسختها الأحدث.'
export const PROJECT_GONE = 'لم يعد هذا المشروع متاحًا لك.'
export const NOT_ALLOWED = 'ليس لدورك أن يفعل هذا.'
export const CARD_ARCHIVED = 'أُرشفت البطاقة.'
export const NOT_EMPTY = 'لا يُحذف عمود فيه بطاقات؛ انقلها أولًا.'
export const LAST_COLUMN = 'هذا آخر عمود في المشروع، وفيه بطاقات مؤرشفة؛ أضف عمودًا قبل حذفه.'
export const EMPTY_PROJECTS_OWNER = 'لا مشاريع بعد. أنشئ أول مشروع.'
export const EMPTY_PROJECTS = 'لم تُضَف إلى أي مشروع بعد.'
export const EMPTY_COLUMN = 'لا بطاقات في هذا العمود.'
export const EMPTY_SEARCH = 'لا بطاقات تطابق البحث.'
export const EMPTY_MINE = 'لا بطاقات لك الآن.'
export const UNPUBLISHED = 'محتوى غير منشور'

/** The screen-reader instructions of a card (section 7), and the announcements a move makes. */
export const MOVE_INSTRUCTIONS = 'لنقل بطاقة: المسافة ترفعها، والأسهم تنقلها، والمسافة تُفلتها، و Escape يلغي النقل.'
export const MOVE_CANCELLED = 'أُلغي النقل.'
export const liftedText = (title: string): string => `رُفعت البطاقة «${title}».`
export const overText = (column: string, position: number, total: number): string => `البطاقة في «${column}»، الموضع ${position} من ${total}.`
export const droppedText = (column: string): string => `وُضعت البطاقة في «${column}».`

export const PRIORITIES = ['urgent', 'normal', 'low'] as const
export type Priority = (typeof PRIORITIES)[number]
export const PRIORITY_LABELS: Readonly<Record<Priority, string>> = { urgent: 'عاجل', normal: 'عادي', low: 'منخفض' }

export const TONES = ['saffron', 'coral', 'sand', 'aub'] as const
export type Tone = (typeof TONES)[number]
export const TONE_LABELS: Readonly<Record<Tone, string>> = { saffron: 'زعفراني', coral: 'مرجاني', sand: 'رملي', aub: 'باذنجاني' }

export type ProjectRole = 'owner' | 'member' | 'viewer'
export const PROJECT_ROLE_LABELS: Readonly<Record<ProjectRole, string>> = { owner: 'مالك', member: 'مشارك', viewer: 'مُطّلع' }

// ---------------------------------------------------------------------------
// The shapes
// ---------------------------------------------------------------------------

export interface Person {
  id: string
  name: string
}
export interface ProjectPerson extends Person {
  role: ProjectRole
}
export interface ProjectSummary {
  id: string
  name: string
  archived: boolean
  cards: number
  overdue: number
  people: Person[]
}
export interface BoardColumn {
  id: string
  name: string
  position: number
  hidden: boolean
  isDone: boolean
  version: number
}
export interface BoardLabel {
  id: string
  name: string
  tone: Tone
  version: number
}
export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}
export interface CardLink {
  collection: 'posts' | 'rooms'
  docId: string
  /** null: the caller may not read the document's title (it is not published). */
  title: string | null
}
export interface BoardCard {
  id: string
  columnId: string
  position: number
  title: string
  notes: string
  priority: Priority
  dueOn: string | null
  doneAt: string | null
  labels: string[]
  people: string[]
  checklist: ChecklistItem[]
  link: CardLink | null
  version: number
}
export interface BoardData {
  project: { id: string; name: string; version: number; archived: boolean }
  /** The caller's role on this project. */
  role: ProjectRole
  columns: BoardColumn[]
  labels: BoardLabel[]
  people: ProjectPerson[]
  cards: BoardCard[]
}
export interface MineCard {
  id: string
  title: string
  priority: Priority
  dueOn: string | null
  project: { id: string; name: string }
  column: { id: string; name: string }
}
export interface LinkTarget {
  collection: 'posts' | 'rooms'
  docId: string
  title: string
}
export interface MoveReply {
  card: BoardCard
  columns: Array<{ id: string; cards: Array<{ id: string; position: number }> }>
}
export interface ExportCard {
  id: string
  title: string
  column: string
  priority: Priority
  dueOn: string | null
  doneAt: string | null
  labels: string[]
  people: string[]
  checklist: Array<{ text: string; done: boolean }>
  notes: string
  link: CardLink | null
  archived: boolean
}

// ---------------------------------------------------------------------------
// The replies, parsed strictly
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const isUuid = (value: string): boolean => UUID.test(value)

function malformed(): never {
  throw new Error('تعذّر قراءة رد المشاريع.')
}
function obj(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : malformed()
}
function str(value: unknown): string {
  return typeof value === 'string' ? value : malformed()
}
const nstr = (value: unknown): string | null => (value === null ? null : str(value))
/** A count or a version: a non-negative integer. */
function int(value: unknown): number {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : malformed()
}
/** A position: counted from 1. */
function ordinal(value: unknown): number {
  return Number.isInteger(value) && (value as number) >= 1 ? (value as number) : malformed()
}
function bool(value: unknown): boolean {
  return typeof value === 'boolean' ? value : malformed()
}
function id(value: unknown): string {
  const text = str(value)
  return UUID.test(text) ? text : malformed()
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  const text = str(value)
  return (allowed as readonly string[]).includes(text) ? (text as T) : malformed()
}
function list<T>(value: unknown, item: (entry: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(item) : malformed()
}
/** A real calendar day, `YYYY-MM-DD`. */
function day(value: unknown): string {
  const text = str(value)
  return isDay(text) ? text : malformed()
}
/** An ISO time with its offset, as the database writes it ('2026-10-16T21:05:00.123456+00:00'). */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/
function time(value: unknown): string {
  const text = str(value)
  return !ISO_TIME.test(text) || Number.isNaN(Date.parse(text)) ? malformed() : text
}
const orNull = <T>(value: unknown, read: (entry: unknown) => T): T | null => (value === null ? null : read(value))

function personOf(value: unknown): Person {
  const o = obj(value)
  return { id: id(o.id), name: str(o.name) }
}
function projectPersonOf(value: unknown): ProjectPerson {
  const o = obj(value)
  return { id: id(o.id), name: str(o.name), role: oneOf(o.role, ['owner', 'member', 'viewer']) }
}
const collectionOf = (value: unknown): 'posts' | 'rooms' => oneOf(value, ['posts', 'rooms'])
function linkOf(value: unknown): CardLink {
  const o = obj(value)
  return { collection: collectionOf(o.collection), docId: str(o.docId), title: nstr(o.title) }
}

/** One column as `board.column_json` writes it (also the reply of the column writes). */
export function parseColumn(value: unknown): BoardColumn {
  const o = obj(value)
  return { id: id(o.id), name: str(o.name), position: ordinal(o.position), hidden: bool(o.hidden), isDone: bool(o.isDone), version: int(o.version) }
}
function labelOf(value: unknown): BoardLabel {
  const o = obj(value)
  return { id: id(o.id), name: str(o.name), tone: oneOf(o.tone, TONES), version: int(o.version) }
}

/** One card as `board.card_json` writes it (also the reply of the card writes). */
export function parseCard(value: unknown): BoardCard {
  return cardOf(value, false) as BoardCard
}

/** The reply of `board_card_archive`: the card as `board.card_json` writes it, with no position (an archived card has none). */
export function parseArchivedCard(value: unknown): Omit<BoardCard, 'position'> & { position: number | null } {
  return cardOf(value, true)
}

function cardOf(value: unknown, archived: boolean): Omit<BoardCard, 'position'> & { position: number | null } {
  const o = obj(value)
  return {
    id: id(o.id),
    columnId: id(o.columnId),
    position: archived && o.position === null ? null : ordinal(o.position),
    title: str(o.title),
    notes: str(o.notes),
    priority: oneOf(o.priority, PRIORITIES),
    dueOn: orNull(o.dueOn, day),
    doneAt: orNull(o.doneAt, time),
    labels: list(o.labels, id),
    people: list(o.people, id),
    checklist: list(o.checklist, (entry) => {
      const item = obj(entry)
      return { id: id(item.id), text: str(item.text), done: bool(item.done) }
    }),
    link: orNull(o.link, linkOf),
    version: int(o.version),
  }
}

/** `board_project`: the project whole, one reading. */
export function parseBoard(value: unknown): BoardData {
  const o = obj(value)
  const project = obj(o.project)
  const columns = list(o.columns, parseColumn)
  const cards = list(o.cards, parseCard)
  const known = new Set(columns.map((column) => column.id))
  // A card in a column the project does not have would never be drawn: that is a reply that is not what it should be.
  if (cards.some((card) => !known.has(card.columnId))) malformed()
  return {
    project: { id: id(project.id), name: str(project.name), version: int(project.version), archived: bool(project.archived) },
    role: oneOf(o.role, ['owner', 'member', 'viewer']),
    columns,
    labels: list(o.labels, labelOf),
    people: list(o.people, projectPersonOf),
    cards,
  }
}

/** The reply of `board_project_create`, `_rename` and the other project writes. */
export function parseProjectRef(value: unknown): BoardData['project'] {
  const o = obj(value)
  return { id: id(o.id), name: str(o.name), version: int(o.version), archived: bool(o.archived) }
}

/** `board_projects`: the caller's projects. */
export function parseProjects(value: unknown): ProjectSummary[] {
  return list(value, (entry) => {
    const o = obj(entry)
    return {
      id: id(o.id),
      name: str(o.name),
      archived: bool(o.archived),
      cards: int(o.cards),
      overdue: int(o.overdue),
      people: list(o.people, personOf),
    }
  })
}

/** `board_mine`: the caller's assigned open cards. */
export function parseMine(value: unknown): MineCard[] {
  return list(value, (entry) => {
    const o = obj(entry)
    const project = obj(o.project)
    const column = obj(o.column)
    return {
      id: id(o.id),
      title: str(o.title),
      priority: oneOf(o.priority, PRIORITIES),
      dueOn: orNull(o.dueOn, day),
      project: { id: id(project.id), name: str(project.name) },
      column: { id: id(column.id), name: str(column.name) },
    }
  })
}

/** `board_link_targets`: the documents a card can link to. */
export function parseLinkTargets(value: unknown): LinkTarget[] {
  return list(value, (entry) => {
    const o = obj(entry)
    return { collection: collectionOf(o.collection), docId: str(o.docId), title: str(o.title) }
  })
}

/** The reply of `board_card_move`: the card, and the positions of the columns it touched. */
export function parseMove(value: unknown): MoveReply {
  const o = obj(value)
  return {
    card: parseCard(o.card),
    columns: list(o.columns, (entry) => {
      const column = obj(entry)
      return {
        id: id(column.id),
        cards: list(column.cards, (card) => {
          const c = obj(card)
          return { id: id(c.id), position: ordinal(c.position) }
        }),
      }
    }),
  }
}

/** `board_export`: every card of a project for the owner's CSV, archived ones included. */
export function parseExport(value: unknown): ExportCard[] {
  return list(value, (entry) => {
    const o = obj(entry)
    return {
      id: id(o.id),
      title: str(o.title),
      column: str(o.column),
      priority: oneOf(o.priority, PRIORITIES),
      dueOn: orNull(o.dueOn, day),
      doneAt: orNull(o.doneAt, time),
      labels: list(o.labels, str),
      people: list(o.people, str),
      checklist: list(o.checklist, (item) => {
        const i = obj(item)
        return { text: str(i.text), done: bool(i.done) }
      }),
      notes: str(o.notes),
      link: orNull(o.link, linkOf),
      archived: bool(o.archived),
    }
  })
}

// ---------------------------------------------------------------------------
// Refusals (section 1) and the calls
// ---------------------------------------------------------------------------

export type RefusalCode = 'NOT_FOUND' | 'FORBIDDEN' | 'STALE' | 'INVALID' | 'LIMIT' | 'NOT_EMPTY'
export interface Refusal {
  code: RefusalCode
  /** The field of an `INVALID`, the limit of a `LIMIT`, and empty otherwise. */
  detail: string
}
const REFUSAL_CODES: readonly RefusalCode[] = ['NOT_FOUND', 'FORBIDDEN', 'STALE', 'INVALID', 'LIMIT', 'NOT_EMPTY']

/** What the Data API answers with: the SQLSTATE in `code`, the refusal's code in `message`, its field in `details`. */
export interface CallError {
  code?: string
  message?: string
  details?: string | null
  detail?: string | null
}

/**
 * A refusal of the board's functions, or null for any other failure (the network, a server error, a reply that cannot
 * be read). The pair is checked as `board.refuse` writes it: `STALE` is 23505 (the house rule) and every other code P0001,
 * so another error that happens to carry the same word is not mistaken for one.
 */
export function readRefusal(error: CallError | null | undefined): Refusal | null {
  if (!error || typeof error.message !== 'string') return null
  const code = REFUSAL_CODES.find((candidate) => candidate === error.message)
  if (code === undefined || error.code !== (code === 'STALE' ? '23505' : 'P0001')) return null
  const detail = error.details ?? error.detail
  return { code, detail: typeof detail === 'string' ? detail : '' }
}

/** The sentence of a refusal, section 7's; null for an `INVALID` field that has no sentence (the caller says `SAVE_FAILED`). */
export function refusalText(refusal: Refusal, context: { onlyColumn?: boolean } = {}): string | null {
  switch (refusal.code) {
    case 'NOT_FOUND':
      return PROJECT_GONE
    case 'FORBIDDEN':
      return NOT_ALLOWED
    case 'STALE':
      return STALE_CARD
    case 'NOT_EMPTY':
      return context.onlyColumn ? LAST_COLUMN : NOT_EMPTY
    case 'LIMIT':
      return LIMIT_TEXT[refusal.detail] ?? null
    case 'INVALID':
      return INVALID_TEXT[refusal.detail] ?? null
  }
}

/**
 * The sentence of a refused write on an existing card or column. Its `NOT_FOUND` means that row is gone (archived or
 * deleted), not the project, so the write's own failure (`fallback`) is said, and the reading that follows turns the
 * screen to «لم يعد…» if the project went too. A `STALE` is the card dialog's own sentence. Any other refusal says its own.
 */
export function writeRefusalText(refusal: Refusal | null, fallback: string): string {
  if (refusal === null || refusal.code === 'NOT_FOUND' || refusal.code === 'STALE') return fallback
  return refusalText(refusal) ?? fallback
}
const LIMIT_TEXT: Readonly<Record<string, string>> = {
  columns: 'بلغ المشروع أقصى عدد من الأعمدة (12).',
  labels: 'بلغ المشروع أقصى عدد من الوسوم (16).',
  people: 'بلغ المشروع أقصى عدد من الأشخاص (30).',
  cards: 'بلغ المشروع أقصى عدد من البطاقات المفتوحة (1000).',
  card_people: 'للبطاقة 10 أشخاص على الأكثر.',
  checklist: 'للبطاقة 50 بندًا على الأكثر.',
  projects: 'بلغت المشاريع المفتوحة أقصى عددها (50).',
}
/** What a name and a title that were left empty are told. */
const EMPTY_TEXT: Readonly<Partial<Record<string, string>>> = { name: 'اكتب اسمًا.', title: 'اكتب عنوانًا.' }
/** An `INVALID` under its field. */
const INVALID_TEXT: Readonly<Record<string, string>> = {
  ...EMPTY_TEXT,
  notes: 'النص أطول من المسموح.',
  checklist: 'النص أطول من المسموح.',
  due_on: 'تاريخ غير صالح.',
}
const TOO_LONG = 'النص أطول من المسموح.'
const CONTROL_CHARACTERS = 'لا يُقبل نص فيه رموز تحكم.'
export const INVALID_DAY = 'تاريخ غير صالح.'

/** The field names of an `INVALID` (`detail`) the dialogs draw a sentence under. */
export type TextField = 'name' | 'title' | 'notes' | 'checklist'

/**
 * A text field checked before the press, as `board.clean` checks it in SQL: no control characters (a note may hold line
 * feeds), trimmed, between `min` and `max` characters. `error` is the sentence of section 7, or null.
 */
export function checkText(value: string, field: TextField, max: number, min = 1): { value: string; error: string | null } {
  const lines = field === 'notes'
  if ((lines ? /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/ : /[\u0000-\u001f\u007f-\u009f]/).test(value)) {
    return { value, error: CONTROL_CHARACTERS }
  }
  const text = lines ? value.replace(/^[ \n]+|[ \n]+$/g, '') : value.replace(/^ +| +$/g, '')
  const length = Array.from(text).length
  if (length > max) return { value: text, error: TOO_LONG }
  // Only a name and a title can be left empty by mistake (a note may be empty, and an empty checklist item is dropped).
  if (length < min) return { value: text, error: EMPTY_TEXT[field] ?? SAVE_FAILED }
  return { value: text, error: null }
}

export type Reply<T> = { ok: true; value: T } | { ok: false; refusal: Refusal | null }
/** A write the screen makes through `callBoard` (the project's view keeps its readings apart from its writes). */
export type BoardCall = <T>(fn: string, args: Record<string, unknown>, parse: (value: unknown) => T) => Promise<Reply<T>>
/** The part of the Supabase client the board calls (`rpc`), so a test can stand in for it. */
export interface Rpc {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: CallError | null }>
}

/**
 * One call of a `public.board_*` function and the reading of its reply: `ok` with the parsed value, or not ok with the
 * refusal (null when the failure was not one: a lost connection, a server error, a reply that is not what it should be).
 */
export async function callBoard<T>(client: Rpc, fn: string, args: Record<string, unknown>, parse: (value: unknown) => T): Promise<Reply<T>> {
  try {
    const { data, error } = await client.rpc(fn, args)
    if (error) return { ok: false, refusal: readRefusal(error) }
    return { ok: true, value: parse(data) }
  } catch {
    return { ok: false, refusal: null }
  }
}

// ---------------------------------------------------------------------------
// Days (Riyadh calendar days, section "Rules that hold for every round")
// ---------------------------------------------------------------------------

/** Arabic month names, Gregorian, Latin digits (`src/lib/format.ts`'s locale). */
const LOCALE = 'ar-SA-u-ca-gregory-nu-latn'
const DAY_MS = 24 * 60 * 60 * 1000
const dayTime = (text: string): number => Date.parse(`${text}T00:00:00Z`)

export function addDays(text: string, days: number): string {
  return new Date(dayTime(text) + days * DAY_MS).toISOString().slice(0, 10)
}
/** Whole days from `from` to `to` (`YYYY-MM-DD` each): positive when `to` is later. */
export const daysBetween = (from: string, to: string): number => Math.round((dayTime(to) - dayTime(from)) / DAY_MS)
/** The Riyadh calendar day of an ISO time. */
export const riyadhDayOf = (iso: string): string => riyadhToday(Date.parse(iso))
export { isDay, riyadhToday }

/** «16 أكتوبر»; the year only when it is not today's. */
export function formatDay(text: string, today: string): string {
  const sameYear = text.slice(0, 4) === today.slice(0, 4)
  return new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' as const }) }).format(
    new Date(dayTime(text)),
  )
}

/** «متأخرة يومًا واحدًا» / «متأخرة يومين» / «متأخرة n أيام» (3 to 10) / «متأخرة n يومًا» (11 and more). */
export function lateText(days: number): string {
  if (days === 1) return 'متأخرة يومًا واحدًا'
  if (days === 2) return 'متأخرة يومين'
  return days <= 10 ? `متأخرة ${days} أيام` : `متأخرة ${days} يومًا`
}

export type DueTone = 'late' | 'soon' | 'later'
/** What a card shows for its due day: «اليوم», the late wording (coral-deep), or the day; null with no due day. */
export function dueLabel(dueOn: string | null, today: string): { text: string; tone: DueTone } | null {
  if (dueOn === null) return null
  if (dueOn < today) return { text: lateText(daysBetween(dueOn, today)), tone: 'late' }
  if (dueOn === today) return { text: 'اليوم', tone: 'soon' }
  return { text: formatDay(dueOn, today), tone: dueOn <= addDays(today, 6) ? 'soon' : 'later' }
}

/** «أُنجزت <day>», the Riyadh day of `doneAt`. */
export const doneText = (doneAt: string, today: string): string => `أُنجزت ${formatDay(riyadhDayOf(doneAt), today)}`

// ---------------------------------------------------------------------------
// Counts in words (Intl.PluralRules('ar'), every form)
// ---------------------------------------------------------------------------

const PLURALS = new Intl.PluralRules('ar')
type Forms = Record<Intl.LDMLPluralRule, string>

const CARD_FORMS = (n: number): Forms => ({
  zero: 'لا بطاقات',
  one: 'بطاقة واحدة',
  two: 'بطاقتان',
  few: `${n} بطاقات`,
  many: `${n} بطاقة`,
  other: `${n} بطاقة`,
})
const PEOPLE_FORMS = (n: number): Forms => ({
  zero: 'لا أحد',
  one: 'شخص واحد',
  two: 'شخصان',
  few: `${n} أشخاص`,
  many: `${n} شخصًا`,
  other: `${n} شخص`,
})
const LATE_FORMS = (n: number): Forms => ({
  zero: 'لا بطاقات متأخرة',
  one: 'بطاقة واحدة متأخرة',
  two: 'بطاقتان متأخرتان',
  few: `${n} بطاقات متأخرة`,
  many: `${n} بطاقة متأخرة`,
  other: `${n} بطاقة متأخرة`,
})

/** «لا بطاقات» / «بطاقة واحدة» / «بطاقتان» / «3 بطاقات» / «11 بطاقة» / «100 بطاقة». */
export const cardsPhrase = (n: number): string => CARD_FORMS(n)[PLURALS.select(n)]
/** «لا أحد» / «شخص واحد» / «شخصان» / «3 أشخاص» / «11 شخصًا». */
export const peoplePhrase = (n: number): string => PEOPLE_FORMS(n)[PLURALS.select(n)]
/** The late cards of a project's tile: the same forms, «متأخرة» agreeing with the count. */
export const latePhrase = (n: number): string => LATE_FORMS(n)[PLURALS.select(n)]
/** A project's people in words, in two parts so that a screen can set the name apart (a name may be Latin): the first person, then the others by count («أنس» + « وشخصان»). */
export function peopleParts(people: readonly Person[]): { first: string | null; rest: string } {
  const [first, ...others] = people
  if (first === undefined) return { first: null, rest: peoplePhrase(0) }
  return { first: first.name, rest: others.length === 0 ? '' : ` و${peoplePhrase(others.length)}` }
}
/** A project's people in words: the first person, then the others by count («أنس وشخصان»). */
export function peopleWords(people: readonly Person[]): string {
  const { first, rest } = peopleParts(people)
  return `${first ?? ''}${rest}`
}
/** A person's mark: the first letter of their name. */
export const initialOf = (name: string): string => Array.from(name.trim())[0] ?? ''
/** «البنود n من m». */
export const checklistText = (card: Pick<BoardCard, 'checklist'>): string | null =>
  card.checklist.length === 0 ? null : `البنود ${card.checklist.filter((item) => item.done).length} من ${card.checklist.length}`

// ---------------------------------------------------------------------------
// Search and the filters
// ---------------------------------------------------------------------------

/**
 * Text as search compares it: Latin digits, no tashkeel or tatweel, one alef, one ya and one ha for the three
 * spellings people mix, lower case. Applied to the card and to the typed words alike.
 */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0))
    .replace(/[\u0640\u064b-\u065f\u0670]/g, '')
    .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627')
    .replace(/\u0649/g, '\u064a')
    .replace(/\u0629/g, '\u0647')
}

/** Every typed word is found in the card's title, notes or checklist; nothing typed matches every card. */
export function matchesSearch(card: Pick<BoardCard, 'title' | 'notes' | 'checklist'>, query: string): boolean {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const text = normalizeSearch([card.title, card.notes, ...card.checklist.map((item) => item.text)].join('\n'))
  return words.every((word) => text.includes(word))
}

export interface Filters {
  priority: 'all' | Priority
  due: 'all' | 'overdue' | 'today' | 'week' | 'none'
  label: string
  person: string
  link: 'all' | 'linked' | 'unlinked'
}
/** Every filter «الكل». */
export const NO_FILTERS: Filters = { priority: 'all', due: 'all', label: 'all', person: 'all', link: 'all' }
export const hasFilters = (filters: Filters): boolean => (Object.keys(NO_FILTERS) as Array<keyof Filters>).some((key) => filters[key] !== NO_FILTERS[key])

export const DUE_FILTERS: ReadonlyArray<{ value: Filters['due']; label: string }> = [
  { value: 'all', label: 'الكل' },
  { value: 'overdue', label: 'متأخرة' },
  { value: 'today', label: 'اليوم' },
  { value: 'week', label: 'هذا الأسبوع' },
  { value: 'none', label: 'بلا موعد' },
]
export const LINK_FILTERS: ReadonlyArray<{ value: Filters['link']; label: string }> = [
  { value: 'all', label: 'الكل' },
  { value: 'linked', label: 'مرتبطة بمحتوى' },
  { value: 'unlinked', label: 'غير مرتبطة' },
]

/**
 * Whether a card passes the filters. «متأخرة», «اليوم» and «هذا الأسبوع» (today and the six days after it) leave out the
 * done column, as the overview and «مهامي» do: a card that is done is not late.
 */
export function matchesFilters(card: BoardCard, filters: Filters, today: string, inDone: boolean): boolean {
  if (filters.priority !== 'all' && card.priority !== filters.priority) return false
  if (filters.label !== 'all' && !card.labels.includes(filters.label)) return false
  if (filters.person !== 'all' && !card.people.includes(filters.person)) return false
  if (filters.link === 'linked' && card.link === null) return false
  if (filters.link === 'unlinked' && card.link !== null) return false
  const due = card.dueOn
  switch (filters.due) {
    case 'overdue':
      return !inDone && due !== null && due < today
    case 'today':
      return !inDone && due === today
    case 'week':
      return !inDone && due !== null && due >= today && due <= addDays(today, 6)
    case 'none':
      return due === null
    default:
      return true
  }
}

// ---------------------------------------------------------------------------
// The board's order, and the positions a move sends
// ---------------------------------------------------------------------------

/** Card ids by column, each in its position order. */
export type Items = Record<string, string[]>

/** The cards `show` lets through, by column (every column of `columns` has an entry, empty or not). */
export function columnItems(cards: readonly BoardCard[], columns: readonly BoardColumn[], show: (card: BoardCard) => boolean = () => true): Items {
  const items: Items = Object.fromEntries(columns.map((column) => [column.id, [] as string[]]))
  for (const card of [...cards].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1))) {
    if (show(card)) items[card.columnId]?.push(card.id)
  }
  return items
}

/**
 * The position `board_card_move` takes for a card dropped at `index` among the cards shown in its column. `full` is the
 * column's open cards in the database's order and `shown` the ones the filters let through, each without the moved card.
 * The card lands before the shown card at `index`, or after the last shown one, or last when none is shown; the position
 * is its place in the column's whole list, counted from 1 (the SQL clamps it to 1 to n + 1 and renumbers the cards it
 * passes). With no filter, `full` and `shown` are one list and the position is `index + 1`.
 */
export function dropPosition(full: readonly string[], shown: readonly string[], index: number): number {
  const before = shown[index]
  if (before !== undefined) return full.indexOf(before) + 1
  const last = shown[shown.length - 1]
  return last === undefined ? full.length + 1 : full.indexOf(last) + 2
}

/** The positions «نقل إلى…» offers in a column holding `count` open cards: one more when the card comes from another column. */
export const menuPositions = (count: number, sameColumn: boolean): number => (sameColumn ? count : count + 1)
/** «الموضع n من m». */
export const positionText = (position: number, total: number): string => `الموضع ${position} من ${total}`

/** The board after a move: the moved card as the reply gives it, the cards it passed at their new positions. */
export function applyMove(data: BoardData, reply: MoveReply): BoardData {
  const positions = new Map(reply.columns.flatMap((column) => column.cards.map((card) => [card.id, card.position] as const)))
  return {
    ...data,
    cards: data.cards.map((card) => {
      if (card.id === reply.card.id) return reply.card
      const position = positions.get(card.id)
      return position === undefined ? card : { ...card, position }
    }),
  }
}
/** A card made, saved or restored: replaces the one with its id, or joins the board. */
export function withCard(data: BoardData, card: BoardCard): BoardData {
  return data.cards.some((entry) => entry.id === card.id)
    ? { ...data, cards: data.cards.map((entry) => (entry.id === card.id ? card : entry)) }
    : { ...data, cards: [...data.cards, card] }
}
/** A card archived: it leaves the board, and the cards after it close the gap. */
export function withoutCard(data: BoardData, cardId: string): BoardData {
  const gone = data.cards.find((card) => card.id === cardId)
  if (gone === undefined) return data
  return {
    ...data,
    cards: data.cards
      .filter((card) => card.id !== cardId)
      .map((card) => (card.columnId === gone.columnId && card.position > gone.position ? { ...card, position: card.position - 1 } : card)),
  }
}

// ---------------------------------------------------------------------------
// A card's form: what «حفظ» sends
// ---------------------------------------------------------------------------

export interface ChecklistRow {
  /** Stands for the row on the screen: the item's id, or a fresh one for a row not yet saved. */
  key: string
  id: string | null
  text: string
  done: boolean
}
/** A card as its dialog edits it. `link` is `<collection>:<docId>`, or empty for none; `dueOn` is a day or empty. */
export interface CardForm {
  title: string
  priority: Priority
  dueOn: string
  people: string[]
  labels: string[]
  notes: string
  checklist: ChecklistRow[]
  link: string
}
/** The fields of a card that have a sentence under them. */
export type CardField = 'title' | 'notes' | 'due_on' | 'checklist'

export const linkValue = (link: CardLink | null): string => (link === null ? '' : `${link.collection}:${link.docId}`)

export const formOf = (card: BoardCard): CardForm => ({
  title: card.title,
  priority: card.priority,
  dueOn: card.dueOn ?? '',
  people: [...card.people],
  labels: [...card.labels],
  notes: card.notes,
  checklist: card.checklist.map((item) => ({ key: item.id, id: item.id, text: item.text, done: item.done })),
  link: linkValue(card.link),
})

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const left = [...a].sort()
  const right = [...b].sort()
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/**
 * What a card's form changes against the card it was opened on: only the keys that differ, as `board_card_update` takes
 * them (a due day is a day or null, labels and people are the whole lists, the checklist is the whole list in order with
 * the id of an existing item or null for a new one, the link is {collection, docId} or null), and a sentence for each
 * field that cannot be sent. A checklist row left empty is dropped.
 */
export function cardChanges(form: CardForm, base: BoardCard): { changes: Record<string, unknown>; errors: Partial<Record<CardField, string>> } {
  const changes: Record<string, unknown> = {}
  const errors: Partial<Record<CardField, string>> = {}

  const title = checkText(form.title, 'title', 200)
  if (title.error !== null) errors.title = title.error
  else if (title.value !== base.title) changes.title = title.value

  const notes = checkText(form.notes, 'notes', 5000, 0)
  if (notes.error !== null) errors.notes = notes.error
  else if (notes.value !== base.notes) changes.notes = notes.value

  if (form.priority !== base.priority) changes.priority = form.priority

  if (form.dueOn !== '' && !isDay(form.dueOn)) errors.due_on = INVALID_DAY
  else if ((form.dueOn === '' ? null : form.dueOn) !== base.dueOn) changes.dueOn = form.dueOn === '' ? null : form.dueOn

  if (!sameSet(form.labels, base.labels)) changes.labels = [...form.labels]
  if (!sameSet(form.people, base.people)) changes.people = [...form.people]

  const items: Array<{ id: string | null; text: string; done: boolean }> = []
  for (const row of form.checklist) {
    const checked = checkText(row.text, 'checklist', 200, 0)
    if (checked.error !== null) errors.checklist = checked.error
    else if (checked.value !== '') items.push({ id: row.id, text: checked.value, done: row.done })
  }
  const unchanged =
    items.length === base.checklist.length && items.every((item, index) => item.id === base.checklist[index]!.id && item.text === base.checklist[index]!.text && item.done === base.checklist[index]!.done)
  if (errors.checklist === undefined && !unchanged) changes.checklist = items

  if (form.link !== linkValue(base.link)) {
    const at = form.link.indexOf(':')
    changes.link = at === -1 ? null : { collection: form.link.slice(0, at), docId: form.link.slice(at + 1) }
  }
  return { changes, errors }
}

/**
 * The changes as the project stands now. A label or a person it no longer has is left out: its box is no longer drawn, so
 * it could not be unticked, and the save would be refused for ever. On a newer version (`newer`, «احفظ نسختي» after a
 * stale answer), a checklist item that version no longer holds goes back as a new one: the list is kept as it was typed.
 */
export function fitChanges(changes: Record<string, unknown>, data: Pick<BoardData, 'labels' | 'people'>, newer: BoardCard | null = null): Record<string, unknown> {
  const fitted = { ...changes }
  if (Array.isArray(fitted.labels)) fitted.labels = (fitted.labels as string[]).filter((id) => data.labels.some((label) => label.id === id))
  if (Array.isArray(fitted.people)) fitted.people = (fitted.people as string[]).filter((id) => data.people.some((person) => person.id === id && person.role !== 'viewer'))
  if (newer !== null && Array.isArray(fitted.checklist)) {
    const kept = new Set(newer.checklist.map((item) => item.id))
    fitted.checklist = (fitted.checklist as Array<{ id: string | null; text: string; done: boolean }>).map((item) => (item.id !== null && !kept.has(item.id) ? { ...item, id: null } : item))
  }
  return fitted
}

// ---------------------------------------------------------------------------
// The keyboard, in reading terms
// ---------------------------------------------------------------------------

export type Direction = 'rtl' | 'ltr'
export type KeyMove = 'up' | 'down' | 'previous' | 'next'

/**
 * What an arrow key means on a board read in `direction`. Up and down are the card above and the card below. Left and
 * right are the neighbouring column in reading order: on a right-to-left page the right arrow goes to the previous column
 * (the one that comes first, at the start edge) and the left arrow to the next, and on a left-to-right page the reverse.
 */
export function keyMove(code: string, direction: Direction): KeyMove | null {
  switch (code) {
    case 'ArrowUp':
      return 'up'
    case 'ArrowDown':
      return 'down'
    case 'ArrowRight':
      return direction === 'rtl' ? 'previous' : 'next'
    case 'ArrowLeft':
      return direction === 'rtl' ? 'next' : 'previous'
    default:
      return null
  }
}

/** The column an arrow moves to, in reading order; null at either end and for a column that is not on the board. */
export function neighbourColumn(columns: readonly string[], current: string, move: 'previous' | 'next'): string | null {
  const index = columns.indexOf(current)
  if (index === -1) return null
  return columns[move === 'previous' ? index - 1 : index + 1] ?? null
}

// ---------------------------------------------------------------------------
// The owner's CSV (made in the browser from `board_export`, never stored)
// ---------------------------------------------------------------------------

export const CSV_HEADER = ['العنوان', 'العمود', 'الأولوية', 'الموعد', 'الوسوم', 'الأشخاص', 'البنود', 'الملاحظات', 'مرتبطة بـ', 'مؤرشفة'] as const

/** A cell: a text that starts like a formula gets a `'` first (`=`, `+`, `-`, `@`, a tab or a carriage return), then it is quoted. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

/** UTF-8 with a byte order mark, every cell quoted, one row to a card, the header first. */
export function csvOf(cards: readonly ExportCard[]): string {
  const rows = [
    [...CSV_HEADER] as string[],
    ...cards.map((card) => [
      card.title,
      card.column,
      PRIORITY_LABELS[card.priority],
      card.dueOn ?? '',
      card.labels.join('، '),
      card.people.join('، '),
      card.checklist.map((item) => `${item.done ? '✓ ' : ''}${item.text}`).join('\n'),
      card.notes,
      card.link === null ? '' : (card.link.title ?? UNPUBLISHED),
      card.archived ? 'نعم' : 'لا',
    ]),
  ]
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}
