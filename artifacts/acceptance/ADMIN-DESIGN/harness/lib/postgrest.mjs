// A small PostgREST stand-in: enough of the query grammar for the admin's
// screens (select with embeds, eq/neq/gt/gte/lt/lte/like/ilike/is/in/not/or,
// order, limit/offset, Prefer: count=exact with Content-Range, HEAD, the
// single-object Accept) over in-memory tables, plus simple writes.
import { uid } from './util.mjs'

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])
const ISO = /^\d{4}-\d{2}-\d{2}T/

/** Splits on commas that are not inside parentheses or double quotes. */
export function splitTop(text) {
  const parts = []
  let depth = 0
  let quoted = false
  let current = ''
  for (const char of text) {
    if (char === '"') quoted = !quoted
    if (!quoted && char === '(') depth++
    if (!quoted && char === ')') depth--
    if (!quoted && depth === 0 && char === ',') {
      parts.push(current)
      current = ''
    } else current += char
  }
  if (current !== '') parts.push(current)
  return parts
}

/** Compares a stored value with a filter's text; returns a negative, zero or positive number, or NaN when they cannot be compared. */
function compare(value, arg) {
  if (value === null || value === undefined) return Number.NaN
  if (typeof value === 'number') return value - Number(arg)
  if (typeof value === 'boolean') return value === (arg === 'true') ? 0 : 1
  const left = String(value)
  if (ISO.test(left) && ISO.test(arg)) return Date.parse(left) - Date.parse(arg)
  return left < arg ? -1 : left > arg ? 1 : 0
}

function likeRegex(pattern, flags) {
  const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')
  return new RegExp(`^${source}$`, flags)
}

function unquote(token) {
  const trimmed = token.trim()
  return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1).replace(/\\"/g, '"') : trimmed
}

function matches(value, op, arg) {
  switch (op) {
    case 'eq':
      return compare(value, arg) === 0
    case 'neq':
      return compare(value, arg) !== 0
    case 'gt':
      return compare(value, arg) > 0
    case 'gte':
      return compare(value, arg) >= 0
    case 'lt':
      return compare(value, arg) < 0
    case 'lte':
      return compare(value, arg) <= 0
    case 'like':
      return typeof value === 'string' && likeRegex(arg, '').test(value)
    case 'ilike':
      return typeof value === 'string' && likeRegex(arg, 'i').test(value)
    case 'is':
      if (arg === 'null') return value === null || value === undefined
      if (arg === 'true') return value === true
      if (arg === 'false') return value === false
      return false
    case 'in': {
      const items = splitTop(arg.replace(/^\(/, '').replace(/\)$/, '')).map(unquote)
      return items.some((item) => compare(value, item) === 0)
    }
    case 'cs': {
      const items = splitTop(arg.replace(/^[{(]/, '').replace(/[})]$/, '')).map(unquote)
      return Array.isArray(value) && items.every((item) => value.map(String).includes(item))
    }
    default:
      return true
  }
}

function conditionMatches(row, text) {
  // `col.op.arg` or `not.col.op.arg`-style leaves inside or(...) / and(...).
  const andMatch = /^and\((.*)\)$/s.exec(text)
  if (andMatch) return splitTop(andMatch[1]).every((part) => conditionMatches(row, part))
  const orMatch = /^or\((.*)\)$/s.exec(text)
  if (orMatch) return splitTop(orMatch[1]).some((part) => conditionMatches(row, part))
  const first = text.indexOf('.')
  const column = text.slice(0, first)
  let rest = text.slice(first + 1)
  let negate = false
  if (rest.startsWith('not.')) {
    negate = true
    rest = rest.slice(4)
  }
  const dot = rest.indexOf('.')
  const result = matches(row[column], rest.slice(0, dot), rest.slice(dot + 1))
  return negate ? !result : result
}

export function applyFilters(rows, params) {
  let result = rows
  for (const [key, value] of params.entries()) {
    if (RESERVED.has(key)) continue
    if (key === 'or') {
      const inner = value.replace(/^\(/, '').replace(/\)$/, '')
      result = result.filter((row) => splitTop(inner).some((part) => conditionMatches(row, part)))
      continue
    }
    if (key === 'and') {
      const inner = value.replace(/^\(/, '').replace(/\)$/, '')
      result = result.filter((row) => splitTop(inner).every((part) => conditionMatches(row, part)))
      continue
    }
    let rest = value
    let negate = false
    if (rest.startsWith('not.')) {
      negate = true
      rest = rest.slice(4)
    }
    const dot = rest.indexOf('.')
    if (dot < 0) continue
    const op = rest.slice(0, dot)
    const arg = rest.slice(dot + 1)
    result = result.filter((row) => (negate ? !matches(row[key], op, arg) : matches(row[key], op, arg)))
  }
  return result
}

