# Handoff: P3c/P3d (run-row eight states + generic Tool groups)

Written by the implementing agent when told to stop early (context budget). Worktree:
`/Users/superjj/ccproj/DSHscience/.claude/worktrees/p3cd-work`, branch `codex/claude-science-artifact-sidebar`.
This file is committed alongside the work; delete it once the remaining items below are closed out
(per `.agents/CLAUDE.md`, temporary handoff material does not belong in the repo long-term —
either fold any durable fact into the Agent Note/READMEs and remove this file, or keep it only
until the next session finishes the checklist).

## What shipped (implemented, tested, one commit — see below)

**P3c — `ScienceExecutionRow` eight states** (`packages/client/ui-science`):
- New `src/client/run-output.ts`: pure derivation — recovers stdout/stderr from `formatRunResult`'s
  fixed text markers, line/byte counting, `mm:ss`/`X.Xs` formatting.
- Rewritten `src/client/ScienceExecutionRow.tsx` + new `ScienceExecutionRow.module.css`: running
  (live elapsed + turn-level Stop wired to `ctx.conversation.cancel` via a new `inject` on the
  `run_python`/`run_r` toolview registrations in `index.ts`), success short/long/table/chart/truncated,
  failed, kernel-exited. Degrades to the pre-existing plain folded cell when the `science` projection
  has no matching run or the text doesn't carry the markers (proven not to disturb existing e2e goldens).
- New keys in `locales.ts` (`run.kernel`, `run.elapsed`, `run.succeeded`, `run.stdoutFold`,
  `run.stdoutTruncatedFold`, `run.truncatedNotice`, `run.failedStatus`, `run.fullTraceFold`,
  `run.kernelExited.*`, `run.interrupt`, `run.runningPlaceholder`).
- Tests: `tests/run-output.client.spec.ts` (new, 100% coverage), `tests/science-cells.client.spec.tsx`
  (rewritten "Science execution cells" describe block — all 8 states + both degrade paths + the
  defensive `interrupted`-status branch), `tests/plugin-registration.client.spec.ts` (new test for the
  injected `cancel` wiring). Deliberate per-file 100% coverage confirmed via
  `pnpm vitest run packages/client/ui-science --coverage --coverage.include=...` (see gates below).
