// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ToolCallOwnerProps } from '../src/toolviews/fromToolCall.tsx'
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
    const owner: ToolCallOwnerProps = {
      callId: 'c1',
      toolName: 'cloudflare_d1_query',
      block: running,
      cwd: '/w',
      openFile: () => undefined,
      inspect: () => undefined,
    }
    expect(Object.keys(owner).toSorted()).toEqual([
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

  it('skips a block that is not text', () => {
    expect(resultText(settled(undefined, [{ type: 'image' }, { type: 'text', text: 'a' }]))).toBe('a')
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

  it('falls back to the result text when the projection is not there to read', () => {
    const { container } = render(
      <D1ResultToolView {...owner(settled(undefined, [{ type: 'text', text: 'raw' }]))} />,
    )
    expect(container.querySelector('.cf-toolview__raw')?.textContent).toBe('raw')
  })

  it('renders nothing while the call is still running', () => {
    const { container } = render(<D1ResultToolView {...owner(running)} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('BrowserRenderToolView', () => {
  it('renders the captioned text from the projection', () => {
    render(<BrowserRenderToolView {...owner(settled({ url: 'https://x.test', body: '# Title' }))} />)
    expect(screen.getByRole('figure', { name: 'Rendered https://x.test' }).textContent).toContain('# Title')
  })

  it('falls back when the body is not a string, which the view cannot render', () => {
    const { container } = render(
      <BrowserRenderToolView
        {...owner(settled({ url: 'https://x.test', body: 7 }, [{ type: 'text', text: 'raw' }]))}
      />,
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

  it('falls back when the tree is not an object', () => {
    const { container } = render(
      <AccessibilityTreeToolView
        {...owner(settled({ url: 'https://x.test', tree: 'flat' }, [{ type: 'text', text: 'raw' }]))}
      />,
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

  it.each([
    ['there is no projection', undefined],
    ['a figure is missing', { requests: 4, cost: 1, tokensIn: 1, tokensOut: 1 }],
    ['a figure is not a number', { requests: '4', cost: 1, tokensIn: 1, tokensOut: 1, cached: 1 }],
  ])('shows the chip failed when %s', (_label, meta) => {
    render(<SessionCostToolView {...owner(settled(meta))} />)
    expect(screen.getByText('Cloudflare usage could not be loaded.').className).toBe('cf-chip__status')
  })
})
