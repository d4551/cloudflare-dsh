/**
 * The accessibility lane cannot narrow itself.
 *
 * axe is only as honest as the way it is invoked, so every way to weaken an
 * invocation — a scoping option, a rule disable, a result filter, a weaker
 * conformance target — is forbidden by name, and the two browser suites are
 * pinned to the invocations and the interactions that make their verdicts mean
 * something. The needles are assembled from fragments: this file is itself
 * under `tests/`, so a literal would make the gate find its own definition.
 */
import { describe, expect, it } from 'vitest'
import { containing, matching, read, testFiles } from './base.ts'

describe('accessibility cannot be filtered', () => {
  it.each([
    ['tag scope', `with${'Tags('}`],
    ['rule narrowing', `with${'Rules('}`],
    ['rule disabling', `disable${'Rules('}`],
    ['inline rule overrides', `rul${'es: {'}`],
    // The five calls above are not the only ways axe is narrowed: one option
    // scopes a run to a weaker conformance target, another throws away
    // everything the assertion reads, two builder methods do by configuration
    // what the banned calls do by name, and the reconfiguration entry point
    // disables rules through an array, which the object needle does not match.
    ['conformance scoping', `run${'Only'}`],
    ['result narrowing', `result${'Types'}`],
    ['rule reconfiguration', `axe.con${'figure'}`],
    ['array rule overrides', `rul${'es: ['}`],
  ])('no %s is used in any test', (_label, needle) => {
    expect(containing(testFiles, needle)).toEqual([])
  })

  // The builder's scoping methods, matched as a call rather than as a bare
  // substring, which cannot tell one from a spread of a local fixture that
  // happens to share the name. The only thing that distinguishes the spread is
  // the dot before it, so that is the whole of what is excluded — anything
  // else, including a call the formatter has wrapped onto its own line, still
  // matches. An earlier version of this required a word character before the
  // dot and missed exactly that wrapped call.
  it.each([
    ['selector exclusion', `exc${'lude'}`],
    ['selector scoping', `inc${'lude'}`],
    ['builder options', `opt${'ions'}`],
  ])('calls no %s method on an axe builder', (_label, method) => {
    expect(matching(testFiles, new RegExp(`(?<!\\.)\\.${method}\\(`, 'u'))).toEqual([])
  })

  it('scans every surface with the whole rule set', () => {
    expect(read('packages/client/tests/a11y.browser.test.tsx')).toContain(
      'new AxeBuilder({ page }).analyze()',
    )
  })

  it('gives the jsdom helper no way to take options, since that is where a filter would hide', () => {
    // The helper's own comment says an options parameter is where a rule
    // disable would sit. A comment is not a gate: the call is pinned to its
    // single argument, and the function to its single parameter.
    const helper = read('packages/client/tests/axe.ts')
    expect(helper).toContain('axe.run(container)')
    expect(helper).toContain('async function runAxe(container: Element): Promise<AxeResults>')
  })

  it.each([
    // Each of these was absent while the lane's own doc claimed it, or while
    // the gate read only the outcome that happened to be empty.
    ['scans the client as a host assembles it', 'ASSEMBLED'],
    ['fails on what axe leaves for review, not only on what it fails', 'results.incomplete'],
    ['walks the page by keyboard', `keyboard.press('Tab')`],
    ['reads the focus ring the stylesheet declares', 'computed.outlineStyle'],
  ])('%s', (_label, needle) => {
    expect(read('packages/client/tests/a11y.browser.test.tsx')).toContain(needle)
  })

  it('assembles that page as a host does, from one render rather than a join', () => {
    // Rendering each surface separately and concatenating restarts `useId`, so
    // the page would carry id collisions no host could produce and the scan
    // would be reporting on a fixture rather than on the client.
    expect(read('packages/client/tests/surfaces.tsx')).toContain(
      'export const ASSEMBLED = renderToStaticMarkup(',
    )
  })

  it.each([
    // The viewport lane is the only place these are observable, and every one
    // of them found a defect the first time it ran.
    ['lays the client out at 320 CSS pixels, the reflow criterion’s own width', 'width: 320'],
    [
      'measures a rendered control rather than trusting the declared minimum',
      'getBoundingClientRect().width',
    ],
    ['applies the text-spacing overrides', 'letter-spacing:0.12em'],
    ['asks what `hidden` computes to, which jsdom cannot', `getComputedStyle(node).display !== 'none'`],
    ['runs with the forced-colours mode active', `forcedColors: 'active'`],
    ['bounds how much document a large result produces', "querySelectorAll('main *').length"],
  ])('%s', (_label, needle) => {
    expect(read('packages/client/tests/viewport.browser.test.tsx')).toContain(needle)
  })

  it.each([
    // Static markup has no React attached, so a toggle that never toggles and a
    // form that never submits produce markup identical to ones that work. Only
    // this lane can tell them apart.
    ['mounts the real components with the real React', 'createRoot('],
    ['records the callback a host supplies, so an assertion can see it was reached', 'savedCalls'],
  ])('%s', (_label, needle) => {
    expect(read('packages/client/tests/e2e-entry.tsx')).toContain(needle)
  })

  it.each([
    ['bundles the source it claims to exercise rather than a committed copy', 'rolldown('],
    ['operates the client by keyboard as well as by pointer', `keyboard.press('Enter')`],
  ])('%s', (_label, needle) => {
    expect(read('packages/client/tests/e2e.browser.test.tsx')).toContain(needle)
  })

  it('runs the browser lane rather than leaving those tests unrun', () => {
    expect(read('vitest.a11y.config.ts')).toContain("include: ['packages/*/tests/**/*.browser.test.tsx']")
    expect(read('.github/workflows/ci.yml')).toContain('bun run test:a11y')
  })
})
