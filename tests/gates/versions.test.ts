/**
 * The dependency floor: every direct pin is exact, at or above the generation this
 * repository commits to, and resolved by the lockfile to that same version. The
 * rules are pure functions of the text they judge, proven on snippets first.
 */
import { describe, expect, it } from 'vitest'
import { json, read, tracked } from './base.ts'
import type { Json } from './repo.ts'

/** A finding, `path: message`, the shape every scanner in this suite reports. */
type Finding = string

/** One dependency as a manifest states it: `[name, version]`. */
type Pin = readonly [name: string, version: string]

/** The four manifests, from what git tracks, so a new package is inside the floor at once. */
const manifests = tracked.filter((file) => /^(?:packages\/[^/]+\/)?package\.json$/u.test(file))

/** The sections a manifest pins directly. */
const PINS = ['dependencies', 'devDependencies'] as const

/** Every section the lockfile repeats — peers too: their ranges are a contract, but a recorded one. */
const RECORDED = [...PINS, 'peerDependencies'] as const

/** The lockfile, read once for every rule below. */
const lockfile = read('bun.lock')

/**
 * The generation no direct dependency may fall below: `typescript` 7, `vitest` 5,
 * `react` 19, `@types/node` 22 and `@types/bun` 1.4 are the floors committed to.
 * Every other entry is the line its pin stands on; for a 0.x package that is the
 * leading two segments, since a 0.x major is always 0 and would floor nothing.
 */
const FLOORS: Readonly<Record<string, string>> = {
  '@axe-core/playwright': '4',
  '@d4551/dsh-cloudflare-core': '0.1',
  '@deepseek-ai/cordis': '4',
  '@deepseek-ai/dsh-attachment': '0.1.2',
  '@deepseek-ai/dsh-brand': '0.1.2',
  '@deepseek-ai/dsh-llm': '0.1.2',
  '@deepseek-ai/dsh-tools': '0.1.2',
  '@deepseek-ai/schemastery': '3',
  '@stryker-mutator/core': '10',
  '@stryker-mutator/vitest-runner': '10',
  '@testing-library/react': '16',
  '@types/bun': '1.4',
  '@types/node': '22',
  '@types/react': '19',
  '@types/react-dom': '19',
  '@vitest/coverage-v8': '5',
  'axe-core': '4',
  jsdom: '30',
  knip: '6',
  'oxc-parser': '0.150',
  'oxc-transform': '0.150',
  oxfmt: '0.68',
  oxlint: '1',
  playwright: '1',
  publint: '0.3',
  react: '19',
  'react-dom': '19',
  rolldown: '1',
  tsdown: '0.23',
  typescript: '7',
  vitest: '5',
  yaml: '2',
}

/** A pin this gate accepts: `major.minor.patch`, with an optional prerelease. */
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/u

/** Every way a version can fail to be a pin, most specific first. */
const RANGES: readonly (readonly [spelling: string, pattern: RegExp])[] = [
  ['caret', /^\^/u],
  ['tilde', /^~/u],
  ['comparator', /^[<>]=?/u],
  ['workspace protocol', /^workspace:/u],
  ['wildcard', /\*/u],
  ['x-range', /(?:^|\.)x(?:$|\.)/iu],
  ['dist tag', /^(?:latest|next|canary|beta|alpha)$/u],
  ['bare major', /^\d+(?:\.\d+)?$/u],
  ['not a version', /./u],
]

/** The range spelling a pin carries, or `undefined` when the pin is exact. */
function rangeSpelling(pin: string): string | undefined {
  if (EXACT.test(pin)) return undefined
  return RANGES.find(([, pattern]) => pattern.test(pin))?.[0] ?? 'an empty pin'
}

const segments = (version: string): readonly number[] => (version.split('-')[0] ?? '').split('.').map(Number)

/** Whether a version stands at or above a floor, compared generation by generation. */
function meetsFloor(version: string, floor: string): boolean {
  const have = segments(version)
  for (const [index, bound] of segments(floor).entries()) {
    const value = have[index]
    if (value === undefined) return false
    if (value > bound) return true
    if (value < bound) return false
  }
  return true
}

/** The entries of a JSON object, or `undefined` when the value is not one. */
function members(value: Json): readonly (readonly [string, Json])[] | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return Object.entries(value)
}

