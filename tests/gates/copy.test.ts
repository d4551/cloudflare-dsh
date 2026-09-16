/**
 * The inline-copy gate, held against the tree.
 *
 * The page states that all copy the client renders — "including accessible
 * names" — lives in the client's locale module. The scanner in `scanners.ts`
 * is proven on snippets in `scan-ast.test.ts`; this module holds its sentence
 * against every client component the tree ships, and keeps the tests
 * themselves from importing the locale, which would let an assertion compare a
 * string with itself.
 */
import { describe, expect, it } from 'vitest'
import { containing } from './base.ts'
import { scanTree } from './scan.ts'
import { inlineCopy } from './scanners.ts'
import { clientComponents, testFiles } from './support.ts'

describe('no client component carries inline copy', () => {
  it('finds the components this gate holds', () => {
    expect(clientComponents.length).toBeGreaterThan(0)
  })

  it('finds no inline copy in any of them', () => {
    expect(scanTree(clientComponents, inlineCopy)).toEqual([])
  })
})

describe('tests speak in user-visible copy', () => {
  it('never imports the locale, so an assertion cannot compare a string with itself', () => {
    // A test that reads `en.cost.empty` and looks for `en.cost.empty` passes
    // whatever the copy says. Pinning the literal is what makes copy a contract.
    expect(containing(testFiles, `locales/${'en'}`)).toEqual([])
  })
})
