// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CloudflareSettings, SettingsCard, type SettingsCardProps } from '../src/SettingsCard.tsx'
import { expectNoViolations } from './axe.ts'

afterEach(cleanup)

const settings: CloudflareSettings = {
  apiTokenRef: 'CLOUDFLARE_API_TOKEN',
  accountId: '',
  gatewayId: '',
}

function setup(over: Partial<Parameters<typeof SettingsCard>[0]> = {}) {
  const onSave = vi.fn<SettingsCardProps['onSave']>()
  const result = render(<SettingsCard settings={settings} tokenStored={false} onSave={onSave} {...over} />)
  return { ...result, onSave }
}

describe('SettingsCard', () => {
  it('names its region by its heading', () => {
    const { container } = setup()
    const region = screen.getByRole('region', { name: 'Cloudflare' })
    const labelledBy = region.getAttribute('aria-labelledby')
    // Named *by the heading*, not by a label that happens to read the same:
    // the reference is resolved to the element it points at.
    expect(container.ownerDocument.getElementById(labelledBy ?? '')).toBe(
      screen.getByRole('heading', { level: 2 }),
    )
  })

  it.each(['API token reference', 'API token', 'Account ID', 'AI Gateway ID'])(
    'gives %s a programmatic label',
    (label) => {
      setup()
      // A label may point at anything with an id; only a form control makes it
      // a programmatic label for a field.
      expect(screen.getByLabelText(label).tagName).toBe('INPUT')
    },
  )

  it('keeps the token field write-only', () => {
    setup()
    const field = screen.getByLabelText('API token')
    expect(field.getAttribute('type')).toBe('password')
    expect((field as HTMLInputElement).value).toBe('')
  })

  it('keeps password managers out of a harness credential', () => {
    setup()
    expect(screen.getByLabelText('API token').getAttribute('autocomplete')).toBe('off')
  })

  it('reports whether a token is stored, without revealing it', () => {
    const { container } = setup({ tokenStored: true })
    expect(container.querySelector('.cf-field:nth-of-type(2)')?.textContent).toContain(
      'A token is stored for this reference.',
    )
  })

  it('reports when no token is stored', () => {
    const { container } = setup()
    expect(container.querySelector('.cf-field:nth-of-type(2)')?.textContent).toContain(
      'No token is stored for this reference.',
    )
  })

  it('associates the Account ID field with its hint', () => {
    const { container } = setup()
    const described = screen.getByLabelText('Account ID').getAttribute('aria-describedby')
    expect(described).not.toBeNull()
    expect(container.ownerDocument.getElementById(described!)?.textContent).toBe(
      'Leave blank to use the first account the token can access.',
    )
  })

  it('states the credential policy in the card body', () => {
    // Copy is asserted literally: this sentence is the page's only statement
    // that a stored secret never comes back, so it is part of the interface.
    const { container } = setup()
    expect(container.textContent).toContain(
      'Credentials are stored by reference. This page never receives a stored secret back — only whether one is set.',
    )
  })

  it.each([
    [
      'API token reference',
      'The environment variable name holding the token, for example CLOUDFLARE_API_TOKEN.',
    ],
    ['AI Gateway ID', 'Required to route the harness\u2019s own model calls through a gateway.'],
  ])('describes the %s field with the hint a user needs', (label, hint) => {
    const { container } = setup()
    const described = screen.getByLabelText(label).getAttribute('aria-describedby')
    expect(described).not.toBeNull()
    const first = described!.split(' ')[0]!
    expect(container.ownerDocument.getElementById(first)?.textContent).toBe(hint)
  })

  it('marks no field invalid before anything is submitted', () => {
    setup()
    expect(screen.getByLabelText('API token reference').getAttribute('aria-invalid')).toBe('false')
  })

  it('describes the token field by both its hint and its stored-state note', () => {
    const { container } = setup({ tokenStored: true })
    const described = screen.getByLabelText('API token').getAttribute('aria-describedby')
    const ids = described?.split(' ') ?? []
    expect(ids).toHaveLength(2)
    const texts = ids.map((id) => container.ownerDocument.getElementById(id)?.textContent)
    expect(texts).toEqual([
      'Write-only. Leave blank to keep the stored value.',
      'A token is stored for this reference.',
    ])
  })

  // Without preventDefault the form would navigate, losing the page.
  it('prevents the browser default form submission', () => {
    const { container } = setup()
    const form = container.querySelector('form')!
    const submit = new Event('submit', { bubbles: true, cancelable: true })
    fireEvent(form, submit)
    expect(submit.defaultPrevented).toBe(true)
  })

  it('saves the edited settings', () => {
    const { onSave } = setup()
    fireEvent.change(screen.getByLabelText('Account ID'), { target: { value: 'acct-9' } })
    fireEvent.change(screen.getByLabelText('AI Gateway ID'), { target: { value: 'gw-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Cloudflare settings' }))
    expect(onSave).toHaveBeenCalledWith(
      { apiTokenRef: 'CLOUDFLARE_API_TOKEN', accountId: 'acct-9', gatewayId: 'gw-1' },
      undefined,
    )
  })

  it('saves the edited token reference, which is the field whose invalid path is tested elsewhere', () => {
    // Every other save test keeps the reference at its initial value, so a
    // save that dropped the edited reference and kept the old one would pass
    // this whole suite while persisting a reference the form no longer shows.
    const { onSave } = setup()
    fireEvent.change(screen.getByLabelText('API token reference'), { target: { value: 'CF_TOKEN' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Cloudflare settings' }))
    expect(onSave).toHaveBeenCalledWith({ apiTokenRef: 'CF_TOKEN', accountId: '', gatewayId: '' }, undefined)
  })

  it('passes a typed token through and then clears the field', () => {
    const { onSave } = setup()
    const field = screen.getByLabelText('API token')
    fireEvent.change(field, { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Cloudflare settings' }))
    expect(onSave).toHaveBeenCalledWith(settings, 'secret')
    expect((field as HTMLInputElement).value).toBe('')
  })

  it('keeps a typed token when validation fails, so the secret is never typed twice', () => {
    // SC 3.3.7 asks that a value already entered not be demanded again. The
    // clearing on success is the other test; a clear on the error path would
    // throw the typed secret away along with the mistake.
    setup()
    const token = screen.getByLabelText('API token')
    fireEvent.change(token, { target: { value: 'secret' } })
    fireEvent.change(screen.getByLabelText('API token reference'), { target: { value: 'bad ref' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Cloudflare settings' }))
    expect(screen.getByRole('alert').textContent).not.toBe('')
    expect((token as HTMLInputElement).value).toBe('secret')
  })

  it('confirms a save in a polite status region', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Save Cloudflare settings' }))
    expect(screen.getByRole('status').textContent).toBe('Cloudflare settings saved.')
  })

  it('keeps the status region mounted but empty until a save happens', () => {
    setup()
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('keeps the error region mounted but empty until validation fails', () => {
    setup()
    expect(screen.getByRole('alert').textContent).toBe('')
  })

  it('rejects a malformed token reference without calling onSave', () => {
    const { onSave } = setup()
    fireEvent.change(screen.getByLabelText('API token reference'), { target: { value: 'lower case' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Cloudflare settings' }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('announces the validation error and marks the field invalid', () => {
    setup()
    fireEvent.change(screen.getByLabelText('API token reference'), { target: { value: 'bad ref' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Cloudflare settings' }))
    expect(screen.getByRole('alert').textContent).toBe(
      'A token reference must be an environment variable name: uppercase letters, digits and underscores.',
    )
    expect(screen.getByLabelText('API token reference').getAttribute('aria-invalid')).toBe('true')
  })

  it('points the invalid field at both its hint and its error', () => {
    const { container } = setup()
    fireEvent.change(screen.getByLabelText('API token reference'), { target: { value: 'bad ref' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Cloudflare settings' }))
    const ids = screen.getByLabelText('API token reference').getAttribute('aria-describedby')?.split(' ')
    // Resolved to what they point at, not counted: two ids is true of any two
    // elements, and of the same element named twice, so a count would let the
    // field describe itself with anything at all and still read as wired.
    expect(ids?.map((id) => container.ownerDocument.getElementById(id)?.textContent)).toEqual([
      'The environment variable name holding the token, for example CLOUDFLARE_API_TOKEN.',
      'A token reference must be an environment variable name: uppercase letters, digits and underscores.',
    ])
  })

  it('clears the error once a valid reference is saved', () => {
    const { onSave } = setup()
    const ref = screen.getByLabelText('API token reference')
    fireEvent.change(ref, { target: { value: 'bad ref' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Cloudflare settings' }))
    fireEvent.change(ref, { target: { value: 'CF_TOKEN' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Cloudflare settings' }))
    expect(screen.getByRole('alert').textContent).toBe('')
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('withdraws a stale save confirmation as soon as a field is edited', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Save Cloudflare settings' }))
    expect(screen.getByRole('status').textContent).toBe('Cloudflare settings saved.')
    fireEvent.change(screen.getByLabelText('Account ID'), { target: { value: 'acct-9' } })
    // The confirmation described the stored values. Editing makes it a claim
    // about state that is no longer stored.
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it.each(['API token reference', 'API token', 'AI Gateway ID'])(
    'withdraws it when the %s field is the one edited',
    (label) => {
      setup()
      fireEvent.click(screen.getByRole('button', { name: 'Save Cloudflare settings' }))
      fireEvent.change(screen.getByLabelText(label), { target: { value: 'X' } })
      expect(screen.getByRole('status').textContent).toBe('')
    },
  )

  it('renders the confirmation as an output element, whose implicit role is status', () => {
    const { container } = setup()
    expect(container.querySelector('.cf-saved')?.tagName).toBe('OUTPUT')
  })

  it('hides a stale save confirmation when validation then fails', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Save Cloudflare settings' }))
    fireEvent.change(screen.getByLabelText('API token reference'), { target: { value: 'bad ref' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Cloudflare settings' }))
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('has no accessibility violations', async () => {
    const { container } = setup()
    await expectNoViolations(container)
  })

  it('has no accessibility violations while showing a validation error', async () => {
    const { container } = setup()
    fireEvent.change(screen.getByLabelText('API token reference'), { target: { value: 'bad ref' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Cloudflare settings' }))
    await expectNoViolations(container)
  })
})
