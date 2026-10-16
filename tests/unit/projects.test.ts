// P12 round R2: the projects board's parts that need no React (`src/lib/projects.ts`): the strict parsers of what the
// `public.board_*` functions answer (the shapes `supabase/migrations/20261016120100_p12_board.sql` builds), the reading of
// a refusal, section 7's sentences, search, each filter, the arrow keys in reading terms on a right-to-left board, the
// positions a drop and «نقل إلى…» send, the late-day forms, the plural forms and the owner's CSV. The screens are proven in
// tests/e2e/projects.spec.ts.
import { describe, expect, it } from 'vitest'

import {
  addDays,
  applyMove,
  callBoard,
  cardChanges,
  cardsPhrase,
  checkText,
  checklistText,
  columnItems,
  csvCell,
  csvOf,
  CSV_HEADER,
  daysBetween,
  doneText,
  droppedText,
  dropPosition,
  dueLabel,
  formatDay,
  formOf,
  hasFilters,
  initialOf,
  isUuid,
  keyMove,
  latePhrase,
  lateText,
  liftedText,
  linkValue,
  matchesFilters,
  matchesSearch,
  menuPositions,
  MOVE_INSTRUCTIONS,
  neighbourColumn,
  NO_FILTERS,
  normalizeSearch,
  overText,
  parseArchivedCard,
  parseBoard,
  parseCard,
  parseColumn,
  parseExport,
  parseLinkTargets,
  parseMine,
  parseMove,
  parseProjectRef,
  parseProjects,
  peoplePhrase,
  peopleParts,
  peopleWords,
  positionText,
  readRefusal,
  refusalText,
  riyadhDayOf,
  withCard,
  withoutCard,
  fitChanges,
  writeRefusalText,
  type BoardCard,
  type BoardData,
  type CardForm,
  type ExportCard,
  type Filters,
  type Refusal,
} from '../../src/lib/projects'

const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const TODAY = '2026-10-16'

type Loose = Record<string, any>
const card = (over: Loose = {}): Loose => ({
  id: U(10),
  columnId: U(2),
  position: 1,
  title: 'صور حقيقية لكل نكهة',
  notes: 'صورة لكل نكهة',
  priority: 'normal',
  dueOn: '2026-10-20',
  doneAt: null,
  labels: [U(5)],
  people: [U(7)],
  checklist: [{ id: U(20), text: 'حجز يوم التصوير', done: true }],
  link: { collection: 'rooms', docId: 'shelf', title: 'على الرف' },
  version: 3,
  ...over,
})
const board = (): Loose => ({
  project: { id: U(1), name: 'إطلاق ذرى', version: 2, archived: false },
  role: 'member',
  columns: [
    { id: U(2), name: 'أفكار', position: 1, hidden: false, isDone: false, version: 1 },
    { id: U(3), name: 'تم', position: 2, hidden: false, isDone: true, version: 4 },
  ],
  labels: [{ id: U(5), name: 'تصوير', tone: 'saffron', version: 1 }],
  people: [
    { id: U(7), name: 'أنس', role: 'owner' },
    { id: U(8), name: 'مشارك', role: 'member' },
  ],
  cards: [card(), card({ id: U(11), position: 2, dueOn: null, link: null, labels: [], people: [], checklist: [] })],
})

/** Each mutation of a valid reply is refused: `parse` throws on it. */
function refuses(parse: (value: unknown) => unknown, make: () => Loose, mutations: Record<string, (reply: any) => void>): void {
  expect(() => parse(make()), 'the valid reply').not.toThrow()
  for (const [name, mutate] of Object.entries(mutations)) {
    const reply = make()
    mutate(reply)
    expect(() => parse(reply), name).toThrow()
  }
}

