/**
 * The trees the gates scan.
 *
 * Each list is one filter over the tracked tree, derived once. `base.ts` used
 * to carry a `testFiles` list while `support.ts` carried the same list under
 * the name `tests` — the same predicate, computed twice, named twice — so a
 * gate could scan a tree its neighbour could not see. Every derived list now
 * has exactly one home and one name.
 */
import { tracked } from './base.ts'

/** Code files: every tracked file a scanner could mean. */
export const code = tracked.filter((file) => /\.(ts|tsx|mjs|cjs|js|json|ya?ml)$/.test(file))

/**
 * Every file under a tests directory, not only `*.test.ts`.
 *
 * A helper is exactly where an evasion would hide: a shared harness or an axe
 * module with a rule-disabling default is invisible to a scan that only looks
 * at files whose name ends in `.test.ts`.
 */
export const testFiles = code.filter((file) => /(^|\/)tests\//.test(file))

/** Every published source module of the packages. */
export const sources = code.filter((file) => /^packages\/[^/]+\/src\//.test(file))

/**
 * Every component the client package ships: the `.tsx` files under its `src`.
 *
 * The components are what a claim about the client's markup is a claim about,
 * so the two gates that hold one — no inline copy, and no size the stylesheet
 * does not own — read the same list rather than each deciding what a component
 * is.
 */
export const clientComponents = sources.filter(
  (file) => file.startsWith('packages/client/src/') && file.endsWith('.tsx'),
)

/**
 * Every TypeScript module in the tree, not only those under `src` and `tests`.
 *
 * The gate configuration is itself TypeScript — the vitest configs, the tsdown
 * configs and the mutation-guard scripts — so a scan that stops at the package
 * directories cannot see the files that decide what the other gates do. One
 * escaped exactly there: a superseded doc block sat in `vitest.a11y.config.ts`
 * while a suite reported the tree clean.
 */
export const modules = code.filter((file) => /\.tsx?$/.test(file))

/**
 * Every Markdown page git tracks or would track: a page added but not yet
 * staged is part of the tree CI will see, so it is part of the tree the
 * diagram gates see. Ignored files stay out.
 */
export const markdown = tracked.filter((file) => file.endsWith('.md'))
