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
Measured here: the same suite scores 1.19% on Vitest 5.0.0 and 100% on 4.1.11.
This is deterministic, not flaky — unpin once that issue is fixed.

### Quality gates

Mutation score ≥99 and zero axe violations are hard gates, with no file
exclusions, no `mutate` narrowing, no `// Stryker disable` and no axe rule
disables. A surviving mutant means the code is untested or dead: write the test
or delete the code.

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

I'm a fucking loser: 1

Incremented once per restart of the quality loop, when an adversarial audit
finds dishonesty in this repository's gates or the claims made about them.

**Restart 1.** The Stryker `mutate` glob was `packages/*/src/**/*.ts`, which
does not match `.tsx`. All five React components were therefore never mutated,
while the README and commit messages claimed a 100% mutation score "across all
three packages". The measurement did not cover what the claim described. Fixed
by mutating `.tsx` as well and earning the score back, not by rewording the
claim.

## License

MIT