describe('the replies, parsed strictly', () => {
  it('reads board_project: every key, the nulls, the caller\'s role', () => {
    const data = parseBoard(board())
    expect(data.role).toBe('member')
    expect(data.project).toEqual({ id: U(1), name: 'إطلاق ذرى', version: 2, archived: false })
    expect(data.columns[1]).toEqual({ id: U(3), name: 'تم', position: 2, hidden: false, isDone: true, version: 4 })
    expect(data.labels).toEqual([{ id: U(5), name: 'تصوير', tone: 'saffron', version: 1 }])
    expect(data.people.map((person) => person.role)).toEqual(['owner', 'member'])
    expect(data.cards[0]).toMatchObject({ dueOn: '2026-10-20', doneAt: null, link: { collection: 'rooms', docId: 'shelf', title: 'على الرف' }, version: 3 })
    expect(data.cards[1]).toMatchObject({ dueOn: null, link: null, labels: [], checklist: [] })
  })

  it('reads a doneAt with its offset and a link whose title the caller may not read', () => {
    const reply = board()
    reply.cards[0] = card({ doneAt: '2026-10-16T21:05:00.123456+00:00', link: { collection: 'posts', docId: 'a-post', title: null } })
    expect(parseBoard(reply).cards[0]).toMatchObject({ doneAt: '2026-10-16T21:05:00.123456+00:00', link: { collection: 'posts', title: null } })
  })

  it('refuses a board_project reply that is not what it should be', () => {
    refuses(parseBoard, board, {
      'a project with no id': (b) => delete b.project.id,
      'a project id that is no uuid': (b) => (b.project.id = 'x'),
      'a project name that is a number': (b) => (b.project.name = 5),
      'a project version of 1.5': (b) => (b.project.version = 1.5),
      'a negative project version': (b) => (b.project.version = -1),
      'a project version as text': (b) => (b.project.version = '2'),
      'archived as text': (b) => (b.project.archived = 'no'),
      'no project': (b) => delete b.project,
      'a role that is no project role': (b) => (b.role = 'board'),
      'no role': (b) => delete b.role,
      'columns that are no list': (b) => (b.columns = {}),
      'a column with no name': (b) => delete b.columns[0].name,
      'a column at position 0': (b) => (b.columns[0].position = 0),
      'hidden as a number': (b) => (b.columns[0].hidden = 1),
      'isDone missing': (b) => delete b.columns[1].isDone,
      'a column id that is no uuid': (b) => (b.columns[0].id = 'x'),
      'a column version of null': (b) => (b.columns[0].version = null),
      'a label tone outside the palette': (b) => (b.labels[0].tone = 'purple'),
      'a label with no name': (b) => delete b.labels[0].name,
      'a person with the board-only staff role': (b) => (b.people[0].role = 'board'),
      'a person with no name': (b) => delete b.people[0].name,
      'a card in a column the project does not have': (b) => (b.cards[0].columnId = U(99)),
      'a card priority outside the three': (b) => (b.cards[0].priority = 'high'),
      'a due day that is no calendar day': (b) => (b.cards[0].dueOn = '2026-02-30'),
      'a due day as a number': (b) => (b.cards[0].dueOn = 20261020),
      'a due day with a time': (b) => (b.cards[0].dueOn = '2026-10-20T00:00:00Z'),
      'a doneAt that is only a day': (b) => (b.cards[0].doneAt = '2026-10-16'),
      'a doneAt with no offset': (b) => (b.cards[0].doneAt = '2026-10-16T21:05:00'),
      'a doneAt that is not a time': (b) => (b.cards[0].doneAt = 'yesterday'),
      'a card label that is no uuid': (b) => (b.cards[0].labels = ['x']),
      'a card person that is a number': (b) => (b.cards[0].people = [1]),
      'a checklist item with no id': (b) => delete b.cards[0].checklist[0].id,
      'a checklist item with done as text': (b) => (b.cards[0].checklist[0].done = 'yes'),
      'a link collection that is not posts or rooms': (b) => (b.cards[0].link.collection = 'users'),
      'a link title that is a number': (b) => (b.cards[0].link.title = 5),
      'a link with no docId': (b) => delete b.cards[0].link.docId,
      'a card position of 0': (b) => (b.cards[0].position = 0),
      'a card version as text': (b) => (b.cards[0].version = '3'),
      'a card with no notes': (b) => delete b.cards[0].notes,
      'cards that are no list': (b) => (b.cards = null),
    })
    for (const value of [null, undefined, [], 'text', 7]) expect(() => parseBoard(value), String(value)).toThrow()
  })

  it('reads a card and a column as the writes answer them, and refuses the same faults', () => {
    expect(parseCard(card()).id).toBe(U(10))
    expect(parseColumn(board().columns[0]).name).toBe('أفكار')
    refuses(parseCard, card, {
      'no title': (c) => delete c.title,
      'a title that is a number': (c) => (c.title = 3),
      'a priority of null': (c) => (c.priority = null),
      'labels that are no list': (c) => (c.labels = 'a'),
      'a checklist that is no list': (c) => (c.checklist = {}),
    })
    refuses(parseColumn, () => board().columns[0], { 'no position': (c) => delete c.position, 'a name that is null': (c) => (c.name = null) })
  })

  it('reads the reply of an archive: the card as it was written, with no position (an archived card has none)', () => {
    const archived = { ...card(), position: null }
    expect(parseArchivedCard(archived)).toMatchObject({ id: U(10), position: null, title: 'صور حقيقية لكل نكهة' })
    expect(parseArchivedCard(card()).position).toBe(1)
    // An open card's reply still needs its place, and a position of 0 is no position.
    expect(() => parseCard(archived)).toThrow()
    expect(() => parseArchivedCard({ ...card(), position: 0 })).toThrow()
    expect(() => parseArchivedCard({ ...card(), priority: 'x', position: null })).toThrow()
  })

  it('reads board_projects', () => {
    const reply = [{ id: U(1), name: 'ذرى', archived: false, cards: 11, overdue: 1, people: [{ id: U(7), name: 'أنس' }] }]
    expect(parseProjects(reply)).toEqual(reply)
    expect(parseProjects([])).toEqual([])
    refuses(parseProjects, () => JSON.parse(JSON.stringify(reply)), {
      'a count that is a string': (r) => (r[0].cards = '11'),
      'a negative overdue count': (r) => (r[0].overdue = -1),
      'a project with no people': (r) => delete r[0].people,
      'a person with no name': (r) => delete r[0].people[0].name,
      'archived as null': (r) => (r[0].archived = null),
      'a project that is an empty object': (r) => r.splice(0, r.length, {}),
    })
    expect(() => parseProjects({})).toThrow()
  })

  it('reads board_mine', () => {
    const reply = [{ id: U(10), title: 'بطاقة', priority: 'urgent', dueOn: null, project: { id: U(1), name: 'ذرى' }, column: { id: U(2), name: 'أفكار' } }]
    expect(parseMine(reply)).toEqual(reply)
    refuses(parseMine, () => JSON.parse(JSON.stringify(reply)), {
      'no project': (r) => delete r[0].project,
      'a column with no name': (r) => delete r[0].column.name,
      'a priority outside the three': (r) => (r[0].priority = 'asap'),
      'a due day that is not real': (r) => (r[0].dueOn = '2026-13-01'),
      'a card id that is no uuid': (r) => (r[0].id = 'x'),
    })
  })

  it('reads board_link_targets', () => {
    const reply = [{ collection: 'posts', docId: 'a-post', title: 'مقال' }, { collection: 'rooms', docId: 'shelf', title: 'على الرف' }]
    expect(parseLinkTargets(reply)).toEqual(reply)
    refuses(parseLinkTargets, () => JSON.parse(JSON.stringify(reply)), {
      'a collection that is not posts or rooms': (r) => (r[0].collection = 'media'),
      'a title of null': (r) => (r[0].title = null),
      'no docId': (r) => delete r[1].docId,
    })
  })

  it('reads the reply of a move: the card and the columns it touched', () => {
    const reply = { card: card({ columnId: U(3), doneAt: '2026-10-16T10:00:00+00:00' }), columns: [{ id: U(3), cards: [{ id: U(10), position: 1 }] }] }
    expect(parseMove(reply).columns).toEqual([{ id: U(3), cards: [{ id: U(10), position: 1 }] }])
    refuses(parseMove, () => JSON.parse(JSON.stringify(reply)), {
      'no card': (r) => delete r.card,
      'a card that is malformed': (r) => (r.card.priority = 'x'),
      'columns that are no list': (r) => (r.columns = 1),
      'a position of 0': (r) => (r.columns[0].cards[0].position = 0),
      'a card with no id': (r) => delete r.columns[0].cards[0].id,
    })
  })

  it('reads the reply of a project write and board_export', () => {
    expect(parseProjectRef({ id: U(1), name: 'ذرى', version: 1, archived: false })).toEqual({ id: U(1), name: 'ذرى', version: 1, archived: false })
    expect(() => parseProjectRef({ id: U(1), name: 'ذرى', version: 1 })).toThrow()
    const row = {
      id: U(10),
      title: 'بطاقة',
      column: 'أفكار',
      priority: 'low',
      dueOn: '2026-10-20',
      doneAt: null,
      labels: ['تصوير'],
      people: ['أنس'],
      checklist: [{ text: 'بند', done: false }],
      notes: 'ملاحظة',
      link: null,
      archived: true,
    }
    expect(parseExport([row])).toEqual([row])
    refuses(parseExport, () => [JSON.parse(JSON.stringify(row))], {
      'a label that is a number': (r) => (r[0].labels = [1]),
      'a checklist item with no text': (r) => delete r[0].checklist[0].text,
      'archived missing': (r) => delete r[0].archived,
      'a column that is null': (r) => (r[0].column = null),
      'a notes that is null': (r) => (r[0].notes = null),
    })
  })

  it('knows a uuid', () => {
    expect(isUuid(U(1))).toBe(true)
    for (const value of ['', 'x', '00000000-0000-4000-8000-00000000000A', `${U(1)}0`]) expect(isUuid(value), value).toBe(false)
  })
})

