// The console a handler under test may write to (FABLE-AUDIT F3-1). A reply of status 500 or above leaves one
// `console.error` line, `{requestId, status, code}` (`fail` in supabase/functions/_shared/http.ts), and a SQL failure
// one more, `{fn, sqlstate}` (`logCause`). Nothing else is ever logged: no other method, no other shape, and no value
// outside these forms, so no token, key, URL, name, address or body can reach a log.
import { expect, type MockInstance } from 'vitest'

/** The methods every handler test spies on and silences, in this order. */
export const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const

/** Every `fn` a `logCause(...)` call names: one fixed literal per function file (`grep -rn "logCause(" supabase/functions`). */
const CAUSE_FUNCTIONS = new Set(['admin', 'checkout', 'contact', 'disputes', 'download', 'notify', 'orders', 'paid-files', 'payments', 'refunds', 'staff-admin'])

type Shape = Readonly<Record<string, (value: unknown) => boolean>>
/** `fail`'s line, for a reply of status 500 or above. */
const REPLY_LINE: Shape = {
  requestId: (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value),
  status: (value) => Number.isInteger(value) && (value as number) >= 500 && (value as number) <= 599,
  code: (value) => typeof value === 'string' && /^[A-Z][A-Z0-9_]*$/.test(value),
}
/** `logCause`'s line, written just before the reply's own. */
const CAUSE_LINE: Shape = {
  fn: (value) => typeof value === 'string' && CAUSE_FUNCTIONS.has(value),
  sqlstate: (value) => value === null || (typeof value === 'string' && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(value)),
}

/** Whether one logged line is exactly this shape: its keys, and the form of every value. */
function isLine(line: unknown, shape: Shape): boolean {
  if (typeof line !== 'string') return false
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return false
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false
  const keys = Object.keys(parsed).sort()
  const expected = Object.keys(shape).sort()
  return keys.length === expected.length && keys.every((key, at) => key === expected[at] && shape[key]!((parsed as Record<string, unknown>)[key]))
}

/**
 * Whatever a test did, the handler logged nothing but the fault lines: every spy of `CONSOLE_METHODS` but `error` was
 * never called, each `console.error` call is one string that is exactly one of the two lines, and a cause line is
 * followed at once by a reply line (a cause logged before an answer below 500 fails here).
 */
export function expectOnlyFaultLines(spies: readonly MockInstance[]): void {
  CONSOLE_METHODS.forEach((method, at) => {
    const spy = spies[at]!
    if (method !== 'error') {
      expect(spy, `console.${method}`).not.toHaveBeenCalled()
      return
    }
    const calls = spy.mock.calls
    calls.forEach((args, index) => {
      expect(args, 'one argument per console.error call').toHaveLength(1)
      const reply = isLine(args[0], REPLY_LINE)
      const cause = isLine(args[0], CAUSE_LINE)
      expect(reply || cause, `a console.error line that is not a fault line: ${String(args[0]).slice(0, 80)}`).toBe(true)
      // Every `logCause` is followed at once by the `fail(500, ...)` it explains, so the very next line is that reply's.
      if (cause) expect(isLine(calls[index + 1]?.[0], REPLY_LINE), `a cause line not followed by its 5xx reply line: ${String(args[0])}`).toBe(true)
    })
  })
}
