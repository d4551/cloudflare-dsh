/**
 * The accessibility-commitments gate: every commitment names the test that
 * holds it, and that test exists and runs.
 *
 * The page used to list these as prose "covered by tests", and one of them —
 * alternative text on a screenshot — outlived the code by two restarts: the
 * client's screenshot branch was deleted, so no test covered it and none could.
 * A commitment now carries the name of the test that holds it, and that name is
 * checked against what vitest actually collects.
 */
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { CLOUDFLARE_MCP_SERVERS } from '../../packages/bundle/src/mcp/index.ts'
import { read, root } from './support.ts'

/**
 * Budget for collecting a whole vitest suite as a subprocess. Collecting over a
 * thousand tests takes seconds locally and longer on a two-core runner; the
 * bound is finite so a hung collection fails rather than waits.
 */
const COLLECTION_TIMEOUT_MS = 120_000

/**
 * The worker markers a vitest run sets in its own workers.
 *
 * The listing runs as a subprocess of this suite; `env -u` removes the markers
 * so the child cannot believe it is one of this run's workers, without this
 * module reading the environment at all.
 */
const WORKER_MARKERS = ['VITEST', 'VITEST_MODE', 'VITEST_POOL_ID', 'VITEST_WORKER_ID'] as const

/** Every test name vitest collects for one config, as `describe > it`. */
function collected(config: string): string[] {
  const listed = JSON.parse(
    execFileSync(
      'env',
      [...WORKER_MARKERS.flatMap((marker) => ['-u', marker]), 'bun', 'x', 'vitest', 'list', '--config', config, '--json'],
      { cwd: root(''), encoding: 'utf8' },
    ),
  ) as readonly { readonly name: string }[]
  return listed.map((test) => test.name)
}

/**
 * The accessibility commitments and the test each one names.
 */
const commitments = (): { readonly commitment: string; readonly tests: string[] }[] => {
  const readme = read('README.md')
  const start = readme.indexOf('| Commitment ')
  const rows = readme.slice(start).split('\n')
  const found: { commitment: string; tests: string[] }[] = []
  for (const line of rows.slice(2)) {
    if (!line.startsWith('| ')) break
    const [commitment, cited] = line.slice(1).split('|')
    // Every name in the cell, not the first: a commitment about every input is
    // not held by one input's test, and citing one would be the same over-claim
    // in the citation that the prose list made in the commitment.
    const tests = [...(cited ?? '').matchAll(/`([^`]+)`/g)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    )
    if (tests.length > 0) found.push({ commitment: (commitment ?? '').trim(), tests })
  }
  return found
}

describe('the accessibility commitments', () => {
  it('states the number of hosted MCP servers the module actually exports', () => {
    // The page's count and the module's exports are held together by reading
    // both, so editing one literal orphans the other out loud. `mcp.test.ts`
    // pins the count independently; this holds the page to it.
    const readme = read('README.md')
    const stated = [...readme.matchAll(/\*\*(\d+) hosted MCP servers\*\*/gu)].map((m) => Number(m[1]))
    expect(stated).toEqual([CLOUDFLARE_MCP_SERVERS.length])
  })

  it('parses the commitments table rather than finding nothing in it', () => {
    // The count check below compares two readings of the same table, so both
    // going to zero passes it; this is the reading that cannot.
    expect(commitments().map((row) => row.commitment)).toContain(
      'All user-facing copy routes through the dictionary, accessible names included',
    )
  })

  it('names a test for every commitment it makes', () => {
    // A row whose second column carries no test name is a commitment nothing
    // holds, which is what the prose list allowed.
    const readme = read('README.md')
    const rows = readme.slice(readme.indexOf('| Commitment ')).split('\n').slice(2)
    const stated = rows.slice(0, rows.findIndex((line) => !line.startsWith('| ')))
    expect(commitments()).toHaveLength(stated.length)
  })

  it('names only tests that exist and run', { timeout: COLLECTION_TIMEOUT_MS }, () => {
    // All three lanes: a commitment may be held in the unit suite, in Chromium,
    // or — for the criteria axe has no rule for — by a gate that computes the
    // answer from the shipped stylesheet.
    const running = new Set([
      ...collected('vitest.config.ts'),
      ...collected('vitest.a11y.config.ts'),
      ...collected('vitest.invariants.config.ts'),
    ])
    expect(
      commitments()
        .flatMap((row) => row.tests)
        .filter((test) => !running.has(test)),
    ).toEqual([])
  })
})
