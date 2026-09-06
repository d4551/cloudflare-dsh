/**
 * The quality rules, as a gate rather than as prose.
 *
 * Every rule the README states is asserted here. A rule that is only documented
 * holds until someone edits a config, and nothing goes red when they do — so
 * the rules fail a build instead of describing an intention.
 *
 * The suppression and evasion needles are assembled from fragments so this file
 * does not contain the text it forbids, and therefore needs no exemption for
 * itself.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/**
 * Every file git tracks or would track: a new file that is not yet added is
 * part of the tree CI will see, so it is part of the tree this gate sees.
 * Ignored files stay out, so build output cannot fail the gate.
 */
const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: root('..'),
  encoding: 'utf8',
})
  .split('\n')
  .filter((line) => line !== '')

const read = (file: string): string => readFileSync(root(`../${file}`), 'utf8')
const json = <T>(file: string): T => JSON.parse(read(file)) as T

/** The gate configuration this suite polices, typed so a missing key is an error. */
interface PackageJson {
  readonly scripts: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
}
interface OxfmtConfig {
  readonly ignorePatterns?: readonly string[]
  readonly overrides?: readonly unknown[]
}
interface StrykerConfig {
  readonly mutate: readonly string[]
  readonly thresholds: Readonly<Record<string, number>>
}
interface OxlintConfig {
  readonly categories: Readonly<Record<string, string>>
}
interface TsConfigBase {
  readonly compilerOptions: Readonly<Record<string, unknown>>
}
interface TsConfig {
  readonly include: readonly string[]
}
interface KnipWorkspace {
  readonly project?: readonly string[]
  readonly entry?: readonly string[]
  readonly ignore?: readonly string[]
  readonly ignoreDependencies?: readonly string[]
}
interface KnipConfig {
  readonly workspaces: Readonly<Record<string, KnipWorkspace>>
}

const code = tracked.filter((file) => /\.(ts|tsx|mjs|cjs|js|json|ya?ml)$/.test(file))
/**
 * Every file under a tests directory, not only `*.test.ts`.
 *
 * A helper is exactly where an evasion would hide: a shared harness or an axe
 * wrapper with a rule-disabling default is invisible to a scan that only looks
 * at files whose name ends in `.test.ts`.
 */
