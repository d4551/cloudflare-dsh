/**
 * The loose-type gate, held against the tree.
 *
 * `any` in a type position and the cast pair `x as unknown as T` assert what
 * the compiler could not derive. The scanner in `scanners.ts` is proven on
 * snippets in `scan-ast.test.ts`; this module holds it against every
 * TypeScript module the tree carries — the gate configuration included, since
 * a cast in a vitest config escapes the packages' own gates.
 */
import { describe, expect, it } from 'vitest'
import { scanTree } from './scan.ts'
import { looseTypes } from './scanners.ts'
import { modules } from './support.ts'

describe('no loose types in any module the tree carries', () => {
  it('finds the modules this gate holds', () => {
    expect(modules.length).toBeGreaterThan(0)
  })

  it('finds none of them loose', () => {
    expect(scanTree(modules, looseTypes)).toEqual([])
  })
})
