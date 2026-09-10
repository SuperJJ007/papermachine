# Adaptation checkpoint: step 1

Date: 2026-09-11. Checkout: `/Users/superjj/ccproj/pm-replant`; branch: `replant/0.1.5`. PaperMachine product version: 0.1.3; Harness version: 0.1.5-rc.1. These commits are local and have not been pushed.

## Review units

| Commit | Change | Evidence |
|---|---|---|
| `bdce45a977` | Compute pending restart before secret redaction and project it through settings | 457 focused tests; settings Web refresh/replay 6 each; native save/restart/remove/restart |
| `8ca878a63e` | Restore saved chart controls when discarding edits | 128 focused tests; chart Web refresh/replay 6 each; native chart discard |
| `5e42a5138c` | Add 10px horizontal padding to sidebar element controls | Client build with 238 artifacts; Finder restart and visual inspection |
| `575b13b31b` | Restore Electron standard edit menu | 10 desktop tests; native Chinese multiline paste, select/delete/undo |

Exact earlier commands, logs, and acceptance conditions live in [the first closeout](manual-fixes-closeout.md) and [the supplemental closeout](manual-supplement-closeout.md). The acceptance credential remains in the ignored local credential store; no secret is part of these commits.

## Checkpoint validation

`PATH=/private/tmp/dsh-rc1-node/bin:/opt/miniconda3/bin:$PATH npm_execpath=/Users/superjj/ccproj/pm-replant/apps/desktop/node_modules/pnpm/bin/pnpm.mjs pnpm_config_verify_deps_before_run=false node --import tsx/esm scripts/run-gates.ts doc-sync` passed 34/34 before splitting the changes. Log: `/private/tmp/pm-step12-doc-baseline.log`. Each commit passed its normal staged hooks, including lint where applicable, translation pairing and whitespace. No passing behavior suite was repeated solely to commit.

## Remaining acceptance

Windows/WSL directory selection, packaged Windows execution and installation, remote CI, cross-version seed upgrade, signing, and the remaining native XLSX/RDS and IME candidate checks are not certified by this checkpoint. The macOS desktop entry still depends on the source checkout and temporary Node runtime; it is not a standalone release installation.
