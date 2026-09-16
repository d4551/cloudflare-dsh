/**
 * The patterns this stack has moved past, as a gate.
 *
 * Each rule below is a way of writing something this repository already writes
 * differently: React 19 removed or deprecated the first group, and the last
 * group is how a source tree is told to check less than it should. They are
 * banned by name rather than by habit because each one compiles, each one looks
 * right in review, and each one changes behaviour this package's lanes measure.
 * Every rule is proven on a snippet that violates it here, and held against the
 * tree below that.
 */
import { describe, expect, it } from 'vitest'
import { json, read, tracked } from './base.ts'
import { codeUses } from './scanners.ts'
import { sources } from './support.ts'

/** One pattern the stack has moved past, with a snippet that uses it. */
interface LegacyPattern {
  readonly label: string
  readonly pattern: RegExp
  readonly sample: string
}

/**
 * The React patterns this client must not use.
 *
 * `renderToString` is the synchronous renderer React 19 replaced with
 * `renderToStaticMarkup` and `renderToReadableStream`, both of which this tree
 * uses. `defaultProps` and `propTypes` no longer do anything to a function
 * component, so both would read as validation while validating nothing. A class
 * component's lifecycle does not run under a static render, which is how the
 * surfaces lane renders — the same component would then differ between the lane
 * and the browser. `forwardRef` is deprecated because React 19 passes `ref` as
 * an ordinary prop. `dangerouslySetInnerHTML` injects markup this package
 * receives from tools, which is the one sink that turns tool output into code.
 */
