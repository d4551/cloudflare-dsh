/**
 * The design system, as a gate: the stylesheet and the components consuming its
 * classes. A size comes from a scale rather than being typed, one rule has one
 * home, a container says how its children line up, and a control states the room
 * a pointer needs. Each rule is proven on a snippet here, then held against the
 * sheet this package ships. Colour lives in `css.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { parseModule, walk } from '../parse.ts'
import { read } from './base.ts'
import { declaration, rulesOf, selectorOf, type CssRule } from './stylesheet-analyzers.ts'
import { clientComponents } from './support.ts'

/** The one stylesheet this package ships. */
const STYLESHEET = 'packages/client/src/cloudflare.css'

/**
 * The properties whose value is a size, and therefore a step on the scale. Each
 * family is one decision: `padding-block-end` is the same scale as `padding`.
 */
const SIZE_PROPERTIES: readonly string[] = [
  'font-size',
  'padding',
  'padding-block',
  'padding-block-end',
  'padding-inline',
  'padding-inline-end',
  'margin',
  'margin-block',
  'margin-block-end',
  'margin-inline',
  'gap',
  'row-gap',
  'column-gap',
  'border-radius',
  'inline-size',
  'block-size',
  'min-inline-size',
  'min-block-size',
  'max-inline-size',
  'max-block-size',
]

/** The words a size may be written with and still name no step of the scale. */
const NOT_A_SIZE = new Set([
  '0',
  'auto',
  'inherit',
  'unset',
  'none',
  'fit-content',
  'max-content',
  'min-content',
])

/** The declarations that say how a container's children line up. */
const ALIGNMENT = 'align-items align-self justify-content justify-self place-items place-content'.split(' ')

/** Elements a user operates, which is what makes a rule a control's rule. */
const CONTROL_ELEMENTS = ['button', 'input', 'select', 'textarea', 'summary']

/** How deep a selector may reach: its own element, and one step in. */
const MAX_DEPTH = 2

/** Every custom property the stylesheet declares, by name. */
function declaredTokens(css: string): Set<string> {
  const declared = new Set<string>()
  for (const rule of rulesOf(css)) {
    for (const [, name] of rule.body.matchAll(/(--cf-[a-z0-9-]+)\s*:/gu)) {
      if (name !== undefined) declared.add(name)
    }
  }
  return declared
}

