// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionCostChip } from '../src/SessionCostChip.tsx'
import { expectNoViolations } from './axe.ts'

afterEach(cleanup)

const usage = { requests: 4, cost: 0.0125, tokensIn: 120, tokensOut: 40, cached: 1 }

describe('SessionCostChip', () => {
  it('names the region so it is findable without sight of the layout', () => {
    render(<SessionCostChip usage={usage} />)
    expect(
      screen.getByRole('region', { name: 'Cloudflare AI Gateway usage for this session' }),
    ).toBeInstanceOf(HTMLElement)
  })

  it('announces updates politely rather than stealing focus', () => {
    const { container } = render(<SessionCostChip usage={usage} />)
    expect(container.querySelector('section')?.getAttribute('aria-live')).toBe('polite')
  })

  it('shows request count, cost and cache rate as labelled text, never colour alone', () => {
    render(<SessionCostChip usage={usage} />)
    expect(screen.getByText('4 requests')).toBeInstanceOf(HTMLElement)
    expect(screen.getByText('cost $0.01')).toBeInstanceOf(HTMLElement)
    expect(screen.getByText('25% cache hit rate')).toBeInstanceOf(HTMLElement)
  })

  it('keeps sub-cent costs legible rather than rounding them to zero', () => {
    render(<SessionCostChip usage={{ ...usage, cost: 0.00042 }} />)
    expect(screen.getByText('cost $0.00042')).toBeInstanceOf(HTMLElement)
  })

  it('uses the singular for a single request', () => {
    render(<SessionCostChip usage={{ ...usage, requests: 1, cached: 0 }} />)
    expect(screen.getByText('1 request')).toBeInstanceOf(HTMLElement)
  })

  it('reports the empty state when the session has made no gateway requests', () => {
    render(<SessionCostChip usage={{ ...usage, requests: 0 }} />)
    expect(
      screen.getByText('No Cloudflare AI Gateway requests recorded for this session yet.'),
    ).toBeInstanceOf(HTMLElement)
  })

  it('reports the empty state when usage is not yet known', () => {
    render(<SessionCostChip />)
    expect(
      screen.getByText('No Cloudflare AI Gateway requests recorded for this session yet.'),
    ).toBeInstanceOf(HTMLElement)
  })

  it('reports loading', () => {
    render(<SessionCostChip loading />)
    expect(screen.getByText('Loading Cloudflare usage for this session')).toBeInstanceOf(HTMLElement)
  })

  it('reports failure', () => {
    render(<SessionCostChip failed />)
    expect(screen.getByText('Cloudflare usage could not be loaded.')).toBeInstanceOf(HTMLElement)
  })

  it('prefers the failure state over loading', () => {
    render(<SessionCostChip failed loading />)
    expect(screen.getByText('Cloudflare usage could not be loaded.')).toBeInstanceOf(HTMLElement)
  })

  it('exposes the detail toggle as a button with an accessible name', () => {
    render(<SessionCostChip usage={usage} />)
    expect(screen.getByRole('button', { name: 'Show detail' })).toBeInstanceOf(HTMLButtonElement)
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
    expect(screen.getByRole('button', { name: 'Hide detail' })).toBeInstanceOf(HTMLButtonElement)
  })

  it('collapses again on a second activation', () => {
    render(<SessionCostChip usage={usage} />)
    const button = screen.getByRole('button')
    fireEvent.click(button)
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('associates the toggle with the detail it controls', () => {
    const { container } = render(<SessionCostChip usage={usage} />)
    const controls = screen.getByRole('button').getAttribute('aria-controls')
    expect(controls).not.toBeNull()
    expect(container.ownerDocument.getElementById(controls!)).not.toBeNull()
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

  it('shows cached and token detail once expanded', () => {
    render(<SessionCostChip usage={usage} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('1 served from cache')).toBeInstanceOf(HTMLElement)
    expect(screen.getByText('120 in, 40 out')).toBeInstanceOf(HTMLElement)
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
