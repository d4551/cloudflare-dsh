/**
 * Per-session Cloudflare AI Gateway usage.
 *
 * This is only meaningful because the model provider stamps every request with
 * the harness session id in `cf-aig-metadata`; the numbers here are read back
 * from the gateway's own logs and billing, not estimated.
 *
 * Accessibility notes, since the harness ships no guidance for plugin authors:
 *  - status is never carried by colour alone (SC 1.4.1) — every figure has a
 *    visible label;
 *  - the figures and the status sit in a polite live region (SC 4.1.3), so
 *    updates are announced without stealing focus. The region holds no
 *    control: a live region announces its contents as flat text, so a button
 *    inside one is re-read without its role every time anything in the region
 *    changes, and the toggle already carries its state in `aria-expanded`;
 *  - the detail toggle is a real button with an accessible name and a 24px
 *    minimum target (SC 2.5.8), and its expanded state is exposed.
 */
import { useId, useState } from 'react'
import { type SessionUsage, formatCacheRate, formatCost, hasUsage } from './format.ts'
import { en } from './locales/en.ts'

/** Props for the session cost chip. */
export interface SessionCostChipProps {
  /** Usage for the current session, or undefined while it loads. */
  readonly usage?: SessionUsage | undefined
  /** True while usage is being fetched. */
  readonly loading?: boolean | undefined
  /** True when usage could not be loaded. */
  readonly failed?: boolean | undefined
}

export function SessionCostChip({ usage, loading, failed }: SessionCostChipProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const detailId = useId()

  let live: React.JSX.Element
  let detail: React.JSX.Element | undefined
  if (failed === true) {
    live = <span className="cf-chip__status">{en.cost.error}</span>
  } else if (loading === true) {
    live = <span className="cf-chip__status">{en.cost.loading}</span>
  } else if (!hasUsage(usage)) {
    live = <span className="cf-chip__status">{en.cost.empty}</span>
  } else {
    live = (
      <>
        <span className="cf-chip__figure">{en.cost.requests(usage.requests)}</span>
        <span className="cf-chip__figure">{en.cost.cost(formatCost(usage.cost))}</span>
        <span className="cf-chip__figure">{en.cost.cacheRate(formatCacheRate(usage))}</span>
      </>
    )
    detail = (
      <>
        <button
          type="button"
          className="cf-chip__toggle"
          aria-expanded={expanded}
          aria-controls={detailId}
          onClick={() => {
            setExpanded((open) => !open)
          }}
        >
          {expanded ? en.cost.hideDetail : en.cost.showDetail}
        </button>
        <dl id={detailId} className="cf-chip__detail" hidden={!expanded}>
          <dt>{en.cost.cachedTerm}</dt>
          <dd>{en.cost.cached(usage.cached)}</dd>
          <dt>{en.cost.tokensTerm}</dt>
          <dd>{en.cost.tokens(usage.tokensIn, usage.tokensOut)}</dd>
        </dl>
      </>
    )
  }

  return (
    <section className="cf-chip" aria-label={en.cost.label}>
      <div className="cf-chip__live" aria-live="polite">
        {live}
      </div>
      {detail}
    </section>
  )
}
