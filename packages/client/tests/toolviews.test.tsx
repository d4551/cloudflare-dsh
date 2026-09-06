// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AccessibilityTree, describeNode } from '../src/toolviews/AccessibilityTree.tsx'
import { BrowserRender } from '../src/toolviews/BrowserRender.tsx'
import { D1Result, cellText, columnsOf } from '../src/toolviews/D1Result.tsx'
import { expectNoViolations } from './axe.ts'

afterEach(cleanup)

describe('columnsOf', () => {
  it('collects column names in first-seen order', () => {
    expect(columnsOf([{ b: 1, a: 2 }])).toEqual(['b', 'a'])
  })

  it('unions columns across rows without duplicating', () => {
    expect(columnsOf([{ a: 1 }, { a: 2, b: 3 }])).toEqual(['a', 'b'])
  })

  it('returns nothing for no rows', () => {
    expect(columnsOf([])).toEqual([])
  })
})

describe('cellText', () => {
  it('passes a string through unchanged', () => {
    expect(cellText('x')).toBe('x')
  })

  it('renders null and undefined as empty', () => {
    expect(cellText(null)).toBe('')
    expect(cellText(undefined)).toBe('')
  })

  it('serializes other values', () => {
    expect(cellText(3)).toBe('3')
    expect(cellText({ a: 1 })).toBe('{"a":1}')
  })
})

/** `n` rows, so the render cap can be approached from either side. */
const manyRows = (n: number) => [{ results: Array.from({ length: n }, (_, i) => ({ id: i })) }]

