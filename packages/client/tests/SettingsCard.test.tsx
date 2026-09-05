// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CloudflareSettings, SettingsCard } from '../src/SettingsCard.tsx'
import { en } from '../src/locales/en.ts'
import { expectNoViolations } from './axe.ts'

afterEach(cleanup)

const settings: CloudflareSettings = {
  apiTokenRef: 'CLOUDFLARE_API_TOKEN',
  accountId: '',
  gatewayId: '',
}

function setup(over: Partial<Parameters<typeof SettingsCard>[0]> = {}) {
  const onSave = vi.fn()
  const result = render(<SettingsCard settings={settings} tokenStored={false} onSave={onSave} {...over} />)
  return { ...result, onSave }
}

describe('SettingsCard', () => {
  it('names its region by its heading', () => {
    setup()
    expect(screen.getByRole('region', { name: en.settings.heading })).toBeDefined()
  })

  it.each([
    en.settings.tokenRefLabel,
    en.settings.tokenValueLabel,
    en.settings.accountLabel,
    en.settings.gatewayLabel,
  ])('gives %s a programmatic label', (label) => {
    setup()
    expect(screen.getByLabelText(label)).toBeDefined()
  })

  it('keeps the token field write-only', () => {
    setup()
    const field = screen.getByLabelText(en.settings.tokenValueLabel)
    expect(field.getAttribute('type')).toBe('password')
    expect((field as HTMLInputElement).value).toBe('')
  })

  it('keeps password managers out of a harness credential', () => {
    setup()
    expect(screen.getByLabelText(en.settings.tokenValueLabel).getAttribute('autocomplete')).toBe('off')
  })

  it('reports whether a token is stored, without revealing it', () => {
    setup({ tokenStored: true })
    expect(screen.getByText(en.settings.tokenSet)).toBeDefined()
  })

  it('reports when no token is stored', () => {
    setup()
    expect(screen.getByText(en.settings.tokenUnset)).toBeDefined()
  })

  it('associates each field with its hint', () => {
    const { container } = setup()
    const described = screen.getByLabelText(en.settings.accountLabel).getAttribute('aria-describedby')
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
      'tokenRefLabel' as const,
      'The environment variable name holding the token, for example CLOUDFLARE_API_TOKEN.',
    ],
    ['gatewayLabel' as const, 'Required to route the harness\u2019s own model calls through a gateway.'],
  ])('describes the %s field with the hint a user needs', (labelKey, hint) => {
    const { container } = setup()
    const described = screen.getByLabelText(en.settings[labelKey]).getAttribute('aria-describedby')
    expect(described).not.toBeNull()
    const first = described!.split(' ')[0]!
    expect(container.ownerDocument.getElementById(first)?.textContent).toBe(hint)
  })

  it('marks no field invalid before anything is submitted', () => {
    setup()
    expect(screen.getByLabelText(en.settings.tokenRefLabel).getAttribute('aria-invalid')).toBe('false')
  })

  it('describes the token field by both its hint and its stored-state note', () => {
    const { container } = setup({ tokenStored: true })
    const described = screen.getByLabelText(en.settings.tokenValueLabel).getAttribute('aria-describedby')
    const ids = described?.split(' ') ?? []
    expect(ids).toHaveLength(2)
    const texts = ids.map((id) => container.ownerDocument.getElementById(id)?.textContent)
    expect(texts).toEqual(['Write-only. Leave blank to keep the stored value.', en.settings.tokenSet])
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
    fireEvent.change(screen.getByLabelText(en.settings.accountLabel), { target: { value: 'acct-9' } })
    fireEvent.change(screen.getByLabelText(en.settings.gatewayLabel), { target: { value: 'gw-1' } })
    fireEvent.click(screen.getByRole('button', { name: en.settings.save }))
    expect(onSave).toHaveBeenCalledWith(
      { apiTokenRef: 'CLOUDFLARE_API_TOKEN', accountId: 'acct-9', gatewayId: 'gw-1' },
      undefined,
    )
  })

  it('passes a typed token through and then clears the field', () => {
    const { onSave } = setup()
    const field = screen.getByLabelText(en.settings.tokenValueLabel)
    fireEvent.change(field, { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: en.settings.save }))
    expect(onSave).toHaveBeenCalledWith(settings, 'secret')
    expect((field as HTMLInputElement).value).toBe('')
  })

  it('confirms a save in a polite status region', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: en.settings.save }))
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
    fireEvent.change(screen.getByLabelText(en.settings.tokenRefLabel), { target: { value: 'lower case' } })
    fireEvent.click(screen.getByRole('button', { name: en.settings.save }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('announces the validation error and marks the field invalid', () => {
    setup()
    fireEvent.change(screen.getByLabelText(en.settings.tokenRefLabel), { target: { value: 'bad ref' } })
    fireEvent.click(screen.getByRole('button', { name: en.settings.save }))
    expect(screen.getByRole('alert').textContent).toBe(
      'A token reference must be an environment variable name: uppercase letters, digits and underscores.',
    )
    expect(screen.getByLabelText(en.settings.tokenRefLabel).getAttribute('aria-invalid')).toBe('true')
  })

  it('points the invalid field at both its hint and its error', () => {
    setup()
    fireEvent.change(screen.getByLabelText(en.settings.tokenRefLabel), { target: { value: 'bad ref' } })
    fireEvent.click(screen.getByRole('button', { name: en.settings.save }))
    const described = screen.getByLabelText(en.settings.tokenRefLabel).getAttribute('aria-describedby')
    expect(described?.split(' ')).toHaveLength(2)
  })

  it('clears the error once a valid reference is saved', () => {
    const { onSave } = setup()
    const ref = screen.getByLabelText(en.settings.tokenRefLabel)
    fireEvent.change(ref, { target: { value: 'bad ref' } })
    fireEvent.click(screen.getByRole('button', { name: en.settings.save }))
    fireEvent.change(ref, { target: { value: 'CF_TOKEN' } })
    fireEvent.click(screen.getByRole('button', { name: en.settings.save }))
    expect(screen.getByRole('alert').textContent).toBe('')
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('hides a stale save confirmation when validation then fails', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: en.settings.save }))
    fireEvent.change(screen.getByLabelText(en.settings.tokenRefLabel), { target: { value: 'bad ref' } })
    fireEvent.click(screen.getByRole('button', { name: en.settings.save }))
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('has no accessibility violations', async () => {
    const { container } = setup()
    await expectNoViolations(container)
  })

  it('has no accessibility violations while showing a validation error', async () => {
    const { container } = setup()
    fireEvent.change(screen.getByLabelText(en.settings.tokenRefLabel), { target: { value: 'bad ref' } })
    fireEvent.click(screen.getByRole('button', { name: en.settings.save }))
    await expectNoViolations(container)
  })
})
