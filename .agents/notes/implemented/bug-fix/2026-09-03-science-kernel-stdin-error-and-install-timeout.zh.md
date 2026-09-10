# Agent Note: 内核 stdin 的 EPIPE 处理与如实上报的安装超时

Status: implemented

[English](2026-09-03-science-kernel-stdin-error-and-install-timeout.md) | 中文

## 问题

没有流监听器时，异步 stdin EPIPE 可使 Host 崩溃。包安装也可能在超时宽限期成功，或在解释器身份不变时改变包。

## 决策

KernelProcess 在内核生命周期内保留 stdin error listener。活跃流错误进入协议失败；进程退出已结算后的错误不能成为未捕获 Host 异常。同步 write catch 不拥有异步流错误。

安装使用独立于普通调用超时的有效配置 `installTimeoutMs`。无信号 exit-zero 完成优先于已锁存 timeout 原因。重新观察比较身份及 `packagesSha256`；无变化时保留 revision 并报告 `environmentChanged: false`。真正超时会警告 prefix 可能已写入。

## 考虑过的替代方案

**每次 write 都加 try/catch。** 断管错误可能稍后通过 error event 到达。

**只按 control 的 timeout 原因分类。** 会误报宽限期内成功退出。

**只用 bindingFingerprint 判断无变化。** 身份有意不包括包 hash。

**硬编码更长安装常量。** 随部署变化的超时应为验证后的配置。

## 后果

无变化安装不能重启健康内核。超时不是回滚，验证应先于有界重试。历史 fixture 覆盖不证明所有 catalog 消费者；原记录指出缺少专门 API-catalog 测试，修改该消费者时仍须补足验证。

## 相关决策

相关 owner：[science-package-install](../feature/2026-09-01-science-package-install.zh.md).
