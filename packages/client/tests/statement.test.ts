/**
 * The coverage statement behind the server-render lane.
 *
 * A surface list that stops covering a component is the failure this catches.
 * Pinning the names here would be the thing that went stale — add a component,
 * export it, and a hand-written list agrees with a tree that no longer exists —
 * so the list is derived instead: the package's own index decides which `.tsx`
 * modules it re-exports from, each of those modules decides what it declares,
 * and the intersection is every component a consumer can reach. A component
 * added to any of them and named by the index joins that set without anyone
 * editing this file, and the comparison below fails until the lanes render it.
 *
 * The registration half states the same thing from the other side: every
 * component the plugin registers into a slot must be one the surface list
 * renders, so a contribution cannot arrive without a lane that measures it.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SURFACES } from './fixtures.tsx'
import { registry } from './slots.ts'

/** The package's own index, so every path below resolves the way the package resolves it. */
const INDEX = new URL('../src/index.ts', import.meta.url)

/** One clause of the index that takes names from a `.tsx` module. */
interface ReExport {
  readonly module: string
  readonly names: readonly string[]
}

/** Every clause of the index that takes names from a `.tsx` module. */
function reExports(): readonly ReExport[] {
  const clause = /export\s+\{([^}]*)\}\s*from\s*'([^']+\.tsx)'/gu
  return [...readFileSync(INDEX, 'utf8').matchAll(clause)].map((match) => ({
    module: match[2] ?? '',
    names: (match[1] ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '' && !name.startsWith('type '))
      .map((name) => /\bas\s+([A-Za-z_$][\w$]*)$/u.exec(name)?.[1] ?? name),
  }))
}

/**
 * The names a module declares as a component.
 *
 * A capital initial and an export, which is how this package names every React
 * component it ships; the lower-case exports beside them are the pure functions
 * — `resultText`, `presentationMetaOf`, `settledResult` — that a lane calls
 * instead of rendering.
 */
function declaredComponents(source: string): readonly string[] {
  const declaration = /export\s+function\s+([A-Z][\w$]*)|export\s+const\s+([A-Z][\w$]*)\s*=/gu
  return [...source.matchAll(declaration)].flatMap((match) => {
    const name = match[1] ?? match[2]
    return name === undefined ? [] : [name]
  })
}

/** Every component the package's index exports, derived from the index and its modules. */
function exportedComponents(): readonly string[] {
  const found = new Set<string>()
  for (const { module, names } of reExports()) {
    const declared = new Set(declaredComponents(readFileSync(new URL(module, INDEX), 'utf8')))
    for (const name of names) {
      if (declared.has(name)) found.add(name)
    }
  }
  return [...found].toSorted()
}

/** The components the surface list covers, by the name each was declared with. */
const coveredComponents = (): readonly string[] =>
  [...new Set(SURFACES.map((surface) => surface.component.name))].toSorted()

/** The components the plugin registers into slots, by the name each was declared with. */
function registeredComponents(): readonly string[] {
  const { registered, install } = registry()
  install()
  return [...new Set(registered.map((entry) => entry.component.name))].toSorted()
}

describe('the components this package exports', () => {
  it('finds the components the statement holds', () => {
    // Without this, a parse that stopped matching would leave the comparison
    // below holding over two empty lists.
    expect(exportedComponents()).toContain('SettingsCard')
    expect(exportedComponents().length).toBeGreaterThan(4)
  })

  it('renders exactly them, so a component added to the index fails here until a lane covers it', () => {
    expect(coveredComponents()).toEqual(exportedComponents())
  })
})

describe('the components this package registers', () => {
  it('registers no component the surface list leaves out', () => {
    expect(registeredComponents().filter((name) => !coveredComponents().includes(name))).toEqual([])
  })

  it('reaches the three cards that only a view renders, and no others', () => {
    // Stated exactly rather than as a subset: a component that arrived in the
    // surface list without being either registered or rendered by a view is a
    // surface nothing puts on a page.
    expect(coveredComponents().filter((name) => !registeredComponents().includes(name))).toEqual([
      'AccessibilityTree',
      'BrowserRender',
      'D1Result',
    ])
  })
})
