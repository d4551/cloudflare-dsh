// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ToolCallOwnerProps } from '../src/toolviews/fromToolCall.tsx'
import { expectNoViolations } from './axe.ts'
import {
  AccessibilityTreeToolView,
  BrowserRenderToolView,
  D1ResultToolView,
  SessionCostToolView,
  presentationMetaOf,
  resultText,
  settledResult,
} from '../src/toolviews/fromToolCall.tsx'

afterEach(cleanup)

/** A settled block as the host hands it over, carrying one tool's projection. */
const settled = (meta: unknown, content: unknown[] = []) => ({
  kind: 'tool-result',
  callId: 'c1',
  isError: false,
  content,
  meta,
})

/** A call still running: a running block carries no `kind` at all. */
const running = { callId: 'c1', name: 'cloudflare_d1_query', argsRaw: '{}' }

/** The owner currency the slot supplies, with the block under test. */
const owner = (block: unknown) => ({ callId: 'c1', toolName: 't', block })

describe('the host contract these views are modelled on', () => {
  // The published declarations cannot be imported — `ToolCallViewProps` is not
  // exported from the package root, and these packages do not typecheck with
  // `skipLibCheck` off — so what the compiler cannot check is pinned here.
  // Any drift is then a visible edit rather than a view that renders nothing.

  it('takes the owner currency the tool-view slot supplies', () => {
    // @deepseek-ai/dsh-client-ui-tool 0.0.1-rc.1,
    // lib/types/client/contract/slots.d.ts → ToolCallOwnerProps.
    const currency: ToolCallOwnerProps = {
      callId: 'c1',
      toolName: 'cloudflare_d1_query',
      block: running,
      cwd: '/w',
      openFile: () => undefined,
      inspect: () => undefined,
    }
    expect(Object.keys(currency).toSorted()).toEqual([
      'block',
      'callId',
      'cwd',
      'inspect',
      'openFile',
      'toolName',
    ])
  })

  it('tells a running call from a settled one by the tag only the settled one carries', () => {
    // @deepseek-ai/dsh-client-runtime, lib/types/client/sessions/conversation.d.ts:
    // `ToolCallBlock = RunningToolCall | ToolResultNode`. `RunningToolCall` has
    // no `kind` field at all, so the tag is the whole of the discriminant.
    expect(Object.keys(running)).not.toContain('kind')
    expect(settledResult(running)).toBeUndefined()
    expect(settledResult(settled(undefined))).not.toBeUndefined()
  })

  it('reads the fields a settled result carries, and no others', () => {
    // ToolResultNode: kind, seq, time, callId, call, callTime, content,
    // isError, error?, meta?, callView, resultView, subCalls. This package
    // reads three of them.
    const read = settledResult(settled({ a: 1 }, [{ type: 'text', text: 'x' }]))
    expect(Object.keys(read ?? {}).toSorted()).toEqual(['content', 'isError', 'meta'])
  })
})

describe('settledResult', () => {
  it('reads the settled result behind a block', () => {
    expect(settledResult(settled({ a: 1 }))).toEqual({ isError: false, content: [], meta: { a: 1 } })
  })

  it('reports nothing for a running call, which carries no tag', () => {
    expect(settledResult(running)).toBeUndefined()
  })

  it.each([
    ['a primitive', 'nope'],
    ['null', null],
    ['a block tagged as something else', { kind: 'tool-call' }],
  ])('reports nothing for %s', (_label, block) => {
    expect(settledResult(block)).toBeUndefined()
  })

  it('carries the error flag through rather than assuming success', () => {
    expect(settledResult({ kind: 'tool-result', isError: true, content: [] })?.isError).toBe(true)
  })

  it('treats a missing content list as empty rather than failing to narrow', () => {
    expect(settledResult({ kind: 'tool-result' })?.content).toEqual([])
  })

  it('keeps only the blocks that carry a type, since a malformed one has nothing to render', () => {
    const block = settled(undefined, [{ type: 'text', text: 'a' }, 7, { text: 'no type' }])
    expect(settledResult(block)?.content).toEqual([{ type: 'text', text: 'a' }])
  })
})

describe('presentationMetaOf', () => {
  it('reads the projection a tool published', () => {
    expect(presentationMetaOf(settled({ sql: 's' }))).toEqual({ sql: 's' })
  })

  it('reads nothing while the call is running', () => {
    expect(presentationMetaOf(running)).toBeUndefined()
  })
})

describe('resultText', () => {
  it('joins the text blocks a result carries', () => {
    expect(
      resultText(
        settled(undefined, [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ]),
      ),
    ).toBe('a\nb')
  })

  it('skips a block that is not text even when it carries text of its own', () => {
    // The non-text block has a `text` field on purpose: without one, the
    // missing-text check does the skipping and the type check is never what
    // decides — which is how a mutant of it survived a run.
    expect(
      resultText(
        settled(undefined, [
          { type: 'image', text: 'alt' },
          { type: 'text', text: 'a' },
        ]),
      ),
    ).toBe('a')
  })

  it('skips a text block with no text', () => {
    expect(resultText(settled(undefined, [{ type: 'text' }, { type: 'text', text: 'a' }]))).toBe('a')
  })

  it('is empty while the call is running', () => {
    expect(resultText(running)).toBe('')
  })
})

