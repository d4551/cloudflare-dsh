/**
 * Cloudflare settings.
 *
 * The token field is write-only by design: the page is told whether a secret is
 * stored, never what it is, so a rendered settings page can never leak one.
 *
 * Accessibility notes:
 *  - every control has a programmatic label, and its hint is associated via
 *    `aria-describedby` rather than left as adjacent text;
 *  - the validation error is announced in an assertive live region and
 *    referenced by `aria-describedby` with `aria-invalid` (SC 3.3.1, 4.1.3);
 *  - the save confirmation is a polite live region (`<output>`, whose implicit
 *    role is `status`), so it does not interrupt, and it is withdrawn the
 *    moment an edit makes it untrue;
 *  - `autoComplete="off"` on the secret keeps password managers from storing a
 *    harness credential as a site login.
 */
import { useId, useState } from 'react'
import { isValidCredentialRef } from './format.ts'
import { en } from './locales/en.ts'

/** The settings this card edits. */
export interface CloudflareSettings {
  readonly apiTokenRef: string
  readonly accountId: string
  readonly gatewayId: string
}

/** Props for the settings card. */
export interface SettingsCardProps {
  readonly settings: CloudflareSettings
  /** Whether a secret is stored for the current reference. Never the secret. */
  readonly tokenStored: boolean
  /** Persist the settings, and the new token when one was typed. */
  onSave(settings: CloudflareSettings, token: string | undefined): void
}

export function SettingsCard({ settings, tokenStored, onSave }: SettingsCardProps): React.JSX.Element {
  const [tokenRef, setTokenRef] = useState(settings.apiTokenRef)
  const [accountId, setAccountId] = useState(settings.accountId)
  const [gatewayId, setGatewayId] = useState(settings.gatewayId)
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)

  const headingId = useId()
  const tokenRefId = useId()
  const tokenRefHintId = useId()
  const tokenRefErrorId = useId()
  const tokenId = useId()
  const tokenHintId = useId()
  const tokenStatusId = useId()
  const accountIdId = useId()
  const accountHintId = useId()
  const gatewayIdId = useId()
  const gatewayHintId = useId()

  const invalid = error !== undefined

  /**
   * Wrap a field setter so editing withdraws a stale confirmation.
   *
   * Any edit makes a previous "saved" false: it described the values that were
   * stored, not the ones now in the form, and leaving it up tells the user
   * their current input is persisted when it is not.
   */
  const editing =
    (apply: (value: string) => void) =>
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      apply(event.target.value)
      setSaved(false)
    }

  return (
    <section className="cf-settings" aria-labelledby={headingId}>
      <h2 id={headingId}>{en.settings.heading}</h2>
      <p>{en.settings.description}</p>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!isValidCredentialRef(tokenRef)) {
            setError(en.settings.invalidTokenRef)
            setSaved(false)
            return
          }
          setError(undefined)
          onSave({ apiTokenRef: tokenRef, accountId, gatewayId }, token === '' ? undefined : token)
          setToken('')
          setSaved(true)
        }}
      >
        <div className="cf-field">
          <label htmlFor={tokenRefId}>{en.settings.tokenRefLabel}</label>
          <input
            id={tokenRefId}
            name="apiTokenRef"
            value={tokenRef}
            aria-describedby={invalid ? `${tokenRefHintId} ${tokenRefErrorId}` : tokenRefHintId}
            aria-invalid={invalid}
            onChange={editing(setTokenRef)}
          />
          <p id={tokenRefHintId} className="cf-hint">
            {en.settings.tokenRefHint}
          </p>
          {/* The live region stays mounted and its content changes: toggling
              a live region's visibility is unreliably announced. */}
          <p id={tokenRefErrorId} className="cf-error" role="alert">
            {error ?? ''}
          </p>
        </div>

        <div className="cf-field">
          <label htmlFor={tokenId}>{en.settings.tokenValueLabel}</label>
          <input
            id={tokenId}
            name="apiToken"
            type="password"
            autoComplete="off"
            value={token}
            aria-describedby={`${tokenHintId} ${tokenStatusId}`}
            onChange={editing(setToken)}
          />
          <p id={tokenHintId} className="cf-hint">
            {en.settings.tokenValueHint}
          </p>
          <p id={tokenStatusId} className="cf-hint">
            {tokenStored ? en.settings.tokenSet : en.settings.tokenUnset}
          </p>
        </div>

        <div className="cf-field">
          <label htmlFor={accountIdId}>{en.settings.accountLabel}</label>
          <input
            id={accountIdId}
            name="accountId"
            value={accountId}
            aria-describedby={accountHintId}
            onChange={editing(setAccountId)}
          />
          <p id={accountHintId} className="cf-hint">
            {en.settings.accountHint}
          </p>
        </div>

        <div className="cf-field">
          <label htmlFor={gatewayIdId}>{en.settings.gatewayLabel}</label>
          <input
            id={gatewayIdId}
            name="gatewayId"
            value={gatewayId}
            aria-describedby={gatewayHintId}
            onChange={editing(setGatewayId)}
          />
          <p id={gatewayHintId} className="cf-hint">
            {en.settings.gatewayHint}
          </p>
        </div>

        <button type="submit">{en.settings.save}</button>
        <output className="cf-saved">{saved ? en.settings.saved : ''}</output>
      </form>
    </section>
  )
}
