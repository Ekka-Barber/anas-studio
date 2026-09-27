/**
 * The hidden passphrase prompt shared by `pnpm backup` and `pnpm restore-check`
 * (D35): raw-mode stdin, nothing echoed. Input is handled per character, not
 * per byte, so a backspace removes a whole character: an Arabic passphrase
 * typed with a correction stays exactly what the owner sees in his head, and
 * the same keystrokes open the backup later.
 */
export function promptHidden(label) {
  return new Promise((resolvePass, rejectPass) => {
    const stdin = process.stdin
    process.stdout.write(label)
    if (stdin.isTTY) stdin.setRawMode(true)
    stdin.setEncoding('utf8')
    stdin.resume()
    const characters = []
    const finish = (settle) => {
      if (stdin.isTTY) stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
      process.stdout.write('\n')
      settle()
    }
    const onData = (text) => {
      for (const character of text) {
        if (character === '\r' || character === '\n') return finish(() => resolvePass(characters.join('')))
        if (character === '\u0003') return finish(() => rejectPass(new Error('Aborted with Ctrl+C.')))
        if (character === '\u0008' || character === '\u007f') {
          characters.pop()
          continue
        }
        // Other control characters (arrow-key escape sequences and the like)
        // are not part of a passphrase.
        if (/[\u0000-\u001f\u007f-\u009f]/.test(character)) continue
        characters.push(character)
      }
    }
    stdin.on('data', onData)
  })
}