describe('D1ResultToolView', () => {
  it('renders the table from the projection', () => {
    render(
      <D1ResultToolView {...owner(settled({ sql: 'SELECT 1', resultSets: [{ results: [{ id: 1 }] }] }))} />,
    )
    expect(screen.getByRole('figure', { name: 'Results for query: SELECT 1' }).tagName).toBe('FIGURE')
    expect(screen.getByRole('columnheader').textContent).toBe('id')
  })

  // One case per clause of the projection guard, so each is the clause that
  // decides. A single malformed example leaves the others never exercised.
  it.each([
    ['there is no projection', undefined],
    ['the projection is not an object', 'flat'],
    ['the query is not a string', { sql: 7, resultSets: [] }],
    ['the rows are not a list', { sql: 'SELECT 1', resultSets: 'rows' }],
  ])('falls back to the result text when %s', (_label, meta) => {
    const { container } = render(
      <D1ResultToolView {...owner(settled(meta, [{ type: 'text', text: 'raw' }]))} />,
    )
    expect(container.querySelector('.cf-toolview__raw')?.textContent).toBe('raw')
  })

  it('renders nothing while the call is still running', () => {
    const { container } = render(<D1ResultToolView {...owner(running)} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders the fallback in a keyboard-reachable region named for the tool', () => {
    // The fallback is a box that scrolls its own overflow, exactly like the
    // render card, so it needs the same two things and had neither: it was a
    // bare `<pre>`, unreachable by keyboard (SC 2.1.1) and unnameable, because
    // ARIA prohibits `aria-label` on the `generic` role a `<pre>` maps to.
    const { container } = render(
      <D1ResultToolView {...owner(settled(undefined, [{ type: 'text', text: 'raw' }]))} />,
    )
    const card = screen.getByRole('figure', { name: 'Result from t' })
    expect(card.getAttribute('tabindex')).toBe('0')
    expect(card.querySelector('pre')?.textContent).toBe('raw')
    expect(container.querySelector('pre')?.getAttribute('aria-label')).toBeNull()
    const labelledBy = card.getAttribute('aria-labelledby')
    expect(container.ownerDocument.getElementById(labelledBy ?? '')).toBe(
      container.querySelector('figcaption'),
    )
  })

  it('keeps the fallback out of the landmark map, since tool views repeat', () => {
    render(<D1ResultToolView {...owner(settled(undefined, [{ type: 'text', text: 'raw' }]))} />)
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('leaves the fallback with no accessibility violations', async () => {
    const { container } = render(
      <D1ResultToolView {...owner(settled(undefined, [{ type: 'text', text: 'raw' }]))} />,
    )
    await expectNoViolations(container)
  })
})

describe('BrowserRenderToolView', () => {
  it('renders the captioned text from the projection', () => {
    render(<BrowserRenderToolView {...owner(settled({ url: 'https://x.test', body: '# Title' }))} />)
    expect(screen.getByRole('figure', { name: 'Rendered https://x.test' }).textContent).toContain('# Title')
  })

  it.each([
    ['there is no projection', undefined],
    ['the projection is not an object', 'flat'],
    ['the url is not a string', { url: 7, body: '# Title' }],
    ['the body is not a string, which the view cannot render', { url: 'https://x.test', body: 7 }],
  ])('falls back to the result text when %s', (_label, meta) => {
    const { container } = render(
      <BrowserRenderToolView {...owner(settled(meta, [{ type: 'text', text: 'raw' }]))} />,
    )
    expect(container.querySelector('.cf-toolview__raw')?.textContent).toBe('raw')
  })
})

describe('AccessibilityTreeToolView', () => {
  it('renders the tree from the projection', () => {
    render(
      <AccessibilityTreeToolView
        {...owner(settled({ url: 'https://x.test', tree: { role: 'document', name: 'Page' } }))}
      />,
    )
    expect(screen.getByRole('listitem').textContent).toBe('document: Page')
  })

  it.each([
    ['there is no projection', undefined],
    ['the projection is not an object', 'flat'],
    ['the url is not a string', { url: 7, tree: { role: 'document' } }],
    ['the tree is not an object', { url: 'https://x.test', tree: 'flat' }],
  ])('falls back to the result text when %s', (_label, meta) => {
    const { container } = render(
      <AccessibilityTreeToolView {...owner(settled(meta, [{ type: 'text', text: 'raw' }]))} />,
    )
    expect(container.querySelector('.cf-toolview__raw')?.textContent).toBe('raw')
  })
})

describe('SessionCostToolView', () => {
  it('shows the usage chip from the projection', () => {
    render(
      <SessionCostToolView
        {...owner(settled({ requests: 4, cost: 0.0125, tokensIn: 120, tokensOut: 40, cached: 1 }))}
      />,
    )
    expect(screen.getByText('4 requests').className).toBe('cf-chip__figure')
  })

  it('shows the chip loading while the call runs, which is what a running call is', () => {
    render(<SessionCostToolView {...owner(running)} />)
    expect(screen.getByText('Loading Cloudflare usage for this session').className).toBe('cf-chip__status')
  })

  // One case per figure, so each type check is the clause that decides. A
  // single malformed example leaves the other four never exercised.
  const figures = { requests: 4, cost: 0.0125, tokensIn: 120, tokensOut: 40, cached: 1 }
  it.each([
    ['there is no projection', undefined],
    ['the projection is not an object', 'flat'],
    ['the request count is missing', { ...figures, requests: undefined }],
    ['the cost is not a number', { ...figures, cost: '1' }],
    ['the input tokens are not a number', { ...figures, tokensIn: '1' }],
    ['the output tokens are not a number', { ...figures, tokensOut: '1' }],
    ['the cache count is missing', { ...figures, cached: undefined }],
  ])('shows the chip failed when %s', (_label, meta) => {
    render(<SessionCostToolView {...owner(settled(meta))} />)
    expect(screen.getByText('Cloudflare usage could not be loaded.').className).toBe('cf-chip__status')
  })
})
