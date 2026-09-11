/**
 * The shipped stylesheet, as a gate.
 *
 * Nothing in the toolchain computes non-text contrast, so the arithmetic lives
 * here: relative luminance per WCAG 2, the ratio each foreground/background
 * pair needs, and a reader that resolves every `--cf-*` token through its
 * `light-dark()` pair. The analyzer is proven on snippets before it is trusted
 * on the stylesheet.
 *
 * Colours in the probes are assembled from fragments: a probe is a stylesheet
 * under test, not styling, so the raw-colour rule for source does not apply to
 * it — and assembling keeps the rule's scanner from having to tell the two
 * apart.
 */
import { describe, expect, it } from 'vitest'
import { read } from './base.ts'

const WHITE = `#${'ffffff'}`
const BLACK = `#${'000000'}`
const BORDER = `#${'b9bdc4'}`
const BORDER_DARK = `#${'6f757e'}`
const ACCENT = `#${'0b5cab'}`

/**
 * Relative luminance of an `#rrggbb` colour, per WCAG 2.
 *
 * Written here rather than imported: the whole point of this gate is that no
 * tool in the stack computes non-text contrast, so there is nothing to import.
 */
function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((value) => (value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0)
}

/** Contrast ratio between two `#rrggbb` colours, from 1 to 21. */
function contrastRatio(first: string, second: string): number {
  const [low, high] = [luminance(first), luminance(second)].toSorted((a, b) => a - b)
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05)
}

/** One style rule, with the media conditions it sits under. */
interface CssRule {
  readonly selector: string
  readonly body: string
  readonly media: readonly string[]
}

/** Every rule in a stylesheet, flattened out of its at-rules. */
function rulesOf(css: string, media: readonly string[] = []): CssRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//gu, '')
  const rules: CssRule[] = []
  let at = 0
  while (at < text.length) {
    const open = text.indexOf('{', at)
    if (open === -1) break
    const selector = text.slice(at, open).trim()
    let depth = 1
    let end = open + 1
    while (end < text.length && depth > 0) {
      if (text[end] === '{') depth += 1
      else if (text[end] === '}') depth -= 1
      end += 1
    }
    const body = text.slice(open + 1, end - 1)
    if (selector.startsWith('@')) rules.push(...rulesOf(body, [...media, selector]))
    else rules.push({ selector, body, media })
    at = end
  }
  return rules
}

