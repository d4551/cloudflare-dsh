/**
 * The superseded-doc gate, held against the tree.
 *
 * A rewrite that leaves the old doc block in place stacks two, and TypeScript
 * treats only the last as the declaration's documentation — so the superseded
 * one keeps sitting there describing what the code used to do, and a reader
 * meets it first. The scanner in `scanners.ts` is proven on snippets in
 * `scan-ast.test.ts`; this module holds it against every TypeScript module the
 * tree carries.
 */
import { describe, expect, it } from 'vitest'
import { modules, read } from './base.ts'
import { stackedDocs } from './scanners.ts'

describe('no superseded doc blocks in any module the tree carries', () => {
  it('finds the modules this gate holds', () => {
    expect(modules.length).toBeGreaterThan(0)
  })

  it('finds none of them stacked', () => {
    expect(modules.flatMap((file) => stackedDocs(file, read(file)))).toEqual([])
  })
})
