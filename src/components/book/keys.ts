export type BookAction = 'next' | 'previous' | 'first' | 'last'

/**
 * What a key does in the book, or null when it is not the book's. Alt, Ctrl
 * and Meta chords belong to the browser (Alt+← is Back, Ctrl+End scrolls), so
 * they do nothing. `held` marks an auto-repeat of a jump (Home, End): the key
 * is still taken, so the page does not scroll, but the jump is not repeated.
 */
export function bookKey(event: {
  key: string
  repeat: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}): { action: BookAction; held: boolean } | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null
  switch (event.key) {
    // Bound on the right: ← is the next page.
    case 'ArrowLeft':
      return { action: 'next', held: false }
    case 'ArrowRight':
      return { action: 'previous', held: false }
    case 'Home':
      return { action: 'first', held: event.repeat }
    case 'End':
      return { action: 'last', held: event.repeat }
    default:
      return null
  }
}
