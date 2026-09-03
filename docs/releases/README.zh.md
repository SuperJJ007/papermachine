# PaperMachine 发布记录

[English](README.md) | 中文

每个已发布的 PaperMachine 桌面 DMG 版本对应一份记录,文件名为 `<version>.md`,取自 `apps/desktop/package.json` 的 `version` 字段(例如 [0.1.1-rc.3.md](0.1.1-rc.3.zh.md)、[0.1.1-rc.4.md](0.1.1-rc.4.zh.md))。每份记录固定包含三节,顺序如下:

- **改了什么** — 相对上一个已发布版本改了什么:功能、修复和已知问题,按类别分组并链接到对应的 Agent Note。
- **实机验了什么** — 该 DMG 的实机验收结果,以按 checklist 条目 id 索引的表格呈现。
- **遗留** — 本次未解决的每一项去向:下一个版本,还是发布后队列。

发布记录第二节里引用的 checklist 条目 id,指的都是[docs/product/device-checklist.md](../product/device-checklist.zh.md)这份主 checklist 里的条目;发布记录本身从不重复条目的动作或预期结果,只记录本次的结果和备注。`apps/desktop/package.json` 里的版本号提升要求同一改动附带一份发布记录——这是打 DMG 的人要遵守的规则,不是本仓库目前有机制强制的门禁。

与具体版本无关的当前产品行为记录在[docs/product/papermachine.md](../product/papermachine.zh.md),不在这里。