/**
 * One manifest's pins for one section, in the order it declares them. A section
 * the reader cannot parse contributes none — the floor coverage and the lockfile
 * agreement both report what it dropped, so an unreadable pin cannot pass.
 */
function pinsIn(manifest: Json, name: string): readonly Pin[] {
  const section = members(manifest)?.find(([key]) => key === name)?.[1]
  const values = section === undefined ? undefined : members(section)
  const found: Pin[] = []
  for (const [dependency, value] of values ?? []) {
    if (typeof value === 'string') found.push([dependency, value])
  }
  return found
}

/** The pin rule for one manifest: every pin exact, and at or above its declared floor. */
function pinFindings(file: string, manifest: Json): readonly Finding[] {
  const findings: Finding[] = []
  for (const name of PINS) {
    for (const [dependency, version] of pinsIn(manifest, name)) {
      const spelling = rangeSpelling(version)
      const floor = FLOORS[dependency]
      if (spelling !== undefined) {
        findings.push(`${file}: ${name}.${dependency} is a ${spelling} (${version}), not an exact pin`)
      } else if (floor === undefined) {
        findings.push(`${file}: ${name}.${dependency} has no declared floor`)
      } else if (!meetsFloor(version, floor)) {
        findings.push(`${file}: ${name}.${dependency} is ${version}, below its floor ${floor}`)
      }
    }
  }
  return findings
}