- README.md/.zh.md rewritten "Execution cells" section + two new Known-Limitations bullets
  (running-state degraded summary; kernel-exited's `inspect` reuse). Pairing re-recorded.

**P3d — generic Tool groups** (`packages/client/ui-conversation`):
- New `src/client/chat/tool-group.ts`: `groupAdjacentToolNodes` (folds ≥2 adjacent `tool-call` Chat
  Node keys), `classifyToolCategory` (name-first, falls back to the declared render-intent `card`),
  `summarizeToolGroup` (title + step/failure counts from structured `isError`), `resolveGroupRoots`.
  No import of `ui-science` or any domain package.
- New `src/client/chat/ToolGroup.tsx` + `.module.css`: the group wrapper, open by default, nesting
  ordinary `<ChatNodeSeat>` per member unchanged — deliberately carries no `data-chat-anchor-key`/
  `data-chat-flow-key` of its own (see the Agent Note's "Alternatives considered" for why).
- `ChatView.tsx`: `order.map(...)` replaced with a `flowEntries` map (single vs group) computed via
  `useMemo` off the already-subscribed `order`/`nodeStore`.
- New locale keys in `ui-conversation`'s `locales.ts` (`group.category.*` ×6, `group.categorySeparator`,
  `group.steps`, `group.stepsFailed`, `group.collapse`, `group.expand`).
- Tests: new `tests/tool-group.client.spec.ts` (100% coverage: classification table, adjacency/
  splitting rules, mixed-category + failure-count title generation, `resolveGroupRoots` degrade paths),
  new tests appended to `tests/chat-view.client.spec.tsx` under `describe('Tool groups', ...)` (single
  stays ungrouped, groups, collapse/reopen, text-interrupted splitting, mixed-category + failure title
  through the real `ChatView` render). All 53 pre-existing `chat-view.client.spec.tsx` tests still pass
  unchanged (the group wrapper is DOM-transparent to their existing `[data-chat-flow-key]`/
  `[data-chat-anchor-key]` assertions).
- README.md/.zh.md: new paragraph under "Tool placement" + one new Known-Limitations bullet
  (collapsed-group scroll-anchor precision). Pairing re-recorded.
- The P3b Agent Note (`2026-08-25-science-transcript-chrome-suppression.md`/`.zh.md`) had its
  final-form statement updated **in place** to the P3d wording (user's exact string), not superseded.

**Shared Agent Note**: `2026-08-26-science-run-row-states-and-tool-groups.md`/`.zh.md`/`.i18n.yaml`
(new, covers both stages, bilingual, pairing recorded).

**Gates run and passing** (all in this worktree):
- `pnpm vitest run packages/client/ui-science packages/client/ui-conversation` → 876 tests passed.
- Per-file 100% coverage confirmed for every new/changed source file (`run-output.ts`,
  `ScienceExecutionRow.tsx`, `tool-group.ts`, `ToolGroup.tsx`; `ChatView.tsx`'s own pre-existing GUI-debt
  coverage exemption — `packages/client/ui-conversation/src/client/*` in `vitest.config.ts`'s coverage
  `exclude` — is untouched/unaffected; my added lines there are not in the reported gap list).
- `pnpm run typecheck` (both `build:lib:host` and `tsc -b tsconfig.client.json`) — clean.
- Scoped lint: `pnpm exec tsx scripts/run-oxlint.ts packages/client/ui-science packages/client/ui-conversation`
  — clean for every line I touched. Remaining reported errors (in `plugin-registration.client.spec.ts`'s
  *other* pre-existing lines, `science-turn-artifacts.client.spec.tsx`, `apps/desktop/tests/onboarding.spec.ts`)
  are 100% pre-existing baseline debt, confirmed via `git diff` showing zero changes to those exact lines/files —
  not introduced by this work, not fixed either (out of scope).

## Real e2e verification done (keyless, real subprocess/browser, no LLM key)

Built once via `pnpm --filter @deepseek-ai/dsh-web-frontend run build` (needs the full monorepo
`lib/` build first — already done in this worktree). **Do not build inside the main checkout while
the desktop app runs from it** (`ps aux | grep 'apps/desktop/lib'`) — this worktree is isolated, safe.

**Environment note for whoever resumes**: running these from a worktree path under a "generic sandbox
temp root" (e.g. anywhere under `/tmp` or `/private/tmp`) makes every Science Runtime scenario fail
with `Science scratch root must not overlap a generic sandbox temp root` — a real `dsh-sandbox` policy
check, not a bug. This worktree was moved (`git worktree move`) from a scratchpad-under-/tmp path to
`.claude/worktrees/p3cd-work` specifically to avoid this; keep running from here (or another non-tmp path).

Extended `apps/web/tests/science-stop.e2e.ts` (real `ScienceRuntime` + fake kernel subprocess) with
3 new scenarios, alongside the original Stop one — **all 4 pass**:
- settled success (kernel badge + full stdout, state 2)
- two adjacent `run_python` calls folding into one real generated Tool-group title (P3d, nesting P3c)
- a real kernel crash (`{action:'crash'}`) rendering the kernel-exited state (state 7), with the
  session's real `run.status === 'failed' && failureCode === 'KERNEL_DIED'` asserted too

Confirmed **no golden refresh needed** (pass unchanged) for `science-chart-outcome.e2e.ts`,
`science-artifact-types.e2e.ts`, `science-transcript-chrome.e2e.ts` — every fixture in those three
either exercises the row's unchanged fallback branches or captures a Details-column ARIA region the
row redesign never touches.

### P3d golden-refresh sweep of the rest of `apps/web/tests/*.e2e.ts`

Ran the ~70 remaining `.e2e.ts` files in batches (replay mode) to find any whose ARIA golden picks up
a NEW Tool-group header from ≥2 real adjacent tool calls. **Refreshed and re-verified green (now
committed):**
- `bash-abort-row.e2e.ts` (`ui.expected.md`) — a diagnostic + the aborted Bash call group.
- `goal-multi-turn-actions.e2e.ts` (`ui.expected.md`) — two separate groups across two turns.
- `message-actions.e2e.ts` (`ui.expected.md`) — two adjacent `read` calls group.

**Batches actually run** (confirmed, only the 3 above needed a refresh; everything else in these
batches passed unchanged):
`access-confirmation, agent-preset-authoring, agent-preset-selection, approval-composer,
background-job-list, chat-continuous-conversation, chat-long-interactions, chat-scroll-contract,
cold-blank-session, composer-draft-scroll, composer-tab-geometry, conversation-column-overflow,
declared-reasoning, default-model, details-session-lifecycle, feedback-command, goal-bar,
goal-command-presentation, goal-multi-turn-actions*, hmr-live, lifecycle-chrome, live-interactions,
markdown-cjk-strong, markdown-images, markdown-inline-code-links, markdown-wide-table,
math-rendering, message-actions*, message-feedback-layout, message-feedback, models-settings,
navigation-panes, onboarding-deepseek-config, onboarding-usable-provider, permission-policy-context,
plan-control-row, plan-review, plugin-config, produced-file-mentions, produced-files, pwa-manifest,
question-composer, queue-actions, rail-search-expand, reference-composer, remote-welcome,
replay-round-trip, scaffold-hermetic, schedule-after, seeded-history, settings-chrome,
shipped-composition, sidebar-scrollbar, sidebar-subagent-activity, skill-user-invoke, smoke-real,
startup-auto-selection, startup-rpc-budget, stats-paged-history, steering, trajectory-virtualization,
vite-entry, workspace-management, turn-tail-actions, skill-tool-row, skill-invocation-policy,
subagent-conversation, workflow-run, cordis-tool-round, code-mode-round, web-search-round,
pwsh-terminal` (* = refreshed).

**Not fully cleared — needs follow-up**: the LAST batch (the 22-file batch ending in
`subagent-interrupt-ui.e2e.ts`/`subagent-interrupt.e2e.ts`) reported **3 failed test files / 10 failed
tests** when the stop directive arrived. Only one failure's full output was captured before stopping:

```
apps/web/tests/subagent-interrupt-ui.e2e.ts > composer interrupt for a running continuable child
  > interrupts through subagent.interrupt, parks the follow-up, and resumes it FIFO
AssertionError: expected [ { content: [ ... ] } ] to have a length of 2 but got 1
  expect(child!.inbox.nextTurn).toHaveLength(2)
```

This assertion is about subagent inbox/queue mechanics — nothing in this PR touches queueing,
subagent inbox, or anything besides Tool-call presentation — so it reads as **unrelated to this
change** (likely a pre-existing flake, or an ordering/timing artifact from running many e2e files
back-to-back in one process; it was NOT independently verified against the base branch before the
stop). The other 2 failed files in that batch were never inspected at all — their names and failure
reasons are unknown. **Whoever resumes must**:

1. Re-run that last batch alone (`trajectory-virtualization` was already confirmed green in an
   earlier batch — the remaining unverified ones are `subagent-interrupt-ui.e2e.ts`,
   `subagent-interrupt.e2e.ts`, and whichever third file failed; re-run the exact list in the
   "Batches actually run" note above minus the ones already confirmed, or just re-run
   `subagent-interrupt-ui.e2e.ts subagent-interrupt.e2e.ts vite-entry.e2e.ts workspace-management.e2e.ts`
   — the tail end of that batch — to identify the 3 failing files precisely).
2. For each failure, check first whether it reproduces on `HEAD~1` (before this PR's changes) in the
   same worktree/environment — if it does, it's baseline noise, not a regression, and needs no fix
   here. If a failure is a genuine ARIA-golden mismatch from Tool grouping, refresh it the same way
   as the three already done: `DSH_SNAPSHOT=refresh pnpm exec vitest run --config vitest.web.config.ts
   apps/web/tests/<file>.e2e.ts`, inspect the diff (`git diff -- apps/web/tests/snapshots/`) for
   sanity, then re-run in default (replay) mode to confirm green.
3. This sweep never reached the several other e2e files not listed in "Batches actually run" above and
   not in the original 14 already covered — cross-check against `ls apps/web/tests/*.e2e.ts` for any
   file this handoff doesn't mention, and sweep it the same way if it constructs ≥2 adjacent ordinary
   tool calls (skill/subagent/workflow/live-interaction scenarios are the likeliest remaining hits per
   the P3b Agent Note's own list of e2e categories that show non-Science tool rows).

## Not done at all

- **Acceptance screenshots** — explicitly out of scope for this implementing pass per the task brief
  (a separate step). None taken.
- No `pnpm run doc-sync` run (README pairing was re-recorded per-file via
  `pnpm run verify-translation-pairing --write <path>` and spot-checked with the bare check; the full
  doc-sync gate covering catalogs/other cross-file doc consistency was not run for time).
- `pnpm run duplication` / `pnpm run hygiene` — not run; no reason to expect either is affected
  (no new package, no export surface change), but not verified.

## Commit

One combined commit (P3c + P3d together) rather than two separate ones, per explicit coordinator
authorization when the split would have cost meaningful extra time under the context budget. See the
commit message for the itemized summary; this handoff is committed in the same commit so the paper
trail travels with it.
