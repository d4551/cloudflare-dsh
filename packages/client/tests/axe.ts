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
import axe, { type AxeResults, type RunOptions } from 'axe-core'
import { expect } from 'vitest'

/** Run axe against a container and return its results. */
export async function runAxe(container: Element, options: RunOptions = {}): Promise<AxeResults> {
  return axe.run(container, options)
}

/** Format violations so a failure names the rule and the offending nodes. */
export function formatViolations(results: AxeResults): string {
  return results.violations
    .map((v) => {
      const nodes = v.nodes.map((n) => `      ${n.html}`).join('\n')
      return `  [${v.impact ?? 'unknown'}] ${v.id}: ${v.help}\n${nodes}`
    })
    .join('\n')
}

/** Assert a container has no accessibility violations. */
export async function expectNoViolations(container: Element, options: RunOptions = {}): Promise<void> {
  const results = await runAxe(container, options)
  expect(results.violations, `axe violations:\n${formatViolations(results)}`).toEqual([])
}