/** One resolved entry of the lockfile's package table: `name@version`. */
const LOCK_ENTRY = /^ {4}"(?<name>[^"]+)": \["(?<spec>[^"]+)"/u

/**
 * What the lockfile's package table resolves, keyed by package name. Entry lines
 * and workspace keys share an indentation, so the entry shape separates them.
 */
function lockEntries(lockfileText: string): ReadonlyMap<string, string> {
  const entries = new Map<string, string>()
  for (const line of lockfileText.split('\n')) {
    const match = LOCK_ENTRY.exec(line)
    const name = match?.groups?.name
    const spec = match?.groups?.spec
    if (name === undefined || spec === undefined) continue
    if (!spec.startsWith(`${name}@`)) continue
    entries.set(name, spec.slice(name.length + 1))
  }
  return entries
}

/**
 * The pins one workspace declares in the lockfile: the second copy a hand-edited
 * manifest leaves behind, after which the manifest says one version and the
 * install takes another. `undefined` is a lockfile carrying no such section; the
 * section is read inside the workspace's own block, so the next workspace's
 * `dependencies` cannot be read as this one's.
 */
function lockedPins(lockfileText: string, workspace: string, name: string): readonly Pin[] | undefined {
  const lines = lockfileText.split('\n')
  const start = lines.indexOf(`    ${JSON.stringify(workspace)}: {`)
  if (start === -1) return undefined
  const close = lines.indexOf('    },', start)
  const block = lines.slice(start + 1, close === -1 ? undefined : close)
  const head = block.indexOf(`      ${JSON.stringify(name)}: {`)
  if (head === -1) return undefined
  const pins: Pin[] = []
  for (const line of block.slice(head + 1)) {
    if (line === '      },') return pins
    const entry = /^ {8}"([^"]+)": "([^"]+)",?$/u.exec(line)
    const dependency = entry?.[1]
    const version = entry?.[2]
    if (dependency === undefined || version === undefined) continue
    pins.push([dependency, version])
  }
  return undefined
}

/** Where the pins a manifest declares and the pins the lockfile repeats disagree. */
function disagreement(
  file: string,
  name: string,
  declared: readonly Pin[],
  locked: readonly Pin[],
): readonly Finding[] {
  const findings: Finding[] = []
  const recorded = new Map(locked)
  for (const [dependency, version] of declared) {
    const lockedVersion = recorded.get(dependency)
    if (lockedVersion === undefined) {
      findings.push(
        `${file}: ${name}.${dependency} is pinned ${version} but the lockfile records no such pin`,
      )
    } else if (lockedVersion !== version) {
      findings.push(
        `${file}: ${name}.${dependency} is pinned ${version} but the lockfile records ${lockedVersion}`,
      )
    }
  }
  const stated = new Set(declared.map(([dependency]) => dependency))
  for (const dependency of recorded.keys()) {
    if (!stated.has(dependency)) {
      findings.push(`${file}: ${name}.${dependency} is in the lockfile but not in the manifest`)
    }
  }
  return findings
}

/** Whether one pin and the spec the lockfile resolves for it name the same version. */
function resolutionFinding(
  file: string,
  name: string,
  pin: string,
  spec: string,
  linked: string | undefined,
): Finding | undefined {
  if (spec === pin) return undefined
  if (!spec.startsWith('workspace:')) {
    return `${file}: ${name} is pinned ${pin} but the lockfile resolves ${spec}`
  }
  // A workspace dependency is a link rather than a registry entry: its pin is
  // the linked manifest's own version.
  const target = spec.slice('workspace:'.length)
  if (linked === pin) return undefined
  return `${file}: ${name} is pinned ${pin} but the lockfile links ${target} at ${linked ?? 'no version'}`
}

/** The value `[install]` gives `exact` in a bunfig, or `undefined` when it sets none. */
function exactSetting(bunfig: string): string | undefined {
  let table = ''
  for (const raw of bunfig.split('\n')) {
    const line = (raw.split('#')[0] ?? '').trim()
    const header = /^\[(?<table>[^\]]+)\]$/u.exec(line)
    if (header?.groups?.table !== undefined) {
      table = header.groups.table
      continue
    }
    const setting = /^exact\s*=\s*(?<value>[^\s]+)$/u.exec(line)
    if (table === 'install' && setting?.groups?.value !== undefined) return setting.groups.value
  }
  return undefined
}

/** The workspace a manifest belongs to, as the lockfile names it: the root is the empty key. */
const workspaceOf = (file: string): string => file.replace(/package\.json$/u, '').replace(/\/$/u, '')

/** The version a linked workspace declares, or `undefined` when the tree carries no such manifest. */
function linkedVersion(workspace: string): string | undefined {
  const file = `${workspace}/package.json`
  if (!manifests.includes(file)) return undefined
  const value = members(json<Json>(file))?.find(([key]) => key === 'version')?.[1]
  return typeof value === 'string' ? value : undefined
}

/** Every manifest in the tree, parsed once, with the workspace the lockfile names it by. */
const tree = manifests.map((file) => ({ file, manifest: json<Json>(file), workspace: workspaceOf(file) }))

describe('the floor rules, on snippets', () => {
  /** A lockfile with two workspaces — one pinning nothing — and one resolved entry. */
  const snippet = [
    '{',
    '  "workspaces": {',
    '    "": {',
    '      "devDependencies": {',
    '        "vitest": "5.0.1",',
    '      },',
    '    },',
    '    "packages/other": {',
    '      "dependencies": {',
    '        "knip": "6.35.1",',
    '      },',
    '    },',
    '  },',
    '  "packages": {',
    '    "vitest": ["vitest@5.0.1", "", { "dependencies": { "chai": "^6.2.2" } }],',
    '  },',
    '}',
  ].join('\n')

  /** The findings one snippet manifest produces, so each assertion names one file. */
  const findings = (manifest: Json): readonly Finding[] => pinFindings('p.json', manifest)

  it('reads an exact pin as no range at all, and names every spelling that is one', () => {
    const pins = ['7.0.2', '0.1.2-rc.1', '^7.0.2', '~7.0.2', '>=7', '7.x', '*', 'latest', '19', 'nope']
    const spells = [undefined, undefined, 'caret', 'tilde', 'comparator', 'x-range', 'wildcard', 'dist tag']
    expect(pins.map(rangeSpelling)).toEqual([...spells, 'bare major', 'not a version'])
    expect(rangeSpelling('workspace:*')).toBe('workspace protocol')
    expect(rangeSpelling('')).toBe('an empty pin')
  })

  it('reads a version against a floor by generation, not by release', () => {
    const cases: readonly (readonly [string, string, boolean])[] = [
      ['7.0.2', '7', true],
      ['6.0.2', '7', false],
      ['4.1.11', '5', false],
      ['0.150.0', '0.150', true],
      ['0.149.0', '0.150', false],
      ['0.1.2-rc.1', '0.1.2', true],
      ['21.7.0', '22', false],
    ]
    expect(cases.map(([version, floor]) => meetsFloor(version, floor))).toEqual(
      cases.map(([, , meets]) => meets),
    )
  })

  it('reports every way a manifest leaves the pin rule, and passes one that does not', () => {
    expect(findings({ devDependencies: { typescript: '7.0.2' } })).toEqual([])
    expect(findings({ devDependencies: { typescript: '^7.0.2', 'no-such-package': '1.0.0' } })).toEqual([
      'p.json: devDependencies.typescript is a caret (^7.0.2), not an exact pin',
      'p.json: devDependencies.no-such-package has no declared floor',
    ])
    expect(findings({ devDependencies: { typescript: '6.0.2' } })).toEqual([
      'p.json: devDependencies.typescript is 6.0.2, below its floor 7',
    ])
  })

  it('reads one workspace at a time, the installer setting, and every disagreement', () => {
    expect(lockEntries(snippet).get('vitest')).toBe('5.0.1')
    expect(lockEntries('not a lockfile').size).toBe(0)
    expect(lockedPins(snippet, '', 'devDependencies')).toEqual([['vitest', '5.0.1']])
    expect(lockedPins(snippet, '', 'dependencies')).toBeUndefined()
    expect(lockedPins(snippet, 'packages/other', 'dependencies')).toEqual([['knip', '6.35.1']])
    expect(exactSetting('[install]\nexact = true\n')).toBe('true')
    expect(exactSetting('[install]\nexact = true # a comment is not the value\n')).toBe('true')
    expect(exactSetting('[install]\nexact = false\n')).toBe('false')
    expect(exactSetting('[install]\n')).toBeUndefined()
    expect(exactSetting('exact = true\n')).toBeUndefined()
    const declared: readonly Pin[] = [
      ['vitest', '5.0.1'],
      ['knip', '6.35.1'],
    ]
    expect(disagreement('p.json', 'devDependencies', declared, [['vitest', '4.1.11']])).toEqual([
      'p.json: devDependencies.vitest is pinned 5.0.1 but the lockfile records 4.1.11',
      'p.json: devDependencies.knip is pinned 6.35.1 but the lockfile records no such pin',
    ])
    expect(resolutionFinding('p.json', 'vitest', '5.0.1', '4.1.11', undefined)).toBe(
      'p.json: vitest is pinned 5.0.1 but the lockfile resolves 4.1.11',
    )
    expect(resolutionFinding('p.json', 'core', '0.1.0', 'workspace:packages/core', '0.2.0')).toBe(
      'p.json: core is pinned 0.1.0 but the lockfile links packages/core at 0.2.0',
    )
  })
})

describe('the floor, held against the tree', () => {
  it('pins every direct dependency exactly, at or above a declared floor', () => {
    expect(tree.length).toBeGreaterThan(0)
    const declared = new Set(
      tree.flatMap(({ manifest }) => PINS.flatMap((name) => pinsIn(manifest, name).map(([pin]) => pin))),
    )
    expect([...declared].toSorted()).toEqual(Object.keys(FLOORS).toSorted())
    expect(tree.flatMap(({ file, manifest }) => pinFindings(file, manifest))).toEqual([])
  })

  it('configures the installer to refuse a range, so one cannot be written back', () => {
    expect(exactSetting(read('bunfig.toml'))).toBe('true')
  })

  it('records every manifest pin in the lockfile, resolving each to the pinned version', () => {
    const resolved = lockEntries(lockfile)
    expect(resolved.size).toBeGreaterThan(0)
    const findings: Finding[] = []
    for (const { file, manifest, workspace } of tree) {
      for (const name of RECORDED) {
        const declared = pinsIn(manifest, name)
        const locked = lockedPins(lockfile, workspace, name)
        if (locked === undefined) {
          if (declared.length > 0) findings.push(`${file}: the lockfile records no ${name}`)
        } else {
          findings.push(...disagreement(file, name, declared, locked))
        }
      }
      for (const [dependency, version] of PINS.flatMap((name) => pinsIn(manifest, name))) {
        const spec = resolved.get(dependency)
        if (spec === undefined) {
          findings.push(`${file}: ${dependency} is pinned and the lockfile resolves nothing`)
          continue
        }
        const linked = linkedVersion(spec.slice('workspace:'.length))
        const finding = resolutionFinding(file, dependency, version, spec, linked)
        if (finding !== undefined) findings.push(finding)
      }
    }
    expect(findings).toEqual([])
  })
})
