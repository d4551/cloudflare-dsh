/**
 * The shipped stylesheet as a whole, as a gate.
 *
 * Two claims about the sheet that no colour ratio can hold: it introduces no
 * motion, so there is nothing to reduce, and the fallback it carries below the
 * engine floor repeats the light-scheme value of every token it stands in for.
 * The colour gates — what the analyzer can read, the scheme the sheet declares
 * and the ratio each pair clears — live beside this file in `css.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { read } from './base.ts'
import {
  ACCENT,
  WHITE,
  colourOf,
  declaration,
  rulesOf,
  selectorOf,
  tokensOf,
  type CssRule,
} from './stylesheet-analyzers.ts'

describe('the stylesheet introduces no motion', () => {
  it.each(['transition', 'animation', 'keyframes'])(
    'declares no %s, so there is no motion to reduce',
    (property) => {
      // There was a `prefers-reduced-motion` block setting `transition: none`
      // on elements the stylesheet never gave a transition — and neither
      // property is inherited, so a host could not have given them one either.
      // It guarded nothing. This is the claim that can be enforced instead:
      // introduce motion and this fails, which is when a reduced-motion story
      // has to be written rather than assumed.
      const css = read('packages/client/src/cloudflare.css').replaceAll(/\/\*[\s\S]*?\*\//gu, '')
      expect(css).not.toContain(property)
    },
  )
})

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
