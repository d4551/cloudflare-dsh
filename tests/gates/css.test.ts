/**
 * The colours the stylesheet paints, as a gate.
 *
 * The client ships one stylesheet, and axe ships no rule for non-text contrast
 * or for the color-scheme override — so these gates compute the answers from
 * the sheet itself. The analyzers live in `stylesheet-analyzers.ts`, one
 * declaration of them, and are proven on snippets here before they are trusted
 * on the stylesheet. What the sheet is allowed to declare about motion, and
 * what the fallback below the engine floor has to repeat, are gated beside this
 * file in `stylesheet.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { read } from './base.ts'
import {
  ACCENT,
  BLACK,
  BORDER,
  BORDER_DARK,
  WHITE,
  contrastPairs,
  declaration,
  rulesOf,
  unreadableColours,
} from './stylesheet-analyzers.ts'

describe('every colour the stylesheet paints is one the analyzer can read', () => {
  it('names a colour it cannot resolve', () => {
    expect(unreadableColours('.a { color: rgb(1, 2, 3) }')).toEqual(['.a { color: rgb(1, 2, 3) }'])
  })

  it('excuses the keywords that place no colour', () => {
    expect(
      unreadableColours('.a { border: 1px solid transparent; outline: 1px solid currentColor }'),
    ).toEqual([])
  })

  it('reads every foreground the shipped stylesheet declares', () => {
    // Without this the ratio gate above measures whatever it happens to
    // understand and reports a clean sheet for the rest.
    expect(unreadableColours(read('packages/client/src/cloudflare.css'))).toEqual([])
  })
})

describe('the stylesheet declares no colour scheme of its own', () => {
  /** Selectors that declare `color-scheme`, which these should never do. */
  const declares = (css: string): string[] =>
    rulesOf(css)
      .filter((rule) => declaration(rule.body, 'color-scheme') !== undefined)
      .map((rule) => rule.selector)

  it('finds one where a rule declares one', () => {
    expect(declares('.a { color-scheme: light dark }\n.b { color: red }')).toEqual(['.a'])
  })

  it('finds none in the stylesheet this package ships', () => {
    // `color-scheme` inherits and `light-dark()` reads the used scheme, so a
    // fragment that declares nothing follows the page it is dropped into.
    // Declaring `light dark` on these roots is an override: it discards the
    // host's choice and answers the operating system alone, which put a dark
    // card on a white document, and a light one on a black document, whenever
    // the two disagreed. The browser lane holds the resolved colour in all six
    // combinations of host and system; this holds the declaration, because the
    // behaviour is only visible in a host that disagrees — and every fixture
    // agreed for as long as the defect was there.
    expect(declares(read('packages/client/src/cloudflare.css'))).toEqual([])
  })
})

describe('every colour pair the stylesheet ships clears its ratio', () => {
  // The analyzer is proven on snippets before it is trusted on the stylesheet.
  const PROBE = [
    `:root { --cf-bg: ${WHITE}; --cf-fg: ${BLACK}; --cf-border: ${BORDER} }`,
    `@media (prefers-color-scheme: dark) { :root { --cf-bg: ${BLACK}; --cf-fg: ${WHITE} } }`,
    '.a { color: var(--cf-fg) }',
    '.b { border: 1px solid var(--cf-border) }',
  ].join('\n')

  it('reads a token through its var reference and pairs it with the surface', () => {
    expect(contrastPairs(PROBE).filter((pair) => pair.where.startsWith('.a'))).toEqual([
      { where: `.a [light] text ${BLACK} on ${WHITE}`, ratio: 21, minimum: 4.5 },
      { where: `.a [dark] text ${WHITE} on ${BLACK}`, ratio: 21, minimum: 4.5 },
    ])
  })

  it('holds a border to 3:1 and finds one that misses it', () => {
    const border = contrastPairs(PROBE).filter((pair) => pair.where.startsWith('.b'))
    expect(border.map((pair) => pair.minimum)).toEqual([3, 3])
    expect(border.filter((pair) => pair.ratio < pair.minimum).map((pair) => pair.where)).toEqual([
      `.b [light] border ${BORDER} on ${WHITE}`,
    ])
  })

  it('reads both schemes out of one light-dark pair', () => {
    const css = [
      `:root { --cf-bg: light-dark(${WHITE}, ${BLACK});`,
      `--cf-border: light-dark(${BORDER}, ${BORDER_DARK}) }`,
      '.b { border: 1px solid var(--cf-border) }',
    ].join('')
    // Light takes the first argument and fails; dark takes the second and passes.
    expect(
      contrastPairs(css)
        .filter((pair) => pair.where.startsWith('.b'))
        .map((pair) => `${pair.where} ${pair.ratio >= pair.minimum ? 'ok' : 'under'}`),
    ).toEqual([
      `.b [light] border ${BORDER} on ${WHITE} under`,
      `.b [dark] border ${BORDER_DARK} on ${BLACK} ok`,
    ])
  })

  it('takes a rule’s own background over the surface', () => {
    const css = `:root { --cf-bg: ${WHITE}; --cf-accent: ${ACCENT} }\n.c { color: var(--cf-bg); background: var(--cf-accent) }`
    expect(contrastPairs(css).map((pair) => pair.where)).toEqual([
      `.c [light] text ${WHITE} on ${ACCENT}`,
      `.c [dark] text ${WHITE} on ${ACCENT}`,
    ])
  })

  it('puts no colour beneath the ratio its use requires', () => {
    const pairs = contrastPairs(read('packages/client/src/cloudflare.css'))
    // An empty parse would satisfy the assertion below without checking a
    // thing, so the count is asserted first.
    expect(pairs.length).toBeGreaterThan(20)
    expect(
      pairs
        .filter((pair) => pair.ratio < pair.minimum)
        .map((pair) => `${pair.where} = ${pair.ratio.toFixed(2)}, needs ${pair.minimum}`),
    ).toEqual([])
  })
})
