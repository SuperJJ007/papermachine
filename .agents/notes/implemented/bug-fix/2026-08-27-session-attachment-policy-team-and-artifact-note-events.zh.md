# Agent Note: session-attachment-index classifies team/* and Science artifact-note events

Status: implemented

[English](2026-08-27-session-attachment-policy-team-and-artifact-note-events.md) | 中文

## Problem

`dsh-session-attachment-index` 的 `policy.ts` 闭合列表(`BUILT_IN_CARRIER_EVENT_TYPES`、`ATTACHMENT_FREE_EVENT_TYPES`)是手工维护的,由一个针对 `KNOWN_SESSION_EVENT_TYPES` 的新鲜度测试校验。自这两份列表上次更新以来新增的六个已知事件类型,在两份列表中都没有条目:`experimental/agent-team` 的 `team/member`、`team/task`、`team/message/queued`、`team/message/delivered`,以及 `dsh-science-session` 的 `science/artifact-note-added`/`-removed`。一个未分类的已知类型隐式地成为 `extractor-required`,在某域包调用 `register()` 之前不授权任何内容——而这六个类型都没有任何包这样做,因此它们携带的任何图片引用都被悄悄拒绝授权,而不是被有意排除。`packages/session/session-attachment-index/tests/policy.spec.ts` 的 `'classifies every known session event type exactly once'` 抓到了这一漂移。

## Decision

按包自身声明的准则(闭合列表,而非"剩下的全归一类"),先读每个事件的 payload 类型再分类:

- `team/message/queued` 的 payload 是 `{ version, teamId, message: TeamMessageSnapshot }`(`packages/experimental/agent-team/src/types.ts`),而 `TeamMessageSnapshot.content: ContentBlock[]` 是一个真实的团队消息正文,可以携带 `image` 块——与 `extractBuiltInAttachments`(`packages/session/session-attachment-index/src/extract.ts`)已经为 `assistant/message` 一类事件扫描的 `data.message.content` 形状完全相同。归类为 `built-in`:无需新增提取器,现有扫描器已能在结构上直接触达它。
- `team/message/delivered` 的 payload(`{ version, teamId, messageId, targetId }`)是对某条已记录消息的送达确认,只按 id 引用,没有任何 content 字段。归类为 `attachment-free`。
- `team/member`(`{ version, teamId, member: TeamMemberSnapshot }`)与 `team/task`(`{ version, teamId, task: TeamTaskSnapshot }`)只携带纯粹的花名册/任务元数据(id、name、description、status 等标量字段)——两个快照类型里都没有任何 content 数组。归类为 `attachment-free`。
- `science/artifact-note-added`/`-removed`(`packages/science/science-session/src/domain.ts`)只携带 `artifactId`、一个版本/seq 数字、纯用户输入的备注 `text`,以及时间戳——与已经是 `attachment-free` 的 `science/outcome-published`/`science/kernel-state` 兄弟事件形状相同。归类为 `attachment-free`。

## Alternatives considered

**为求简单把六个都归为 `attachment-free`,反正只有 `team/message/queued` 在结构上携带内容。** 已拒绝:`team/message/queued` 确实可能携带图片(团队成员之间交换的正是聊天消息同款的 `ContentBlock[]` 正文),而内置扫描器已能直接触达它这个"包裹在 message.content 里"的确切形状,不需要新代码;把它留在 `attachment-free` 会悄悄从 Session ZIP 导出与实时 attachment RPC 中丢掉一个真实的、本已支持的附件引用。

**为 `team/message/queued` 注册一个提取器,而不是把它加入 `BUILT_IN_CARRIER_EVENT_TYPES`。** 已拒绝:提取器是为通用扫描器触达不了的形状准备的(不同的字段名、需要转换);而 `message.content` 正是扫描器本就为之而建的"包裹 content"模式,声明为 `built-in` 复用既有代码路径,而不是在新路径里重复它。

## Consequences

新鲜度测试的闭合列表不变式重新成立:每个当前已知的事件类型都有一次刻意的、唯一的分类。`team/message/queued` 的图片(六个类型里唯一真正携带内容的一个)现在成为已授权的附件引用,可通过实时 RPC 触达,并被纳入 Session ZIP 导出,与其他携带消息内容的事件类型早已具备的同款能力一致。

## Verification

`packages/session/session-attachment-index/tests/policy.spec.ts` 的 `'classifies every known session event type exactly once'` 在六个类型加入各自列表后通过。`packages/experimental/agent-team`、`packages/science/science-session`、`packages/host/apiproxy` 套件保持不变通过,确认当前没有任何消费方依赖这六个类型中的任何一个继续保持 `extractor-required`。
