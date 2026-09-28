import { Fragment } from 'react'

import { typeset } from '@/lib/format'

/**
 * One of Anas's texts as he wrote it: his line breaks become `<br>`, and
 * `typeset` spaces his punctuation. Renders the text only, never markup.
 */
export function Lines({ text }: { text: string }) {
  const lines = typeset(text).split('\n')
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line}
        </Fragment>
      ))}
    </>
  )
}
