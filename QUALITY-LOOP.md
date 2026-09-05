# Quality loop record

Development history for this repository: the adversarial audit loop, what it
found, and how each finding was fixed at its root. This is a working record
for contributors. Nothing here is needed to use the packages — start from
[README.md](README.md).

This project runs an adversarial audit against its own gates. When the audit
finds a gate passing for the wrong reason, the loop restarts, the counter goes
up, and the defect is fixed at its root rather than reworded.

**I'm a fucking loser: 4**

<details>
<summary><strong>Restart 1 — the mutation glob matched less than the claim</strong></summary>

The Stryker `mutate` glob was `packages/*/src/**/*.ts`, which does not match
`.tsx`. All five React components were therefore never mutated, while the README
and commit messages claimed a 100% mutation score "across all three packages" —
32 of 37 files were instrumented.

Fixed by mutating `.tsx` as well and earning the score back, not by rewording
the claim. The six survivors it exposed were fixed by writing the assertions
that had been missing and deleting one dead condition.

</details>

<details>
<summary><strong>Restart 2 — four claims that had not been measured</strong></summary>

- **"Lint clean" was read off an exit code.** `oxlint` was emitting 16 warnings
  and exiting 0, because the config graded two categories as warnings. Fixed by
  fixing all 16 and running the gate with `--deny-warnings`.
- **`workspace:*` in the bundle's published dependencies.** Nobody installing
  from the registry could have resolved it. `publint` did not catch it and no
  test looked. A test now rejects any `workspace:` range in a published
  manifest.
- **Nothing had ever exercised the built output.** Every suite ran against `src`
  through a path alias, so "publishes prebuilt" was unverified. `test:dist` now
  loads each built entry point the way a consumer resolves it.
- **Plan phases were marked done against exit criteria never executed.** Phase 0
  required `dsh --dump-config` to show our rows in a real profile. That had never
  been run. It has now.

</details>

<details>
<summary><strong>Restart 3 — eleven defects, and the rule made absolute</strong></summary>

An adversarial audit reported a violation and, by design, would not say which.
The response was to make the rule absolute — no overrides, exceptions or
justifications anywhere — and re-audit the tree against it.

1. **The mutation gate narrowed itself while the README denied it.** `mutate`
   carried a negated pattern two paragraphs under a sentence promising no
   `mutate` narrowing, and `break` was 99 while commits claimed 100.
2. **"Lint clean" was still being bought with suppression comments.** Four
   `eslint-disable-next-line no-await-in-loop` directives silenced a rule that
   genuinely fired. Deleting them turned the gate red, which is what an honest
   gate does. The three sites were restructured instead — recursion in
   `runWithRetry`, a flat async iterator in `paginate` and in the adapter's read
   loop — so one request is one `await` in one call.
3. **Two lint categories were graded `warn`** rather than `error`.
4. **`skipLibCheck` was on.** The errors it hid were an undeclared peer,
   `@deepseek-ai/dsh-attachment`, which this package's published types resolve
   through. Now declared, so a consumer's typecheck resolves too.
5. **`knip` was told the root workspace held no files** (`project: []`), so
   nothing at the repository root was ever checked.
6. **Coverage thresholds were 99 against a measured 100.**
7. **A double cast** (`as unknown as`) defeated type checking in
   `cloudflare_account_list`. Replaced with an explicit projection, which is the
   right shape anyway: under PTC the canonical value is a programmatic API.
8. **Two assertions in the built-output suite proved less than they read as** —
   `toBeGreaterThanOrEqual(5)` on the patch's rows, and `toBeDefined()` on an
   export key that was never resolved to a file.
9. **The model provider was never mounted.** `cordis.patch.yml` listed the seam
   and four tool groups but not `cloudflare-dsh/ai`, so the adapter — the whole
   reason the session-correlation design exists — could not activate in any
   profile that installed the bundle.
10. **The real-harness section claimed more than the command proves.** It said
    `--dump-config` showed that specifiers resolve and defaults apply. Neither
    follows, which was settled by inserting a deliberately unresolvable
    specifier and watching it print and exit 0.
11. **A `const` assertion was hiding a whole file from mutation.**
    `locales/en.ts` ended in `} as const`, and Stryker does not mutate inside a
    const assertion — so the file produced zero mutants and was omitted from the
    report entirely. Removing the assertion exposed 47 mutants, **ten of them
    surviving**: user-facing copy nothing asserted. The cause was
    self-referential assertions — tests compared rendered output against the
    same dictionary entry that produced it. Those assertions now pin the literal
    copy, every `as const` in `src` is gone, and
    `scripts/verify-mutation-files.mjs` makes the escape impossible to repeat
    silently.

</details>

<details>
<summary><strong>Restart 4 — rules that nothing enforced</strong></summary>

The audit found a violation and, by design, would not say which. It did say
what class it belonged to: not a red gate, but "a claim standing for the wrong
reason", and that the remedy is that *a claim not enforced by something that
fails gets deleted or gets enforcement*.

Applying that test to this repository's own quality section produced an
uncomfortable answer. Nine of its eleven rules were enforced by nothing at all.
"No suppression comments", "no skipped tests", "no axe filtering", "no softened
lint severity", "no skipped type checking", "no hidden files" — every one of
those was a sentence in a document. Adding an `eslint-disable`, a `.skip`, a
`disableRules`, or flipping `skipLibCheck` back on would have kept every gate
green and every badge accurate-looking. The two rules that *were* enforced
(the mutation threshold and the file-escape guard) had only become so during
the previous two restarts, each time after the unenforced version had already
failed.

One further claim was simply false: the Restart 1 entry said the fix reached
"37/37" instrumented files. It did not — `locales/en.ts` was still escaping
behind a const assertion, which is what Restart 3 eventually found. The number
was reported from a tool output that omitted the escaped file, which is exactly
how the escape stayed invisible.

Fixed by writing `tests/invariants.test.ts`, a lane of its own that runs in CI
and asserts every rule the section states: the Stryker globs and threshold, the
guard being wired into the script, no const assertion under `src`, the coverage
thresholds, the absence of every suppression and evasion form in tracked code,
the lint severities and `--deny-warnings`, the four strictness options, knip's
root scope, the absence of every axe-weakening API alongside a positive
assertion that the unfiltered scan is the one that runs, and the presence of
every gate command in the workflow.

Each assertion was then verified the only way an assertion can be: by breaking
the thing it guards and watching the suite go red. Eight softenings were applied
one at a time — threshold to 99, `skipLibCheck` on, a category downgraded to
`warn`, knip's root scope narrowed, a suppression comment added to a source
file, a const assertion added to a source file, the mutation step deleted from
CI, `--deny-warnings` dropped — and each produced a failing test before the tree
was restored.

The needles the suite scans for are assembled from string fragments, so the file
does not contain the text it forbids and needs no exemption for itself.

</details>

---
