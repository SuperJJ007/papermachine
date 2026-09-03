# Agent Note: Science 上下文重复与 run 目录指引

Status: implemented

[English](2026-09-04-science-context-churn-and-run-directory-guidance.md) | 中文

## 问题

一次真机 22 步 Science session 把 `science:environment` runtime-context 快照重复发送了 14 次，每次都带着一行随每次 run 变化的 `Latest run <runId> (<language>): <status>.`。`dsh-agent-loop` 的 `RuntimeContextProjection.project()` 只要渲染出的文本与已保留的不同，就会 append 一份完整快照的新 `user/message` 副本，且从不替换更早的快照——替换会让 provider 的 prompt cache 对这条消息之后的一切失效，这与 [sandbox-policy context](../feature/2026-07-30-current-sandbox-policy-context.zh.md) 为同一机制建立的 cache 保留设计一致。一个本应只在变化时 append 的 context 里放了一行逐 run 变化的内容，于是每次 run 都会把一份约 2.4 KB 的新快照强行推入历史，即便该 run 自身的工具结果与 `get_science_state` 已经按需携带同样的状态。

同一个 session 里还发生了另一件事：某次 run 把中间结果 `boxplot_data.csv` 写到了 `SCIENCE_ARTIFACT_DIR` 下，下一次 run 又试图对同一相对路径调用 `pd.read_csv`，结果文件未找到——每次 run 都会拿到一个全新、私有的 artifact 目录，而 `STATIC_GUIDANCE` 此前没有说明写到那里的文件不会留存到下一次 run。模型随后正确地回退到了 kernel 变量，但这一次 run 被浪费了。第三项真机发现是:对一个 pingouin 结果 frame 用猜测的列名做索引，而不是该版本实际返回的列名,浪费了一步。

## 决定

**`renderScienceProjection` 不再渲染 `projection.runs`。** `packages/science/tool-science/src/context.ts` 中的 `Latest run …` 那一行被移除；现在这段 context 只在 `mode.modeRevision`、`environment` 或某个解释器绑定发生变化时才会改变，因此一次普通的 run 轮次会渲染出逐字节相同的 context，`RuntimeContextProjection` 也就不会 append 任何内容。run 的 status 依然通过每个 run 工具自身的结果、以及 `get_science_state` 的 `runs` 列表按需可见，而不是每轮都重发。append-而非替换 这一取舍本身没有变化，这里也不重复其论证，只链接到上面那条笔记：这次修复移除的是逐 run 重复的来源，而不是改动快照的投递方式。

**`STATIC_GUIDANCE` 里原有的两句 `SCIENCE_STATE_DIR`/`SCIENCE_ARTIFACT_DIR` 指引被重写，而不是再加第三句。** 第一句现在陈述:`SCIENCE_ARTIFACT_DIR` 是每次 run 都全新的目录，写在那里的文件到下一次 run 的目录中就不存在了，因此中间表格与工作数据应保存为 kernel 变量，或只在必须挺过 kernel 重启时才放进 `SCIENCE_STATE_DIR`——`SCIENCE_ARTIFACT_DIR` 只用于最终交付物，因为写在那里的合格文件会被捕获为 artifact。第二句保留了"当前目录是私有 scratch 目录"这一事实，以及通过 `SCIENCE_WORKSPACE_DIR`/绝对路径访问文件的指引,现在还补上了 `artifact_inputs` 的物化位置（从第一句移过来，因为第一句已不再需要携带这项事实）。`packages/science/tool-science/README.md`/`.zh.md` 逐字引用了 `STATIC_GUIDANCE`，在同一变更中一并更新，并通过 `verify-translation-pairing --write` 重新记录。

