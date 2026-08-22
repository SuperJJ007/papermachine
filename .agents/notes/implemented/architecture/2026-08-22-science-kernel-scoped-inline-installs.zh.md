# Agent Note：kernel 范围的用户安装目录，让 inline `pip install`/`install.packages()` 真正生效

Status: implemented

[English](2026-08-22-science-kernel-scoped-inline-installs.md) | 中文

## 问题

`run_python` 的 tool 描述与 science-runtime 的 README 早已承诺：一次 run 内 inline 的 `pip install` 会影响正在运行的 kernel，直到它重启为止——这是在对齐 Claude Science 的语义。但这个承诺从未真正成立。Python kernel 以 `-I`（isolated mode）方式启动。在 sandbox confinement 下 Conda prefix 是只读的，因此 pip 的安装会回退为在 kernel 的 `HOME` 下做 user-site install（已验证：`openpyxl` 落在了 `<session scratch>/home/.local/lib/python3.12/site-packages`，pip 退出码为 0）——但 `-I` 会把 user site-packages 排除在 `sys.path` 之外，所以同一个 kernel 里紧接着的下一次 `import` 就会抛出 `ModuleNotFoundError`。这条 tool 描述文字描述的是应然，而不是实然。

## 决定

**只对持久化 kernel 去掉 `-I`；每个 probe 都保留它。** `interpreterArgv`（`execution.ts`）是仅供 kernel 使用的 argv 构造函数——interpreter probe 早已在 `environment.ts` 的 `probeArgv` 中独立构造自己的 direct argv，本次改动完全没有触碰它。probe 从不安装任何东西，所以在那里继续保留更严格的 isolated mode 默认值。

**给每个 kernel 一个属于自己的可写安装目录，而不是 session 的 `HOME`。** Python kernel 的固定 environment allowlist 新增 `PYTHONUSERBASE=<kernel scratch dir>/pyuser`；R kernel 的新增 `R_LIBS_USER=<kernel scratch dir>/rlibs`。两个目录都在 kernel spawn 时创建（`ScienceKernelScratch.userLibrary`，`scratch.ts`）——R 只有在目录已经存在时才会把 `R_LIBS_USER` 加进 `.libPaths()`；而指向一个 scratch-scoped 的路径（而不是任由 pip 回退到相对 `HOME` 的 `.local`）正是让这次安装变成 kernel 范围、而不是 session 范围的关键。

**按 kernel，而不是按 session 或 environment 划分范围。** `userLibrary` 位于 kernel 自己的 `kernels/<language>-<epoch>/` 目录下，用 `kernelEpoch` 做键，和 `tmp` 的做法完全一致。一次全新的 kernel——无论是 idle 重启、crash、interrupt escalation，还是 `environment-rebound`——都会拿到一个全新的、空的安装目录。这一点对 `environment-rebound` 尤其关键：一旦存在更新的 applied environment revision，受影响语言的下一次 run 就会针对新 revision 启动一个全新 epoch，而这个全新 kernel 绝不能看到 inline install 拉进*旧* revision 那个 kernel 里的包。如果范围划在 `HOME`（session 级）或某个 session 级目录上，就会让一次 stale 的 inline install 跨 environment rebind 泄漏；划在 kernel epoch 上则做不到这一点。

