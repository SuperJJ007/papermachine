# Agent Note: Science 产物捕获的 verbatim 图片准入

Status: implemented

[English](2026-08-22-science-verbatim-image-capture.md) | 中文

## 问题

附件存储的图片准入会运行规范化管线（EXIF 方向、剥离元数据、sRGB 转换、长边缩至 `normalizedImageMaxDimension`、格式候选）。这对模型与浏览器消费的聊天上传是正确的,但 Science 自动捕获存储的是科学证据:被捕获版本的字节必须与 run 写出的完全一致地读回。Matplotlib 输出通常携带 `Software` 元数据块,且可能超过规范化尺寸上限,于是规范化改写了捕获的图表字节;被缩放的引用还会带上 `originalDimensions`——严格的 `science/artifact-saved` codec 拒绝该键,导致一次成功的 run 之后整个 `run_python` 调用报错。

## 决定

`SaveImageAttachment` 携带显式准入通道:`normalization?: 'normalize' | 'verbatim'`,默认 `'normalize'`。verbatim 通道保留完整解码验证与全部源准入上限（字节上限、像素与尺寸上限、声明类型比对）,但把提交的字节原样存储——不改元数据、色彩、编码或尺寸,规范化字节上限也不适用。verbatim 引用对源字节取 digest,永不携带 `originalDimensions`。Science 捕获（`science-runtime` 的 `captureRunArtifacts`）以 verbatim 提交图片。

严格的 Science codec 继续拒绝 `originalDimensions`:捕获按构造即 verbatim 后,规范化引用进入 Science 事件即表明生产方缺陷,严格模式让它大声暴露,而不是默默接纳被改写的证据。

## 后果

Science 捕获可以承诺字节完全相同的证据,同时聊天上传继续使用规范化存储。需要 verbatim 持久化的调用方必须在每张图片上显式选择;附件存储仍负责两条通道的完整解码验证与源准入上限。

## 考虑过的替代方案

- 存储级或按 store 实例的策略开关:通道是每次提交自身的事实,同一个 store 因此可同时服务聊天规范化与 Science 证据。
- 放宽 Science codec 接受规范化引用:那等于用字节精确保证换取对"本决定旨在防止的改写"的容忍。

## 验证

`attachment-local` 存储测试证明:在 normalize 通道会改写的场景（缩放）下 verbatim 提交逐字节读回一致、准入拒绝保留（类型不符、字节上限）、且永不产生 `originalDimensions`。`science-runtime` 捕获测试用带元数据的 PNG 驱动真实 store 端到端,比对读回字节与写出文件。opt-in 的真实 Conda acceptance 中 curated-chart 读回检查在真实解释器上验证同一合同。