const LEGACY_REACT: readonly LegacyPattern[] = [
  { label: 'ReactDOM.render', pattern: /\bReactDOM\.render\s*\(/u, sample: 'ReactDOM.render(<b />, node)' },
  {
    label: 'renderToString',
    pattern: /\brenderToString\b/u,
    sample: "import { renderToString } from 'react-dom/server'",
  },
  { label: 'defaultProps', pattern: /\bdefaultProps\b/u, sample: 'Card.defaultProps = { size: 1 }' },
  { label: 'propTypes', pattern: /\bpropTypes\b/u, sample: 'Card.propTypes = { size: Number }' },
  {
    label: 'React.createElement',
    pattern: /\bReact\.createElement\s*\(/u,
    sample: "React.createElement('b')",
  },
  {
    label: 'a class component',
    pattern: /\bextends\s+(?:React\.)?(?:Component|PureComponent)\b/u,
    sample: 'class Card extends Component {}\nclass Panel extends React.Component {}',
  },
  {
    label: 'forwardRef',
    pattern: /\bforwardRef\s*\(/u,
    sample: 'const Card = forwardRef((p, ref) => <b ref={ref} />)',
  },
  {
    label: 'dangerouslySetInnerHTML',
    pattern: /\bdangerouslySetInnerHTML\b/u,
    sample: 'const A = () => <b dangerouslySetInnerHTML={{ __html: tool }} />',
  },
]

/** The compiler options a source tree has outgrown. */
type ForbiddenOption = 'skipLibCheck' | 'allowJs' | 'preserveSymlinks'

const FORBIDDEN_OPTIONS: readonly ForbiddenOption[] = ['skipLibCheck', 'allowJs', 'preserveSymlinks']

/** One tsconfig, as much of it as this gate reads. */
interface TsConfigFile {
  readonly extends?: string
  readonly compilerOptions?: {
    readonly skipLibCheck?: boolean
    readonly allowJs?: boolean
    readonly preserveSymlinks?: boolean
    readonly paths?: Readonly<Record<string, readonly string[]>>
  }
}

/**
 * Whether a `paths` target climbs out of the repository.
 *
 * The target resolves against the file's own directory, so a target climbing
 * further than that directory is deep leaves the tree and resolves through
 * whatever the machine building it happens to have there. An absolute target is
 * outside the tree by the same reasoning.
 */
function escapesRepository(config: string, target: string): boolean {
  if (target.startsWith('/')) return true
  const depth = config.split('/').length - 1
  let climbs = 0
  for (const segment of target.split('/')) {
    if (segment === '..') climbs += 1
    else if (segment !== '.' && segment !== '') break
  }
  return climbs > depth
}

/**
 * The banned options one tsconfig sets.
 *
 * `skipLibCheck` is the one that matters most here: it is already pinned off in
 * `tsconfig.base.json`, and a package that set it back on would check its own
 * files against declarations nobody read.
 */
function forbiddenOptions(file: string, config: TsConfigFile): string[] {
  const options = config.compilerOptions
  if (options === undefined) return []
  const found: string[] = []
  for (const name of FORBIDDEN_OPTIONS) {
    if (options[name] === true) found.push(`${file} sets ${name} to true`)
  }
  for (const [alias, targets] of Object.entries(options.paths ?? {})) {
    for (const target of targets) {
      if (escapesRepository(file, target)) found.push(`${file} maps ${alias} to ${target}, outside the tree`)
    }
  }
  return found
}

/** Every tsconfig git tracks, the root and the base among them. */
const TSCONFIGS = tracked.filter((file) => /(^|\/)tsconfig[^/]*\.json$/u.test(file))

describe('the React patterns React 19 moved past', () => {
  it('names each one where a module uses it', () => {
    // One labelled expectation per pattern, so a failure names the rule that
    // stopped matching rather than the loop it sits in.
    for (const { label, pattern, sample } of LEGACY_REACT) {
      expect(codeUses('probe.tsx', sample, pattern), label).not.toEqual([])
    }
  })

  it('leaves each one alone where a module only writes about it', () => {
    // The same text, commented out: a rule that matched its own name in prose
    // would fail a module for explaining why it avoids the pattern.
    for (const { label, pattern, sample } of LEGACY_REACT) {
      expect(codeUses('probe.tsx', `// ${sample}`, pattern), label).toEqual([])
    }
  })

  it('finds none of them in any source module', () => {
    for (const { label, pattern } of LEGACY_REACT) {
      expect(
        sources.flatMap((file) => codeUses(file, read(file), pattern)),
        label,
      ).toEqual([])
    }
  })
})

describe('the compiler options this tree does not set', () => {
  it('reads the configuration this gate holds', () => {
    // Both ends of the inheritance chain: a gate that read neither would hold
    // nothing, and one that read only the base could not see an override.
    expect(TSCONFIGS).toContain('tsconfig.base.json')
    expect(TSCONFIGS).toContain('tsconfig.json')
  })

  it.each([
    ['a skipped library check', 'tsconfig.json', { skipLibCheck: true }],
    ['JavaScript that nothing type-checks', 'tsconfig.json', { allowJs: true }],
    ['resolution that depends on how the checkout was made', 'tsconfig.json', { preserveSymlinks: true }],
  ])('names %s', (_label, file, compilerOptions) => {
    expect(forbiddenOptions(file, { compilerOptions })).toHaveLength(1)
  })

  it.each([
    ['climbs out of the tree', 'tsconfig.json', '../outside'],
    ['is absolute', 'tsconfig.json', '/usr/lib/types'],
    ['climbs further than the file is deep', 'packages/client/tsconfig.json', '../../../elsewhere'],
  ])('names a paths entry that %s', (_label, file, target) => {
    expect(forbiddenOptions(file, { compilerOptions: { paths: { '@x': [target] } } })).toEqual([
      `${file} maps @x to ${target}, outside the tree`,
    ])
  })

  it('leaves a paths entry that stays inside, however far up it climbs', () => {
    // A package's own config may reach a directory up and still be inside the
    // repository; the depth of the file is what decides.
    expect(
      forbiddenOptions('packages/client/tsconfig.json', {
        compilerOptions: { paths: { '@core': ['../core/src/index.ts'] } },
      }),
    ).toEqual([])
  })

  it('sets none of them anywhere in the tree', () => {
    // `tsconfig.base.json` is pinned in `config.test.ts`; this reads every
    // config git tracks, so an override in a package is a failure rather than a
    // quieter check.
    for (const file of TSCONFIGS) {
      expect(forbiddenOptions(file, json<TsConfigFile>(file)), file).toEqual([])
    }
  })
})