/** The tokens a value resolves through. */
const tokensIn = (value: string): string[] =>
  [...value.matchAll(/var\(\s*(--cf-[a-z0-9-]+)/gu)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  )

/**
 * A value with every `var()` reference replaced by the fallback it names, or by a
 * space when it names none. A fallback is a literal the sheet carries, so it is
 * read with the rest of the value.
 */
const withoutReferences = (value: string): string =>
  value.replaceAll(/var\(\s*[^,()]+(?:,([^()]*))?\)/gu, (_match, fallback: string | undefined) =>
    fallback === undefined ? ' ' : fallback,
  )

/** The lengths a value carries that name no step of the scale. */
const offScaleWords = (value: string): string[] =>
  withoutReferences(value)
    .split(/[\s,/]+/u)
    .filter((word) => word !== '' && !NOT_A_SIZE.has(word) && !/^\d+(?:\.\d+)?%$/u.test(word))

/** Every size declaration off the scale, and every token named but not declared. */
function offScaleSizes(css: string): string[] {
  const declared = declaredTokens(css)
  const found: string[] = []
  for (const rule of rulesOf(css)) {
    for (const property of SIZE_PROPERTIES) {
      const value = declaration(rule.body, property)
      if (value === undefined) continue
      const where = `${selectorOf(rule)} { ${property}: ${value} }`
      const undeclared = tokensIn(value).filter((token) => !declared.has(token))
      if (undeclared.length > 0) {
        found.push(`${where} names ${undeclared.join(', ')}, which the sheet does not declare`)
        continue
      }
      const literals = offScaleWords(value)
      if (literals.length > 0) found.push(`${where} is not drawn from the scale: ${literals.join(' ')}`)
    }
  }
  return found
}

/** Rules carrying the same declaration block: one rule written twice. */
function duplicateBlocks(rules: readonly CssRule[]): string[] {
  const byBody = new Map<string, string[]>()
  for (const rule of rules) {
    const body = rule.body.replaceAll(/\s+/gu, ' ').trim()
    if (body === '') continue
    byBody.set(body, [...(byBody.get(body) ?? []), selectorOf(rule)])
  }
  return [...byBody.entries()]
    .filter(([, selectors]) => selectors.length > 1)
    .map(([body, selectors]) => `${selectors.join(', ')} { ${body} }`)
}

/** The compounds of each selector in a list, split outside brackets and parentheses. */
function selectorsIn(selector: string): string[][] {
  const selectors: string[][] = []
  let compounds: string[] = []
  let current = ''
  let depth = 0
  const flush = (): void => {
    if (current !== '') compounds.push(current)
    current = ''
  }
  for (const character of selector) {
    if (character === '(' || character === '[') depth += 1
    if (character === ')' || character === ']') depth = Math.max(0, depth - 1)
    if (depth === 0 && character === ',') {
      flush()
      if (compounds.length > 0) selectors.push(compounds)
      compounds = []
    } else if (depth === 0 && /[\s>+~]/u.test(character)) {
      flush()
    } else {
      current += character
    }
  }
  flush()
  if (compounds.length > 0) selectors.push(compounds)
  return selectors
}

/**
 * Selectors reaching deeper than one step in: what they join plus what they are
 * nested inside, so `.a .b .c` and `a { b { c { … } } }` are measured alike.
 */
function deepSelectors(rules: readonly CssRule[]): string[] {
  const found: string[] = []
  for (const rule of rules) {
    const nested = [...rule.body].filter((character) => character === '{').length
    const width = Math.max(...selectorsIn(selectorOf(rule)).map((compounds) => compounds.length))
    if (width + nested > MAX_DEPTH) found.push(`${selectorOf(rule)} reaches ${String(width + nested)} deep`)
  }
  return found
}

/** Containers placing children by the initial value of the alignment properties. */
function unalignedContainers(rules: readonly CssRule[]): string[] {
  const found: string[] = []
  for (const rule of rules) {
    const display = declaration(rule.body, 'display')
    if (display !== 'flex' && display !== 'grid') continue
    if (ALIGNMENT.some((property) => declaration(rule.body, property) !== undefined)) continue
    found.push(`${selectorOf(rule)} { display: ${display} } declares no alignment`)
  }
  return found
}

/**
 * Controls the sheet gives no minimum block size. A control is an element a user
 * operates, or a class a rule gives a pointer cursor to. The minimum is looked
 * for across the sheet, since a rule behind a feature query re-colours a control
 * without establishing its box.
 */
function controlsWithoutMinimum(rules: readonly CssRule[]): string[] {
  const controls = new Set<string>()
  for (const rule of rules) {
    const pressable = declaration(rule.body, 'cursor') === 'pointer'
    for (const compounds of selectorsIn(selectorOf(rule))) {
      const element = compounds.some((compound) =>
        CONTROL_ELEMENTS.some((named) =>
          new RegExp(`(?:^|[^\\w-])${named}(?:$|[^\\w-])`, 'u').test(compound),
        ),
      )
      if (pressable || element) controls.add(compounds.join(' '))
    }
  }
  const sized = new Set<string>()
  for (const rule of rules) {
    if (declaration(rule.body, 'min-block-size') === undefined) continue
    for (const compounds of selectorsIn(selectorOf(rule))) sized.add(compounds.join(' '))
  }
  return [...controls]
    .filter((control) => !sized.has(control))
    .map((control) => `${control} declares no min-block-size`)
}

/**
 * Sizes a component writes into its own style prop, where no class reaches and
 * no host can theme them. React spells the properties above in camelCase.
 */
function inlineSizes(name: string, text: string): string[] {
  const module = parseModule(name, text)
  const found: string[] = []
  const camel = (property: string): string =>
    property.replace(/-([a-z])/gu, (_match, letter: string) => letter.toUpperCase())
  walk(module.program, (node) => {
    if (node.type !== 'JSXAttribute') return undefined
    if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'style') return false
    const size = node.value
    if (size === null || size.type !== 'JSXExpressionContainer') return false
    if (size.expression.type !== 'ObjectExpression') return false
    for (const property of size.expression.properties) {
      if (property.type !== 'Property' || property.key.type !== 'Identifier') continue
      if (!SIZE_PROPERTIES.some((named) => camel(named) === property.key.name)) continue
      const set = property.value
      if (set.type !== 'Literal' || (typeof set.value !== 'string' && typeof set.value !== 'number')) continue
      if (offScaleWords(String(set.value)).length === 0) continue
      const at = `${name}:${module.lineAt(property.start)}`
      found.push(`${at} the style prop sets ${property.key.name} to ${String(set.value)}`)
    }
    return false
  })
  return found
}

