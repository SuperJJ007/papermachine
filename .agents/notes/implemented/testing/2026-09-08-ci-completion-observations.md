# Agent Note: CI fixture completion and isolation

Status: implemented

English | [中文](2026-09-08-ci-completion-observations.zh.md)

## Problem

The [reference CI run](https://github.com/deepseek-harness/deepseek-harness/actions/runs/34206953049) reports a webhook-created Session absent after a one-second poll and empty PowerShell output before a five-second read deadline. HTTP acceptance, projected UI state, process startup, and durable completion are separate observations. Tests need an explicit completion condition and controls that prevent an intermediate state from satisfying it. The [completion-wait decision](2026-09-08-ci-readiness-and-completion.md) owns those conditions and lane budgets; these fixtures make their ordering and cleanup observable under controlled delays.

## Decision

The [GitHub review browser test](../../../../apps/web/tests/github-ready-review.e2e.ts) holds real Workspace creation after HTTP 202, verifies that neither the Agent nor the model request exists, then releases creation and awaits the matching Session's `turn/end`. Cleanup releases the barrier, restores the method, and removes the event listener even when the test times out. Workspace membership, request counts, prompt content, and browser expectations retain their original assertions.

The [PowerShell executor tests](../../../../packages/shell/pwsh-local/tests/executor.spec.ts) hold startup and consuming reads at private file barriers. The test controls when later output becomes available; final stdin/environment output is read after `done`. Polling uses the active test budget, and every constructed Context is registered before plugin initialization. Teardown captures Contexts and directories before awaiting disposal and removes directories only after that disposal completes.

The [queued-image test](../../../../apps/web/tests/queue-image.e2e.ts) separately holds admission and attachment retrieval, then captures the admitted row's loaded thumbnail. Cleanup shares one promise, releases held requests, and drains their handlers before closing the browser.

The [Details Session-lifecycle test](../../../../apps/web/tests/details-session-lifecycle.e2e.ts) awaits the frame's captured animation promises after closed state appears, then checks the zero-width track. Cancelled transitions also reach that assertion; animation settlement cannot make a persistent nonzero track pass.

The [whole-queue steering test](../../../../apps/web/tests/steering.e2e.ts) waits for enabled steering actions and the composer's queue-steering hint. A model-stream barrier keeps the following question-composer takeover pending while the test observes steering. Teardown releases that barrier before browser closure.

The [workspace-management test](../../../../apps/web/tests/workspace-management.e2e.ts) waits for restored composer focus before the next directory-dialog gesture. Its archive case gives the known seed id an explicit user title through the Session controller, then uses that exact title to identify the row across reload. An unrelated restored row cannot satisfy that locator; the durable archive assertion still checks the seed id and retained log.

The [worker budget tests](../../../../packages/code-runtime/code-runtime-worker-thread/tests/budget.spec.ts) retain real worker execution and binding transport while controlling host timers and ELU samples. They acknowledge binding entry before exercising idle, active, and wall-clock decisions, so a bootstrap timeout cannot stand in for a budget decision during a binding. The [real-worker tests](../../../../packages/code-runtime/code-runtime-worker-thread/tests/runtime.spec.ts) independently retain actual ELU, idle-binding, and hot-loop coverage.

The [detached-launch tests](../../../../packages/host/open-in-app/tests/launch-detached.spec.ts) control watch time and deliver late process events through the real launcher's registered callbacks. They check one settlement, one unref, and no child kill. Real-process environment and early-exit cases remain in the [resolver tests](../../../../packages/host/open-in-app/tests/resolver.spec.ts).

The [LSP backpressure test](../../../../packages/lsp/lsp-stdio/tests/instance.spec.ts) preserves the real paused-reader fixture and large native pipe write. Before accepting the abort error, it verifies that the pending write callback settled and the captured subprocess completed; `instance.dead` alone can be true as soon as disposal starts.

The [E2B subprocess tests](../../../../packages/e2b/subprocess-e2b/tests/subprocess.spec.ts) hold sandbox acquisition after a cooperative interrupt begins, then complete or terminate the command before releasing it. No late INT may reach that group; a failed acquisition must leave ordinary command completion and quiescence usable. A completed stdin write establishes startup readiness, so an interrupt ignored before publication cannot satisfy the race assertion.

The [Python process-identity tests](../../../../packages/experimental/code-runtime-python/tests/process-start.spec.ts) supply procfs records for the same pid with distinct start times and a command name containing closing parentheses. Missing or inaccessible records yield unavailable identity rather than breaking teardown. Exact-path filesystem interception and restored platform metadata make the parser observable on non-Linux hosts; [real-process tests](../../../../packages/experimental/code-runtime-python/tests/runtime.spec.ts) retain Linux kernel and process-group evidence. Synthetic procfs records alone cannot establish kernel signaling behavior.

### DNS completion during graceful disposal

A rejected or aborted `fetch` does not prove its DNS lookup has finished. The [proxy dispatcher disposer](../../../../packages/util/http-proxy/src/install.ts) restores process state before awaiting graceful `agent.close()`, which can still wait for pending DNS. A request deadline therefore does not bound teardown; a controlled DNS barrier confirms that fetch rejection can precede disposal completion until the lookup callback is released.

The [proxy installation tests](../../../../packages/util/http-proxy/tests/install.spec.ts) settle DNS failure only for the exact fixture hostname and restore the original resolver in `finally`. They retain real global fetch, dispatchers, and loopback proxy connections: direct routing requires the local lookup and `ENOTFOUND`, while a usable HTTPS proxy requires an observed CONNECT without local origin resolution. Rejection alone cannot distinguish those routes. Disposal also verifies restored dispatcher, routing, and proxy environment. These tests control resolver completion, not operating-system DNS latency.

### Built-client import classification

The [Node import sweep](../../../../packages/experimental/webworker-runtime/tests/compile/transform-corpus-check.ts) uses a TypeScript configuration without workspace source aliases, so each dependency retains its published module identity. Dockkit is admitted only for `ERR_UNKNOWN_FILE_EXTENSION` naming its exact built `dockkit.module.css` or its primitives dependency’s built `StateDot.module.css`; either ESM dependency may fail first. Other stylesheet paths, source-tree stylesheets, other errors and unexpectedly successful exempt imports fail. Scoped resolve/load hooks exercise these outcomes without modifying shared build artifacts. Win32 bindings share one module instance, so no duplicate koffi-registration exemption is needed.

## Alternatives considered

**Production timeouts, retries, or suite serialization.** Rejected because none establishes the missing completion observation.

**Completion inferred from acceptance or a preview.** HTTP 202 and an optimistic image can precede the operation being asserted.

**Controlled samples replacing measured worker coverage.** Rejected because they omit verification of Node's actual ELU and transport behavior.

**Force-destroy the dispatcher or extend the test timeout.** Destruction changes the production guarantee that in-flight requests may finish; a longer timeout leaves resolver completion outside fixture control. Deterministic DNS completion preserves graceful disposal and the actual routing assertions.

## Consequences

Each fixture owns its clocks, barriers, callbacks, processes, and temporary paths. Controlled observations supplement real worker, subprocess, browser, and persistence paths. Product behavior, production timing, benchmark budgets, CI scheduling, and recorded expectations remain unchanged.