describe('a refused write', () => {
  it('says the write failed for a row that is gone (NOT_FOUND) and for a stale version, and every other refusal its own sentence', () => {
    const SAVE = 'تعذّر الحفظ؛ أعد المحاولة.'
    expect(writeRefusalText({ code: 'NOT_FOUND', detail: '' }, SAVE)).toBe(SAVE)
    expect(writeRefusalText({ code: 'STALE', detail: '' }, SAVE)).toBe(SAVE)
    expect(writeRefusalText(null, SAVE)).toBe(SAVE)
    expect(writeRefusalText({ code: 'FORBIDDEN', detail: '' }, SAVE)).toBe('ليس لدورك أن يفعل هذا.')
    expect(writeRefusalText({ code: 'LIMIT', detail: 'card_people' }, SAVE)).toBe('للبطاقة 10 أشخاص على الأكثر.')
    expect(writeRefusalText({ code: 'INVALID', detail: 'labels' }, SAVE)).toBe(SAVE)
  })
})

describe('refusals', () => {
  const api = (message: string, details = '', code = message === 'STALE' ? '23505' : 'P0001') => ({ code, message, details })

  it('reads the code in the message and the field in the details, with the SQLSTATE the SQL gives each', () => {
    expect(readRefusal(api('NOT_FOUND'))).toEqual({ code: 'NOT_FOUND', detail: '' })
    expect(readRefusal(api('FORBIDDEN'))).toEqual({ code: 'FORBIDDEN', detail: '' })
    expect(readRefusal(api('STALE'))).toEqual({ code: 'STALE', detail: '' })
    expect(readRefusal(api('INVALID', 'title'))).toEqual({ code: 'INVALID', detail: 'title' })
    expect(readRefusal(api('LIMIT', 'columns'))).toEqual({ code: 'LIMIT', detail: 'columns' })
    expect(readRefusal(api('NOT_EMPTY'))).toEqual({ code: 'NOT_EMPTY', detail: '' })
    // The pg driver spells the field `detail`.
    expect(readRefusal({ code: 'P0001', message: 'INVALID', detail: 'name' })).toEqual({ code: 'INVALID', detail: 'name' })
    expect(readRefusal({ code: 'P0001', message: 'LIMIT', details: null })).toEqual({ code: 'LIMIT', detail: '' })
  })

  it('does not take any other failure for a refusal', () => {
    expect(readRefusal(null)).toBeNull()
    expect(readRefusal(undefined)).toBeNull()
    expect(readRefusal({ message: 'TypeError: Failed to fetch' })).toBeNull()
    expect(readRefusal({ code: '', message: 'FetchError' })).toBeNull()
    // STALE is 23505 and every other code P0001: a word on another SQLSTATE is another error.
    expect(readRefusal(api('STALE', '', 'P0001'))).toBeNull()
    expect(readRefusal(api('NOT_FOUND', '', '23505'))).toBeNull()
    expect(readRefusal(api('NOT_FOUND', '', '42501'))).toBeNull()
    expect(readRefusal(api('SOMETHING'))).toBeNull()
    expect(readRefusal({ code: 'P0001' })).toBeNull()
  })

  it('says each refusal in section 7\'s sentence', () => {
    const say = (code: Refusal['code'], detail = '') => refusalText({ code, detail })
    expect(say('NOT_FOUND')).toBe('لم يعد هذا المشروع متاحًا لك.')
    expect(say('FORBIDDEN')).toBe('ليس لدورك أن يفعل هذا.')
    expect(say('STALE')).toBe('تغيّرت هذه البطاقة منذ فتحتها؛ هذه نسختها الأحدث.')
    expect(say('NOT_EMPTY')).toBe('لا يُحذف عمود فيه بطاقات؛ انقلها أولًا.')
    expect(refusalText({ code: 'NOT_EMPTY', detail: '' }, { onlyColumn: true })).toBe('هذا آخر عمود في المشروع، وفيه بطاقات مؤرشفة؛ أضف عمودًا قبل حذفه.')
    expect(say('LIMIT', 'columns')).toBe('بلغ المشروع أقصى عدد من الأعمدة (12).')
    expect(say('LIMIT', 'labels')).toBe('بلغ المشروع أقصى عدد من الوسوم (16).')
    expect(say('LIMIT', 'people')).toBe('بلغ المشروع أقصى عدد من الأشخاص (30).')
    expect(say('LIMIT', 'cards')).toBe('بلغ المشروع أقصى عدد من البطاقات المفتوحة (1000).')
    expect(say('LIMIT', 'card_people')).toBe('للبطاقة 10 أشخاص على الأكثر.')
    expect(say('LIMIT', 'checklist')).toBe('للبطاقة 50 بندًا على الأكثر.')
    expect(say('LIMIT', 'projects')).toBe('بلغت المشاريع المفتوحة أقصى عددها (50).')
    expect(say('INVALID', 'name')).toBe('اكتب اسمًا.')
    expect(say('INVALID', 'title')).toBe('اكتب عنوانًا.')
    expect(say('INVALID', 'notes')).toBe('النص أطول من المسموح.')
    expect(say('INVALID', 'due_on')).toBe('تاريخ غير صالح.')
    // A field section 7 gives no sentence for is left to the caller's «تعذّر الحفظ؛ أعد المحاولة.».
    for (const detail of ['labels', 'people', 'link', 'position', 'role', 'tone', '']) expect(say('INVALID', detail), detail).toBeNull()
    expect(say('LIMIT', 'unknown')).toBeNull()
  })

  it('checks a text as the SQL does, before the press: control characters, trimmed, its lengths', () => {
    expect(checkText('  عنوان  ', 'title', 200)).toEqual({ value: 'عنوان', error: null })
    expect(checkText('   ', 'title', 200)).toEqual({ value: '', error: 'اكتب عنوانًا.' })
    expect(checkText('', 'name', 80)).toEqual({ value: '', error: 'اكتب اسمًا.' })
    expect(checkText('س'.repeat(201), 'title', 200).error).toBe('النص أطول من المسموح.')
    expect(checkText('س'.repeat(200), 'title', 200).error).toBeNull()
    // Characters, not UTF-16 units: 200 astral characters are 200.
    expect(checkText('😀'.repeat(200), 'title', 200).error).toBeNull()
    expect(checkText('😀'.repeat(201), 'title', 200).error).toBe('النص أطول من المسموح.')
    expect(checkText('a\u0000b', 'title', 200).error).toBe('لا يُقبل نص فيه رموز تحكم.')
    expect(checkText('a\tb', 'name', 80).error).toBe('لا يُقبل نص فيه رموز تحكم.')
    expect(checkText('a\u009fb', 'title', 200).error).toBe('لا يُقبل نص فيه رموز تحكم.')
    // A note may hold line feeds and be empty; a carriage return or a tab is a control character in it too.
    expect(checkText('سطر\nسطر\n\n', 'notes', 5000, 0)).toEqual({ value: 'سطر\nسطر', error: null })
    expect(checkText('', 'notes', 5000, 0)).toEqual({ value: '', error: null })
    expect(checkText('سطر\r\nسطر', 'notes', 5000, 0).error).toBe('لا يُقبل نص فيه رموز تحكم.')
    expect(checkText('a\tb', 'notes', 5000, 0).error).toBe('لا يُقبل نص فيه رموز تحكم.')
    expect(checkText('س'.repeat(5001), 'notes', 5000, 0).error).toBe('النص أطول من المسموح.')
    // A single line holds no line feed.
    expect(checkText('a\nb', 'title', 200).error).toBe('لا يُقبل نص فيه رموز تحكم.')
  })

  it('calls a function and reads its reply, or says why it could not', async () => {
    const ok = { rpc: async () => ({ data: { id: U(1), name: 'ذرى', version: 1, archived: false }, error: null }) }
    expect(await callBoard(ok, 'board_project_create', { p_name: 'ذرى' }, parseProjectRef)).toEqual({ ok: true, value: { id: U(1), name: 'ذرى', version: 1, archived: false } })
    const refused = { rpc: async () => ({ data: null, error: { code: '23505', message: 'STALE', details: '' } }) }
    expect(await callBoard(refused, 'x', {}, parseProjectRef)).toEqual({ ok: false, refusal: { code: 'STALE', detail: '' } })
    const down = { rpc: async () => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' } }) }
    expect(await callBoard(down, 'x', {}, parseProjectRef)).toEqual({ ok: false, refusal: null })
    const thrown = { rpc: async () => { throw new Error('offline') } }
    expect(await callBoard(thrown, 'x', {}, parseProjectRef)).toEqual({ ok: false, refusal: null })
    // A reply that cannot be read is a failure, never a half-drawn answer.
    const odd = { rpc: async () => ({ data: { id: 'x' }, error: null }) }
    expect(await callBoard(odd, 'x', {}, parseProjectRef)).toEqual({ ok: false, refusal: null })
    let seen: unknown[] = []
    const spy = { rpc: async (fn: string, args?: Record<string, unknown>) => ((seen = [fn, args]), { data: [], error: null }) }
    await callBoard(spy, 'board_projects', {}, parseProjects)
    expect(seen).toEqual(['board_projects', {}])
  })
})

describe('search', () => {
  const c = (over: Partial<BoardCard> = {}): Pick<BoardCard, 'title' | 'notes' | 'checklist'> => ({
    title: 'صور حقيقية لكل نكهة',
    notes: 'بضوء النهار، من غير نص على الصورة',
    checklist: [{ id: U(20), text: 'تجهيز النكهات', done: false }],
    ...over,
  })

  it('finds a word in the title, the notes or the checklist, and finds every card for nothing typed', () => {
    expect(matchesSearch(c(), 'حقيقية')).toBe(true)
    expect(matchesSearch(c(), 'النهار')).toBe(true)
    expect(matchesSearch(c(), 'تجهيز')).toBe(true)
    expect(matchesSearch(c(), 'غائب')).toBe(false)
    for (const empty of ['', '   ']) expect(matchesSearch(c(), empty), JSON.stringify(empty)).toBe(true)
  })

  it('needs every typed word, in any order', () => {
    expect(matchesSearch(c(), 'صور نكهة')).toBe(true)
    expect(matchesSearch(c(), 'نكهة صور')).toBe(true)
    expect(matchesSearch(c(), 'صور غائب')).toBe(false)
  })

  it('reads the spellings people mix: diacritics, alef forms, ya and alef maqsura, ta marbuta, digits, case', () => {
    expect(matchesSearch(c({ title: 'إعلان قصير' }), 'اعلان')).toBe(true)
    expect(matchesSearch(c({ title: 'اعلان قصير' }), 'إعلان')).toBe(true)
    expect(matchesSearch(c({ title: 'مُراجَعة' }), 'مراجعه')).toBe(true)
    expect(matchesSearch(c({ title: 'موسى' }), 'موسي')).toBe(true)
    expect(matchesSearch(c({ title: 'كــتاب' }), 'كتاب')).toBe(true)
    expect(matchesSearch(c({ title: 'دفعة 3' }), 'دفعة ٣')).toBe(true)
    expect(matchesSearch(c({ title: 'دفعة ٣' }), '3')).toBe(true)
    expect(matchesSearch(c({ title: 'Launch Plan' }), 'launch')).toBe(true)
    expect(normalizeSearch('أُنجزت ۱۲')).toBe('انجزت 12')
  })
})

describe('the filters', () => {
  const c = (over: Partial<BoardCard> = {}): BoardCard =>
    parseCard(card({ dueOn: null, link: null, ...(over as Loose) }))
  const pass = (cardOver: Partial<BoardCard>, filters: Partial<Filters>, inDone = false) =>
    matchesFilters(c(cardOver), { ...NO_FILTERS, ...filters }, TODAY, inDone)

  it('shows every card when every filter is «الكل»', () => {
    expect(hasFilters(NO_FILTERS)).toBe(false)
    expect(pass({}, {})).toBe(true)
    expect(pass({ dueOn: '2020-01-01' }, {}, true)).toBe(true)
  })

  it('filters by priority', () => {
    expect(pass({ priority: 'urgent' }, { priority: 'urgent' })).toBe(true)
    expect(pass({ priority: 'normal' }, { priority: 'urgent' })).toBe(false)
    expect(pass({ priority: 'low' }, { priority: 'low' })).toBe(true)
    expect(hasFilters({ ...NO_FILTERS, priority: 'low' })).toBe(true)
  })

  it('filters by due day: overdue, today, this week (today and the six days after it), none', () => {
    expect(pass({ dueOn: '2026-10-15' }, { due: 'overdue' })).toBe(true)
    expect(pass({ dueOn: TODAY }, { due: 'overdue' })).toBe(false)
    expect(pass({ dueOn: null }, { due: 'overdue' })).toBe(false)
    expect(pass({ dueOn: TODAY }, { due: 'today' })).toBe(true)
    expect(pass({ dueOn: '2026-10-17' }, { due: 'today' })).toBe(false)
    expect(pass({ dueOn: TODAY }, { due: 'week' })).toBe(true)
    expect(pass({ dueOn: '2026-10-22' }, { due: 'week' })).toBe(true)
    expect(pass({ dueOn: '2026-10-23' }, { due: 'week' })).toBe(false)
    expect(pass({ dueOn: '2026-10-15' }, { due: 'week' })).toBe(false)
    expect(pass({ dueOn: null }, { due: 'none' })).toBe(true)
    expect(pass({ dueOn: TODAY }, { due: 'none' })).toBe(false)
  })

  it('leaves a done card out of «متأخرة», «اليوم» and «هذا الأسبوع», as the overview does, and keeps it for «بلا موعد»', () => {
    expect(pass({ dueOn: '2026-10-01' }, { due: 'overdue' }, true)).toBe(false)
    expect(pass({ dueOn: TODAY }, { due: 'today' }, true)).toBe(false)
    expect(pass({ dueOn: '2026-10-18' }, { due: 'week' }, true)).toBe(false)
    expect(pass({ dueOn: null }, { due: 'none' }, true)).toBe(true)
  })

  it('filters by label and by person', () => {
    expect(pass({ labels: [U(5)] }, { label: U(5) })).toBe(true)
    expect(pass({ labels: [U(6)] }, { label: U(5) })).toBe(false)
    expect(pass({ labels: [] }, { label: U(5) })).toBe(false)
    expect(pass({ people: [U(7), U(8)] }, { person: U(8) })).toBe(true)
    expect(pass({ people: [U(7)] }, { person: U(8) })).toBe(false)
  })

  it('filters by link', () => {
    const link = { collection: 'rooms', docId: 'shelf', title: 'على الرف' } as const
    expect(pass({ link }, { link: 'linked' })).toBe(true)
    expect(pass({ link: null }, { link: 'linked' })).toBe(false)
    expect(pass({ link: null }, { link: 'unlinked' })).toBe(true)
    expect(pass({ link }, { link: 'unlinked' })).toBe(false)
  })

  it('applies every filter at once', () => {
    const filters = { priority: 'urgent', due: 'today', label: U(5), person: U(7), link: 'unlinked' } as const
    const full: Partial<BoardCard> = { priority: 'urgent', dueOn: TODAY, labels: [U(5)], people: [U(7)], link: null }
    expect(pass(full, filters)).toBe(true)
    const breaks: Array<[string, Partial<BoardCard>]> = [
      ['priority', { priority: 'low' }],
      ['dueOn', { dueOn: '2026-10-17' }],
      ['labels', { labels: [] }],
      ['people', { people: [] }],
      ['link', { link: { collection: 'rooms', docId: 'x', title: null } }],
    ]
    for (const [key, change] of breaks) expect(pass({ ...full, ...change }, filters), key).toBe(false)
  })
})

describe('the arrow keys, in reading terms', () => {
  it('on a right-to-left board the right arrow goes to the previous column and the left arrow to the next', () => {
    expect(keyMove('ArrowRight', 'rtl')).toBe('previous')
    expect(keyMove('ArrowLeft', 'rtl')).toBe('next')
  })

  it('on a left-to-right board it is the other way', () => {
    expect(keyMove('ArrowRight', 'ltr')).toBe('next')
    expect(keyMove('ArrowLeft', 'ltr')).toBe('previous')
  })

  it('up and down are the card above and below, in either direction, and no other key moves', () => {
    for (const direction of ['rtl', 'ltr'] as const) {
      expect(keyMove('ArrowUp', direction)).toBe('up')
      expect(keyMove('ArrowDown', direction)).toBe('down')
      for (const code of ['Space', 'Enter', 'Tab', 'Escape', 'KeyA', 'Home', '']) expect(keyMove(code, direction), code).toBeNull()
    }
  })

  it('finds the neighbouring column in reading order, and none past either end', () => {
    const columns = ['أفكار', 'تجهيز', 'قيد العمل', 'تم']
    expect(neighbourColumn(columns, 'تجهيز', 'previous')).toBe('أفكار')
    expect(neighbourColumn(columns, 'تجهيز', 'next')).toBe('قيد العمل')
    expect(neighbourColumn(columns, 'أفكار', 'previous')).toBeNull()
    expect(neighbourColumn(columns, 'تم', 'next')).toBeNull()
    expect(neighbourColumn(columns, 'غائب', 'next')).toBeNull()
  })

  it('takes a card from «تجهيز» to «أفكار» with the right arrow and to «قيد العمل» with the left, on a right-to-left board', () => {
    const columns = ['أفكار', 'تجهيز', 'قيد العمل', 'تم']
    const go = (code: string) => {
      const move = keyMove(code, 'rtl')
      return move === 'previous' || move === 'next' ? neighbourColumn(columns, 'تجهيز', move) : null
    }
    expect(go('ArrowRight')).toBe('أفكار')
    expect(go('ArrowLeft')).toBe('قيد العمل')
  })

  it('says the instructions and announcements in section 7\'s words', () => {
    expect(MOVE_INSTRUCTIONS).toBe('لنقل بطاقة: المسافة ترفعها، والأسهم تنقلها، والمسافة تُفلتها، و Escape يلغي النقل.')
    expect(liftedText('اعتماد الإعلان')).toBe('رُفعت البطاقة «اعتماد الإعلان».')
    expect(overText('تجهيز', 2, 5)).toBe('البطاقة في «تجهيز»، الموضع 2 من 5.')
    expect(droppedText('تم')).toBe('وُضعت البطاقة في «تم».')
  })
})

describe('positions', () => {
  const ids = (...names: string[]) => names

  it('is the place in the column, counted from 1, when no filter hides a card', () => {
    const column = ids('a', 'b', 'c', 'd')
    // Dropped at index k among the cards without the moved one.
    for (let k = 0; k <= 4; k += 1) expect(dropPosition(column, column, k), `k=${k}`).toBe(k + 1)
    expect(dropPosition([], [], 0)).toBe(1)
  })

  it('lands in the whole list while a filter hides cards: before the shown card, after the last shown, last when none is shown', () => {
    const full = ids('a', 'x', 'b', 'y', 'c')
    const shown = ids('a', 'b', 'c')
    expect(dropPosition(full, shown, 0)).toBe(1)
    expect(dropPosition(full, shown, 1)).toBe(3)
    expect(dropPosition(full, shown, 2)).toBe(5)
    expect(dropPosition(full, shown, 3)).toBe(6)
    expect(dropPosition(full, [], 0)).toBe(6)
    expect(dropPosition([], [], 0)).toBe(1)
  })

  it('matches the SQL: the card ends at the position sent, within a column and across columns', () => {
    // board_card_move: the moved card is taken out, p_position is clamped to 1..n+1 and is the card's final place.
    const sqlMove = (from: string[], to: string[], moved: string, position: number): string[] => {
      const rest = to.filter((entry) => entry !== moved)
      const at = Math.min(Math.max(position, 1), rest.length + 1)
      return [...rest.slice(0, at - 1), moved, ...rest.slice(at - 1)]
    }
    const first = ids('a', 'b', 'c', 'd')
    // Within a column: «b» dropped after «c» (index 2 among a, c, d).
    expect(sqlMove(first, first, 'b', dropPosition(['a', 'c', 'd'], ['a', 'c', 'd'], 2))).toEqual(['a', 'c', 'b', 'd'])
    // «d» dropped first.
    expect(sqlMove(first, first, 'd', dropPosition(['a', 'b', 'c'], ['a', 'b', 'c'], 0))).toEqual(['d', 'a', 'b', 'c'])
    // «a» dropped last.
    expect(sqlMove(first, first, 'a', dropPosition(['b', 'c', 'd'], ['b', 'c', 'd'], 3))).toEqual(['b', 'c', 'd', 'a'])
    // Across: «z» into a column of p, q, r at index 1.
    expect(sqlMove(['z'], ['p', 'q', 'r'], 'z', dropPosition(['p', 'q', 'r'], ['p', 'q', 'r'], 1))).toEqual(['p', 'z', 'q', 'r'])
    // With «x» hidden between p and q, dropped before the shown «q» (index 1 among shown p, q, r): right before q.
    expect(sqlMove(['z'], ['p', 'x', 'q', 'r'], 'z', dropPosition(['p', 'x', 'q', 'r'], ['p', 'q', 'r'], 1))).toEqual(['p', 'x', 'z', 'q', 'r'])
  })

  it('offers «نقل إلى…» one position more in another column than in its own', () => {
    expect(menuPositions(4, true)).toBe(4)
    expect(menuPositions(4, false)).toBe(5)
    expect(menuPositions(0, false)).toBe(1)
    expect(positionText(2, 5)).toBe('الموضع 2 من 5')
  })

  const data = (): BoardData => parseBoard({ ...board(), cards: [card({ id: U(10), position: 1 }), card({ id: U(11), position: 2 }), card({ id: U(12), position: 3 }), card({ id: U(13), columnId: U(3), position: 1 })] })

  it('orders the cards of each column by position, shows only the ones let through, and keeps an entry for an empty column', () => {
    const d = data()
    expect(columnItems(d.cards, d.columns)).toEqual({ [U(2)]: [U(10), U(11), U(12)], [U(3)]: [U(13)] })
    expect(columnItems([...d.cards].reverse(), d.columns)[U(2)]).toEqual([U(10), U(11), U(12)])
    expect(columnItems(d.cards, d.columns, (entry) => entry.id !== U(11))[U(2)]).toEqual([U(10), U(12)])
    expect(columnItems([], d.columns)).toEqual({ [U(2)]: [], [U(3)]: [] })
  })

  it('applies a move\'s reply: the moved card as given, the cards it passed at their new positions', () => {
    const d = data()
    const moved = parseCard(card({ id: U(10), columnId: U(3), position: 1, version: 4, doneAt: '2026-10-16T10:00:00+00:00' }))
    const next = applyMove(d, {
      card: moved,
      columns: [
        { id: U(2), cards: [{ id: U(11), position: 1 }, { id: U(12), position: 2 }] },
        { id: U(3), cards: [{ id: U(10), position: 1 }, { id: U(13), position: 2 }] },
      ],
    })
    expect(next.cards.find((entry) => entry.id === U(10))).toEqual(moved)
    expect(next.cards.map((entry) => [entry.id, entry.columnId, entry.position])).toEqual([
      [U(10), U(3), 1],
      [U(11), U(2), 1],
      [U(12), U(2), 2],
      [U(13), U(3), 2],
    ])
    expect(columnItems(next.cards, next.columns)).toEqual({ [U(2)]: [U(11), U(12)], [U(3)]: [U(10), U(13)] })
    // The old reading is not changed.
    expect(d.cards[0]!.columnId).toBe(U(2))
  })

  it('adds, replaces and archives a card', () => {
    const d = data()
    const fresh = parseCard(card({ id: U(14), position: 4, title: 'جديدة' }))
    expect(withCard(d, fresh).cards).toHaveLength(5)
    const edited = parseCard(card({ id: U(11), position: 2, title: 'معدّلة', version: 9 }))
    const replaced = withCard(d, edited)
    expect(replaced.cards).toHaveLength(4)
    expect(replaced.cards.find((entry) => entry.id === U(11))?.title).toBe('معدّلة')
    const gone = withoutCard(d, U(10))
    expect(gone.cards.map((entry) => [entry.id, entry.position])).toEqual([[U(11), 1], [U(12), 2], [U(13), 1]])
    expect(withoutCard(d, U(99))).toBe(d)
  })
})

describe('days', () => {
  it('says a late card in the forms of section 7: 1, 2, 3 to 10, 11 and more', () => {
    expect(lateText(1)).toBe('متأخرة يومًا واحدًا')
    expect(lateText(2)).toBe('متأخرة يومين')
    expect(lateText(3)).toBe('متأخرة 3 أيام')
    expect(lateText(10)).toBe('متأخرة 10 أيام')
    expect(lateText(11)).toBe('متأخرة 11 يومًا')
    expect(lateText(100)).toBe('متأخرة 100 يومًا')
  })

  it('gives a card\'s due day: late in words, «اليوم», the day (soon within the week, later after it), nothing without one', () => {
    expect(dueLabel(null, TODAY)).toBeNull()
    expect(dueLabel('2026-10-15', TODAY)).toEqual({ text: 'متأخرة يومًا واحدًا', tone: 'late' })
    expect(dueLabel('2026-10-14', TODAY)).toEqual({ text: 'متأخرة يومين', tone: 'late' })
    expect(dueLabel('2026-10-06', TODAY)).toEqual({ text: 'متأخرة 10 أيام', tone: 'late' })
    expect(dueLabel('2026-10-05', TODAY)).toEqual({ text: 'متأخرة 11 يومًا', tone: 'late' })
    expect(dueLabel(TODAY, TODAY)).toEqual({ text: 'اليوم', tone: 'soon' })
    expect(dueLabel('2026-10-22', TODAY)).toEqual({ text: '22 أكتوبر', tone: 'soon' })
    expect(dueLabel('2026-10-23', TODAY)).toEqual({ text: '23 أكتوبر', tone: 'later' })
    expect(dueLabel('2027-01-05', TODAY)).toEqual({ text: '5 يناير 2027', tone: 'later' })
  })

  it('counts Riyadh days, across a month and a year', () => {
    expect(addDays('2026-10-28', 6)).toBe('2026-11-03')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(daysBetween('2026-10-14', TODAY)).toBe(2)
    expect(daysBetween(TODAY, '2026-10-14')).toBe(-2)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    // 21:30 UTC is already the next day in Riyadh (UTC+3); the unit tests run in UTC on every machine.
    expect(riyadhDayOf('2026-10-16T21:30:00+00:00')).toBe('2026-10-17')
    expect(riyadhDayOf('2026-10-16T20:59:00+00:00')).toBe('2026-10-16')
  })

  it('says when a card was done, on the Riyadh day', () => {
    expect(doneText('2026-10-16T10:00:00+00:00', TODAY)).toBe('أُنجزت 16 أكتوبر')
    expect(doneText('2026-10-16T22:00:00+00:00', TODAY)).toBe('أُنجزت 17 أكتوبر')
    expect(formatDay('2026-10-30', TODAY)).toBe('30 أكتوبر')
  })
})

describe('counts in words', () => {
  it('uses every plural form: cards', () => {
    expect(cardsPhrase(0)).toBe('لا بطاقات')
    expect(cardsPhrase(1)).toBe('بطاقة واحدة')
    expect(cardsPhrase(2)).toBe('بطاقتان')
    expect(cardsPhrase(3)).toBe('3 بطاقات')
    expect(cardsPhrase(10)).toBe('10 بطاقات')
    expect(cardsPhrase(11)).toBe('11 بطاقة')
    expect(cardsPhrase(99)).toBe('99 بطاقة')
    expect(cardsPhrase(100)).toBe('100 بطاقة')
    expect(cardsPhrase(103)).toBe('103 بطاقات')
  })

  it('people', () => {
    expect(peoplePhrase(0)).toBe('لا أحد')
    expect(peoplePhrase(1)).toBe('شخص واحد')
    expect(peoplePhrase(2)).toBe('شخصان')
    expect(peoplePhrase(3)).toBe('3 أشخاص')
    expect(peoplePhrase(11)).toBe('11 شخصًا')
    expect(peoplePhrase(100)).toBe('100 شخص')
  })

  it('the late cards of a tile agree with the count', () => {
    expect(latePhrase(1)).toBe('بطاقة واحدة متأخرة')
    expect(latePhrase(2)).toBe('بطاقتان متأخرتان')
    expect(latePhrase(3)).toBe('3 بطاقات متأخرة')
    expect(latePhrase(11)).toBe('11 بطاقة متأخرة')
  })

  it('gives a project\'s people in two parts, so that a screen can set a Latin name apart', () => {
    const named = (count: number) => Array.from({ length: count }, (_, index) => ({ id: U(index + 1), name: `ش${index}` }))
    expect(peopleParts(named(0))).toEqual({ first: null, rest: 'لا أحد' })
    expect(peopleParts(named(1))).toEqual({ first: 'ش0', rest: '' })
    expect(peopleParts(named(3))).toEqual({ first: 'ش0', rest: ' وشخصان' })
  })

  it('names a project\'s people: the first, then the others by count', () => {
    const named = (count: number) => Array.from({ length: count }, (_, index) => ({ id: U(index + 1), name: index === 0 ? 'أنس' : `ش${index}` }))
    expect(peopleWords(named(0))).toBe('لا أحد')
    expect(peopleWords(named(1))).toBe('أنس')
    expect(peopleWords(named(2))).toBe('أنس وشخص واحد')
    expect(peopleWords(named(3))).toBe('أنس وشخصان')
    expect(peopleWords(named(4))).toBe('أنس و3 أشخاص')
    expect(peopleWords(named(12))).toBe('أنس و11 شخصًا')
  })

  it('gives a person\'s mark and a card\'s checklist count', () => {
    expect(initialOf('أنس')).toBe('أ')
    expect(initialOf('  Sara')).toBe('S')
    expect(initialOf('')).toBe('')
    expect(checklistText({ checklist: [] })).toBeNull()
    expect(checklistText({ checklist: [{ id: U(1), text: 'a', done: true }, { id: U(2), text: 'b', done: false }, { id: U(3), text: 'c', done: false }] })).toBe('البنود 1 من 3')
  })
})

describe('a card\'s form: «حفظ» sends only what changed', () => {
  const base = (): BoardCard => parseCard(card({ checklist: [{ id: U(20), text: 'حجز', done: true }, { id: U(21), text: 'تجهيز', done: false }], labels: [U(5), U(6)], people: [U(7), U(8)] }))
  const changed = (edit: (form: CardForm) => void) => {
    const form = formOf(base())
    edit(form)
    return cardChanges(form, base())
  }

  it('sends nothing for a form nobody touched, and for edits that only look like changes (spaces, order)', () => {
    expect(cardChanges(formOf(base()), base())).toEqual({ changes: {}, errors: {} })
    expect(changed((f) => (f.title = '  صور حقيقية لكل نكهة  ')).changes).toEqual({})
    expect(changed((f) => (f.notes = 'صورة لكل نكهة\n\n')).changes).toEqual({})
    expect(changed((f) => (f.labels = [U(6), U(5)])).changes).toEqual({})
    expect(changed((f) => (f.people = [U(8), U(7)])).changes).toEqual({})
  })

  it('sends the title, the notes and the priority when they changed, and nothing else', () => {
    expect(changed((f) => (f.title = 'عنوان آخر')).changes).toEqual({ title: 'عنوان آخر' })
    expect(changed((f) => (f.notes = 'ملاحظة جديدة')).changes).toEqual({ notes: 'ملاحظة جديدة' })
    expect(changed((f) => (f.notes = '')).changes).toEqual({ notes: '' })
    expect(changed((f) => (f.priority = 'urgent')).changes).toEqual({ priority: 'urgent' })
    expect(changed((f) => ((f.title = 'ج'), (f.priority = 'low'))).changes).toEqual({ title: 'ج', priority: 'low' })
  })

  it('sends a due day as a day, and as null when it was cleared (null is not absent: absent leaves it as it is)', () => {
    expect(changed((f) => (f.dueOn = '2026-11-01')).changes).toEqual({ dueOn: '2026-11-01' })
    expect(changed((f) => (f.dueOn = '')).changes).toEqual({ dueOn: null })
    expect('dueOn' in changed((f) => (f.title = 'ج')).changes).toBe(false)
    const none = parseCard(card({ dueOn: null }))
    expect(cardChanges(formOf(none), none).changes).toEqual({})
    expect(cardChanges({ ...formOf(none), dueOn: '2026-10-20' }, none).changes).toEqual({ dueOn: '2026-10-20' })
    expect(changed((f) => (f.dueOn = '2026-02-30')).errors).toEqual({ due_on: 'تاريخ غير صالح.' })
    expect('dueOn' in changed((f) => (f.dueOn = '2026-02-30')).changes).toBe(false)
  })

  it('sends labels and people as the whole lists', () => {
    expect(changed((f) => (f.labels = [U(5)])).changes).toEqual({ labels: [U(5)] })
    expect(changed((f) => (f.labels = [])).changes).toEqual({ labels: [] })
    expect(changed((f) => (f.people = [U(7), U(8), U(9)])).changes).toEqual({ people: [U(7), U(8), U(9)] })
    expect(changed((f) => (f.people = [])).changes).toEqual({ people: [] })
  })

  it('sends the checklist whole, in order, with the id of each saved item and null for a new one', () => {
    expect(changed((f) => (f.checklist[1]!.done = true)).changes).toEqual({
      checklist: [{ id: U(20), text: 'حجز', done: true }, { id: U(21), text: 'تجهيز', done: true }],
    })
    expect(changed((f) => f.checklist.push({ key: 'new', id: null, text: '  بند جديد ', done: false })).changes).toEqual({
      checklist: [{ id: U(20), text: 'حجز', done: true }, { id: U(21), text: 'تجهيز', done: false }, { id: null, text: 'بند جديد', done: false }],
    })
    expect(changed((f) => f.checklist.splice(0, 1)).changes).toEqual({ checklist: [{ id: U(21), text: 'تجهيز', done: false }] })
    expect(changed((f) => f.checklist.reverse()).changes).toEqual({
      checklist: [{ id: U(21), text: 'تجهيز', done: false }, { id: U(20), text: 'حجز', done: true }],
    })
    expect(changed((f) => (f.checklist[0]!.text = 'حجز اليوم')).changes).toEqual({
      checklist: [{ id: U(20), text: 'حجز اليوم', done: true }, { id: U(21), text: 'تجهيز', done: false }],
    })
  })

  it('drops a row left empty, and a form with only an empty new row changes nothing', () => {
    expect(changed((f) => f.checklist.push({ key: 'new', id: null, text: '   ', done: false })).changes).toEqual({})
    expect(changed((f) => (f.checklist[1]!.text = '')).changes).toEqual({ checklist: [{ id: U(20), text: 'حجز', done: true }] })
  })

  it('sends the link as {collection, docId}, and as null when it was taken off', () => {
    expect(changed((f) => (f.link = 'posts:a-post')).changes).toEqual({ link: { collection: 'posts', docId: 'a-post' } })
    expect(changed((f) => (f.link = '')).changes).toEqual({ link: null })
    expect(changed((f) => (f.link = 'rooms:shelf')).changes).toEqual({})
    expect(linkValue(null)).toBe('')
    expect(linkValue({ collection: 'rooms', docId: 'shelf', title: null })).toBe('rooms:shelf')
  })

  it('sends what the project still has: a label or a person it no longer holds is left out (its box is gone)', () => {
    const data: Pick<BoardData, 'labels' | 'people'> = {
      labels: [{ id: U(5), name: 'تصوير', tone: 'saffron', version: 1 }],
      people: [
        { id: U(7), name: 'أنس', role: 'owner' },
        { id: U(9), name: 'مطّلع', role: 'viewer' },
      ],
    }
    expect(fitChanges({ labels: [U(5), U(6)], people: [U(7), U(8), U(9)], title: 'ج' }, data)).toEqual({ labels: [U(5)], people: [U(7)], title: 'ج' })
    expect(fitChanges({ notes: 'ن' }, data)).toEqual({ notes: 'ن' })
  })

  it('«احفظ نسختي» keeps the list as typed: an item the newer version no longer holds goes back as a new one', () => {
    const newer = parseCard(card({ checklist: [{ id: U(21), text: 'تجهيز', done: false }] }))
    const none: Pick<BoardData, 'labels' | 'people'> = { labels: [], people: [] }
    const typed = { checklist: [{ id: U(20), text: 'حجز', done: true }, { id: U(21), text: 'تجهيز', done: true }, { id: null, text: 'جديد', done: false }] }
    expect(fitChanges(typed, none, newer)).toEqual({
      checklist: [{ id: null, text: 'حجز', done: true }, { id: U(21), text: 'تجهيز', done: true }, { id: null, text: 'جديد', done: false }],
    })
    // A plain save, with no newer version, keeps every id.
    expect(fitChanges(typed, none)).toEqual(typed)
  })

  it('says what cannot be sent, under its field, and sends nothing of that field', () => {
    const empty = changed((f) => (f.title = '   '))
    expect(empty.errors).toEqual({ title: 'اكتب عنوانًا.' })
    expect('title' in empty.changes).toBe(false)
    expect(changed((f) => (f.title = 'س'.repeat(201))).errors.title).toBe('النص أطول من المسموح.')
    expect(changed((f) => (f.title = `a${String.fromCharCode(7)}b`)).errors.title).toBe('لا يُقبل نص فيه رموز تحكم.')
    expect(changed((f) => (f.notes = 'س'.repeat(5001))).errors.notes).toBe('النص أطول من المسموح.')
    const long = changed((f) => (f.checklist[0]!.text = 'س'.repeat(201)))
    expect(long.errors.checklist).toBe('النص أطول من المسموح.')
    expect('checklist' in long.changes).toBe(false)
  })

  it('starts the form from the card as it is', () => {
    const form = formOf(base())
    expect(form).toMatchObject({ title: 'صور حقيقية لكل نكهة', priority: 'normal', dueOn: '2026-10-20', link: 'rooms:shelf' })
    expect(form.checklist.map((row) => [row.key, row.id])).toEqual([[U(20), U(20)], [U(21), U(21)]])
    // The form owns its lists: editing it never edits the card.
    form.people.push(U(9))
    expect(base().people).toEqual([U(7), U(8)])
  })
})

describe('the owner\'s CSV', () => {
  const row = (over: Partial<ExportCard> = {}): ExportCard => ({
    id: U(10),
    title: 'بطاقة',
    column: 'أفكار',
    priority: 'urgent',
    dueOn: '2026-10-20',
    doneAt: null,
    labels: ['تصوير', 'نصوص'],
    people: ['أنس'],
    checklist: [{ text: 'حجز', done: true }, { text: 'تصوير', done: false }],
    notes: 'سطر\nسطر آخر',
    link: { collection: 'rooms', docId: 'shelf', title: 'على الرف' },
    archived: false,
    ...over,
  })

  it('starts with a byte order mark and the ten columns in the contract\'s order', () => {
    const csv = csvOf([])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(CSV_HEADER).toEqual(['العنوان', 'العمود', 'الأولوية', 'الموعد', 'الوسوم', 'الأشخاص', 'البنود', 'الملاحظات', 'مرتبطة بـ', 'مؤرشفة'])
    expect(csv).toBe(`\uFEFF${CSV_HEADER.map((name) => `"${name}"`).join(',')}\r\n`)
  })

  it('quotes every cell, doubles a quote and keeps a line feed inside its cell', () => {
    expect(csvCell('نص')).toBe('"نص"')
    expect(csvCell('قال "نعم"')).toBe('"قال ""نعم"""')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('')).toBe('""')
    // The header row, then the card's row (its inner line feeds stay inside their quotes), then the closing line break.
    const parsed = csvOf([row()])
    expect(parsed.slice(csvOf([]).length)).toBe('"بطاقة","أفكار","عاجل","2026-10-20","تصوير، نصوص","أنس","✓ حجز\nتصوير","سطر\nسطر آخر","على الرف","لا"\r\n')
    expect(parsed.endsWith('"لا"\r\n')).toBe(true)
    expect(parsed).toContain('"✓ حجز\nتصوير"')
    expect(parsed).toContain('"سطر\nسطر آخر"')
  })

  it('prefixes a cell that starts like a formula with a quote: =, +, -, @, a tab, a carriage return', () => {
    for (const start of ['=', '+', '-', '@', '\t', '\r']) {
      expect(csvCell(`${start}1+1`), JSON.stringify(start)).toBe(`"'${start}1+1"`)
    }
    // Only the start counts, and an ordinary cell is left as it is.
    expect(csvCell('a=1')).toBe('"a=1"')
    expect(csvCell("'=1")).toBe(`"'=1"`)
    expect(csvCell('بطاقة -')).toBe('"بطاقة -"')
    // Every column of a row is covered, not only the title.
    const csv = csvOf([row({ title: '=HYPERLINK("x")', notes: '@cmd', column: '+a', labels: ['-b'], people: ['\tp'] })])
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv).toContain(`"'@cmd"`)
    expect(csv).toContain(`"'+a"`)
    expect(csv).toContain(`"'-b"`)
    expect(csv).toContain(`"'\tp"`)
  })

  it('says an unpublished link as «محتوى غير منشور», an empty cell without a link, and an archived card as «نعم»', () => {
    expect(csvOf([row({ link: { collection: 'posts', docId: 'p', title: null } })])).toContain('"محتوى غير منشور"')
    const bare = csvOf([row({ link: null, dueOn: null, archived: true })]).slice(csvOf([]).length)
    expect(bare).toBe('"بطاقة","أفكار","عاجل","","تصوير، نصوص","أنس","✓ حجز\nتصوير","سطر\nسطر آخر","","نعم"\r\n')
  })
})
