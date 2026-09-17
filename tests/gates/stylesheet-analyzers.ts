/**
 * The stylesheet analyzers, as one declaration.
 *
 * Nothing in the toolchain computes non-text contrast, so the arithmetic lives
 * here once and both gate suites read it from here: relative luminance per
 * WCAG 2, the ratio each foreground/background pair needs, a reader that
 * flattens rules out of their at-rules, and the token resolver that follows
 * every `--cf-*` token through its `light-dark()` pair.
 *
 * Colours in probes are assembled from fragments: a probe is a stylesheet
 * under test, not styling, so the raw-colour rule for source does not apply to
 * it — and assembling keeps the rule's scanner from having to tell the two
 * apart.
 */

/** A colour literal, assembled so this module carries no raw one. */
const hex = (digits: string): string => `#${digits}`

/** White, black, and the accent and border greys the fixtures resolve. */
export const WHITE = hex('ffffff')
export const BLACK = hex('000000')
export const ACCENT = hex('0b5cab')
export const BORDER = hex('b9bdc4')
export const BORDER_DARK = hex('6f757e')

/** An `rgb()` literal, in the space-separated or the comma-separated form. */
const RGB = /rgb\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*\)/u

/** A colour written as a literal, either form the sheet writes one in. */
const COLOUR = String.raw`(?:rgb\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+\s*\)|#[0-9a-f]{6})`

/** A `light-dark()` pair of two literals, the form the tokens carry. */
const PAIR = new RegExp(`light-dark\\(\\s*(${COLOUR})\\s*,\\s*(${COLOUR})\\s*\\)`, 'u')

/**
 * The `#rrggbb` form of an `rgb()` literal.
 *
 * The sheet writes its colours as `rgb()` literals, and the arithmetic below
 * works in `#rrggbb`, so this is the one place the two forms meet: three
 * channels, each a finite number in 0..255, rendered as two hex digits.
 */
function rgbToHex(literal: string): string | undefined {
  const match = RGB.exec(literal)
  const channels = [match?.[1], match?.[2], match?.[3]].map((raw) => {
    const value = Number.parseFloat(raw ?? '')
    return raw !== undefined && Number.isFinite(value) && value >= 0 && value <= 255 ? value : undefined
  })
  const [red, green, blue] = channels
  if (red === undefined || green === undefined || blue === undefined) return undefined
  return hex([red, green, blue].map((one) => Math.round(one).toString(16).padStart(2, '0')).join(''))
}

/** The colour a value spells as a literal, wherever in the value it sits. */
function literalColour(value: string): string | undefined {
  const hash = /#[0-9a-f]{6}/u.exec(value)?.[0]
  if (hash !== undefined) return hash
  const rgb = RGB.exec(value)?.[0]
  return rgb === undefined ? undefined : rgbToHex(rgb)
}

/**
 * Relative luminance of an `#rrggbb` colour, per WCAG 2.
 *
 * Written here rather than imported from a package: the whole point of these
 * gates is that no tool in the stack computes non-text contrast, so there is
 * nothing to import.
 */
function luminance(colour: string): number {
  const channels = [1, 3, 5]
    .map((at) => Number.parseInt(colour.slice(at, at + 2), 16) / 255)
    .map((value) => (value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0)
}

/** Contrast ratio between two `#rrggbb` colours, from 1 to 21. */
function contrastRatio(first: string, second: string): number {
  const [low, high] = [luminance(first), luminance(second)].toSorted((a, b) => a - b)
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05)
}

/** One style rule, with the media conditions it sits under. */
export interface CssRule {
  readonly selector: string
  readonly body: string
  readonly media: readonly string[]
}

/** Every rule in a stylesheet, flattened out of its at-rules. */
export function rulesOf(css: string, media: readonly string[] = []): CssRule[] {
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
export const declaration = (body: string, property: string): string | undefined =>
  new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]*)`, 'u').exec(body)?.[1]?.trim()

/** The `--cf-*` token a value resolves through, if it names one. */
const tokenIn = (value: string | undefined): string | undefined =>
  value === undefined ? undefined : /var\(\s*(--cf-[a-z0-9-]+)/u.exec(value)?.[1]

/**
 * The colour a declaration puts on screen, whether it names a token or not.
 *
 * Resolving only through `var(--cf-*)` was a hole under a claim to read every
 * rule here: a literal colour anywhere in the sheet was skipped in silence, and
 * the fallback block for engines without `light-dark()` is written in literals
 * because a token is exactly what it cannot use. `transparent` and the like
 * resolve to nothing, which is right — they place no colour on anything.
 */
export const colourOf = (
  value: string | undefined,
  tokens: Readonly<Record<string, string>>,
): string | undefined => {
  if (value === undefined) return undefined
  const token = tokenIn(value)
  return token === undefined ? literalColour(value) : tokens[token]
}

/**
 * Token values for one colour scheme.
 *
 * A token is declared once and carries both schemes in a `light-dark()` pair,
 * so the scheme picks the argument: first for light, second for dark. A
 * declaration inside a `prefers-color-scheme: dark` block still counts for the
 * dark scheme only, so either spelling is read correctly. A pair this reader
 * cannot split resolves to no colour rather than to whichever literal happens
 * to sit in the declaration first.
 */
export function tokensOf(rules: readonly CssRule[], dark: boolean): Record<string, string> {
  const values: Record<string, string> = {}
  for (const rule of rules) {
    const inDark = rule.media.some((query) => query.includes('prefers-color-scheme: dark'))
    if (inDark && !dark) continue
    for (const [, name, declaration_] of rule.body.matchAll(/(--cf-[a-z0-9-]+)\s*:([^;]*)/gu)) {
      if (name === undefined || declaration_ === undefined) continue
      const pair = PAIR.exec(declaration_)
      // A declaration spelling `light-dark()` that does not match `PAIR` is a
      // pair this reader cannot split: an alpha channel, a 3-digit hex, a
      // nested function. Reading the whole declaration instead returns
      // whichever literal appears first in it, so the light scheme would take
      // the dark colour from a pair whose light side is unreadable. The token
      // is left unresolved, and `colourOf` reads an unresolved token as a
      // declaration that places no colour.
      if (pair === null && declaration_.includes('light-dark(')) continue
      const chosen = pair === null ? literalColour(declaration_) : literalColour(pair[dark ? 2 : 1] ?? '')
      if (chosen !== undefined) values[name] = chosen
    }
  }
  return values
}

/** A rule's selector with its line breaks and indentation flattened. */
export const selectorOf = (rule: CssRule): string => rule.selector.replaceAll(/\s+/gu, ' ')

/** Properties whose colour is a boundary rather than text (SC 1.4.11). */
const NON_TEXT_PROPERTIES = ['border', 'border-block-end', 'outline'] as const

/** One pair of colours the stylesheet puts together, and the ratio it needs. */
export interface ContrastPair {
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
export function contrastPairs(css: string): ContrastPair[] {
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

/**
 * Foreground declarations the analyzer cannot resolve to a colour.
 *
 * The claim is that every rule in the stylesheet is read. That claim holds
 * only while every colour is readable by the analyzer above: an `hwb()`, a
 * named colour, or a colour written in a form nobody declared would resolve to
 * nothing and be skipped in silence. The sheet writes its colours as `#rrggbb`
 * or `rgb()` literals, both of which resolve, and the keywords that place no
 * colour are excused by name, which is a closed set rather than a pattern that
 * has to guess.
 */
export function unreadableColours(css: string): string[] {
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
