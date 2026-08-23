# DSH Science v0.1 R3 面向模型的 Science 工具收尾证据

[English](2026-08-16-dsh-science-v01-r3-science-tools.md) | 中文

调查时间为 2026-08-16，平台为 macOS 26.5.2（Darwin 25.5.0，arm64），Node v24.14.0，pnpm 11.7.0。范围授权文档：[DSH Science v0.1 R3 model-facing Science tools on RC5](../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r3-science-tools.zh.md)。

## 结果

原始 R3 产品候选 `50d5b413e59a3425c8936717e2ee369341324774` 与 closure head `d1dc9f3d23cdb67f60d530db003a653fa4196194` 未通过后续深度 review。修复后的产品候选 `9a668331bd54c0d267d982927b2c5f77db6147bc` 仍基于已验收 R2 head `dba4c1cdaaed209c8996e1a1bebca9b38c62d8aa`，并已通过最终 independent review 与 exact-SHA 验收。本记录只提升该修复候选。

## 精确身份

| 主题 | 身份 |
|---|---|
| 官方 RC5 | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a` |
| 已验收 R2 head | `dba4c1cdaaed209c8996e1a1bebca9b38c62d8aa` |
| 原始 R3 产品候选 | `50d5b413e59a3425c8936717e2ee369341324774`，位于 R2 head 之上三个 commit；因 review 修复而不再用于提升 |
| 被 review 的 closure head | `d1dc9f3d23cdb67f60d530db003a653fa4196194`；review 失败，已被修复后的 candidate 取代，不再用于提升 |
| 已验收的修复后 R3 candidate | `9a668331bd54c0d267d982927b2c5f77db6147bc`，位于 R2 head 之上六个 commit |
| 提交 1 | `1cf4ef0ddd` —— `packages/core/agent-loop` 中的 generic runtime-context restoration |
| 提交 2 | `35ae6b5399` —— `@deepseek-ai/dsh-tool-fs/read-only` subpath entry |
| 提交 3 | `50d5b413e5` —— `@deepseek-ai/dsh-tool-science` Consumer package |
| Review 修复 | `be46f69b6e` —— 关闭深度 review findings 并增加 runnable snapshot |
| Coverage 修复 | `9a668331bd` —— 在不改变生产 behavior 的前提下覆盖剩余 sanitized-state branches |
| Downstream provenance | `omdsh-dev/dsh-science@0a940733e80d57c70245134bf260012f9be29114`（runtime-context，test corrections `e5e8b29b435f`）、`@8c7d5e01e3876b0c645f13f20ada8cf7add0c356`（read-only，loader correction `0073f6e0a11c`）、`@27c96d8e8b2431814fe70a2e94fe8feeaf207b63`（Science Consumer） |
| 被拒绝的 whole-range candidate | `omdsh-dev/dsh-science@fae091e1080e830bed8ad0456e4cbced29101b01` —— 仅作为 negative scope evidence |

## 验证矩阵

| 层级 | 命令 | 结果 |
|---|---|---|
| Scope 与 ancestry | `git merge-base --is-ancestor dba4c1cdaa 9a668331bd`；`CI=true pnpm --silent run change-scope --base dba4c1cdaa --head 9a668331bd`；`git diff --check` | PASS —— merge base 为已验收的 R2 head；candidate 的六个 commit 全部映射到已声明的 packages、tests、documentation、generators 或 metadata；已验收 candidate 上没有 staged、unstaged 或 untracked path |
| Generic agent-loop behavior | `CI=true pnpm exec vitest run packages/core/agent-loop/tests`（包含在下方 combined run 中） | PASS —— 338 passed，18 files，覆盖 final-Enter authority、pressure fallback 与 exact-id retry restoration |
| Filesystem read-only entry | `pnpm exec vitest run packages/fs/tool-fs/tests` | PASS —— 181 passed，7 files（包含 3 个新增的 read-only test files） |
| Science Consumer behavior | `CI=true pnpm exec vitest run packages/science/tool-science/tests` | PASS —— 50 passed，2 files，包含真实 Loader+agent-loop composition 与 sanitized-state edge cases |
| Combined focused suite | `CI=true pnpm exec vitest run packages/core/agent-loop/tests packages/fs/tool-fs/tests packages/science/tool-science/tests packages/science/science-runtime/tests packages/science/science-session/tests` | PASS —— 700 passed，45 files |
| Focused per-file coverage | `CI=true pnpm exec vitest run packages/science/tool-science/tests --coverage --coverage.include='packages/science/tool-science/src/**/*.ts'`；针对 `agent.ts` 与 `runtime-context.ts` 的 Core targeted coverage | Science PASS —— statements 152/152、branches 110/110、functions 32/32、lines 134/134。Core 覆盖了每一条 changed restoration path；其 focused command 只报告 pre-existing、未改动且当前位于 `agent.ts:148` 的 `runMaintenance` reentrancy guard，因此在 per-file 100% threshold 下 exit 1。该例外已披露，未被称作 PASS；repository-wide `test:coverage` 仍由 CI 负责，本地未运行。 |
| Built lib subpath smoke | `pnpm exec vitest run --config vitest.e2e.config.ts packages/fs/tool-fs/tests/built-lib.e2e.ts`（在 `pnpm run build:lib:host` 之后） | PASS —— 针对 built `lib/` 确认了 shared `Config` identity、read-only roster 与一次真实文件读取 |
| Static and package artifacts | `CI=true pnpm run typecheck`；`CI=true pnpm run check:ci:artifacts` | 在 `9a668331bd` 上 PASS —— typecheck exit 0；未经改动的 Host 重跑通过 check:ci:artifacts 5/5（build、publint、node-next-types、built-package-invariants、built-bin smoke）。第一次 sandboxed artifact run 阻断了 CLI lifecycle/file-watch behavior，未被视作项目失败。 |
| Hygiene remaining subchecks | `knip`、`constraints`、`verify-dsh-package-licenses`、`verify-package-invariants`、`verify-built-package-invariants`、`verify-cordis-config`、`verify-node-next-types`、`verify-runtime-closure`、`verify-vendored-links` | PASS，均在已知的 `rescope-vendor:check` short-circuit 之后运行 |
| Hygiene（`rescope-vendor:check`） | `pnpm run rescope-vendor:check` | **FAIL —— pre-existing，确认未变化。** 与 R2 evidence record 中记录的 26-problem list 完全一致；已披露，不计为 PASS |
| Cross-file duplication | `pnpm run duplication` | **FAIL —— pre-existing，确认无关。** 报告 8 组 clone pairs，全部位于本次改动未触及的文件中（`goal/goal`、`science-session`/`science-runtime` 内部、`bash-sandbox`/`pwsh-sandbox`、`gen-config-catalog.ts`）；本次改动新增的每个 `invariant.ts` 都带有既有的 `jscpd:ignore` marker，报告零个 clone |
| Documentation | `pnpm run doc-sync`（28 个 gate）；`pnpm run lint` | PASS —— doc-sync 28/28，包含对每份被改动文档的 bilingual pairing（agent-loop README、tool-fs/fs READMEs、science/tool-science READMEs、architecture.md，以及 config/tool/event/module-graph catalogs）；lint exit 0 |
| Agent Note lifecycle | `pnpm run verify-agent-note-format`；`pnpm run verify-agent-note-classification` | PASS —— 两次均检查了 544 个 Agent Notes |
| Exact candidate review | 对截至 closure head `d1dc9f3d23cdb67f60d530db003a653fa4196194` 的 R3 range 进行 fresh subagent review（GPT-5.6 sol，high effort） | FAIL —— 见下方[Review](#review) |
| 修复后 candidate 的最终 review | 主 agent 对已提交 candidate `9a668331bd54c0d267d982927b2c5f77db6147bc` 进行独立 semantic 与 diff review | PASS —— coverage 修复后没有 unresolved finding；source、generated catalogs、bilingual documentation、runnable snapshot 与 protected-state scope 一致 |
| Review 修复检查 | Exact candidate scope、combined focused suite、Science coverage、选定的 keyless Science snapshot、typecheck 与 artifact gates | 在 `9a668331bd` 上 PASS —— 700 个 focused tests、50 个达到 100% per-file coverage 的 Science tests、一个选定的 runnable snapshot、typecheck exit 0，以及 Host artifact gates 5/5 |

### 明确 NOT-RUN

Repository-wide unit suite（CI 负责 exhaustive matrix）、针对明确授权的既有 Conda prefixes 的真实 Python 与 R Consumer acceptance、Science preset、Web、browser、Desktop、provider credentials、signing、publication、tag、release、Git push 与 PR，对 R3 均为 `NOT-RUN`。这些 layers 不在本 slice 范围内。

## Review

Review 拒绝了已记录的 candidate，因为 retry restoration 可能覆盖 authoritative final `agent/pre-step` Enter batch，`get_science_state` 返回未设上限的 histories 与原始 Host environment fields，model-facing free text 可能携带 Host paths，且没有 runnable keyless snapshot 覆盖新增 schemas/results 与 filesystem read-only roster。已验收修复会在 pre-step pressure replacement 之前捕获 exact retained fallback，在 Enter batch 之后为首次 request 与 retries 选择最终 retained value，按 message id restore，要求并测试每项 history 的 state limit，清理 model-facing environment/run/version/signal data，并新增真实 Loader/headless snapshot，依次执行 `get_science_state` 与 `run_python`。Independent review 与 exact committed-SHA gates 已在 `9a668331bd54c0d267d982927b2c5f77db6147bc` 上通过。

## Domain port provenance

`packages/core/agent-loop` 中的 runtime-context restoration 是一次全新的 RC5 patch，参考了 recorded downstream SHAs 上的只读 behavior 与 test corrections，而不是 cherry-pick：它的 authoritative final-Enter selection、用于 pre-request pressure compaction 的 exact retained fallback，以及 frozen first-request retry target，都不存在于已验收的 R2 tree 或 downstream provenance commit 中。`@deepseek-ai/dsh-tool-fs/read-only` entry 及其 loader-resolution behavior 是针对 RC5 的 `tool-fs` package 重新推导的，而不是从 downstream prerelease 复制；package metadata、exports 与 TypeScript project wiring 遵循 RC5 sibling-package template（version `0.1.0-rc.5`，public，MIT）。`@deepseek-ai/dsh-tool-science` 在已验收的 R1/R2 tree 上复现了 downstream Science Consumer provenance 的 behavior 与 test input；其 generated output 与 downstream Phase 3 range 失败的 whole-range acceptance 均被排除，而 real-composition test、schema-derived tool values、sanitized bounded state view、基于 waterfall 结果的 context replacement 与 runnable-example snapshot 都是 R3 原创，而不是 ported。

## Overlay inventory update

| `delta_id` | 此前状态 | R3 状态 |
|---|---|---|
| `GEN-RUNTIME-CONTEXT` | 在 R0/R1/R2 inventory 中缺席，未作为具名 row 出现 | 在修复后 candidate `9a668331bd` 上 `verified` |
| `FS-READONLY` | `deferred` | `verified`；built subpath 与 assembled read-only roster 均通过 |
| `FS-READONLY-LOAD-FIX` | `deferred` | `verified` |
| `SCI-TOOLS` | 在 Runtime Context 与 filesystem read-only 被验收之前 `deferred` | 在修复后 candidate `9a668331bd` 上 `verified` |
| `SCI-SESSION` / `SCI-RUNTIME` / `GEN-SESSION-REGISTRY` / `GEN-SUBPROCESS-RUNTIME-FACTS` / `GEN-SANDBOX-CLASSIFICATION` / `SCI-R-PROBE` | 在 R1/R2 中 `verified` | 不变 |
| 其余 overlay rows | 与 [R0 closure evidence](2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.zh.md) 中记录的一致 | 不变：`SCI-PRESET`、`SCI-CHARTS-OUTCOME`、`SCI-SETTINGS-SIDEBAR`、`DESKTOP-CARRIER` |

## Protected-state preservation

`/Users/superjj/ccproj/DSHscience`（分支 `codex/science-v01-r3-science-tools-plan`）之外的任何 protected worktree 都未被 staged、cleaned、reset、checked out 或 repointed。没有发生 push、tag、PR 或 publish。本次工作期间运行过一次 `pnpm run clean`，用于移除与本次改动无关的 pre-existing build residue（一个阻塞 `pnpm run constraints` 的、过期的 `packages/session-query/session-log-download` 目录）；它只移除了 build outputs 与已确认被删除 package 的 residue，没有移除 source。

## Risks, unknowns, and deferred product decisions

- `rescope-vendor:check` 的 pre-existing 26-problem gap 仍然存在；R3 既不修复也不扩大它，也不对何时应处理它表态。
- pre-existing 的 8-clone `duplication` gap 仍然存在；R3 既不修复也不扩大它，且 R3 新增的每个文件都已确认没有 clone，或带有正确的 `jscpd` ignore 标记。
- Tool schema visibility 不按 preset 限定范围：一旦 `@deepseek-ai/dsh-tool-science` 被组合进任意 Host tree，`get_science_state`/`run_python`/`run_r` 就会全局注册，对每个 session 可见，无论其 `agentPreset` 为何。只有 durable mode/environment binding 与 `science:environment` context text 会以 `agentPreset === 'science'` 为条件。如果确有需要，限制 schema visibility 本身将由后续 preset slice 负责。
- 真实 Python 与 R Consumer acceptance、Science preset、Client UI 与 Desktop，仍然与 R0/R1/R2 overlay inventory 中记录的一致。
