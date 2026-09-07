# Agent Note: TUNA 在 win32 package cache 下必然超出 MAX_PATH；默认源改为 USTC

Status: implemented

[English](2026-09-07-win32-package-cache-tuna-max-path.md) | 中文

## Problem

issue #22 报告了一次 Windows 安装在 TUNA 上失败并悄无声息地重试，最终在 USTC 上成功——但每个 package 都被重新下载并缓存了一遍。一次调查（gitignored scratch，未提交：`.agents/tmp/2026-09-07-issue-review/R2-report.md`）发现 TUNA 那次尝试不是网络抖动：它每次都在 `libstdcxx-devel_win-64-16.2.0-h230208c_104`——一个由 `r-base`/`r-rcpp` 透传拉入、并非 `general.json` 声明的 22 个顶层包之一的头文件——处确定性地失败，报错是 `libmamba Error when extracting package: remove_all: The directory is not empty`。

2026-09-05 的修复（`2026-09-05-win32-package-cache-max-path.md`）把 win32 package cache root 缩短到 `<SystemDrive>\pm\pkgs`（10 个字符），依据是"随应用发布的 `general` declaration 最长的分层相对 cache 路径约为 245 个字符"这一估算——加上 10 字符的 root 后仍在 win32 260 字符 `MAX_PATH` 之内、留有余量。这个估算没有算上 `libstdcxx-devel_win-64` 那个最深的头文件——本次 issue 里 TUNA 失败正是溯源到这个透传依赖。直接量测 micromamba 2.x cache 产生的真实路径结构（`pkgs/https/<mirror host>/<channel path>/noarch/<package>/Library/lib/gcc/x86_64-w64-mingw32/16.2.0/include/c++/ext/pb_ds/detail/cc_hash_table_map_/constructor_destructor_no_store_hash_fn_imps.hpp`）得到：USTC 主机名（`mirrors.ustc.edu.cn`）下这条相对路径是 242 个字符，TUNA 主机名（`mirrors.tuna.tsinghua.edu.cn`）下是 251 个字符——单纯因为 cache 路径里主机名更长,多出 8 个字符。加上 10 字符的 root：USTC 总长 252（留 8 字符余量），TUNA 总长 261——比 `MAX_PATH` 多 1 个字符。官方源（`conda.anaconda.org/conda-forge`，没有 `/anaconda/cloud/` 这段路径）总长 236。在共享的云 Windows 机上复现完全相同的 `create`（零下载，字节已在 cache 中）证实了这一点：TUNA 每次都以这种方式失败；USTC 与官方源不会。TUNA 同时也是 `source-selection.ts` 为中国大陆 locale 选中的默认源，所以本次 issue 的报告者是通过默认路径而非手动选择碰到它的。

## E1 实验：`\\?\` 长路径前缀，在真机上试过并被否决

