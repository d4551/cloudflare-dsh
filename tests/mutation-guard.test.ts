import { describe, expect, it } from 'vitest'
import {
  type MutantResult,
  type MutationReport,
  escapedFiles,
  isTypeOnly,
  rewrittenFiles,
  staleInputs,
  unloadableMutants,
} from '../scripts/mutation-guard.ts'

/** One mutant at line 3, with the test count given (or none recorded). */
function mutant(status: string, testsCompleted?: number): MutantResult {
  return {
    status,
    ...(testsCompleted === undefined ? {} : { testsCompleted }),
    location: { start: { line: 3 } },
    mutatorName: 'StringLiteral',
  }
}

/** A report over one file, with the mutants and the instrumented text given. */
function reportOf(
  file: string,
  mutants: readonly MutantResult[],
  source = 'export const x = 1\n',
): MutationReport {
  return { files: { [file]: { mutants, source } } }
}

describe('staleInputs', () => {
  it('names an input written after the report', () => {
    expect(
      staleInputs(
        [
          { path: 'packages/core/src/a.ts', mtimeMs: 11 },
          { path: 'packages/core/tests/a.test.ts', mtimeMs: 9 },
        ],
        10,
      ),
    ).toEqual(['packages/core/src/a.ts'])
  })

  it('accepts an input written in the same instant as the report', () => {
    expect(staleInputs([{ path: 'vitest.config.ts', mtimeMs: 10 }], 10)).toEqual([])
  })
})

describe('rewrittenFiles', () => {
  const file = 'packages/core/src/a.ts'

  it('accepts a file that still reads as the report mutated it', () => {
    expect(rewrittenFiles(reportOf(file, [], 'export const x = 1\n'), () => 'export const x = 1\n')).toEqual(
      [],
    )
  })

  it('names a file whose text changed, however fresh the report is', () => {
    expect(rewrittenFiles(reportOf(file, [], 'export const x = 1\n'), () => 'export const x = 2\n')).toEqual([
      file,
    ])
  })

  it('names a file that no longer exists', () => {
    expect(rewrittenFiles(reportOf(file, []), () => undefined)).toEqual([file])
  })
})

describe('unloadableMutants', () => {
  const file = 'packages/bundle/src/tools/ai.ts'

  it('names a survivor that ran no tests, with its line and mutator', () => {
    expect(unloadableMutants(reportOf(file, [mutant('Survived', 0)]))).toEqual([
      'packages/bundle/src/tools/ai.ts:3 (StringLiteral)',
    ])
  })

  it('treats a survivor with no test count recorded as having run none', () => {
    expect(unloadableMutants(reportOf(file, [mutant('Survived')]))).toEqual([
      'packages/bundle/src/tools/ai.ts:3 (StringLiteral)',
    ])
  })

  it('leaves a survivor that ran its tests to the score threshold', () => {
    expect(unloadableMutants(reportOf(file, [mutant('Survived', 2)]))).toEqual([])
  })

  it('ignores a killed mutant whatever its test count', () => {
    expect(unloadableMutants(reportOf(file, [mutant('Killed', 0)]))).toEqual([])
  })
})

describe('isTypeOnly', () => {
  it.each([
    ['an interface', 'export interface A {\n  x: number\n}\n'],
    ['a type alias', 'export type T = string\n'],
    ['a type-only re-export', "export type { T } from './t.ts'\n"],
  ])('is true for %s', (_label, text) => {
    expect(isTypeOnly(text, 'a.ts')).toBe(true)
  })

  it.each([
    ['a constant', 'export const x = 1\n', 'a.ts'],
    ['a function', 'export function f(): number {\n  return 1\n}\n', 'a.ts'],
    ['a component in a .tsx file', 'export const A = () => <b />\n', 'a.tsx'],
  ])('is false for %s', (_label, text, fileName) => {
    expect(isTypeOnly(text, fileName)).toBe(false)
  })
})

describe('escapedFiles', () => {
  const mutated = 'packages/core/src/a.ts'
  const runtime = 'packages/core/src/b.ts'
  const typeOnly = 'packages/core/src/types.ts'
  const texts: Record<string, string> = {
    [mutated]: 'export const a = 1\n',
    [runtime]: 'export const b = 2\n',
    [typeOnly]: 'export interface T {\n  x: number\n}\n',
  }
  const read = (path: string): string => texts[path] ?? ''

  it('names a runtime-code source the report never mutated', () => {
    expect(escapedFiles(reportOf(mutated, []), [mutated, runtime, typeOnly], read)).toEqual([runtime])
  })

  it('passes a type-only source the report never mutated', () => {
    expect(escapedFiles(reportOf(mutated, []), [mutated, typeOnly], read)).toEqual([])
  })
})
