// @vitest-environment jsdom
/**
 * The controls this client renders, activated.
 *
 * Every other jsdom suite in this package reads the document a control left
 * behind — a role, a name, an attribute, a live region's text. None of them
 * activated anything: a button whose handler was deleted, a form whose submit
 * handler went with it and a toggle wired to nothing all produce markup
 * identical to ones that work, so none of those assertions can tell the
 * difference. These tests drive the control the way a reader does, and read
 * what changed.
 *
 * Every activation reads a transition rather than a state. The reading taken
 * before the activation is part of the expected value, so a handler that never
 * ran fails with `[0, 'secret']` against `[1, '']` instead of passing on a page
 * that did not move — which is the whole difference between proving a control
 * works and asserting that it exists.
 *
 * Keyboard activation is proved in Chromium by `e2e.browser.test.tsx`. jsdom
 * implements no default action for a key press: `fireEvent.keyDown(button,
 * { key: 'Enter' })` dispatches the event and nothing else, so a keyboard
 * assertion here would be an assertion about `fireEvent`. A real engine
 * synthesises the activation, which is where that half belongs.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionCostChip } from '../src/SessionCostChip.tsx'
import { SettingsCard } from '../src/SettingsCard.tsx'
import type { CloudflareSettings, SessionCostChipProps, SettingsCardProps } from '../src/index.ts'
import { CHIP_WITH_USAGE, SETTINGS } from './fixtures.tsx'

afterEach(cleanup)

/** The copy a failed validation puts in front of the reader. */
const INVALID_REFERENCE =
  'A token reference must be an environment variable name: uppercase letters, digits and underscores.'

/** One save the card made, as the host's callback saw it. */
interface Save {
  readonly settings: CloudflareSettings
  readonly token: string | undefined
}

/** The input a label names, so its value can be read without a cast on what was found. */
function inputFor(label: string): HTMLInputElement {
  const field = screen.getByLabelText(label)
  if (field instanceof HTMLInputElement) return field
  throw new Error(`the field labelled ${label} is not an input`)
}

/** Render the card with a callback that records every save it makes. */
function card(over: Partial<SettingsCardProps> = {}): { container: HTMLElement; saves: Save[] } {
  const saves: Save[] = []
  const { container } = render(
    <SettingsCard
      settings={SETTINGS}
      tokenStored={false}
      onSave={(settings, token) => {
        saves.push({ settings, token })
      }}
      {...over}
    />,
  )
  return { container, saves }
}

/** The save control, found by the name a reader hears rather than by its position. */
const saveButton = (): HTMLElement => screen.getByRole('button', { name: 'Save Cloudflare settings' })

describe('the settings card, activated', () => {
  it('saves exactly what was typed, and clears the secret field afterwards', () => {
    const { saves } = card()
    const token = inputFor('API token')
    fireEvent.change(inputFor('Account ID'), { target: { value: 'acct-9' } })
    fireEvent.change(inputFor('AI Gateway ID'), { target: { value: 'gw-1' } })
    fireEvent.change(token, { target: { value: 'secret' } })

    const before = [saves.length, token.value]
    fireEvent.click(saveButton())
    const after = [saves.length, token.value]

    // Read as a pair, either side of the click: a handler that never ran leaves
    // the pair at `[0, 'secret']`, which is what fails here.
    expect(after, 'activating the save control changed nothing').not.toEqual(before)
    expect([before, after]).toEqual([
      [0, 'secret'],
      // The typed secret does not survive a save, which is what makes the
      // field write-only in practice and not only by attribute.
      [1, ''],
    ])
    expect(saves).toEqual([
      {
        settings: { apiTokenRef: 'CLOUDFLARE_API_TOKEN', accountId: 'acct-9', gatewayId: 'gw-1' },
        token: 'secret',
      },
    ])
  })

  it('saves the edited reference itself, not the one the form opened with', () => {
    const { saves } = card()
    fireEvent.change(inputFor('API token reference'), { target: { value: 'CF_TOKEN' } })

    expect(saves).toEqual([])
    fireEvent.click(saveButton())
    expect(saves.map((save) => save.settings.apiTokenRef)).toEqual(['CF_TOKEN'])
  })

  it('refuses a malformed reference without reaching the host, and keeps what was typed', () => {
    const { saves } = card()
    const reference = inputFor('API token reference')
    const token = inputFor('API token')
    fireEvent.change(token, { target: { value: 'secret' } })
    fireEvent.change(reference, { target: { value: 'not a reference' } })

    const before = [reference.getAttribute('aria-invalid'), screen.getByRole('alert').textContent]
    fireEvent.click(saveButton())
    const after = [reference.getAttribute('aria-invalid'), screen.getByRole('alert').textContent]

    expect(saves, 'a malformed reference reached the host').toEqual([])
    expect(after, 'the refusal changed nothing the reader is shown').not.toEqual(before)
    expect([before, after]).toEqual([
      ['false', ''],
      ['true', INVALID_REFERENCE],
    ])
    // SC 3.3.7: a value already typed is not demanded a second time.
    expect(token.value).toBe('secret')
  })

  it('saves once a corrected reference is submitted, and withdraws the error', () => {
    const { saves } = card()
    const reference = inputFor('API token reference')
    fireEvent.change(reference, { target: { value: 'not a reference' } })
    fireEvent.click(saveButton())

    expect([saves.length, screen.getByRole('alert').textContent]).toEqual([0, INVALID_REFERENCE])
    fireEvent.change(reference, { target: { value: 'CF_TOKEN' } })
    fireEvent.click(saveButton())
    expect([saves.length, screen.getByRole('alert').textContent]).toEqual([1, ''])
  })
})