/** The shipped sheet with rules added to it, so a rule can be seen reading them. */
const withRules = (...rules: readonly string[]): string => [read(STYLESHEET), ...rules].join('\n')

describe('the size scale the stylesheet declares', () => {
  it.each([
    [
      'a length the scale does not name',
      ':root { --cf-space-1: 4px }\n.a { padding: 4px }',
      ['.a { padding: 4px } is not drawn from the scale: 4px'],
    ],
    [
      'a token the sheet does not declare',
      '.a { gap: var(--cf-space-2) }',
      ['.a { gap: var(--cf-space-2) } names --cf-space-2, which the sheet does not declare'],
    ],
    [
      'a length inside a fallback',
      ':root { --cf-space-1: 4px }\n.a { gap: var(--cf-space-1, 4px) }',
      ['.a { gap: var(--cf-space-1, 4px) } is not drawn from the scale: 4px'],
    ],
  ])('names %s', (_label, css, expected) => {
    expect(offScaleSizes(css)).toEqual(expected)
  })

  it('accepts the sizes the scale draws, and the ones that name no step', () => {
    expect(offScaleSizes(':root { --cf-space-1: 4px }\n.a { padding: var(--cf-space-1) }')).toEqual([])
    expect(
      offScaleSizes(':root { --cf-space-1: 4px }\n.a { margin: 0; inline-size: 100%; block-size: auto }'),
    ).toEqual([])
  })

  it.each([
    ['a fontSize', 'const A = () => <b style={{ fontSize: "13px" }} />'],
    ['a minBlockSize', 'const A = () => <b style={{ minBlockSize: 24 }} />'],
  ])('names %s written into a component', (_label, snippet) => {
    expect(inlineSizes('probe.tsx', snippet)).toHaveLength(1)
  })

  it.each([
    ['a token', 'const A = () => <b style={{ padding: "var(--cf-space-1)" }} />'],
    ['another property', 'const A = () => <b style={{ color: "red" }} />'],
  ])('leaves %s alone', (_label, snippet) => {
    expect(inlineSizes('probe.tsx', snippet)).toEqual([])
  })

  it('reads the surfaces this gate holds', () => {
    expect(rulesOf(read(STYLESHEET)).length).toBeGreaterThan(0)
    expect(clientComponents.length).toBeGreaterThan(0)
  })

  it('draws every size the shipped stylesheet sets from the scale', () => {
    expect(offScaleSizes(read(STYLESHEET))).toEqual([])
    // The same call, on the sheet's own text with one rule added to it.
    expect(offScaleSizes(withRules('.cf-injected { padding: 4px }'))).toContain(
      '.cf-injected { padding: 4px } is not drawn from the scale: 4px',
    )
  })

  it('finds no size in any component the client ships', () => {
    expect(clientComponents.flatMap((file) => inlineSizes(file, read(file)))).toEqual([])
  })
})