/** A declaration's value, or undefined when the rule does not set it. */
const declaration = (body: string, property: string): string | undefined =>
  new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]*)`, 'u').exec(body)?.[1]?.trim()

/** The `--cf-*` token a value resolves through, if it names one. */
const tokenIn = (value: string | undefined): string | undefined =>
  value === undefined ? undefined : /var\(\s*(--cf-[a-z-]+)/u.exec(value)?.[1]

/**
 * The colour a declaration puts on screen, whether it names a token or not.
 *
 * Resolving only through `var(--cf-*)` would be a hole under a claim to read
 * every rule here: a literal colour anywhere in the sheet would resolve to
 * nothing and be skipped in silence. `transparent` and the like resolve to
 * nothing, which is right — they place no colour on anything.
 */
const colourOf = (
  value: string | undefined,
  tokens: Readonly<Record<string, string>>,
): string | undefined => {
  if (value === undefined) return undefined
  const token = tokenIn(value)
  return token === undefined ? /#[0-9a-f]{6}/u.exec(value)?.[0] : tokens[token]
}

/**
 * Token values for one colour scheme.
 *
 * A token is declared once and carries both schemes in a `light-dark()` pair,
 * so the scheme picks the argument: first for light, second for dark. A
 * declaration inside a `prefers-color-scheme: dark` block still counts for the
 * dark scheme only, so either spelling is read correctly.
 */
function tokensOf(rules: readonly CssRule[], dark: boolean): Record<string, string> {
  const values: Record<string, string> = {}
  for (const rule of rules) {
    const inDark = rule.media.some((query) => query.includes('prefers-color-scheme: dark'))
    if (inDark && !dark) continue
    for (const [, name, declaration_] of rule.body.matchAll(/(--cf-[a-z-]+)\s*:([^;]*)/gu)) {
      if (name === undefined || declaration_ === undefined) continue
      const pair = /light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)/u.exec(declaration_)
      const chosen = pair === null ? /#[0-9a-f]{6}/u.exec(declaration_)?.[0] : pair[dark ? 2 : 1]
      if (chosen !== undefined) values[name] = chosen
    }
  }
  return values
}

/** A rule's selector with its line breaks and indentation flattened. */
const selectorOf = (rule: CssRule): string => rule.selector.replaceAll(/\s+/gu, ' ')

/** Properties whose colour is a boundary rather than text (SC 1.4.11). */
const NON_TEXT_PROPERTIES = ['border', 'border-block-end', 'outline'] as const

/** One pair of colours the stylesheet puts together, and the ratio it needs. */
interface ContrastPair {
  readonly where: string
  readonly ratio: number
  readonly minimum: number
}

/**
 * Every foreground the stylesheet places on a background, per scheme.
 *
 * The background is the rule's own when it sets one and the surface background
 * otherwise, which is what these components render on. Text needs 4.5:1
 * (SC 1.4.3); a border or a focus ring needs 3:1 (SC 1.4.11), and nothing in
 * the toolchain checks that one — axe ships no non-text-contrast rule.
 */
function contrastPairs(css: string): ContrastPair[] {
  const rules = rulesOf(css)
  const pairs: ContrastPair[] = []
  for (const scheme of ['light', 'dark'] as const) {
    const tokens = tokensOf(rules, scheme === 'dark')
    const surface = tokens['--cf-bg']
    for (const rule of rules) {
      const background = colourOf(declaration(rule.body, 'background'), tokens) ?? surface
      if (background === undefined) continue
      const add = (value: string | undefined, minimum: number, kind: string): void => {
        const colour = colourOf(value, tokens)
        if (colour === undefined) return
        pairs.push({
          where: `${rule.selector} [${scheme}] ${kind} ${colour} on ${background}`,
          ratio: contrastRatio(colour, background),
          minimum,
        })
      }
      add(declaration(rule.body, 'color'), 4.5, 'text')
      for (const property of NON_TEXT_PROPERTIES) {
        add(declaration(rule.body, property), 3, property)
      }
    }
  }
  return pairs
}

describe('the stylesheet introduces no motion', () => {
  it.each(['transition', 'animation', 'keyframes'])(
    'declares no %s, so there is no motion to reduce',
    (property) => {
      // Neither property is inherited, so a host could not give the elements a
      // transition of its own for this stylesheet to reduce. Introducing motion
      // fails here, which is when a reduced-motion story has to be written.
      const css = read('packages/client/src/cloudflare.css').replaceAll(/\/\*[\s\S]*?\*\//gu, '')
      expect(css).not.toContain(property)
    },
  )
})

/**
 * Foreground declarations the analyzer cannot resolve to a colour.
 *
 * The claim is that every rule in the stylesheet is read. That claim holds
 * only while every colour is readable by the analyzer above: a literal, an
 * `rgb()` or a named colour would resolve to nothing and be skipped in
 * silence, so the "every" would rest on a habit. Keywords that place no colour
 * are excused by name, which is a closed set rather than a pattern that has to
 * guess.
 */
function unreadableColours(css: string): string[] {
  const rules = rulesOf(css)
  const tokens = tokensOf(rules, false)
  const excused = new Set(['transparent', 'currentcolor', 'inherit', 'unset', 'initial', 'revert', 'none'])
  const unreadable: string[] = []
  for (const rule of rules) {
    for (const property of ['color', ...NON_TEXT_PROPERTIES]) {
      const value = declaration(rule.body, property)
      if (value === undefined || colourOf(value, tokens) !== undefined) continue
      if (
        value
          .toLowerCase()
          .split(/\s+/u)
          .some((word) => excused.has(word))
      )
        continue
      unreadable.push(`${rule.selector} { ${property}: ${value} }`)
    }
  }
  return unreadable
}

describe('the fallback below the engine floor says what the tokens say', () => {
  it('repeats the light-scheme value of every token it stands in for', () => {
    // The fallback has to be literals — a token is the thing that is missing
    // below the floor — so it is the one place in this stylesheet where a
    // colour is written twice. Change `--cf-accent` and the two drift, and
    // nothing on an old engine would ever say so. This is what says so.
    const rules = rulesOf(read('packages/client/src/cloudflare.css'))
    const light = tokensOf(rules, false)
    const values = (rule: CssRule): (string | undefined)[] =>
      ['color', 'background'].map((property) => colourOf(declaration(rule.body, property), light))
    const behindQuery = rules.filter((rule) => rule.media.some((query) => query.startsWith('@supports')))
    expect(behindQuery.map(selectorOf)).toEqual(['.cf-chip__toggle, .cf-settings button'])
    const shadowed = rules.filter(
      (rule) => rule.media.length === 0 && behindQuery.some((it_) => selectorOf(it_) === selectorOf(rule)),
    )
    expect(shadowed).toHaveLength(1)
    // Both sides are read the same way, so this compares resolved colours
    // rather than the spelling of either.
    expect(behindQuery.map(values)).toEqual(shadowed.map(values))
    // And neither side is allowed to be two undefineds agreeing with nothing.
    expect(behindQuery.map(values)).toEqual([[WHITE, ACCENT]])
  })
})

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
    // Declaring `light dark` on these roots would discard the host's choice
    // and answer the operating system alone, which puts a dark card on a white
    // document, and a light one on a black document, whenever the two
    // disagree. The browser lane holds the resolved colour in all six
    // combinations of host and system; this holds the declaration, because the
    // behaviour is only visible in a host that disagrees.
    expect(declares(read('packages/client/src/cloudflare.css'))).toEqual([])
  })
})

describe('every colour pair the stylesheet ships clears its ratio', () => {
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
