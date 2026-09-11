# Agent Note: CI fixture 的完成与隔离

Status: implemented

[English](2026-09-08-ci-completion-observations.md) | 中文

## 问题

[参考 CI 运行](https://github.com/deepseek-harness/deepseek-harness/actions/runs/34206953049)报告：轮询一秒后 webhook 创建的 Session 仍不存在，五秒读取期限内 PowerShell 输出为空。HTTP 接受、UI 投影状态、进程启动和持久化完成是不同的观察。测试需要明确的完成条件，并用对照阻止中间状态满足该条件。[完成等待决策](2026-09-08-ci-readiness-and-completion.zh.md)拥有这些条件与 lane 预算；这些 fixture 通过受控延迟使顺序与清理可观察。

## 决策

[GitHub 评审浏览器测试](../../../../apps/web/tests/github-ready-review.e2e.ts)在 HTTP 202 后阻塞真实 Workspace 创建，验证 Agent 和模型请求均不存在，再释放创建并等待对应 Session 的 `turn/end`。即使测试超时，清理也会释放屏障、恢复方法并移除事件监听器。Workspace 归属、请求数量、提示词内容和浏览器预期保留原有断言。

[PowerShell 执行器测试](../../../../packages/shell/pwsh-local/tests/executor.spec.ts)用私有文件屏障控制启动与消费式读取。测试决定后续输出何时可用；最终 stdin／环境变量输出在 `done` 后读取。轮询使用当前测试预算，每个创建的 Context 都在插件初始化前登记。清理在等待释放前同时取得 Context 与目录，完成释放后才删除目录。

[排队图片测试](../../../../apps/web/tests/queue-image.e2e.ts)分别阻塞接纳和附件读取，再捕获已接纳行中加载完成的缩略图。清理共享一个 Promise，释放保留的请求，并在关闭浏览器前等待其 handler 完成。

[详情 Session 生命周期测试](../../../../apps/web/tests/details-session-lifecycle.e2e.ts)在关闭状态出现后等待框架已捕获的动画 Promise，再检查轨道宽度为零。取消的过渡同样进入该断言；动画结束不能让持续非零的轨道通过。

[整队列 steering 测试](../../../../apps/web/tests/steering.e2e.ts)等待 steering 操作可用以及 composer 显示队列 steering 提示。模型流屏障在测试观察 steering 时阻止后续问题 composer 接管。清理在关闭浏览器前释放该屏障。

[Workspace 管理测试](../../../../apps/web/tests/workspace-management.e2e.ts)在下一次目录对话框操作前等待恢复后的 composer 焦点。归档用例通过 Session controller 为已知 seed id 设置显式用户标题，再用该精确标题跨重载定位行。无关的恢复行无法匹配该定位器；持久化归档断言仍检查 seed id 和保留的日志。

[Worker 预算测试](../../../../packages/code-runtime/code-runtime-worker-thread/tests/budget.spec.ts)保留真实 worker 执行与绑定传输，只控制 Host 定时器和 ELU 样本。测试先确认绑定已进入，再检验 idle、active 和壁钟决策，使启动超时不能冒充绑定期间的预算决策。[真实 worker 测试](../../../../packages/code-runtime/code-runtime-worker-thread/tests/runtime.spec.ts)独立保留实际 ELU、空闲绑定和热循环覆盖。

[分离启动测试](../../../../packages/host/open-in-app/tests/launch-detached.spec.ts)控制观察时间，并通过真实 launcher 登记的回调发送迟到进程事件。测试检查仅完成一次、仅 unref 一次且不终止子进程。[Resolver 测试](../../../../packages/host/open-in-app/tests/resolver.spec.ts)保留真实进程的环境变量和提前退出用例。

[LSP 背压测试](../../../../packages/lsp/lsp-stdio/tests/instance.spec.ts)保留真实暂停读取的 fixture 与大型原生管道写入。接受 abort 错误前，测试验证待处理写入回调已完成、捕获的子进程也已结束；`instance.dead` 在释放开始时就可能为真。

[E2B 子进程测试](../../../../packages/e2b/subprocess-e2b/tests/subprocess.spec.ts)在协作中断开始后阻塞 sandbox 获取，先让命令完成或进入终止，再放行获取。迟到的 INT 不得到达该进程组；获取失败也不能破坏正常命令完成和完全停稳。已完成的 stdin 写入证明启动就绪，因此发布前被忽略的中断无法满足竞态断言。

[Python 进程身份测试](../../../../packages/experimental/code-runtime-python/tests/process-start.spec.ts)提供相同 pid、不同启动时间的 procfs 记录，命令名包含右括号。记录缺失或不可访问时，身份信息不可用，但不能破坏清理。精确路径的文件系统拦截与恢复的平台元数据使非 Linux 主机也能观察解析器；[真实进程测试](../../../../packages/experimental/code-runtime-python/tests/runtime.spec.ts)保留 Linux 内核与进程组证据。合成 procfs 记录本身不能证明内核信号行为。

### 优雅释放期间的 DNS 完成

`fetch` 被拒绝或取消不证明其 DNS 查询已经结束。[代理 dispatcher 的释放函数](../../../../packages/util/http-proxy/src/install.ts)先恢复进程状态，再等待优雅关闭 `agent.close()`，后者仍可能等待尚未完成的 DNS。因此，请求期限不能约束清理耗时；受控 DNS 屏障确认，fetch 拒绝后释放仍可处于等待状态，直到查询回调被放行。

[代理安装测试](../../../../packages/util/http-proxy/tests/install.spec.ts)只为精确的 fixture 主机名完成 DNS 失败，并在 `finally` 中恢复原 resolver。测试保留真实全局 fetch、dispatcher 和回环代理连接：直连必须发生本地查询并得到 `ENOTFOUND`，可用 HTTPS 代理则必须收到 CONNECT 且不在本地解析目标域名。仅凭请求被拒绝无法区分这两条路径。释放还验证 dispatcher、路由和代理环境变量恢复。这些测试控制 resolver 完成，不测量操作系统 DNS 延迟。

### 已构建 Client 的导入分类

[Node 导入遍历](../../../../packages/experimental/webworker-runtime/tests/compile/transform-corpus-check.ts)使用不含工作区源码别名的 TypeScript 配置，使每个依赖保持发布模块身份。Dockkit 仅在 `ERR_UNKNOWN_FILE_EXTENSION` 指向其已构建 `dockkit.module.css` 或 primitives 依赖的已构建 `StateDot.module.css` 精确路径时被接受；任一 ESM 依赖都可能先失败。其他样式表路径、源码树样式表、其他错误及意外成功的豁免导入都会失败。限定范围的 resolve/load hook 验证这些结果，不改共享构建产物。Win32 绑定共享一个模块实例，因此不需要重复 koffi 注册豁免。

## 考虑过的替代方案

**生产超时、重试或套件串行化。** 拒绝，因为均不能建立缺少的完成观察。

**从接受或预览推断完成。** HTTP 202 和乐观图片可能早于被断言的操作。

**用受控样本替换实测 worker 覆盖。** 拒绝，因为会遗漏对 Node 实际 ELU 与传输行为的验证。

**强制销毁 dispatcher 或延长测试超时。** 销毁会改变生产环境中允许进行中请求完成的保证；延长超时仍让 resolver 完成时间处于 fixture 控制之外。确定性 DNS 完成保留优雅释放和实际路由断言。

## 影响

每个 fixture 拥有自己的时钟、屏障、回调、进程和临时路径。受控观察补充真实 worker、子进程、浏览器和持久化路径。产品行为、生产时序、基准预算、CI 调度和录制预期均保持不变。
