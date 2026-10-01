/**
 * What a service's «اطلب جلسة» does to the message field. An empty message, or
 * one still exactly the previous service's line, is replaced; anything the
 * visitor wrote stays. A replaced message that changes is a different
 * submission, so it must not go out under the last one's submission key: the
 * function would answer that the first was already stored, and the second
 * would be reported as sent and never saved.
 */
export function servicePrefill(current: string, previous: string, text: string): { replace: boolean; resetKey: boolean } {
  const replace = !current.trim() || current === previous
  return { replace, resetKey: replace && current !== text }
}
