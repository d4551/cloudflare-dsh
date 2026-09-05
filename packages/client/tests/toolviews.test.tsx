// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AccessibilityTree, countNodes, describeNode } from '../src/toolviews/AccessibilityTree.tsx'
import { BrowserRender, isImageFormat } from '../src/toolviews/BrowserRender.tsx'
import { D1Result, cellText, columnsOf } from '../src/toolviews/D1Result.tsx'
import { en } from '../src/locales/en.ts'
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

describe('D1Result', () => {
  const resultSets = [{ results: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] }]

  it('renders a real table with column headers', () => {
    render(<D1Result sql="SELECT 1" resultSets={resultSets} />)
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['id', 'name'])
  })

  it('captions the table with the query that produced it', () => {
    render(<D1Result sql="SELECT 1" resultSets={resultSets} />)
    expect(screen.getByRole('table', { name: 'Results for query: SELECT 1' })).toBeDefined()
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

  it('tolerates a result set with no rows field', () => {
    render(<D1Result sql="s" resultSets={[{}]} />)
    expect(screen.getByText(en.toolView.emptyResult)).toBeDefined()
  })

  it('reports an empty result rather than an empty table', () => {
    render(<D1Result sql="s" resultSets={[{ results: [] }]} />)
    expect(screen.getByText(en.toolView.emptyResult)).toBeDefined()
  })

  it('reports an empty result when rows carry no columns', () => {
    render(<D1Result sql="s" resultSets={[{ results: [{}] }]} />)
    expect(screen.getByText(en.toolView.emptyResult)).toBeDefined()
  })

  it('makes the scroll container reachable by keyboard and gives it a name', () => {
    render(<D1Result sql="SELECT 1" resultSets={resultSets} />)
    const group = screen.getByRole('group', { name: en.toolView.queryCaption('SELECT 1') })
    expect(group.getAttribute('tabindex')).toBe('0')
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

describe('isImageFormat', () => {
  it('treats a screenshot as an image', () => {
    expect(isImageFormat('screenshot')).toBe(true)
  })

  it.each(['markdown', 'content', 'links', 'pdf'])('treats %s as text', (format) => {
    expect(isImageFormat(format)).toBe(false)
  })
})

describe('BrowserRender', () => {
  it('captions the output with the page it came from', () => {
    render(<BrowserRender url="https://x.test" format="markdown" body="# Title" />)
    expect(screen.getByText(en.toolView.renderHeading('https://x.test'))).toBeDefined()
  })

  it('renders text output in a keyboard-reachable region', () => {
    render(<BrowserRender url="https://x.test" format="markdown" body="# Title" />)
    const body = screen.getByLabelText(en.toolView.renderHeading('https://x.test'))
    expect(body.tagName).toBe('PRE')
    expect(body.getAttribute('tabindex')).toBe('0')
  })

  it('gives a screenshot a meaningful alternative text', () => {
    render(<BrowserRender url="https://x.test" format="screenshot" body="data:image/png;base64,AAA" />)
    expect(screen.getByAltText('Screenshot of https://x.test')).toBeDefined()
  })

  it('has no accessibility violations for text output', async () => {
    const { container } = render(<BrowserRender url="https://x.test" format="markdown" body="hi" />)
    await expectNoViolations(container)
  })

  it('has no accessibility violations for a screenshot', async () => {
    const { container } = render(
      <BrowserRender url="https://x.test" format="screenshot" body="data:image/png;base64,AAA" />,
    )
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

describe('countNodes', () => {
  it('counts a single node', () => {
    expect(countNodes({ role: 'a' })).toBe(1)
  })

  it('counts nested children', () => {
    expect(countNodes({ role: 'a', children: [{ role: 'b' }, { role: 'c', children: [{ role: 'd' }] }] })).toBe(4)
  })

  it('treats an empty children list as a leaf', () => {
    expect(countNodes({ role: 'a', children: [] })).toBe(1)
  })
})

describe('AccessibilityTree', () => {
  const tree = { role: 'document', name: 'Page', children: [{ role: 'heading', name: 'Title' }] }

  it('names the region by the page it describes', () => {
    render(<AccessibilityTree url="https://x.test" tree={tree} />)
    expect(screen.getByRole('region', { name: en.toolView.treeHeading('https://x.test') })).toBeDefined()
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