2026-09-05 笔记的"Alternatives considered"一节在没有真机测试的情况下否决了 `\\?\` 长路径前缀,理由是"并不被 micromamba/conda 工具链自身路径处理中的每一个工具普遍支持"。本次在共享的云 Windows 机上,用与 TUNA 复现完全相同的 `create` argv/env,把 `CONDA_PKGS_DIRS` 换成 `\\?\C:\pm\pkgs`,prefix 挪到别处以免碰到真实 cache 或已装应用。结果立即失败（0.15 秒,连路径长度都还没被考虑到）：

```
error    libmamba Bad conversion of configurable 'pkgs_dirs' from environment variable 'CONDA_PKGS_DIRS' with value '\\?\C:\pm\pkgs' : yaml-cpp: error at line 1, column 4: unknown token
critical libmamba yaml-cpp: error at line 1, column 4: unknown token
```

micromamba 2.9.0 通过它基于 YAML 的配置层（`yaml-cpp`）解析 `CONDA_PKGS_DIRS`,而 `\\?\` 在这里不是合法的 YAML 标量语法——反斜杠加问号这个序列是一个无法识别的转义 token。这是配置加载阶段的硬性拒绝,独立于且先于任何 Win32 路径长度行为；在这个版本里,这个前缀根本无法通过这个环境变量传给 micromamba。完整日志：`.agents/tmp/2026-09-07-win32-crt/exp/e1.log`（gitignored scratch，未提交）。

## Decision

`resolvePackageCacheDir`（`apps/desktop/src/provisioning.ts`）未改动：在 win32-x64 上仍然返回 `<SystemDrive>\pm\pkgs`。在这种 cache 布局下,进一步缩短这个 root 救不了 TUNA：分层路径本身已经带着 micromamba 控制的固定的 `https/<mirror host>/<channel path>/noarch/<package>/...` 段,而 TUNA 主机名本身（28 字符,比 USTC 长 8 个字符）就占满了 USTC 总长 252 与 TUNA 总长 261 之间全部 9 字符的差距——没有哪个短到有意义的 root 是现实的选择（哪怕把 root 压到个位数字符,也只能换回个位数的字符,而这个 root 现在已经是 10 个字符）。

取而代之的是：`general.json` 的 `sources` 重新排序为 `ustc`、`tuna`、`official`（USTC 在前）,`source-selection.ts` 的 `CHINA_MIRROR_SOURCE_ID` 从 `'tuna'` 改为 `'ustc'`——它是按 id 选择,不是按列表位置,所以只改 JSON 顺序并不会改变中国大陆 locale 实际最先尝试的源。TUNA 仍然留在列表里供确认面板手动选择；手动选它仍然会以同样的方式失败,因为底层 cache 布局没有变。已在共享的云 Windows 机上端到端验证：只用 USTC 单源跑一次 `create`,复用机器上已有的 cache,`CONDA_PKGS_DIRS=C:\pm\pkgs` 保持不变,完整跑完（`EXITCODE=0`）,两个 health check 都通过——`python.exe -c "import sys;print(sys.version)"` 报告 3.13.15,`Scripts\Rscript.exe -e "library(tidyverse);library(haven);library(lme4);library(survey);library(data.table)"` 加载了全部声明的 R package,包括 `libstdcxx-devel_win-64` 本身。日志：`.agents/tmp/2026-09-07-win32-crt/exp/final.log`、`verify-final.log`（gitignored scratch，未提交）。

`general.json` 的 `estimatedDownloadBytes` 也从 520,000,000 改为 850,000,000：在共享的云 Windows 机上实测,单源 `create` 的压缩包下载量约 0.80GB,比此前声明的 0.52GB 高 54%。

## Alternatives considered

- **`mirrored_channels`（单次 `create` 尝试内,TUNA/USTC/official 三源文件级失败转移）。** 能更彻底地解决本次 issue 的失败模式——312 个包里 311 个在 TUNA 下都能成功,文件级失败转移可以只把 `libstdcxx-devel_win-64` 这一个包换到主机名更短的镜像重试,不需要在新源下把整套包重新下载一遍——但调查发现,当 `mirrored_channels` 列表里第一个镜像不可达时,在一个故意探测 404 的配置下出现了疑似无限期挂起（100 多秒无新日志输出,手动 kill）,而不是干净的失败转移。这必须先在真机上查清根因并验证可靠,才能让本应用在每一次 provisioning 尝试上依赖它；延后到 0.1.2。
- **重试前把已下载的 tarball 硬链接到新源期望的 cache 路径。** 能彻底消除跨源重复下载的问题（同一份包字节,不同镜像）。未实测：需要逆向 micromamba 未文档化的按包 cache 子路径约定,没有公开 API 可查询,要接受与 micromamba 内部布局绑定的维护成本。延后,取决于上面 `mirrored_channels` 可靠性的结论；一旦文件级失败转移把跨源重复下载缩小到极少数真正需要它的包,这个方案的优先级大概率更低。
- **进一步缩短 win32 cache root（例如去掉 `pm` 这层变成 `C:\pkgs`）。** 本次修复否决：上面的算术已经说明,在不假设掉 micromamba 自己控制的固定 `https/<host>/<channel>/...` 段的前提下,没有现实可行的 root 缩短能补上 TUNA 那 1 个字符的超出；真正能撬动的杠杆是 cache 路径用哪个镜像的主机名构建,而不是共享 root 有多短。

## Consequences

从确认面板手动选择 TUNA 仍然会因为上述原因确定性失败；现在这一点已被记录,而不是被人再报一遍才发现。`general.json` 的源顺序是一个活的产品决定（中国大陆用户默认拿到哪个镜像）,现在由这次真实量测驱动,而不是此前未经量测的估算；`source-selection.ts` 的 `CHINA_MIRROR_SOURCE_ID` 与 `general.json` 的源顺序由测试覆盖,断言 `'ustc'` 既是被选中的 id 也是随发布列表的第一项（`apps/desktop/tests/source-selection.spec.ts`、`apps/desktop/tests/environment-declaration.spec.ts`、`apps/desktop/tests/provisioning.spec.ts`）。`\\?\` 长路径前缀对这个 micromamba 版本的 `CONDA_PKGS_DIRS` 而言现在是一个已经查清的问题,不再是一个未经验证的否决——以后若要考虑这里的长路径支持,需要一个不同的机制（例如系统级的 `LongPathsEnabled`,2026-09-05 笔记里已因这个不需要提权的安装包没有提权能力而否决过）。