export function applyOrder(rows, orderParam) {
  if (!orderParam) return rows
  const keys = orderParam.split(',').map((part) => {
    const [column, ...flags] = part.split('.')
    return { column, desc: flags.includes('desc'), nullsFirst: flags.includes('nullsfirst') ? true : flags.includes('nullslast') ? false : flags.includes('desc') }
  })
  return [...rows].sort((a, b) => {
    for (const { column, desc, nullsFirst } of keys) {
      const x = a[column]
      const y = b[column]
      const xNull = x === null || x === undefined
      const yNull = y === null || y === undefined
      if (xNull || yNull) {
        if (xNull && yNull) continue
        return (xNull ? 1 : -1) * (nullsFirst ? -1 : 1)
      }
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : ISO.test(String(x)) && ISO.test(String(y)) ? Date.parse(String(x)) - Date.parse(String(y)) : String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0
      if (c !== 0) return desc ? -c : c
    }
    return 0
  })
}

/** Keeps the selected columns; an embed `rel(...)` keeps the row's `rel` value as it is. */
export function project(rows, select) {
  if (!select || select.trim() === '*' || select.trim() === '') return rows
  const parts = splitTop(select.replace(/\s+/g, '')).map((part) => {
    const embed = /^([a-z_]+)(?:!\w+)?\(/.exec(part)
    if (embed) return { from: embed[1], to: embed[1] }
    const [left, right] = part.includes(':') && !part.includes('::') ? part.split(':') : [null, part]
    const name = right.split('::')[0]
    return { from: name, to: left ?? name }
  })
  if (parts.some((part) => part.from === '*')) return rows
  return rows.map((row) => Object.fromEntries(parts.map((part) => [part.to, row[part.from] ?? (part.from in row ? row[part.from] : null)])))
}

function errorBody(code, message, details = null) {
  return { code, details, hint: null, message }
}

/**
 * Handles one REST call against `db` (a map of table name -> rows).
 * Returns `{status, headers, body}` where body is JSON-able (or undefined).
 */
export function handleRest({ method, table, params, headers, body, db, hooks = {} }) {
  const rows = db[table]
  if (!rows) return { status: 404, body: errorBody('42P01', `relation "public.${table}" does not exist`) }
  const prefer = headers.prefer ?? ''
  const wantsCount = /count=(exact|planned|estimated)/.test(prefer)
  const accept = headers.accept ?? ''
  const single = accept.includes('application/vnd.pgrst.object+json')
  const select = params.get('select')

  if (method === 'GET' || method === 'HEAD') {
    const filtered = applyOrder(applyFilters(rows, params), params.get('order'))
    const total = filtered.length
    const offset = Number(params.get('offset') ?? 0) || 0
    const limitText = params.get('limit')
    const limit = limitText === null ? Number.POSITIVE_INFINITY : Number(limitText)
    const page = filtered.slice(offset, offset + limit)
    const range = page.length === 0 ? `*/${wantsCount ? total : '*'}` : `${offset}-${offset + page.length - 1}/${wantsCount ? total : '*'}`
    const responseHeaders = { 'content-range': range }
    if (method === 'HEAD') return { status: 200, headers: responseHeaders }
    const projected = project(page, select)
    if (single) {
      if (projected.length !== 1) {
        return { status: 406, headers: responseHeaders, body: errorBody('PGRST116', 'JSON object requested, multiple (or no) rows returned', `The result contains ${projected.length} rows`) }
      }
      return { status: 200, headers: responseHeaders, body: projected[0] }
    }
    return { status: 200, headers: responseHeaders, body: projected }
  }

  if (method === 'POST') {
    const incoming = Array.isArray(body) ? body : [body]
    const created = []
    for (const input of incoming) {
      const row = { ...input }
      if (hooks.beforeInsert) {
        const refusal = hooks.beforeInsert(table, row)
        if (refusal) return refusal
      }
      if (!('id' in row) && rows.length > 0 && 'id' in rows[0]) row.id = uid(`${table}:${rows.length}:${Math.random()}`)
      if (!('version' in row) && rows.length > 0 && 'version' in rows[0]) row.version = 1
      rows.push(row)
      created.push(row)
      hooks.afterInsert?.(table, row)
    }
    if (/return=representation/.test(prefer)) {
      const out = project(created, select)
      return { status: 201, body: single ? out[0] : out }
    }
    return { status: 201 }
  }

  if (method === 'PATCH') {
    const hit = applyFilters(rows, params)
    for (const row of hit) {
      Object.assign(row, body)
      if (typeof row.version === 'number') row.version += 1
      if ('updated_at' in row) row.updated_at = new Date().toISOString()
    }
    if (/return=representation/.test(prefer)) return { status: 200, body: project(hit, select) }
    return { status: 204 }
  }

  if (method === 'DELETE') {
    const hit = new Set(applyFilters(rows, params))
    db[table] = rows.filter((row) => !hit.has(row))
    if (/return=representation/.test(prefer)) return { status: 200, body: project([...hit], select) }
    return { status: 204 }
  }

  return { status: 405, body: errorBody('PGRST000', `method ${method} not allowed`) }
}
