/**
 * How a room's paragraphs become B's rhythm (D39). Anas's words stay a plain
 * list in the CMS; each room names the paragraphs to set large (`pullLines`)
 * and the ones that break out as a full-width coloured band (`bandLines`).
 * A band ends the text before it and starts a new one after it.
 */
export type ParaKind = 'body' | 'display' | 'band'

export interface Para {
  text: string
  kind: ParaKind
}

export type Block = { kind: 'text'; paras: Para[] } | { kind: 'band'; text: string }

export function classify(
  paragraphs: readonly string[],
  pullLines: readonly string[] = [],
  bandLines: readonly string[] = [],
): Para[] {
  const pull = new Set(pullLines)
  const band = new Set(bandLines)
  return paragraphs.map((text) => ({
    text,
    kind: band.has(text) ? 'band' : pull.has(text) ? 'display' : 'body',
  }))
}

/** Splits a run of paragraphs at every band. Empty text runs are dropped. */
export function toBlocks(paras: readonly Para[]): Block[] {
  const out: Block[] = []
  let run: Para[] = []
  for (const para of paras) {
    if (para.kind === 'band') {
      if (run.length > 0) out.push({ kind: 'text', paras: run })
      out.push({ kind: 'band', text: para.text })
      run = []
    } else {
      run.push(para)
    }
  }
  if (run.length > 0) out.push({ kind: 'text', paras: run })
  return out
}

/** The paragraphs up to and including the first large line, and the rest. */
export function splitAfterFirstDisplay(paras: readonly Para[]): [Para[], Para[]] {
  const at = paras.findIndex((para) => para.kind === 'display')
  if (at === -1) return [[...paras], []]
  return [paras.slice(0, at + 1), paras.slice(at + 1)]
}