describe('the session cost chip, activated', () => {
  it('expands the detail it controls, relabels itself, and collapses again', () => {
    const { container } = render(CHIP_WITH_USAGE)
    const toggle = screen.getByRole('button', { name: 'Show detail' })
    const detail = container.ownerDocument.getElementById(toggle.getAttribute('aria-controls') ?? '')

    // The control names the element it opens, and that element is the one the
    // `hidden` attribute is on — resolved to the node, not to an id string.
    expect(detail).toBe(container.querySelector('.cf-chip__detail'))
    expect(detail?.hasAttribute('hidden')).toBe(true)

    const before = [toggle.getAttribute('aria-expanded'), detail?.hasAttribute('hidden'), toggle.textContent]
    fireEvent.click(toggle)
    const after = [toggle.getAttribute('aria-expanded'), detail?.hasAttribute('hidden'), toggle.textContent]

    expect(after, 'activating the toggle changed nothing').not.toEqual(before)
    expect([before, after]).toEqual([
      ['false', true, 'Show detail'],
      ['true', false, 'Hide detail'],
    ])

    fireEvent.click(toggle)
    expect([toggle.getAttribute('aria-expanded'), detail?.hasAttribute('hidden'), toggle.textContent]).toEqual([
      'false',
      true,
      'Show detail',
    ])
  })

  it('leaves the figures it was opened with untouched by the toggle', () => {
    const { container } = render(CHIP_WITH_USAGE)
    const figures = (): (string | null)[] =>
      [...container.querySelectorAll('.cf-chip__figure')].map((node) => node.textContent)

    expect(figures()).toEqual(['4 requests', 'cost $0.01', '25% cache hit rate'])
    fireEvent.click(screen.getByRole('button', { name: 'Show detail' }))
    // The detail opens under the figures; a handler that rebuilt the row would
    // change what the reader was already looking at.
    expect(figures()).toEqual(['4 requests', 'cost $0.01', '25% cache hit rate'])
  })

  it('reports no transition for a control wired to nothing, which is the shape these assertions take', () => {
    const { container } = render(<button type="button">Show detail</button>)
    const toggle = screen.getByRole('button', { name: 'Show detail' })

    const before = [toggle.getAttribute('aria-expanded'), container.innerHTML]
    fireEvent.click(toggle)
    // The pair every activation assertion above reads either side of. An inert
    // control leaves it equal, so an assertion written against a state rather
    // than a transition would hold here — which is why none of them is.
    expect([toggle.getAttribute('aria-expanded'), container.innerHTML]).toEqual(before)
    expect(before).toEqual([null, '<button type="button">Show detail</button>'])
  })
})

/** The states that carry no figures, and so offer nothing to activate. */
const FIGURELESS: ReadonlyArray<{ name: string; props: SessionCostChipProps }> = [
  { name: 'loading', props: { loading: true } },
  { name: 'failed', props: { failed: true } },
  { name: 'empty', props: {} },
]

describe('the chip in its other states, activated', () => {
  for (const state of FIGURELESS) {
    it(`offers nothing to activate while it is ${state.name}`, () => {
      const { container } = render(<SessionCostChip {...state.props} />)
      // Nothing to press, and nothing a press could reach: the states with no
      // figures have no detail either.
      expect(screen.queryByRole('button')).toBeNull()
      expect(container.querySelector('.chip__detail')).toBeNull()
      expect(container.querySelectorAll('.cf-chip__figure')).toHaveLength(0)
    })
  }
})