**Python 还需要第二处、并不显而易见的修复：kernel driver 本身，而不只是 flags/env。** 仅仅去掉 `-I` 并设置 `PYTHONUSERBASE` 并不够——针对真实 Conda prefix 的 real-acceptance 测试抓到了即使去掉 `-I`，同一个 kernel 内的 import 依然会失败。根因在于：Python 的 `site` 模块只在 interpreter 启动时把 user site-packages 目录加进 `sys.path` 恰好一次，而且只有在那一刻该目录*已经存在*时才会加。`PYTHONUSERBASE` 只是命名了那个可写的 base，pip 真正安装进去的叶子目录是一个嵌套的、依赖版本号的 `PYTHONUSERBASE/lib/pythonX.Y/site-packages`，它是 pip 在*第一次*安装时才惰性创建的——那时 `site.py` 早已完成了它那次性的扫描。只预先创建顶层的 `pyuser` 目录（也就是仅做 flags/env 改动会做到的程度）会让那个叶子目录在 kernel 启动时仍不存在，于是它从未被加进 `sys.path`，而该 kernel 里之后任何一次安装都无法追溯性地修复这一点。`kernel_python.py` 现在会在 driver 启动时调用一次 `site.addsitedir(site.getusersitepackages())`（先 `os.makedirs`，只在设置了 `PYTHONUSERBASE` 且 `site.ENABLE_USER_SITE` 为真时才执行），用 Python 自己对 user-site 目录结构的理解，而不是让 Node 一侧去猜一个与版本相关的路径。`sys.path` 是进程级全局状态，会在 kernel 的整个生命周期内保持，所以这一次启动时调用就覆盖了之后的每一个 `RUN` frame。R 则从来没有这个问题：`R_LIBS_USER` 直接命名的就是 library 目录本身（不存在嵌套结构需要构造），所以只预先创建 `scratch.ts` 已经在创建的那一个目录就足够了。

## 结果

已针对真实 Conda prefix（Python 3.12 的 `mesa` env、一个 R Conda env）完成端到端验证，绕开了 `real-acceptance.ts` 中一个与本次改动无关、早已存在的 chart-curation/attachment-readback 失败——它使整份脚本目前在本机无法跑到 `PASS`（已在未改动的 `main` 上复现出完全相同的失败，不在本次改动范围内）：在本地构建一个不依赖任何包、无需联网的 wheel／R 源码 tarball，在一个 kernel 内执行 `pip install --no-index`／`install.packages(repos = NULL, type = "source")`，在*同一个* kernel 内 import（成功），触发一次 `environment-rebound` kernel 重启，再次 import（失败：Python 报 `ModuleNotFoundError`，R 报 "there is no package called"）。两者都与设计完全吻合。`real-acceptance.ts` 已获得同样的检查序列，作为一段已提交、opt-in 的扩展（`DSH_SCIENCE_RUNTIME_REAL_ACCEPTANCE=1`），目前仅因为上述无关的既有阻塞项而无法在本机端到端跑完。

kernel run 那份 README 的 "Confinement and environment" 一节，以及 `install.packages()`／`pip install` 那条限制说明，已经从"应然"的措辞（"no code needed"）修正为对实际机制的如实描述。`run_python` 与 `run_r` 的 tool 描述文字本身不需要改动——其措辞早已描述了现在才成立的行为；用于固定它们的 keyless snapshot 已重新验证，内容未变。

## 考虑过的替代方案

- **让 `PYTHONUSERBASE`/`R_LIBS_USER` 指向 session 的 `HOME` 相对默认值（也就是什么都不做）**——这正是 Python 一侧修复前的状态（pip 自身的回退行为），也正是导致 stale install 跨 `environment-rebound` 泄漏的原因；本次改动正是要关闭这个缺陷，因此拒绝了这个方案。
- **把安装目录的范围划到 Science Session，而不是具体的 kernel 实例**——能在同一 environment revision 内挺过 kernel 重启，听起来很方便，但破坏了 `environment-rebound` 的不变量：针对更新 revision 的全新 kernel 绝不能带着针对旧 revision 安装的包。
- **添加 `-P`（Python 的 "safe path" flag）而不是去掉 `-I`**——按任务要求拒绝：`-P` 在用户配置的 Conda prefix 可能仍在使用的较老 interpreter 上并不存在，而本 Runtime 面向的是 operator 指定的任意 prefix，而非某个锁定的 Python 版本。
- **在 spawn 之前从 Node 一侧重跑一遍 `site` 处理来修复 `sys.path` 缺口**——在不重复实现 Python 自身那套与版本相关的 site-packages 目录结构逻辑的前提下，host 一侧做不到这一点；在 driver 内部用 `site.getusersitepackages()` 本身来做这件事，只需一次，且在 driver 可能运行的任何 Python 版本下都是正确的，做法更简单也更正确。