describe('D1Result', () => {
  const resultSets = [
    {
      results: [
        { id: 1, name: 'a' },
        { id: 2, name: 'b' },
      ],
    },
  ]

  it('renders a real table with column headers', () => {
    render(<D1Result sql="SELECT 1" resultSets={resultSets} />)
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['id', 'name'])
  })

  it('captions the table with the query that produced it', () => {
    const { container } = render(<D1Result sql="SELECT 1" resultSets={resultSets} />)
    // The table's name has to come from its own caption: an ancestor's label
    // would answer the role query just as well and caption nothing.
    expect(container.querySelector('table > caption')?.textContent).toBe('Results for query: SELECT 1')
    expect(screen.getByRole('table', { name: 'Results for query: SELECT 1' }).tagName).toBe('TABLE')
  })

  it('renders one row per result', () => {
    render(<D1Result sql="SELECT 1" resultSets={resultSets} />)
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('renders each cell value under its column', () => {
    render(<D1Result sql="SELECT 1" resultSets={resultSets} />)
    const cells = screen.getAllByRole('cell').map((c) => c.textContent)
    expect(cells).toEqual(['1', 'a', '2', 'b'])
  })

  it('renders an empty cell where a row is missing that column', () => {
    render(<D1Result sql="s" resultSets={[{ results: [{ a: 1 }, { b: 2 }] }]} />)
    expect(screen.getAllByRole('cell').map((c) => c.textContent)).toEqual(['1', '', '', '2'])
  })

  it('flattens several result sets into one table', () => {
    render(<D1Result sql="s" resultSets={[{ results: [{ a: 1 }] }, { results: [{ a: 2 }] }]} />)
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it.each([
    ['a result set with no rows field', [{}]],
    ['a result set whose rows are empty', [{ results: [] }]],
    ['rows that carry no columns', [{ results: [{}] }]],
  ])('reports an empty result rather than an empty table for %s', (_label, sets) => {
    const { container } = render(<D1Result sql="s" resultSets={sets} />)
    expect(container.querySelector('.cf-d1__empty')?.textContent).toBe('The query returned no rows.')
    // "rather than an empty table" is the half a text query cannot see.
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('makes the scroll container reachable by keyboard and gives it a name', () => {
    const { container } = render(<D1Result sql="SELECT 1" resultSets={resultSets} />)
    const card = screen.getByRole('figure', { name: 'Results for query: SELECT 1' })
    expect(card.getAttribute('tabindex')).toBe('0')
    // The name comes from the caption itself, so the query is stated once and
    // the two can never disagree.
    const labelledBy = card.getAttribute('aria-labelledby')
    expect(container.ownerDocument.getElementById(labelledBy ?? '')).toBe(container.querySelector('caption'))
  })

  it('renders every row when the result is under the cap', () => {
    render(<D1Result sql="s" resultSets={manyRows(100)} />)
    // 100 body rows plus the header row.
    expect(screen.getAllByRole('row')).toHaveLength(101)
  })

  it('says nothing about a total when it is showing all of it', () => {
    const { container } = render(<D1Result sql="SELECT 1" resultSets={manyRows(100)} />)
    expect(container.querySelector('caption')?.textContent).toBe('Results for query: SELECT 1')
  })

  it('stops at the cap rather than building a row per result', () => {
    // A query can return thousands; every one would otherwise become a table
    // row inside a conversation card.
    render(<D1Result sql="s" resultSets={manyRows(4312)} />)
    expect(screen.getAllByRole('row')).toHaveLength(101)
  })

  it('says how many of how many, so a partial table is not read as the whole', () => {
    const { container } = render(<D1Result sql="SELECT 1" resultSets={manyRows(4312)} />)
    expect(container.querySelector('caption')?.textContent).toBe(
      'Results for query: SELECT 1 Showing the first 100 of 4312 rows.',
    )
  })

  it('carries the count into the accessible name, since the caption is what names the card', () => {
    render(<D1Result sql="SELECT 1" resultSets={manyRows(4312)} />)
    expect(
      screen.getByRole('figure', {
        name: 'Results for query: SELECT 1 Showing the first 100 of 4312 rows.',
      }).className,
    ).toBe('cf-d1')
  })

  it('keeps the result card out of the landmark map, since tool views repeat', () => {
    // A named section is a `region` landmark, and tool views repeat: two runs
    // of one query would put two identically named landmarks on the page,
    // which is what the assembled scan reported the first time it ran.
    const { container } = render(<D1Result sql="SELECT 1" resultSets={resultSets} />)
    expect(container.querySelector('.cf-d1')?.tagName).toBe('FIGURE')
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<D1Result sql="SELECT 1" resultSets={resultSets} />)
    await expectNoViolations(container)
  })

  it('has no accessibility violations when empty', async () => {
    const { container } = render(<D1Result sql="s" resultSets={[]} />)
    await expectNoViolations(container)
  })
})

describe('BrowserRender', () => {
  it('captions the output with the page it came from', () => {
    const { container } = render(<BrowserRender url="https://x.test" body="# Title" />)
    expect(container.querySelector('figcaption')?.textContent).toBe('Rendered https://x.test')
  })

  it('renders text output in a keyboard-reachable region', () => {
    const { container } = render(<BrowserRender url="https://x.test" body="# Title" />)
    const card = screen.getByRole('figure', { name: 'Rendered https://x.test' })
    expect(card.getAttribute('tabindex')).toBe('0')
    // ARIA prohibits `aria-label` on the `generic` role a bare `pre` maps to,
    // so the focus stop is an element that can carry a name, and the preformatted
    // text sits inside it.
    expect(card.querySelector('pre')?.textContent).toBe('# Title')
    expect(container.querySelector('pre')?.getAttribute('aria-label')).toBeNull()
  })

  it('keeps the render card out of the landmark map, since tool views repeat', () => {
    render(<BrowserRender url="https://x.test" body="# Title" />)
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('names the card from its caption, so the page it came from is stated once', () => {
    const { container } = render(<BrowserRender url="https://x.test" body="# Title" />)
    const card = screen.getByRole('figure', { name: 'Rendered https://x.test' })
    const labelledBy = card.getAttribute('aria-labelledby')
    expect(container.ownerDocument.getElementById(labelledBy ?? '')).toBe(
      container.querySelector('figcaption'),
    )
  })

  it('has no accessibility violations for text output', async () => {
    const { container } = render(<BrowserRender url="https://x.test" body="hi" />)
    await expectNoViolations(container)
  })
})

describe('describeNode', () => {
  it('combines role and name', () => {
    expect(describeNode({ role: 'button', name: 'Save' })).toBe('button: Save')
  })

  it('falls back to the role when there is no name', () => {
    expect(describeNode({ role: 'generic' })).toBe('generic')
  })

  it('falls back to the role when the name is empty', () => {
    expect(describeNode({ role: 'generic', name: '' })).toBe('generic')
  })

  it('reports an unknown role rather than rendering nothing', () => {
    expect(describeNode({})).toBe('unknown')
  })
})

describe('AccessibilityTree', () => {
  const tree = { role: 'document', name: 'Page', children: [{ role: 'heading', name: 'Title' }] }

  it('names the card by the page it describes', () => {
    render(<AccessibilityTree url="https://x.test" tree={tree} />)
    expect(screen.getByRole('figure', { name: 'Accessibility tree for https://x.test' }).className).toBe(
      'cf-axtree',
    )
  })

  it('keeps the tree card out of the landmark map, since tool views repeat', () => {
    render(<AccessibilityTree url="https://x.test" tree={tree} />)
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('renders the hierarchy as nested lists, not a flat dump', () => {
    render(<AccessibilityTree url="https://x.test" tree={tree} />)
    expect(screen.getAllByRole('list')).toHaveLength(2)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('renders a leaf without an empty child list', () => {
    render(<AccessibilityTree url="https://x.test" tree={{ role: 'document' }} />)
    expect(screen.getAllByRole('list')).toHaveLength(1)
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<AccessibilityTree url="https://x.test" tree={tree} />)
    await expectNoViolations(container)
  })
})
