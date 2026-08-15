# DSH Science v0.1 R3 面向模型的 Science 工具收尾证据

[English](2026-08-16-dsh-science-v01-r3-science-tools.md) | 中文

调查时间为 2026-08-16，平台为 macOS 26.5.2（Darwin 25.5.0，arm64），Node v24.14.0，pnpm 11.7.0。范围授权文档：[DSH Science v0.1 R3 model-facing Science tools on RC5](../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r3-science-tools.md)。

## 结果

原始 R3 产品候选 `50d5b413e59a3425c8936717e2ee369341324774` 与 closure head `d1dc9f3d23cdb67f60d530db003a653fa4196194` 未通过后续深度 review。修复后的 worktree 仍基于已验收 R2 head `dba4c1cdaaed209c8996e1a1bebca9b38c62d8aa`，正等待本地 commit 与最终 exact-SHA 验收。本记录不会提升未提交的修复。

## 精确身份

| 主题 | 身份 |
|---|---|
| 官方 RC5 | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a` |
| 已验收 R2 head | `dba4c1cdaaed209c8996e1a1bebca9b38c62d8aa` |
| 原始 R3 产品候选 | `50d5b413e59a3425c8936717e2ee369341324774`，位于 R2 head 之上三个 commit；因 review 修复而不再用于提升 |
| 被 review 的 closure head | `d1dc9f3d23cdb67f60d530db003a653fa4196194`；review 失败，修复仍未提交 |
| 提交 1 | `1cf4ef0ddd` —— `packages/core/agent-loop` 中的 generic runtime-context restoration |
| 提交 2 | `35ae6b5399` —— `@deepseek-ai/dsh-tool-fs/read-only` subpath entry |
| 提交 3 | `50d5b413e5` —— `@deepseek-ai/dsh-tool-science` Consumer package |
| Downstream provenance | `omdsh-dev/dsh-science@0a940733e80d57c70245134bf260012f9be29114`（runtime-context，test corrections `e5e8b29b435f`）、`@8c7d5e01e3876b0c645f13f20ada8cf7add0c356`（read-only，loader correction `0073f6e0a11c`）、`@27c96d8e8b2431814fe70a2e94fe8feeaf207b63`（Science Consumer） |
| 被拒绝的 whole-range candidate | `omdsh-dev/dsh-science@fae091e1080e830bed8ad0456e4cbced29101b01` —— 仅作为 negative scope evidence |

## 验证矩阵

| 层级 | 命令 | 结果 |
|---|---|---|
| Scope 与 ancestry | `git merge-base --is-ancestor dba4c1cdaa HEAD`；`pnpm --silent run change-scope --base dba4c1cdaa --head HEAD`；`git diff --cached --check` | PASS —— ancestry 成立；三个 commit 中每个已提交 path 都映射到 R3 Note 声明的 packages、tests、documentation、generators 或 metadata；whitespace check exit 0 |
| Generic agent-loop behavior | `pnpm exec vitest run packages/core/agent-loop/tests` | PASS —— 333 passed，18 files（包含 4 个新增的 retry-restoration tests） |
| Filesystem read-only entry | `pnpm exec vitest run packages/fs/tool-fs/tests` | PASS —— 181 passed，7 files（包含 3 个新增的 read-only test files） |
| Science Consumer behavior | `pnpm exec vitest run packages/science/tool-science/tests` | PASS —— 35 passed，2 files，包含所需的真实 Loader+agent-loop composition（`loader-composition.spec.ts`） |
| Combined focused suite | `pnpm exec vitest run packages/core/agent-loop/tests packages/fs/tool-fs/tests packages/science/tool-science/tests packages/science/science-runtime/tests packages/science/science-session/tests` | PASS —— 680 passed，45 files |
| Focused per-file coverage | 针对 `packages/core/agent-loop/src/**`、`packages/fs/tool-fs/src/**`、`packages/science/tool-science/src/**` 的 targeted Vitest coverage | PASS —— 每个 changed/new file 都达到 100% statements/branches/functions/lines，唯一例外是一行 pre-existing、未被改动的行（`packages/core/agent-loop/src/agent.ts:143`，`runMaintenance` 的 reentrancy guard），它在完整 workspace `test:coverage` run 中由许多其他 packages 的 suites 覆盖；已确认与本次改动无关 |
| Built lib subpath smoke | `pnpm exec vitest run --config vitest.e2e.config.ts packages/fs/tool-fs/tests/built-lib.e2e.ts`（在 `pnpm run build:lib:host` 之后） | PASS —— 针对 built `lib/` 确认了 shared `Config` identity、read-only roster 与一次真实文件读取 |
| Static and package artifacts | `pnpm run typecheck`；`pnpm run check:ci:artifacts` | PASS —— typecheck exit 0；check:ci:artifacts 5/5（build、publint、node-next-types、built-package-invariants、built-bin smoke） |
| Hygiene remaining subchecks | `knip`、`constraints`、`verify-dsh-package-licenses`、`verify-package-invariants`、`verify-built-package-invariants`、`verify-cordis-config`、`verify-node-next-types`、`verify-runtime-closure`、`verify-vendored-links` | PASS，均在已知的 `rescope-vendor:check` short-circuit 之后运行 |
| Hygiene（`rescope-vendor:check`） | `pnpm run rescope-vendor:check` | **FAIL —— pre-existing，确认未变化。** 与 R2 evidence record 中记录的 26-problem list 完全一致；已披露，不计为 PASS |
| Cross-file duplication | `pnpm run duplication` | **FAIL —— pre-existing，确认无关。** 报告 8 组 clone pairs，全部位于本次改动未触及的文件中（`goal/goal`、`science-session`/`science-runtime` 内部、`bash-sandbox`/`pwsh-sandbox`、`gen-config-catalog.ts`）；本次改动新增的每个 `invariant.ts` 都带有既有的 `jscpd:ignore` marker，报告零个 clone |
| Documentation | `pnpm run doc-sync`（28 个 gate）；`pnpm run lint` | PASS —— doc-sync 28/28，包含对每份被改动文档的 bilingual pairing（agent-loop README、tool-fs/fs READMEs、science/tool-science READMEs、architecture.md，以及 config/tool/event/module-graph catalogs）；lint exit 0 |
| Agent Note lifecycle | `pnpm run verify-agent-note-format`；`pnpm run verify-agent-note-classification` | PASS —— 两次均检查了 544 个 Agent Notes |
| Exact candidate review | 对截至 closure head `d1dc9f3d23cdb67f60d530db003a653fa4196194` 的 R3 range 进行 fresh subagent review（GPT-5.6 sol，high effort） | FAIL —— 见下方[Review](#review) |
| Review 修复检查 | Focused agent-loop 与 Science Consumer Vitest；选定的 keyless Science snapshot；`pnpm run typecheck` | PASS —— 未提交修复 worktree 上 14 个 agent-loop tests、48 个 Science Consumer tests、一个选定的 runnable snapshot，以及 typecheck exit 0 |

### 明确 NOT-RUN

Repository-wide unit suite（CI 负责 exhaustive matrix）、针对明确授权的既有 Conda prefixes 的真实 Python 与 R Consumer acceptance、Science preset、Web、browser、Desktop、provider credentials、signing、publication、tag、release、Git push 与 PR，对 R3 均为 `NOT-RUN`。这些 layers 不在本 slice 范围内。

## Review

Review 拒绝了已记录的 candidate，因为 retry restoration 可能覆盖 authoritative final `agent/pre-step` Enter batch，`get_science_state` 返回未设上限的 histories 与原始 Host environment fields，model-facing free text 可能携带 Host paths，且没有 runnable keyless snapshot 覆盖新增 schemas/results 与 filesystem read-only roster。修复会在 pre-step pressure replacement 之前捕获 exact retained fallback，在 Enter batch 之后为首次 request 与 retries 选择最终 retained value，按 message id restore，要求并测试每项 history 的 state limit，清理 model-facing environment/run/version data，并新增真实 Loader/headless snapshot，依次执行 `get_science_state` 与 `run_python`。最终 independent review 与 exact committed-SHA gates 仍待完成。

## Domain port provenance

`packages/core/agent-loop` 中的 runtime-context restoration 是一次全新的 RC5 patch，参考了 recorded downstream SHAs 上的只读 behavior 与 test corrections，而不是 cherry-pick：它的 authoritative final-Enter selection、用于 pre-request pressure compaction 的 exact retained fallback，以及 frozen first-request retry target，都不存在于已验收的 R2 tree 或 downstream provenance commit 中。`@deepseek-ai/dsh-tool-fs/read-only` entry 及其 loader-resolution behavior 是针对 RC5 的 `tool-fs` package 重新推导的，而不是从 downstream prerelease 复制；package metadata、exports 与 TypeScript project wiring 遵循 RC5 sibling-package template（version `0.1.0-rc.5`，public，MIT）。`@deepseek-ai/dsh-tool-science` 在已验收的 R1/R2 tree 上复现了 downstream Science Consumer provenance 的 behavior 与 test input；其 generated output 与 downstream Phase 3 range 失败的 whole-range acceptance 均被排除，而 real-composition test、schema-derived tool values、sanitized bounded state view、基于 waterfall 结果的 context replacement 与 runnable-example snapshot 都是 R3 原创，而不是 ported。

## Overlay inventory update

| `delta_id` | 此前状态 | R3 状态 |
|---|---|---|
| `GEN-RUNTIME-CONTEXT` | 在 R0/R1/R2 inventory 中缺席，未作为具名 row 出现 | 修复等待最终 exact-SHA verification |
| `FS-READONLY` | `deferred` | implementation 保留；assembled snapshot verification 等待最终 exact-SHA acceptance |
| `FS-READONLY-LOAD-FIX` | `deferred` | implementation 保留；等待最终 exact-SHA acceptance |
| `SCI-TOOLS` | 在 Runtime Context 与 filesystem read-only 被验收之前 `deferred` | 修复等待最终 exact-SHA verification |
| `SCI-SESSION` / `SCI-RUNTIME` / `GEN-SESSION-REGISTRY` / `GEN-SUBPROCESS-RUNTIME-FACTS` / `GEN-SANDBOX-CLASSIFICATION` / `SCI-R-PROBE` | 在 R1/R2 中 `verified` | 不变 |
| 其余 overlay rows | 与 [R0 closure evidence](2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md) 中记录的一致 | 不变：`SCI-PRESET`、`SCI-CHARTS-OUTCOME`、`SCI-SETTINGS-SIDEBAR`、`DESKTOP-CARRIER` |

## Protected-state preservation

`/Users/superjj/ccproj/DSHscience`（分支 `codex/science-v01-r3-science-tools-plan`）之外的任何 protected worktree 都未被 staged、cleaned、reset、checked out 或 repointed。没有发生 push、tag、PR 或 publish。本次工作期间运行过一次 `pnpm run clean`，用于移除与本次改动无关的 pre-existing build residue（一个阻塞 `pnpm run constraints` 的、过期的 `packages/session-query/session-log-download` 目录）；它只移除了 build outputs 与已确认被删除 package 的 residue，没有移除 source。

## Risks, unknowns, and deferred product decisions

- `rescope-vendor:check` 的 pre-existing 26-problem gap 仍然存在；R3 既不修复也不扩大它，也不对何时应处理它表态。
- pre-existing 的 8-clone `duplication` gap 仍然存在；R3 既不修复也不扩大它，且 R3 新增的每个文件都已确认没有 clone，或带有正确的 `jscpd` ignore 标记。
- Tool schema visibility 不按 preset 限定范围：一旦 `@deepseek-ai/dsh-tool-science` 被组合进任意 Host tree，`get_science_state`/`run_python`/`run_r` 就会全局注册，对每个 session 可见，无论其 `agentPreset` 为何。只有 durable mode/environment binding 与 `science:environment` context text 会以 `agentPreset === 'science'` 为条件。如果确有需要，限制 schema visibility 本身将由后续 preset slice 负责。
- 真实 Python 与 R Consumer acceptance、Science preset、Client UI 与 Desktop，仍然与 R0/R1/R2 overlay inventory 中记录的一致。
