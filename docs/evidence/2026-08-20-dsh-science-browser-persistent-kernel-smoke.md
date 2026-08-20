# DSH Science browser persistent-kernel and artifact-version smoke evidence

English | [中文](2026-08-20-dsh-science-browser-persistent-kernel-smoke.zh.md)

Investigated on 2026-08-20 on macOS 26.5.2 (Darwin 25.5.0, arm64) in the user's existing Chrome session. The source Web application was served from the DSH checkout at `5bcd3f6fb7406c176262dd17bd4616a243475f79` on `http://127.0.0.1:3081/`; the selected Science session was `本地数据绘图演示`. This record is a dated browser and source snapshot, not release acceptance.

## Result

Python persistent-kernel behavior passed the browser checks for cross-turn state, ordinary execution failure, safe user cancellation, and browser reload. Every observed Python run used `kernelEpoch: 1`, and values written before each boundary remained readable afterward.

Artifact version allocation failed. Two different user turns wrote different bytes to the same logical artifact, but both tool rows and the Details viewer reported v1. The durable projection retained only one version with the later bytes. The same defect was already visible in the session's PNG: the edited chart remained artifact v1 while its published Outcome advanced to revision 2.

Cancellation also has a presentation mismatch. The durable Science run is `cancelled` with `failureCode: CANCELLED`, but the Chat run card renders `运行失败` and `Error: tool call aborted` instead of the available stopped state.

## Identity and scope

| Layer | Identity | Scope and result |
|---|---|---|
| DSH source | `5bcd3f6fb7406c176262dd17bd4616a243475f79` | Source inspection and source-launched Web process; the three pre-existing untracked Claude Science investigation files were not modified |
| Web host | `127.0.0.1:3081`, Node `v24.14.0`, pnpm `11.7.0` | Existing source process; no host restart, package install, or environment mutation |
| Browser | User's existing Chrome tab at `http://127.0.0.1:3081/` | Real model and tool interaction in the selected Science session |
| Science environment | revision 1; Python 3.12.12; fingerprint prefix `cf808732c543` | Python available; R unavailable in this session |
| Release layers | none | Desktop packaging, installer, signing, publication, tag, release, and other platforms are `NOT-RUN` |

The browser test created or rewrote only `kernel_browser_probe.txt` in the per-run `SCIENCE_ARTIFACT_DIR`. It did not edit repository product source, workspace files, Science settings, Conda prefixes, credentials, Git refs, or release state.

## Browser observations

| Check | Browser action and durable evidence | Result |
|---|---|---|
| Cross-turn Python state | Run `c1e63b77-3522-4546-8eef-d1ed67e7895f` set `kernel_browser_probe = 41`; the next user turn's run `76d0665f-acac-4154-be75-ee5227a98f5d` executed `kernel_browser_probe += 1` without redefining it and printed `KERNEL_BROWSER_PROBE=42`. Both runs used `kernelEpoch: 1`. | **PASS** |
| Cross-turn artifact version | The two runs wrote `41` and `42` respectively to `kernel_browser_probe.txt`. Both tool rows reported v1. `get_science_state` exposed one artifact, `67eaf886-882f-46d8-8259-5c1d692d3ef3` v1, owned by the later run; the Details viewer displayed `42`, v1, with both previous/next controls disabled. | **FAIL** |
| Ordinary exception survival | Run `235876ff-2061-4ba3-813e-c3b8eafa9964` assigned `kernel_browser_survivor = "alive"` and raised `RuntimeError("kernel-browser-probe")`; it durably finished `failed/EXECUTION_FAILED`. The next run `0cbd31bf-96b0-426c-b84d-ce9294bdcdfd` printed `SURVIVOR=alive`, still on epoch 1. | **PASS** |
| User-cancel survival | Run `de26dbc1-ba04-486a-b4b6-af0eb0f91311` assigned `kernel_browser_cancel = 73`, printed `CANCEL_PROBE_STARTED`, and slept. Clicking `停止生成` produced a durable `cancelled/CANCELLED` terminal on epoch 1. Run `e97287fe-9f43-4f2e-9512-a0a6f03ab3c3` then printed `CANCEL_SURVIVOR=73` on epoch 1. | **PASS** for kernel state; presentation issue recorded below |
| Browser reload survival | After reloading the Chrome page, run `52971c9a-3c1c-4c2c-ba1e-199d2e7f0aab` printed `RELOAD_PROBE=42|alive|73|11`; the kernel remained live at epoch 1. | **PASS** |
| Python/R coexistence and isolation | Python assigned and printed `language_isolation_probe = 11`. `run_r` was rejected before a run with `Science r environment is not available`. | `NOT-RUN` for R; this is missing session configuration, not a demonstrated Runtime failure |

The expanded `get_science_state` result reported 17 runs, one live Python kernel at epoch 1, two logical artifacts, two total artifact versions, and Outcome revision 2. The first and second text-artifact runs have distinct `toolCallId` values but the same `requestHeaderSeq: 14`.

