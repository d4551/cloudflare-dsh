/**
 * A minimal axe-core matcher.
 *
 * Written here rather than pulled from `vitest-axe`: that package's released
 * version is 0.1.0 and its v1 line has sat in prerelease depending on a v3
 * formatter, which is not a dependency worth putting a hard quality gate on.
 * This is the whole of what the gate needs.
 *
 * No rule is disabled and no selector is excluded — a violation here means the
 * markup is wrong.
 */
import axe, { type AxeResults } from 'axe-core'
import { expect } from 'vitest'

/**
 * Run axe against a container and return its results.
 *
 * Takes no options on purpose: an options parameter here is where a rule
 * disable would hide, and no caller has ever needed one.
 */
async function runAxe(container: Element): Promise<AxeResults> {
  return axe.run(container)
}

/** Format violations so a failure names the rule and the offending nodes. */
function formatViolations(results: AxeResults): string {
  return results.violations
    .map((v) => {
      const nodes = v.nodes.map((n) => `      ${n.html}`).join('\n')
      return `  [${v.impact ?? 'unknown'}] ${v.id}: ${v.help}\n${nodes}`
    })
    .join('\n')
}

/**
 * What axe leaves undecided under jsdom, measured rather than assumed.
 *
 * Across every component this package renders, exactly one rule comes back
 * `incomplete`: `color-contrast`. It is not that the rule fails to run — the
 * older reading here cited an axe-core issue that has since been closed, and a
 * missing `createRange` that jsdom has since implemented — it runs, and cannot
 * resolve a computed colour, so it reports that it could not decide. The real
 * browser decides it, which is what the Chromium lane is for.
 *
 * Pinned as an equality rather than filtered out of the results: a second
 * undecided rule is a finding, and a container that leaves none is a change
 * worth looking at too. `aria-label` on a `<pre>` sat in `incomplete` for as
 * long as a lane read `violations` alone, and this lane read only violations
 * until now.
 */
const UNDECIDED_UNDER_JSDOM = ['color-contrast']

/** Assert a container has no accessibility violations and nothing else to review. */
export async function expectNoViolations(container: Element): Promise<void> {
  const results = await runAxe(container)
  expect(results.violations, `axe violations:\n${formatViolations(results)}`).toEqual([])
  expect(
    results.incomplete.map((result) => result.id).toSorted(),
    `axe left more than colour contrast for review:\n${results.incomplete.map((r) => r.id).join(', ')}`,
  ).toEqual(UNDECIDED_UNDER_JSDOM)
}
