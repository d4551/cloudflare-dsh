/**
 * The entry the end-to-end lane bundles and mounts.
 *
 * Every other browser check renders these components to static markup and
 * looks at the result. Static markup has no React attached, so nothing in this
 * repository had ever *operated* the client: a toggle that never toggles, a
 * form that never submits and a live region that never updates all produce
 * markup indistinguishable from ones that work.
 *
 * This mounts the real components with the real React, so the lane drives what
 * a host would run. `savedCalls` is the only affordance added for the test —
 * the callback a host supplies, recorded so an assertion can see that
 * activating the form reached it.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SessionCostChip } from '../src/SessionCostChip.tsx'
import { type CloudflareSettings, SettingsCard } from '../src/SettingsCard.tsx'
import { D1Result } from '../src/toolviews/D1Result.tsx'

declare global {
  interface Window {
    /** Every `onSave` the mounted card made, so a test can see it was reached. */
    savedCalls: [CloudflareSettings, string | undefined][]
  }
}

window.savedCalls = []

const usage = { requests: 4, cost: 0.0125, tokensIn: 120, tokensOut: 40, cached: 1 }
const settings: CloudflareSettings = {
  apiTokenRef: 'CLOUDFLARE_API_TOKEN',
  accountId: '',
  gatewayId: '',
}

function App(): React.JSX.Element {
  return (
    <>
      <SessionCostChip usage={usage} />
      <SettingsCard
        settings={settings}
        tokenStored
        onSave={(next, token) => {
          window.savedCalls.push([next, token])
        }}
      />
      <D1Result sql="SELECT id FROM users" resultSets={[{ results: [{ id: 1 }] }]} />
    </>
  )
}

const host = document.querySelector('#root')
if (host !== null) {
  createRoot(host).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