describe('the stylesheet has one home for each rule', () => {
  it('names two rules carrying the same declarations, and no others', () => {
    expect(duplicateBlocks(rulesOf('.a { margin: 0 }\n.b { margin: 0 }'))).toEqual(['.a, .b { margin: 0 }'])
    expect(duplicateBlocks(rulesOf('.a { margin: 0 }\n.b { margin: 0 1px }'))).toEqual([])
  })

  it('carries no two rules with the same declarations', () => {
    expect(duplicateBlocks(rulesOf(read(STYLESHEET)))).toEqual([])
    const injected = withRules('.cf-injected-a { margin: 0 }', '.cf-injected-b { margin: 0 }')
    expect(duplicateBlocks(rulesOf(injected)).some((found) => found.includes('.cf-injected-a'))).toBe(true)
  })
})

describe('the stylesheet reaches no deeper than one step in', () => {
  it.each([
    ['a third compound', '.a .b .c { margin: 0 }'],
    ['a rule nested two levels in', 'a { b { c { margin: 0 } } }'],
  ])('names %s', (_label, css) => {
    expect(deepSelectors(rulesOf(css))).toHaveLength(1)
  })

  it.each([
    ['one step in', '.a .b { margin: 0 }'],
    ['the same step written as nesting', 'a { b { margin: 0 } }'],
    ['a functional pseudo-class holding a list', ':is(.a, .b) * { margin: 0 }'],
  ])('leaves %s alone', (_label, css) => {
    expect(deepSelectors(rulesOf(css))).toEqual([])
  })

  it('reaches no deeper in the shipped stylesheet', () => {
    expect(deepSelectors(rulesOf(read(STYLESHEET)))).toEqual([])
    expect(
      deepSelectors(rulesOf(withRules('.cf-injected .cf-injected .cf-injected { margin: 0 }'))),
    ).toContain('.cf-injected .cf-injected .cf-injected reaches 3 deep')
  })
})

describe('a layout container says how its children line up', () => {
  it.each(['flex', 'grid'])('names a %s container that does not', (display) => {
    expect(unalignedContainers(rulesOf(`.a { display: ${display} }`))).toEqual([
      `.a { display: ${display} } declares no alignment`,
    ])
  })

  it('accepts a container that names its alignment, and a box that is not one', () => {
    // One labelled expectation per declaration, so a failure names the one the
    // container was aligned by.
    for (const property of ALIGNMENT) {
      expect(unalignedContainers(rulesOf(`.a { display: flex; ${property}: center }`)), property).toEqual([])
    }
    expect(unalignedContainers(rulesOf('.a { display: block }'))).toEqual([])
  })

  it('leaves no container in the shipped stylesheet aligned by accident', () => {
    expect(unalignedContainers(rulesOf(read(STYLESHEET)))).toEqual([])
    expect(unalignedContainers(rulesOf(withRules('.cf-injected-box { display: flex }')))).toContain(
      '.cf-injected-box { display: flex } declares no alignment',
    )
  })
})

describe('every control states a minimum block size', () => {
  it('names a control that states none', () => {
    expect(controlsWithoutMinimum(rulesOf('button { cursor: pointer }'))).toEqual([
      'button declares no min-block-size',
    ])
  })

  it('accepts a control that states one, in one block or another', () => {
    expect(controlsWithoutMinimum(rulesOf('button { cursor: pointer; min-block-size: 24px }'))).toEqual([])
    // The rule behind a feature query re-colours the control; the minimum is
    // established where the control's box is.
    expect(
      controlsWithoutMinimum(
        rulesOf('button { min-block-size: 24px }\n@supports not (color: red) { button { color: blue } }'),
      ),
    ).toEqual([])
  })

  it('leaves every control in the shipped stylesheet with one', () => {
    expect(controlsWithoutMinimum(rulesOf(read(STYLESHEET)))).toEqual([])
    expect(controlsWithoutMinimum(rulesOf(withRules('button.cf-injected-button { color: red }')))).toContain(
      'button.cf-injected-button declares no min-block-size',
    )
  })
})
