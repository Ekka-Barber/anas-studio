// D35: the hidden passphrase prompt keeps key sequences (arrows, Delete, Alt+key)
// out of the passphrase, even when a sequence is split across two data chunks.
import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { promptHidden } from '../../scripts/lib/passphrase.mjs'

function type(...chunks: string[]): Promise<string> {
  const stdin = Object.assign(new EventEmitter(), { isTTY: false, setEncoding() {}, resume() {}, pause() {} })
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin as never)
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  const result = promptHidden('Passphrase: ')
  for (const chunk of chunks) stdin.emit('data', chunk)
  return result
}

describe('promptHidden', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('drops whole arrow, Delete and SS3 sequences, not just the ESC byte', async () => {
    await expect(type('ab\u001b[Dc\u001b[3~d\u001bOA\r')).resolves.toBe('abcd')
  })

  it('drops a sequence split across two chunks', async () => {
    await expect(type('ab\u001b', '[Dc\r')).resolves.toBe('abc')
  })

  it('still handles backspace and Arabic text', async () => {
    await expect(type('عبدالله\u007fx\r')).resolves.toBe('عبداللx')
  })

  it('a lone ESC does not swallow the Enter that follows', async () => {
    await expect(type('ab\u001b', '\r')).resolves.toBe('ab')
  })
})