## Finding F1: a request header is being used as a user-turn identity

Severity: **P1 product defect**. A normal follow-up request cannot open the next visible artifact version when provider/model/tools/system configuration remains unchanged.

The browser proves the required distinction. Runs `c1e63b77…` and `76d0665f…` came from two submitted user messages and have different tool calls, but both carry request header 14. Their same logical file changed from `41` to `42`; the projection and viewer still contain only v1. The earlier chart edit has the same symptom: `gpt_exposure_wage_bubble.png` remains artifact v1 even though the Outcome is revision 2 and cites the later run `9e2f7c18-e538-4bc9-915b-23647f530fb9`.

The source explanation is direct. [`capture.ts`](../../packages/science/science-runtime/src/capture.ts) increments a version only when `latest.requestHeaderSeq !== sourceRun.requestHeaderSeq`. [`agent.ts`](../../packages/core/agent-loop/src/agent.ts) emits `request/header` only for initial/resume or when the canonical request configuration changes, so the sequence identifies a configuration epoch rather than every user turn. [`harness.ts`](../../packages/science/science-runtime/tests/harness.ts) masks the defect by appending a fresh `request/header` whenever it authorizes a run.

The repair should resolve the owning `tool/call.turn` for the prior artifact and incoming source run, then compare those turns. [`fold-state.ts`](../../packages/science/science-session/src/fold-state.ts) already indexes every tool call with `turn` and `step`; the Runtime allocator and the supersede validation in [`transition.ts`](../../packages/science/science-session/src/transition.ts) must use the same rule. `requestHeaderSeq` remains valid provenance but must not decide visible version identity.

A repair needs a new bug-fix Agent Note because the implemented [artifact-version decision](../../.agents/notes/implemented/architecture/2026-08-19-artifact-version-per-request-turn.md) currently names `requestHeaderSeq` as the turn anchor. The repair should keep its product rule—same turn supersedes, later turn increments—while correcting the durable relation used to implement it.

Required regression evidence:

- One `request/header`, two distinct `tool/call.turn` values, and two runs writing different bytes to the same logical name must produce v1 then v2.
- Two runs in one tool-call turn must still supersede v1 rather than opening v2.
- Strict replay must reject cross-turn supersede even when both calls share one request header, while accepting same-turn supersede.
- A keyless assembled Web or snapshot scenario must submit two user turns and show v1/v2 in the run rows and Details viewer, including enabled previous/next navigation.
- The affected package tests, keyless product snapshot, both SDK projections if their expected loop output changes, documentation, typecheck/build surfaces selected by the pre-push workflow, and `git diff --check` must be reported separately; a focused unit PASS is not browser or release closure.

## Finding F2: cancellation is durable as cancelled but rendered as failed

Severity: **P2 trace and status defect**. This does not lose kernel state, but it gives the user the wrong lifecycle label at the exact interaction the Agent Trace must explain.

After the page stop action, the Chat row displayed `运行失败` and `Error: tool call aborted`. The expanded Science state identifies the same run as `status: cancelled`, `failureCode: CANCELLED`, and `kernelEpoch: 1`; the successful follow-up proves the safe interrupt preserved memory.

[`ScienceToolFallbackRow.tsx`](../../packages/client/ui-science/src/client/ScienceToolFallbackRow.tsx) maps only `block.error.code === 'interrupted'` to `stopped`; every other errored tool result becomes `error`. The tool executor's canonical post-dispatch abort result carries `AbortError` and its canonical abort code in error info, while the visible plain text says `Error: tool call aborted`. The repair should make the normalized durable call slice distinguish a user-stopped call from execution failure and must keep generic pre-dispatch cancellation behavior explicit.

Add a browser-level cancellation regression that clicks the real stop control while `run_python` is active, asserts the Science run card uses the stopped presentation, and independently asserts the durable run remains `cancelled/CANCELLED`. The existing component test for a synthetic `interrupted` error does not cover the wrapper-abort result observed here.

## Remaining persistence matrix

The following items are deliberately `NOT-RUN` in this browser pass and remain useful acceptance work after the two defects are fixed:

- Real R persistence and Python/R coexistence using an explicitly configured real Conda R prefix.
- Host restart: the old process memory must disappear, replay must not present the old kernel as live, and the next run must use a greater epoch.
- Idle timeout retirement and a subsequent greater epoch.
- Environment rebind retirement once a product path can apply a later environment revision.
- Per-run timeout with both proven-safe interrupt reuse and tainted-kernel `run-escalation` retirement.
- Session isolation: equal variable names in two Science sessions must not share memory.
- Kernel crash and wire-protocol failure, including durable exit reason and next-epoch recovery.
- Real Conda acceptance through `pnpm --filter @deepseek-ai/dsh-science-runtime run test:real-acceptance`; it is separate from this browser evidence.

## Handoff boundary

This investigation changed only this bilingual evidence pair and its pairing record. It did not implement either repair, add an Agent Note, change tests, restart the Host, configure R, run real-acceptance, stage, commit, push, open a PR, publish, or release.
