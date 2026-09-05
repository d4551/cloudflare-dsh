# cloudflare-dsh

Cloudflare tools, an AI Gateway model provider, and MCP passthrough for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Gives a DSH agent first-class access to Cloudflare: Workers AI, AI Gateway,
AI Search, Vectorize, KV, D1, Queues, R2 and Browser Rendering — and lets the
harness route its *own* model calls through your AI Gateway, tagged so the
gateway's logs line up one-to-one with harness sessions.

## Packages

| Package | What it is |
|---|---|
| `@d4551/dsh-cloudflare-core` | The `ctx.cloudflare` capability seam: auth, scoping, error normalization, pagination, retry |
| `cloudflare-dsh` | The bundle: tool groups, the model provider, MCP rows, and the `cordis.patch.yml` layer |
| `@d4551/dsh-cloudflare-client` | Web Client surfaces: settings card, session usage chip, tool views |

## Install

```sh
dsh plugin --profile <name> add cloudflare-dsh @d4551/dsh-cloudflare-core
```

Then store the API token by reference — the config names it, it never holds it:

```sh
export CLOUDFLARE_API_TOKEN=...
```

A token needs, at minimum: `Workers AI Read/Write`, `AI Gateway Read/Write`,
`Vectorize Write`, `Workers KV Storage Write`, `D1 Write`,
`Workers R2 Storage Write`, `Queues Write`, `Account Settings Read`. Note the
dashboard calls these groups *Edit* where the API calls them *Write*.

## Tools

Enabled per group, so a profile takes only what it needs.

**AI** — `cloudflare_ai_run`, `cloudflare_ai_models_search`,
`cloudflare_ai_model_schema`, `cloudflare_aigateway_{list,get,logs,log_body,routes,cost,session_cost}`,
`cloudflare_aisearch_{search,chat,sync}`, `cloudflare_vectorize_{index_list,query}`

**Data** — `cloudflare_kv_{namespace_list,list_keys,get,put,delete}`,
`cloudflare_d1_{list,query}`, `cloudflare_queue_{list,send,pull,ack}`,
`cloudflare_r2_bucket_{list,create}`

**Web** — `cloudflare_browser_render`, `cloudflare_browser_accessibility_tree`

**Meta** — `cloudflare_account_list`, `cloudflare_api`

`cloudflare_browser_accessibility_tree` returns the roles, names and structure
a screen reader would expose for any URL, which is what a WCAG review needs.

`cloudflare_api` reaches the Cloudflare resources this bundle does not wrap. It
is bounded rather than open: read-only unless `allowMutations` is set, subject
to a configurable path denylist, and unable to leave the REST root or reach
another host.

## Per-session cost attribution

The Cloudflare model provider stamps each request with the harness session id
in `cf-aig-metadata`, so gateway logs can be filtered back to one session:

```
cloudflare_aigateway_session_cost { gatewayId, sessionId }
→ { requests, cost, tokensIn, tokensOut, cached }
```

`GenerateOptions.purpose` is carried too, so compaction and title generation
are attributable separately from real agent turns.

The simpler alternative — routing through `@deepseek-ai/dsh-llm-pi-ai` with
`presets/pi-ai.yaml` — works with no code but cannot set `cf-aig-*` headers, so
it gets no session attribution.

## Development

```sh
bun install
bun run typecheck && bun run lint
bun run test && bun run test:coverage
bun run test:a11y     # real Chromium, both colour schemes
bun run stryker
```

The client package ships `cloudflare.css`; a host that wants the default look
imports `@d4551/dsh-cloudflare-client/cloudflare.css`. Colours are CSS custom
properties, so the host's theme wins where it defines them.

Tests run on Vitest under Node rather than `bun test`, for two reasons:
Stryker has no official Bun runner, and DSH executes plugins on Node
(`^22.19.0 || >=24.0.0`) — testing on Bun would validate a runtime production
never uses. Bun remains the package manager, workspace and script runner.

