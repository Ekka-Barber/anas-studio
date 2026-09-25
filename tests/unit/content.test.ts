import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import fixture from '../../content/initial-content.json'

// The database is filled from this file by scripts/import-content.mjs, and
// tests/integration/content.test.ts proves the loaders return it unchanged, so
// checking the file against the source covers the public pages.
const { started, built, passed, shelf } = fixture.rooms

/**
 * Anas's texts must be carried verbatim (character for character) from
 * `BOOK_ASSETS/SORTED_2026-09-21/CONTENT.md` into `content/initial-content.json`.
 * That source is git-excluded and only present on a machine with the sorted
 * assets, so this drift check skips cleanly (not a failure) when it is
 * absent — for example in CI.
 */
const CONTENT_MD = path.resolve(__dirname, '../../BOOK_ASSETS/SORTED_2026-09-21/CONTENT.md')

describe('content verbatim against source', () => {
  if (!existsSync(CONTENT_MD)) {
    it.skip('BOOK_ASSETS/SORTED_2026-09-21/CONTENT.md is absent (expected in CI) — skipping drift check', () => {})
    return
  }

  // The source is CRLF markdown blockquote ("> " per line); content.ts joins
  // consecutive quoted lines into one LF-separated paragraph with the quote
  // markers stripped (see the extraction in content/initial-content.json's
  // history) — normalize the same way before comparing.
  const source = readFileSync(CONTENT_MD, 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^> ?/, ''))
    .join('\n')

  it('بدأتُ من هنا: a full paragraph matches the source', () => {
    expect(source).toContain(started.heroLine)
    expect(source).toContain(started.movements[2]?.paragraphs[3])
  })

  it('بنيتُ هنا: the closing display line matches the source', () => {
    expect(source).toContain(built.closing.displayLine)
    expect(source).toContain(built.intro.paragraphs[0])
  })

  it('مررتُ من هنا: the hero line and closing line match the source', () => {
    expect(source).toContain(passed.heroLine)
    expect(source).toContain(passed.closingLine)
  })

  it('على الرف: the moonlight cup story and thura slogan match the source', () => {
    expect(source).toContain(shelf.items.moonlightCup.paragraphs[0])
    expect(source).toContain(shelf.items.thura.slogan.replace(/^«|»\.?$/g, ''))
  })
})
