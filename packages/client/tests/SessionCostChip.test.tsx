// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionCostChip } from '../src/SessionCostChip.tsx'
import { expectNoViolations } from './axe.ts'

afterEach(cleanup)

const usage = { requests: 4, cost: 0.0125, tokensIn: 120, tokensOut: 40, cached: 1 }

/**
 * The chip's figures, in document order.
 *
 * Read as a list rather than asserted one at a time: the order and the count
 * are part of what the chip shows, and a query per figure proves neither.
 */
const figures = (container: HTMLElement): (string | null)[] =>
  [...container.querySelectorAll('.cf-chip__figure')].map((node) => node.textContent)

/** The single status line, or null when the chip is showing figures instead. */
const status = (container: HTMLElement): string | null | undefined =>
  container.querySelector('.cf-chip__status')?.textContent

describe('SessionCostChip', () => {
  it('names the region so it is findable without sight of the layout', () => {
    render(<SessionCostChip usage={usage} />)
    const region = screen.getByRole('region', { name: 'Cloudflare AI Gateway usage for this session' })
    // The named region is the chip itself. An ancestor carrying the name would
    // satisfy the query while leaving the chip unnamed.
    expect(region.className).toBe('cf-chip')
  })

  it('announces updates politely rather than stealing focus', () => {
    const { container } = render(<SessionCostChip usage={usage} />)
    expect(container.querySelector('[aria-live]')?.getAttribute('aria-live')).toBe('polite')
  })

  it('keeps the toggle out of the live region, so activating it announces no flat copy of the chip', () => {
    const { container } = render(<SessionCostChip usage={usage} />)
    const live = container.querySelector('[aria-live]')
    expect(live?.className).toBe('cf-chip__live')
    expect(live?.querySelector('button')).toBeNull()
    expect(live?.querySelector('.cf-chip__detail')).toBeNull()
  })

  it('shows request count, cost and cache rate as labelled text, never colour alone', () => {
    const { container } = render(<SessionCostChip usage={usage} />)
    expect(figures(container)).toEqual(['4 requests', 'cost $0.01', '25% cache hit rate'])
  })

  it('keeps sub-cent costs legible rather than rounding them to zero', () => {
    const { container } = render(<SessionCostChip usage={{ ...usage, cost: 0.00042 }} />)
    expect(figures(container)[1]).toBe('cost $0.00042')
  })

  it('uses the singular for a single request', () => {
    const { container } = render(<SessionCostChip usage={{ ...usage, requests: 1, cached: 0 }} />)
    expect(figures(container)[0]).toBe('1 request')
  })

  it('reports the empty state when the session has made no gateway requests', () => {
    const { container } = render(<SessionCostChip usage={{ ...usage, requests: 0 }} />)
    expect(status(container)).toBe('No Cloudflare AI Gateway requests recorded for this session yet.')
  })

  it('reports the empty state when usage is not yet known', () => {
    const { container } = render(<SessionCostChip />)
    expect(status(container)).toBe('No Cloudflare AI Gateway requests recorded for this session yet.')
  })

  it('reports loading', () => {
    const { container } = render(<SessionCostChip loading />)
    expect(status(container)).toBe('Loading Cloudflare usage for this session')
  })

  it('reports failure', () => {
    const { container } = render(<SessionCostChip failed />)
    expect(status(container)).toBe('Cloudflare usage could not be loaded.')
  })

  it('prefers the failure state over loading', () => {
    const { container } = render(<SessionCostChip failed loading />)
    expect(status(container)).toBe('Cloudflare usage could not be loaded.')
  })

  it.each([
    ['while loading', { loading: true }],
    ['after a failure', { failed: true }],
    ['when empty', {}],
  ])('offers no figures and no toggle %s', (_name, props) => {
    const { container } = render(<SessionCostChip {...props} />)
    expect(figures(container)).toEqual([])
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('exposes the detail toggle as a button with an accessible name', () => {
    render(<SessionCostChip usage={usage} />)
    // `type` matters: a button with no type submits the form it sits in.
    expect(screen.getByRole('button', { name: 'Show detail' }).getAttribute('type')).toBe('button')
  })

  it('starts collapsed and reports that state', () => {
    render(<SessionCostChip usage={usage} />)
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
  })

  it('expands on activation, updating both the state and the label', () => {
    render(<SessionCostChip usage={usage} />)
    const button = screen.getByRole('button')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    // The same control relabels; a second button appearing would also satisfy
    // a query for the new name.
    expect(button.textContent).toBe('Hide detail')
  })

  it('collapses again on a second activation', () => {
    render(<SessionCostChip usage={usage} />)
    const button = screen.getByRole('button')
    fireEvent.click(button)
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.textContent).toBe('Show detail')
  })

  it('associates the toggle with the detail it controls', () => {
    const { container } = render(<SessionCostChip usage={usage} />)
    const controls = screen.getByRole('button').getAttribute('aria-controls')
    expect(controls).not.toBeNull()
    // Resolved to the element it names, not counted: an id that resolves to
    // anything at all is true of any id on the page.
    expect(container.ownerDocument.getElementById(controls!)).toBe(
      container.querySelector('.cf-chip__detail'),
    )
  })

  it('hides the detail while collapsed', () => {
    const { container } = render(<SessionCostChip usage={usage} />)
    expect(container.querySelector<HTMLElement>('.cf-chip__detail')?.hidden).toBe(true)
  })

  it('reveals the detail once expanded', () => {
    const { container } = render(<SessionCostChip usage={usage} />)
    fireEvent.click(screen.getByRole('button'))
    expect(container.querySelector<HTMLElement>('.cf-chip__detail')?.hidden).toBe(false)
  })

  it('pairs each detail term with the figure it describes', () => {
    const { container } = render(<SessionCostChip usage={usage} />)
    fireEvent.click(screen.getByRole('button'))
    // Terms and definitions in order, so a term describing the wrong figure
    // fails — which a check for the presence of each string would not.
    expect([...container.querySelectorAll('.cf-chip__detail > *')].map((n) => n.textContent)).toEqual([
      'Cached',
      '1 served from cache',
      'Tokens',
      '120 in, 40 out',
    ])
  })

  it.each([
    ['with usage', { usage }],
    ['while loading', { loading: true }],
    ['after a failure', { failed: true }],
    ['when empty', {}],
  ])('has no accessibility violations %s', async (_name, props) => {
    const { container } = render(<SessionCostChip {...props} />)
    await expectNoViolations(container)
  })

  it('has no accessibility violations when expanded', async () => {
    const { container } = render(<SessionCostChip usage={usage} />)
    fireEvent.click(screen.getByRole('button'))
    await expectNoViolations(container)
  })
})