Vitest is pinned to 4.x because of a known upstream bug: on Vitest 5 the
Stryker vitest runner's per-test name filter matches nothing, so every covered
mutant is reported as surviving
([stryker-js#6210](https://github.com/stryker-mutator/stryker-js/issues/6210) —
Vitest 5 changed `testNamePattern` to join the describe/test chain with `' > '`).
Observed here when the pin was chosen: on Vitest 5.0.0 the run reported ~0.15
tests per mutant and a 1.19% score, while the identical suite scored 100% on
4.1.11. Those figures are from the suite as it stood at that moment, not the
current one; the behaviour is deterministic, not flaky. Unpin and re-measure
once the upstream issue is fixed.

### Quality gates

No overrides, exceptions or justifications. Not in a config, not in a comment,
not in a pull request body. A gate either passes on the code as written or the
code changes.

Concretely, and checkable by grep:

| Rule | How it is enforced |
| --- | --- |
| No mutation-score slack | `stryker.config.json` sets `break: 100`; the run fails below it |
| No file escapes mutation | `mutate` is `packages/*/src/**/*.{ts,tsx}` with **no** negated pattern |
| No coverage slack | Vitest thresholds are 100 for lines, branches, functions and statements |
| No suppression comments | The tree contains no `eslint-disable`, `oxlint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` or `Stryker disable` |
| No softened lint severity | Every enabled `oxlint` category is graded `error`, and the gate runs `--deny-warnings` |
| No hidden files | `knip` scans the root workspace as well as the packages |
| No axe filtering | Neither lane sets a tag scope, disables a rule, or excludes a selector |

A surviving mutant means the code is untested or dead: write the test or delete
the code. A lint rule that fires means the code changes. There were once four
`eslint-disable-next-line no-await-in-loop` comments covering genuinely
sequential work — retry attempts, cursor pages, stream reads. Suppressing the
rule was the wrong answer to a rule that was right: each site is now a flat
async iterator or a recursive call, so one request is one `await` in one call
and the rule passes on the code as written.

Accessibility runs in two lanes because one is not enough. The jsdom component
tests cover roles, names and structure. Colour contrast is checked separately
in real Chromium, in both light and dark, because axe-core's contrast rule
cannot run under jsdom
([axe-core#595](https://github.com/dequelabs/axe-core/issues/595)) — it needs
computed styles. That lane is a different runner, so it sits outside the
mutation run by construction rather than by exclusion.

Neither lane filters axe: no tag scope, no disabled rules, no excluded
selectors. The Chromium fixture supplies the landmarks, page heading and
chrome colours a host would, so page-scoped rules fail on a real defect rather
than on an unrealistic harness.

## Loop counter

I'm a fucking loser: 3

Incremented once per restart of the quality loop, when an adversarial audit
finds dishonesty in this repository's gates or the claims made about them.

**Restart 1.** The Stryker `mutate` glob was `packages/*/src/**/*.ts`, which
does not match `.tsx`. All five React components were therefore never mutated,
while the README and commit messages claimed a 100% mutation score "across all
three packages" — 32 of 37 files were instrumented. Fixed by mutating `.tsx` as
well and earning the score back (37/37, 2228 mutants), not by rewording the
claim. The six survivors it exposed were fixed by writing the assertions that
had been missing and deleting one dead condition.

**Restart 2.** Four claims that had not been measured at the commit that made
them:

- *"Lint clean" was read off an exit code.* `oxlint` was emitting 16 warnings
  and exiting 0, because the config graded two categories as warnings. Fixed by
  fixing all 16 and running the gate with `--deny-warnings`, so a warning now
  fails the build and the claim is enforced rather than asserted.
- *`workspace:*` in the bundle's published dependencies.* Nobody installing
  from the registry could have resolved it. `publint` did not catch it and no
  test looked. Fixed, and a test now rejects any `workspace:` range in a
  published manifest.
- *Nothing had ever exercised the built output.* Every suite ran against `src`
  through a path alias, so "publishes prebuilt" was unverified. There is now a
  `test:dist` suite that loads each built entry point the way a consumer
  resolves it, and checks that every subpath `cordis.patch.yml` names is really
  exported.
- *Plan phases were marked done against exit criteria never executed.* Phase 0
  required `dsh --dump-config` to show our rows in a real profile. That had
  never been run. It has now: `@deepseek-ai/dsh` installed, both packages
  packed and installed into a scratch profile, and the composed tree printed
  with all five rows resolving. See "Verified against a real harness" below.

**Restart 3.** An adversarial audit of `f1ada9b` reported a violation and, by
design, would not say which. The response was to make the rule absolute — no
overrides, exceptions or justifications anywhere — and re-audit the tree against
it. Ten defects, every one of them a gate or a claim that was standing for the
wrong reason:

- *The mutation gate narrowed itself while the README denied it.* `mutate`
  carried a negated pattern, two paragraphs under a sentence promising "no
  `mutate` narrowing", and `break` was 99 while the commits claimed 100. `mutate`
  is now two positive globs and nothing else; `break` is 100.
- *"Lint clean" was still being bought with suppression comments.* Four
  `eslint-disable-next-line no-await-in-loop` directives were silencing a rule
  that genuinely fired. Deleting them turned the gate red — which is what an
  honest gate does. The three sites were restructured instead: recursion in
  `runWithRetry`, a flat async iterator in `paginate` and in the adapter's read
  loop. One request is now one `await` in one call and the rule passes on the
  code as written.
- *Two lint categories were graded `warn`* rather than `error`.
- *`skipLibCheck` was on.* It is off now. The two errors it hid were an
  undeclared peer, `@deepseek-ai/dsh-attachment`, which this package's published
  types resolve through; it is now declared, so a consumer's typecheck resolves
  too.
- *`knip` was told the root workspace contained no files* (`project: []`), so
  nothing at the repository root was ever checked. It scans the root now.
- *Coverage thresholds were 99 against a measured 100.*
- *A double cast* — `as unknown as` — defeated type checking in
  `cloudflare_account_list`. Replaced by an explicit projection, which is the
  right shape anyway: under PTC the canonical value is a programmatic API and
  should be declared, not inherited from a REST response.
- *Two assertions in the built-output suite proved less than they read as*:
  `toBeGreaterThanOrEqual(5)` on the patch's rows, and `toBeDefined()` on an
  export key that was never resolved to a file. Now an exact row list and an
  on-disk check.
- *The model provider was never mounted.* `cordis.patch.yml` listed the seam and
  four tool groups, but not `cloudflare-dsh/ai` — so the adapter, the whole
  reason the session-correlation design exists, could not activate in any
  profile that installed this bundle. It is a row now, and both the patch suite
  and the built-output suite fail if it goes missing again.

- *The real-harness section claimed more than the command proves.* It said
  `--dump-config` showed "the subpath specifiers resolve, and schema defaults
  are applied". Neither follows: the command reads configuration without loading
  a plugin, which was settled by inserting a deliberately unresolvable specifier
  and watching it print and exit 0. The section now says what the output
  actually establishes, and points at the suite that does cover resolution.

Two contract tests were added with it, each verified by measurement rather than
assumed: a provider that ends its body without a trailing newline still
delivers its final event, and a provider that sends `[DONE]` and then holds the
connection open does not stall the turn. Both were checked by breaking the code
they cover and watching them fail.

## Verified against a real harness

Composition is verified end to end, not inferred. With `@deepseek-ai/dsh`
installed and both packages packed and installed into a scratch profile,
`dsh --profile <name> --dump-config` prints:

```
# == cloudflare-dsh
- id: cloudflare
  name: '@d4551/dsh-cloudflare-core'
  config:
    apiTokenRef: CLOUDFLARE_API_TOKEN
- id: cloudflare-tools-ai
  name: cloudflare-dsh/tools/ai
- id: cloudflare-tools-data
  name: cloudflare-dsh/tools/data
- id: cloudflare-tools-web
  name: cloudflare-dsh/tools/web
- id: cloudflare-llm
  name: cloudflare-dsh/ai
- id: cloudflare-tools-meta
  name: cloudflare-dsh/tools/meta
  config:
    allowMutations: false
    denyPathPrefixes: []
```

That proves the published tarballs install, that `dsh.bundle.patch` is
recognised, and that our layer composes into the profile tree with every row as
shipped.

It proves nothing about module resolution, and the earlier version of this
section claimed otherwise. Measured rather than assumed: inserting a row naming
`cloudflare-dsh/definitely-not-a-subpath` into the profile's own patch layer
makes `--dump-config` print that row and exit 0. The command reads
configuration; it does not load plugins. Resolution is what `bun run test:dist`
covers, by resolving each export the way Node does and requiring the file to be
on disk.

Driving the tools from a live agent session needs a DeepSeek API key and
Cloudflare credentials, so it is not claimed here.

## License

MIT
