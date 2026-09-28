// D39 (direction B): the pure pieces the woven pages rely on.
import { describe, expect, it } from 'vitest'

import content from '../../content/initial-content.json'
import { classify, splitAfterFirstDisplay, toBlocks } from '../../src/components/public/story/flow'
import { typeset } from '../../src/lib/format'
import { readingTime } from '../../src/lib/journal'

describe('a room text becomes B’s rhythm', () => {
  const paras = classify(['a', 'b', 'band', 'c', 'pull', 'd'], ['pull'], ['band'])

  it('marks large lines and band lines, and leaves the rest as reading text', () => {
    expect(paras.map((p) => p.kind)).toEqual(['body', 'body', 'band', 'body', 'display', 'body'])
  })

  it('splits the text at every band, keeping the order', () => {
    const blocks = toBlocks(paras)
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'band', 'text'])
    expect(blocks[1]).toEqual({ kind: 'band', text: 'band' })
    expect(toBlocks(classify(['x'], [], ['x']))).toEqual([{ kind: 'band', text: 'x' }])
  })

  it('puts the films after the first large line', () => {
    const [before, after] = splitAfterFirstDisplay(classify(['a', 'pull', 'b'], ['pull']))
    expect(before.map((p) => p.text)).toEqual(['a', 'pull'])
    expect(after.map((p) => p.text)).toEqual(['b'])
    expect(splitAfterFirstDisplay(classify(['a'])).map((part) => part.length)).toEqual([1, 0])
  })

  it('every large or band line in the content repeats a paragraph exactly', () => {
    const rooms = content.rooms
    const checks: Array<[string, string[], string[]]> = [
      ['started', rooms.started.movements.flatMap((m) => m.paragraphs), [...rooms.started.pullLines, ...rooms.started.bandLines]],
      [
        'built',
        [...rooms.built.intro.paragraphs, ...rooms.built.movements.flatMap((m) => m.paragraphs), ...rooms.built.closing.paragraphs],
        [...rooms.built.pullLines, ...rooms.built.bandLines],
      ],
      ['passed', rooms.passed.paragraphs, [...rooms.passed.pullLines, ...rooms.passed.bandLines]],
      ['moonlight', rooms.shelf.items.moonlightCup.paragraphs, rooms.shelf.items.moonlightCup.pullLines],
      ['boutique', rooms.shelf.items.boutique.paragraphs, rooms.shelf.items.boutique.bandLines],
    ]
    for (const [room, paragraphs, lines] of checks) {
      for (const line of lines) expect(paragraphs, `${room}: «${line}»`).toContain(line)
    }
  })
})

describe('typeset', () => {
  it('gives a glued comma its space and keeps closing marks with their word', () => {
    expect(typeset('هنا،وبعضها')).toBe('هنا، وبعضها')
    expect(typeset('تحديداً .')).toBe('تحديداً .')
    expect(typeset('نفسها:\nماذا')).toBe('نفسها:\nماذا')
    expect(typeset('( خوص )')).toBe('( خوص )')
    expect(typeset('المَشاهد · رحلات · خلف الكواليس')).toBe('المَشاهد · رحلات · خلف الكواليس')
  })
})

describe('readingTime', () => {
  it('uses the Arabic singular, dual and plural', () => {
    expect(readingTime(10)).toBe('دقيقة للقراءة')
    expect(readingTime(360)).toBe('دقيقتان للقراءة')
    expect(readingTime(900)).toBe('5 دقائق للقراءة')
    expect(readingTime(3600)).toBe('20 دقيقة للقراءة')
  })
})