**`apps/desktop/resources/skills/statistical-analysis/references/library_result_frames.md` 新增一条"先打印列名"规则,以及经过核实的列名。** 规则是:在对本次 session 尚未用过的结果 frame 做索引之前，先打印 `result.columns`（R 中则是 `str(result)`）。规则下方的表格给出了 pingouin 的 `ttest`/`mwu`/`wilcoxon`/`anova`/`pairwise_tests`/`corr`，scipy.stats 的结果对象属性（`ttest_ind`、`mannwhitneyu`、`wilcoxon`、`f_oneway`、`kruskal`、`shapiro`、`levene`、`pearsonr`、`spearmanr`、`chi2_contingency`），以及 statsmodels `summary2().tables` 的三表结构的确切列名——每一个名字都是针对随桌面端一同发布的环境（pingouin 0.6.1、scipy 1.16.3、statsmodels 0.14.6）实际调用后读回的，而不是凭训练数据回忆的。`SKILL.md` 在 "Run the test" 这一工作流步骤里新增一句指向该参考文档的话；skill 正文停在 7,424 字符，低于 `apps/desktop/tests/bundled-skills.spec.ts` 强制的 8,000 字符上限。

## 权衡过的替代方案

**保留 run status 那一行，但把它作为单独、更小的 context 条目 append。** 拒绝：`dsh-system-prompt` 为每个已注册的 context 名字渲染一份有序快照，而现有的 `science:environment` 条目本就该把 mode/environment/解释器这些事实放在同一处；把 run status 拆成独立条目只会让 payload 变小，仍然每次 run 都 append，没有消除重复本身。

**新增第三句陈述 `SCIENCE_ARTIFACT_DIR` 逐 run 全新这一事实的句子，另外两句保持不动。** 任务本身就否决了这个方案：两句重叠地讲同两个目录，比重写既有两句要多花固定的每请求 token；而且既有两句本就需要"仅用于最终交付物"这层框架，才能让新事实变得可执行，而不只是一条描述。

**pingouin/scipy/statsmodels 的列名凭记忆或对这些库的一般了解来写。** 拒绝：该 skill 已有的 "Compatibility traps" 一节本就记录了 pingouin 一次跨版本的列名重命名，新参考文档里靠猜的列名只会重演这次修复要关闭的同一种失败模式。`library_result_frames.md` 里的每一个名字都是针对确切已安装版本，从 `result.columns`/`dir(result)`/`repr(result)` 读回来的。

## 结果

一个有 N 次 run、且 mode 或 environment 都没有变化的 Science session，在首次绑定之后现在会 append 零份额外的 runtime-context 快照，而不是每次 run 一份；keyless `science-tools` 场景的 `stream-json.expected.jsonl` 刷新后从 13 个 `user/message` 事件降到 8 个（JSONL 总行数从 207 降到 202），下游的 `seq`/`lastScienceEventSeq` 数值也相应下移，以匹配变短了的事件流——这是预期结果，不是回归，因为它们本就是 session 日志的序号。`model-view.expected.json` 逐字携带了重写后的 `STATIC_GUIDANCE` 与动态 context 文本。`packages/science/tool-science/tests/tool-science.spec.ts` 里原先的 "renders the latest run summary" 用例被替换为一个断言"有无 run 历史时 context 完全一致"的用例，描述的是新的不变式，而不是被移除的渲染行为。

一个把中间表格写到 `SCIENCE_ARTIFACT_DIR` 下、又期望能从下一次 run 的目录里读回它的模型，现在能在每次请求都会收到的指引里读到这种失败模式的名字；这次指引改动只是 prompt 文本，没有 schema 或工具改动。`docs/tool-catalog.md`/`.zh.md` 未受影响，因为它们是从 `run.ts` 里每个工具自身的描述重新生成的，这次修复没有动那部分——只改了共享的 `STATIC_GUIDANCE` 小节。

`library_result_frames.md` 是一份静态参考文件，除了 skill 正文自身的字符上限之外没有任何 gate 强制核实它；未来 pingouin/scipy/statsmodels 升级如果重命名了文档里记录的某个列名，是这份文件无法自动侦测的已知漂移，维护者需要在这些版本号变动时对照发布环境重新核实。
