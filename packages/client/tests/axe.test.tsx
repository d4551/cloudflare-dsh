// @vitest-environment jsdom
/**
 * The premise both accessibility lanes rest on.
 *
 * The jsdom lane gates violations and pins one rule as undecided; the Chromium
 * lane proves that same rule reaches a verdict in a real browser. Neither claim
 * is worth anything unless the split is real, and it was asserted nowhere: the
 * browser test looked for the rule among passes *or* incomplete, which a jsdom
 * run satisfies too, so it told the two environments apart in its comment and
 * not in its code. This is the half a component test can hold.
 *
 * The reason cited for the split was also stale — an axe-core issue since
 * closed, and a `createRange` gap jsdom has since filled. The rule is not
 * skipped here. It runs, and says it could not decide.
 */
import { render } from '@testing-library/react'
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'
import { SettingsCard } from '../src/SettingsCard.tsx'

const settings = { apiTokenRef: 'CLOUDFLARE_API_TOKEN', accountId: '', gatewayId: '' }

describe('the colour-contrast rule under jsdom', () => {
  it('runs and reaches no verdict, which is why the Chromium lane exists', async () => {
    const { container } = render(<SettingsCard settings={settings} tokenStored onSave={() => undefined} />)
    const results = await axe.run(container)
    // Undecided, not skipped and not passed: the distinction is the whole
    // reason a second lane exists, and it is measured here rather than cited.
    expect(results.incomplete.map((rule) => rule.id)).toContain('color-contrast')
    expect(results.passes.map((rule) => rule.id)).not.toContain('color-contrast')
    expect(results.violations.map((rule) => rule.id)).not.toContain('color-contrast')
  })

  it('leaves nothing else undecided, which is what the helper pins', async () => {
    const { container } = render(<SettingsCard settings={settings} tokenStored onSave={() => undefined} />)
    const results = await axe.run(container)
    expect(results.incomplete.map((rule) => rule.id).toSorted()).toEqual(['color-contrast'])
  })
})