const tests = code.filter((file) => /(^|\/)tests\//.test(file))
const sources = code.filter((file) => /^packages\/[^/]+\/src\//.test(file))
/**
 * Every TypeScript module in the tree, not only those under `src` and `tests`.
 *
 * The gate configuration is itself TypeScript — four vitest configs, three
 * tsdown configs and the two mutation-guard scripts — so a scan that stops at
 * the package directories cannot see the files that decide what the other
 * gates do. One escaped exactly there: a superseded doc block sat in
 * `vitest.a11y.config.ts` while this suite reported the tree clean.
 */
const modules = code.filter((file) => /\.tsx?$/.test(file))

/** Files containing a needle, so a failure names them. */
const containing = (files: readonly string[], needle: string): string[] =>
  files.filter((file) => read(file).includes(needle))

/**
 * Files matching a pattern, for a shape a substring cannot express.
 *
 * The pattern is assembled from fragments for the same reason the needles are:
 * this file is itself under `tests/`, so a literal would make the gate find
 * its own definition.
 */
const matching = (files: readonly string[], pattern: RegExp): string[] =>
  files.filter((file) => pattern.test(read(file)))

describe('no suppression comments', () => {
  it.each([
    ['eslint', `eslint-dis${'able'}`],
    ['oxlint', `oxlint-dis${'able'}`],
    ['ts-ignore', `@ts-ig${'nore'}`],
    ['ts-expect-error', `@ts-exp${'ect-error'}`],
    ['ts-nocheck', `@ts-noc${'heck'}`],
    ['stryker', `Stryker dis${'able'}`],
  ])('no %s suppression exists in tracked code', (_label, needle) => {
    expect(containing(code, needle)).toEqual([])
  })
})

describe('no test evasions', () => {
  it.each([
    ['skip', `.sk${'ip('}`],
    ['only', `.on${'ly('}`],
    ['todo', `.to${'do('}`],
    ['conditional skip', `skip${'If('}`],
    ['conditional run', `run${'If('}`],
    ['soft assertion', `expect.so${'ft'}`],
    // A throw assertion with no argument passes for any error at all — a network
    // failure, a typo in a fixture — so it proves only that something went wrong.
    ['bare throw assertion', `toThrow${'()'}`],
    ['bare throw-error assertion', `toThrowError${'()'}`],
    // `getBy*` already throws when nothing matches, so a defined-only check on
    // its result asserts nothing — and passes for `null` the moment the query
    // becomes `queryBy*`.
    ['defined-only assertion', `.toBeDefi${'ned()'}`],
    ['truthy assertion', `.toBeTru${'thy()'}`],
    ['falsy assertion', `.toBeFal${'sy()'}`],
    ['anything matcher', `expect.anyt${'hing()'}`],
    // A rejection caught and discarded leaves the outcome the test exists to
    // observe unobserved.
    ['swallowed rejection', `.cat${'ch(() =>'}`],
    // A snapshot records whatever the code did on the day it was written and
    // calls that the expectation. There are none today; there is nothing to
    // stop the first.
    ['snapshot', `toMatch${'Snapshot('}`],
    ['inline snapshot', `toMatchInline${'Snapshot('}`],
    ['file snapshot', `toMatchFile${'Snapshot('}`],
    // Every string contains the empty string, so this matcher accepts any
    // string at all — the anything-matcher above, wearing a different name.
    ['empty substring matcher', `stringContaining(${"''"})`],
    // A clock in a test makes the result depend on how loaded the machine is.
    // Source modules are already held to this; a test asserting on elapsed
    // wall time was how it got in.
    ['wall clock', `Date.${'now('}`],
    ['clock construction', `new Da${'te('}`],
    ['performance clock', `performance.${'now('}`],
  ])('no %s appears in a test file', (_label, needle) => {
    expect(containing(tests, needle)).toEqual([])
  })
})

describe('no assertion that anything at all satisfies', () => {
  it('never asserts merely that a query returned an element', () => {
    // `getBy*` throws when nothing matches, so asserting that its result is an
    // element adds nothing to the query — and it holds for every element on
    // the page, so a query aimed at the wrong node still reads as wired. This
    // is the defined-only assertion above under another name, and it was here
    // 23 times. Matched as a pattern because the formatter wraps the long ones.
    expect(matching(tests, new RegExp(`toBeInstance${'Of'}\\(\\s*HTML`, 'u'))).toEqual([])
  })
})

/**
 * Attributes whose value a user reads or hears.
 *
 * Everything else a component sets — `className`, `id`, `role`, `type`,
 * `scope`, `autoComplete`, every `aria-*` that names an id — is addressed to
 * the machine, so a literal there is not copy and its subtree is skipped.
 */
const USER_VISIBLE_ATTRIBUTES = new Set([
  'alt',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'label',
  'placeholder',
  'title',
])

/** `typeof x === 'string'` compares against a language keyword, not copy. */
const isTypeofOperand = (node: ts.Node): boolean =>
  ts.isBinaryExpression(node.parent) &&
  (ts.isTypeOfExpression(node.parent.left) || ts.isTypeOfExpression(node.parent.right))

/**
 * User-visible copy written inline in a component instead of routed through
 * the locale dictionary.
 *
 * The page states that all copy the client renders — "including accessible
 * names" — lives in the client's locale module. It did not: a toggle's whole
 * accessible name and two description terms were literals in the component,
 * and the sentence was prose no gate read.
 *
 * Every literal in the module counts, not only the ones directly between tags:
 * the name that escaped was `{expanded ? 'Hide detail' : 'Show detail'}`, a
 * conditional inside an expression container, which a scan of text nodes and
 * attributes walks straight past. Machine-facing attribute values are skipped
 * by subtree, and an empty string or pure whitespace is never copy.
 */
function inlineCopy(name: string, text: string): string[] {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  const found: string[] = []
  const at = (node: ts.Node): string =>
    `${name}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`
  const report = (node: ts.Node, value: string): void => {
    if (value.trim() !== '') found.push(`${at(node)} ${value.trim()}`)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && !USER_VISIBLE_ATTRIBUTES.has(node.name.getText(source))) return
    // A module specifier is a path, not something anyone reads.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
    if (ts.isJsxText(node)) report(node, node.text)
    if (ts.isStringLiteralLike(node) && !isTypeofOperand(node)) report(node, node.text)
    if (ts.isTemplateLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) {
      report(node.head, node.head.text)
      for (const span of node.templateSpans) report(span.literal, span.literal.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('user-facing copy lives in the dictionary', () => {
  // The scanner is proven on snippets before it is trusted on the tree.
  it.each([
    ['text between tags', 'const A = () => <b>Hide detail</b>', ['probe.tsx:1 Hide detail']],
    ['a term in a list', 'const A = () => <dl><dt>Cached</dt></dl>', ['probe.tsx:1 Cached']],
    [
      'a literal in a conditional, which is how one escaped',
      "const A = (p: { x: boolean }) => <b>{p.x ? 'Hide detail' : 'Show detail'}</b>",
      ['probe.tsx:1 Hide detail', 'probe.tsx:1 Show detail'],
    ],
    ['a quoted accessible name', 'const A = () => <b aria-label="Usage" />', ['probe.tsx:1 Usage']],
    ['alternative text', 'const A = () => <img alt="A chart" src="s" />', ['probe.tsx:1 A chart']],
    [
      'a literal returned by a helper the component renders',
      "function d(): string {\n  return 'unknown'\n}",
      ['probe.tsx:2 unknown'],
    ],
    [
      'a separator interpolated into displayed text',
      'const d = (a: string, b: string) => `${a}: ${b}`',
      ['probe.tsx:1 :'],
    ],
  ])('finds %s', (_label, snippet, expected) => {
    expect(inlineCopy('probe.tsx', snippet)).toEqual(expected)
  })

  it.each([
    ['copy read from the dictionary', 'const A = () => <b>{en.cost.label}</b>'],
    ['a name read from the dictionary', 'const A = () => <b aria-label={en.cost.label} />'],
    ['a machine-facing attribute', 'const A = () => <b className="cf-chip" id="x" role="status" />'],
    ['an interpolated value', 'const A = (p: { n: number }) => <b>{p.n}</b>'],
    ['whitespace between elements', 'const A = () => (\n  <b>\n    <i>{en.x}</i>\n  </b>\n)'],
    ['an empty string', "const [v, s] = useState('')"],
    ['a whitespace-only join', 'const ids = (a: string, b: string) => `${a} ${b}`'],
    // Assembled, because the needle above forbids this file naming that path.
    ['an import specifier', `import { en } from './locales/${'en'}.ts'`],
    ['a typeof comparison', "const f = (v: unknown) => typeof v === 'string'"],
    ['a typeof comparison written the other way round', "const f = (v: unknown) => 'string' === typeof v"],
  ])('passes %s', (_label, snippet) => {
    expect(inlineCopy('probe.tsx', snippet)).toEqual([])
  })

  it('finds no inline copy in any client component', () => {
    const components = sources.filter(
      (file) => file.startsWith('packages/client/src/') && file.endsWith('.tsx'),
    )
    expect(components.length).toBeGreaterThan(0)
    expect(components.flatMap((file) => inlineCopy(file, read(file)))).toEqual([])
  })
})

describe('tests speak in user-visible copy', () => {
  it('never imports the locale, so an assertion cannot compare a string with itself', () => {
    // A test that reads `en.cost.empty` and looks for `en.cost.empty` passes
    // whatever the copy says. Pinning the literal is what makes copy a contract.
    expect(containing(tests, `locales/${'en'}`)).toEqual([])
  })
})

/**
 * Budget for a test that launches a whole vitest collection as a subprocess.
 *
 * Collecting 1,000+ tests takes a few seconds locally and over ten on a
 * two-core CI runner, which is beyond the default; the bound is still finite,
 * so a hung collection fails rather than waits forever.
 */
const COLLECTION_TIMEOUT_MS = 120_000

describe('every test is uniquely addressable', () => {
  it(
    'gives no two tests the same full name, which per-test mutation filtering selects by',
    { timeout: COLLECTION_TIMEOUT_MS },
    () => {
      // Asked of vitest itself rather than parsed from source, so `it.each`
      // expansions and nested describes are seen exactly as the runner sees them.
      // A duplicate name has twice made a mutant that tests kill report as
      // surviving, because the filter could not address the test that killed it.
      const listed = JSON.parse(
        execFileSync('bunx', ['vitest', 'list', '--config', 'vitest.config.ts', '--json'], {
          cwd: root('..'),
          encoding: 'utf8',
          // A vitest run inherits the outer worker's environment; the listing must
          // not believe it is one of this run's workers.
          env: {
            ...process.env,
            VITEST: undefined,
            VITEST_MODE: undefined,
            VITEST_POOL_ID: undefined,
            VITEST_WORKER_ID: undefined,
          },
        }),
      ) as readonly { readonly name: string; readonly file: string }[]
      const counts = new Map<string, number>()
      for (const test of listed) {
        const key = `${relative(root('..'), test.file)} > ${test.name}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      expect([...counts].filter(([, n]) => n > 1).map(([key]) => key)).toEqual([])
    },
  )
})

/**
 * Type escape hatches in one module, read from its syntax tree rather than its
 * text: `any` in any type position — an annotation, a type argument, an
 * assertion — and the double cast `x as unknown as T`, which asserts a type
 * the compiler could not derive. A text search misses `Record<string, any>`
 * and flags the word "any" in a comment; the tree does neither.
 */
function escapeHatches(name: string, text: string): string[] {
  const kind = name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.ESNext, true, kind)
  const found: string[] = []
  const at = (node: ts.Node): string =>
    `${name}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) found.push(`${at(node)} any`)
    if (
      ts.isAsExpression(node) &&
      ts.isAsExpression(node.expression) &&
      node.expression.type.kind === ts.SyntaxKind.UnknownKeyword
    ) {
      found.push(`${at(node)} as unknown as`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('no type escape hatch', () => {
  // The scanner is proven on snippets before it is trusted on the tree: a gate
  // nobody has seen fail is not known to work.
  it.each([
    ['an annotation', 'let a: any', ['probe.ts:1 any']],
    ['a type argument', 'let r: Record<string, any> = {}', ['probe.ts:1 any']],
    ['an assertion', 'const a = (1 as any).x', ['probe.ts:1 any']],
    ['a double cast', 'const s = 1 as unknown as string', ['probe.ts:1 as unknown as']],
    [
      'a double cast on a later line',
      'const n = 1\nconst s = n as unknown as string',
      ['probe.ts:2 as unknown as'],
    ],
  ])('finds %s', (_label, snippet, expected) => {
    expect(escapeHatches('probe.ts', snippet)).toEqual(expected)
  })

  it.each([
    ['a single widening cast', 'const u = 1 as unknown'],
    ['a value typed by inference', 'const s = String(1)'],
    ['the word in a comment', '// no other node kind has any'],
    ['the words in a string', "const s = 'as unknown as'"],
    ['a JSX file with a typed prop', 'export const A = (p: { n: number }) => <b>{p.n}</b>'],
  ])('passes %s', (_label, snippet) => {
    expect(escapeHatches(_label.startsWith('a JSX') ? 'probe.tsx' : 'probe.ts', snippet)).toEqual([])
  })

  it('finds none in any TypeScript module the tree carries', () => {
    expect(modules.flatMap((file) => escapeHatches(file, read(file)))).toEqual([])
  })
})

/**
 * Declarations with a superseded doc block above their current one.
 *
 * A rewrite that leaves the old block in place stacks two, and TypeScript
 * treats only the last as the declaration's documentation — so the superseded
 * one keeps sitting there describing what the code used to do, and a reader
 * meets it first. One did: `listAll` was documented as "yielding items" long
 * after it stopped being a generator. The comment ranges are read from the
 * text, because the syntax tree drops the block it does not consider current.
 *
 * Two blocks are stacked when nothing but one line break separates them. A
 * module's own doc block sits above the first declaration's with a blank line
 * between, which is what tells the two apart.
 */
function stackedDocs(name: string, text: string): string[] {
  const kind = name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.ESNext, true, kind)
  const found = new Set<string>()
  const visit = (node: ts.Node): void => {
    const docs = (ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []).filter(
      (range) => text.slice(range.pos, range.pos + 3) === '/**',
    )
    const stacked = docs.some((range, index) => {
      const next = docs[index + 1]
      return next !== undefined && text.slice(range.end, next.pos).split('\n').length === 2
    })
    if (stacked) {
      found.add(`${name}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...found]
}

describe('no superseded doc block', () => {
  // The scanner is proven on snippets before it is trusted on the tree.
  it.each([
    ['two blocks above one declaration', '/** old */\n/** new */\nexport const a = 1', ['probe.ts:3']],
    ['two blocks above a method', 'class C {\n  /** old */\n  /** new */\n  m(): void {}\n}', ['probe.ts:4']],
  ])('finds %s', (_label, snippet, expected) => {
    expect(stackedDocs('probe.ts', snippet)).toEqual(expected)
  })

  it.each([
    ['one block', '/** only */\nexport const a = 1'],
    ['no block', 'export const a = 1'],
    ['a block each on two declarations', '/** a */\nexport const a = 1\n/** b */\nexport const b = 2'],
    ['a line comment above a block', '// note\n/** doc */\nexport const a = 1'],
    ['a plain block above a doc block', '/* note */\n/** doc */\nexport const a = 1'],
    ['a module doc a blank line above the first', '/** module */\n\n/** doc */\nexport const a = 1'],
  ])('passes %s', (_label, snippet) => {
    expect(stackedDocs('probe.ts', snippet)).toEqual([])
  })

  it('finds none in any TypeScript module the tree carries', () => {
    expect(modules.flatMap((file) => stackedDocs(file, read(file)))).toEqual([])
  })
})

describe('mutation testing cannot be narrowed', () => {
  it('mutates every source extension, with no negated pattern', () => {
    expect(json<StrykerConfig>('stryker.config.json').mutate).toEqual([
      'packages/*/src/**/*.ts',
      'packages/*/src/**/*.tsx',
    ])
  })

  it('fails the run below a perfect score', () => {
    expect(json<StrykerConfig>('stryker.config.json').thresholds).toEqual({ high: 100, low: 100, break: 100 })
  })

  it('runs the escape guard after the mutation run', () => {
    expect(json<PackageJson>('package.json').scripts.stryker).toBe(
      'stryker run && bun scripts/verify-mutation-files.ts',
    )
  })

  it('has no const assertion in source, which would remove values from mutation', () => {
    // Stryker does not mutate inside a const assertion. One of these once hid a
    // whole file: 47 mutants, ten of them untested.
    expect(containing(sources, 'as const')).toEqual([])
    expect(containing(sources, `<con${'st>'}`)).toEqual([])
  })
})

describe('coverage cannot be softened', () => {
  it('requires 100 on every metric', () => {
    const found = [...read('vitest.config.ts').matchAll(/(lines|branches|functions|statements):\s*(\d+)/g)]
    expect(found.map((match) => [match[1], Number(match[2])])).toEqual([
      ['lines', 100],
      ['branches', 100],
      ['functions', 100],
      ['statements', 100],
    ])
  })

  it('excludes nothing from the measurement', () => {
    // `coverage.exclude: ['packages/bundle/src/**']` would leave every other
    // assertion in this block passing while the metric measured almost nothing.
    // The lane-separation `test.exclude` is a different key and is legitimate,
    // so this reads the coverage block alone rather than the whole file.
    const config = read('vitest.config.ts')
    const start = config.indexOf('coverage: {')
    expect(start).toBeGreaterThan(-1)
    const block = config.slice(start, config.indexOf('\n    }', start))
    expect(block).not.toContain('exclude')
  })

  it('measures every source extension', () => {
    expect(read('vitest.config.ts')).toContain(
      "include: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx']",
    )
  })
})

describe('linting cannot be softened', () => {
  it('grades every enabled category as an error', () => {
    const { categories } = json<OxlintConfig>('.oxlintrc.json')
    expect(Object.entries(categories).filter(([, level]) => level !== 'error')).toEqual([])
  })

  it('keeps every category that must be graded, so none can be dropped', () => {
    // Asserting only that present categories are errors is checkable by
    // omission: deleting one leaves an empty filter and a green gate.
    expect(Object.keys(json<OxlintConfig>('.oxlintrc.json').categories).toSorted()).toEqual([
      'correctness',
      'perf',
      'suspicious',
    ])
  })

  it('fails the build on a warning', () => {
    expect(json<PackageJson>('package.json').scripts.lint).toContain('--deny-warnings')
  })
})

describe('formatting cannot drift', () => {
  // A formatter run across the tree once rewrote 23 files while every other
  // gate stayed green. A canonical style is only a rule if something fails
  // when a file departs from it.
  it('checks formatting rather than applying it', () => {
    expect(json<PackageJson>('package.json').scripts['format:check']).toBe('oxfmt --check')
  })

  it('ignores only what git ignores, so no source can be excused from the check', () => {
    const gitignored = read('.gitignore')
      .split('\n')
      .filter((line) => line.endsWith('/'))
      .map((line) => line.slice(0, -1))
    for (const pattern of json<OxfmtConfig>('.oxfmtrc.json').ignorePatterns ?? []) {
      expect(gitignored).toContain(pattern)
    }
  })

  it('has no per-file overrides', () => {
    expect(json<OxfmtConfig>('.oxfmtrc.json').overrides).toBeUndefined()
  })

  it('pins the formatter exactly, since a new version can change what canonical means', () => {
    expect(json<PackageJson>('package.json').devDependencies['oxfmt']).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('the runner and the mutator are pinned', () => {
  // A range here is not a version bump, it is a silent change of what the
  // mutation score means. On Vitest 5 the Stryker vitest runner's per-test
  // filter matches nothing and every covered mutant reports as surviving
  // (stryker-js#6210, still open), so a caret on `vitest` would turn a 100%
  // gate into a meaningless one with nothing going red.
  it.each(['vitest', '@vitest/coverage-v8', '@stryker-mutator/core', '@stryker-mutator/vitest-runner'])(
    'pins %s to an exact version',
    (name) => {
      expect(json<PackageJson>('package.json').devDependencies[name]).toMatch(/^\d+\.\d+\.\d+$/)
    },
  )

  it('keeps the runner and its coverage provider on the same version', () => {
    const { devDependencies } = json<PackageJson>('package.json')
    expect(devDependencies['@vitest/coverage-v8']).toBe(devDependencies['vitest'])
  })
})

describe('type checking cannot be skipped', () => {
  it.each([
    ['strict', true],
    ['skipLibCheck', false],
    ['noUncheckedIndexedAccess', true],
    ['exactOptionalPropertyTypes', true],
  ])('%s is %s', (option, value) => {
    expect(json<TsConfigBase>('tsconfig.base.json').compilerOptions[option]).toBe(value)
  })
})

describe('nothing is hidden from the unused-code gate', () => {
  it('scans the root workspace as well as the packages', () => {
    expect(json<KnipConfig>('knip.json').workspaces['.']?.project).toEqual([
      '*.ts',
      'tests/**/*.ts',
      'scripts/**/*.ts',
    ])
  })

  it('gives every workspace a project scope', () => {
    const { workspaces } = json<KnipConfig>('knip.json')
    expect(Object.entries(workspaces).filter(([, ws]) => (ws.project ?? []).length === 0)).toEqual([])
  })

  it('hides nothing behind an ignore list', () => {
    // An `ignore` or `ignoreDependencies` key would silently exempt code from
    // the unused-code gate, which is the same shape as a mutate exclusion.
    const { workspaces } = json<KnipConfig>('knip.json')
    const hiding = Object.entries(workspaces).filter(
      ([, ws]) => ws.ignore !== undefined || ws.ignoreDependencies !== undefined,
    )
    expect(hiding).toEqual([])
  })
})

describe('nothing is hidden from the type checker', () => {
  it.each([
    'tests/**/*.ts',
    'scripts/**/*.ts',
    'packages/*/tsdown.config.ts',
    'packages/*/src/**/*.ts',
    'packages/*/tests/**/*.ts',
  ])('%s is typechecked', (pattern) => {
    // This suite polices every other gate, and until these patterns existed it
    // was not itself typechecked — eight real type errors were hiding in it.
    expect(json<TsConfig>('tsconfig.json').include).toContain(pattern)
  })
})

/**
 * Relative luminance of an `#rrggbb` colour, per WCAG 2.
 *
 * Written here rather than imported: the whole point of this gate is that no
 * tool in the stack computes non-text contrast, so there is nothing to import.
 */
function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((value) => (value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0)
}

/** Contrast ratio between two `#rrggbb` colours, from 1 to 21. */
function contrastRatio(first: string, second: string): number {
  const [low, high] = [luminance(first), luminance(second)].toSorted((a, b) => a - b)
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05)
}

/** One style rule, with the media conditions it sits under. */
interface CssRule {
  readonly selector: string
  readonly body: string
  readonly media: readonly string[]
}

/** Every rule in a stylesheet, flattened out of its at-rules. */
function rulesOf(css: string, media: readonly string[] = []): CssRule[] {
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
const declaration = (body: string, property: string): string | undefined =>
  new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]*)`, 'u').exec(body)?.[1]?.trim()

/** The `--cf-*` token a value resolves through, if it names one. */
const tokenIn = (value: string | undefined): string | undefined =>
  value === undefined ? undefined : /var\(\s*(--cf-[a-z-]+)/u.exec(value)?.[1]

/** Token values for one colour scheme, taking the dark block's overrides. */
function tokensOf(rules: readonly CssRule[], dark: boolean): Record<string, string> {
  const values: Record<string, string> = {}
  for (const rule of rules) {
    const inDark = rule.media.some((query) => query.includes('prefers-color-scheme: dark'))
    if (inDark && !dark) continue
    for (const [, name, hex] of rule.body.matchAll(/(--cf-[a-z-]+)\s*:[^;]*?(#[0-9a-f]{6})/gu)) {
      if (name !== undefined && hex !== undefined) values[name] = hex
    }
  }
  return values
}

/** Properties whose colour is a boundary rather than text (SC 1.4.11). */
const NON_TEXT_PROPERTIES = ['border', 'border-block-end', 'outline'] as const

/** One pair of colours the stylesheet puts together, and the ratio it needs. */
interface ContrastPair {
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
function contrastPairs(css: string): ContrastPair[] {
  const rules = rulesOf(css)
  const pairs: ContrastPair[] = []
  for (const scheme of ['light', 'dark'] as const) {
    const tokens = tokensOf(rules, scheme === 'dark')
    const surface = tokens['--cf-bg']
    for (const rule of rules) {
      const background = tokens[tokenIn(declaration(rule.body, 'background')) ?? '--cf-bg'] ?? surface
      if (background === undefined) continue
      const add = (token: string | undefined, minimum: number, kind: string): void => {
        const colour = token === undefined ? undefined : tokens[token]
        if (colour === undefined) return
        pairs.push({
          where: `${rule.selector} [${scheme}] ${kind} ${colour} on ${background}`,
          ratio: contrastRatio(colour, background),
          minimum,
        })
      }
      add(tokenIn(declaration(rule.body, 'color')), 4.5, 'text')
      for (const property of NON_TEXT_PROPERTIES) {
        add(tokenIn(declaration(rule.body, property)), 3, property)
      }
    }
  }
  return pairs
}

describe('every colour pair the stylesheet ships clears its ratio', () => {
  // The analyzer is proven on snippets before it is trusted on the stylesheet.
  const PROBE = [
    ':root { --cf-bg: #ffffff; --cf-fg: #000000; --cf-border: #b9bdc4 }',
    '@media (prefers-color-scheme: dark) { :root { --cf-bg: #000000; --cf-fg: #ffffff } }',
    '.a { color: var(--cf-fg) }',
    '.b { border: 1px solid var(--cf-border) }',
  ].join('\n')

  it('reads a token through its var reference and pairs it with the surface', () => {
    expect(contrastPairs(PROBE).filter((pair) => pair.where.startsWith('.a'))).toEqual([
      { where: '.a [light] text #000000 on #ffffff', ratio: 21, minimum: 4.5 },
      { where: '.a [dark] text #ffffff on #000000', ratio: 21, minimum: 4.5 },
    ])
  })

  it('holds a border to 3:1 and finds one that misses it', () => {
    const border = contrastPairs(PROBE).filter((pair) => pair.where.startsWith('.b'))
    expect(border.map((pair) => pair.minimum)).toEqual([3, 3])
    expect(border.filter((pair) => pair.ratio < pair.minimum).map((pair) => pair.where)).toEqual([
      '.b [light] border #b9bdc4 on #ffffff',
    ])
  })

  it('takes a rule’s own background over the surface', () => {
    const css =
      ':root { --cf-bg: #ffffff; --cf-accent: #0b5cab }\n.c { color: var(--cf-bg); background: var(--cf-accent) }'
    expect(contrastPairs(css).map((pair) => pair.where)).toEqual([
      '.c [light] text #ffffff on #0b5cab',
      '.c [dark] text #ffffff on #0b5cab',
    ])
  })

  it('puts no colour beneath the ratio its use requires', () => {
    const pairs = contrastPairs(read('packages/client/src/cloudflare.css'))
    // An empty parse would satisfy the assertion below without checking a
    // thing, so the count is asserted first.
    expect(pairs.length).toBeGreaterThan(20)
    expect(
      pairs
        .filter((pair) => pair.ratio < pair.minimum)
        .map((pair) => `${pair.where} = ${pair.ratio.toFixed(2)}, needs ${pair.minimum}`),
    ).toEqual([])
  })
})

describe('accessibility cannot be filtered', () => {
  it.each([
    ['tag scope', `with${'Tags('}`],
    ['rule narrowing', `with${'Rules('}`],
    ['rule disabling', `disable${'Rules('}`],
    ['inline rule overrides', `rul${'es: {'}`],
    // The five above were the only ones listed, and none of them is how axe is
    // actually narrowed: one option scopes a run to a weaker conformance
    // target, another throws away everything the assertion reads, two builder
    // methods do by configuration what the banned calls do by name, and the
    // reconfiguration entry point disables rules through an array, which the
    // object needle above does not match. Each needle is assembled, since this
    // file is itself scanned.
    ['conformance scoping', `run${'Only'}`],
    ['result narrowing', `result${'Types'}`],
    ['rule reconfiguration', `axe.con${'figure'}`],
    ['array rule overrides', `rul${'es: ['}`],
  ])('no %s is used in any test', (_label, needle) => {
    expect(containing(tests, needle)).toEqual([])
  })

  // The builder's scoping methods, matched as calls on a receiver. A bare
  // substring cannot tell a method call on the builder from a spread of a
  // local fixture that happens to share the name, and the difference is a
  // false failure on a test that has nothing to do with axe.
  it.each([
    ['selector exclusion', `exc${'lude'}`],
    ['selector scoping', `inc${'lude'}`],
    ['builder options', `opt${'ions'}`],
  ])('calls no %s method on an axe builder', (_label, method) => {
    expect(matching(tests, new RegExp(`[\\w)\\]]\\.${method}\\(`, 'u'))).toEqual([])
  })

  it('scans every surface with the whole rule set', () => {
    expect(read('packages/client/tests/a11y.browser.test.tsx')).toContain(
      'new AxeBuilder({ page }).analyze()',
    )
  })

  it('gives the jsdom helper no way to take options, since that is where a filter would hide', () => {
    // The helper's own comment says an options parameter is where a rule
    // disable would sit. A comment is not a gate: the call is pinned to its
    // single argument, and the wrapper to its single parameter.
    const helper = read('packages/client/tests/axe.ts')
    expect(helper).toContain('axe.run(container)')
    expect(helper).toContain('async function runAxe(container: Element): Promise<AxeResults>')
  })

  it.each([
    // Each of these was absent while the lane's own doc claimed it, or while
    // the gate read only the outcome that happened to be empty.
    ['scans the client as a host assembles it', 'const ASSEMBLED = renderToStaticMarkup('],
    ['fails on what axe leaves for review, not only on what it fails', 'results.incomplete'],
    ['walks the page by keyboard', `keyboard.press('Tab')`],
    ['reads the focus ring the stylesheet declares', 'computed.outlineStyle'],
  ])('%s', (_label, needle) => {
    expect(read('packages/client/tests/a11y.browser.test.tsx')).toContain(needle)
  })

  it('runs the browser lane rather than leaving those tests unrun', () => {
    expect(read('vitest.a11y.config.ts')).toContain("include: ['packages/*/tests/**/*.browser.test.tsx']")
    expect(read('.github/workflows/ci.yml')).toContain('bun run test:a11y')
  })
})

/** Source modules whose text matches a capability pattern, in path order. */
const usersOf = (pattern: RegExp): string[] => sources.filter((file) => pattern.test(read(file))).toSorted()

describe('the pure/impure split holds', () => {
  // Three rules the README states about purity, none of which anything checked
  // until now: presenters replay from a session log, so a clock or a random
  // number in one makes a replay differ from the run it replays; and the
  // network is confined to the modules that are supposed to reach it.
  it('reads a clock in no source module at all', () => {
    expect(usersOf(/\bDate\.now\b|\bnew Date\b|\bperformance\.now\b/)).toEqual([])
  })

  it('takes randomness only where retry jitter is injected from', () => {
    expect(usersOf(/\bMath\.random\b/)).toEqual(['packages/core/src/service.ts'])
  })

  it('reaches the network from these modules and no others', () => {
    // `client.ts` and `adapter.ts` dispatch; the two plugin entries do nothing
    // with it but hand the global in as the default dependency. A fifth module
    // naming `fetch` is a new I/O site, which is what this is here to notice.
    expect(usersOf(/\bfetch\s*\(/)).toEqual([
      'packages/bundle/src/ai/adapter.ts',
      'packages/bundle/src/ai/index.ts',
      'packages/core/src/client.ts',
      'packages/core/src/index.ts',
    ])
  })
})

describe('CI reports on every commit it runs for', () => {
  // `cancel-in-progress: true` cancels the previous run in the group. On a pull
  // request the superseded run is noise; on the default branch it is a commit
  // whose gates never finished, which reads as a failed pipeline and proves
  // nothing about the tree that was merged.
  it('cancels a superseded run only on a pull request', () => {
    expect(read('.github/workflows/ci.yml')).toContain(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    )
  })
})

describe('every gate runs in CI', () => {
  it.each([
    'bun run typecheck',
    'bun run lint',
    'bun run format:check',
    'bun run test:coverage',
    'bun run test:invariants',
    'bun run test:dist',
    'bun run test:a11y',
    'bun run stryker',
    'bun run knip',
    'bun run publint',
  ])('%s', (command) => {
    expect(read('.github/workflows/ci.yml')).toContain(command)
  })

  /** One job's block, from its name to the next job at the same indent. */
  const ciJob = (name: string): string => {
    const workflow = read('.github/workflows/ci.yml')
    const start = workflow.indexOf(`\n  ${name}:\n`)
    expect(start).toBeGreaterThan(-1)
    const rest = workflow.slice(start + 1)
    const next = rest.slice(1).search(/\n {2}\w[\w-]*:\n/u)
    return next === -1 ? rest : rest.slice(0, next + 1)
  }

  // README states which lanes run on which Node majors. Asserting the command
  // strings alone leaves that sentence unheld: deleting '24' from a matrix
  // changes what CI proves and nothing goes red.
  it.each([
    ['check', "node: ['22', '24']"],
    ['package', "node: ['22', '24']"],
  ])('runs the %s lane on both supported Node majors', (job, matrix) => {
    expect(ciJob(job)).toContain(matrix)
  })

  it.each([
    ['accessibility', "node-version: '22'"],
    ['mutation', "node-version: '22'"],
  ])('pins the %s lane to one Node major, as the page states', (job, version) => {
    const block = ciJob(job)
    expect(block).toContain(version)
    expect(block).not.toContain('matrix.node')
  })
})
