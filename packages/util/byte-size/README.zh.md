# dsh-byte-size

[English](README.md) | 中文

一个零依赖、只含一个纯函数的库——不依赖任何运行时 harness、没有 `ctx`、不持有任何状态——供任何需要展示文件或附件字节数、却不打算自己拥有字节数展示语义的 capability 或 Client 包共享。

## 对外接口

```ts
import { formatBytes } from '@deepseek-ai/dsh-byte-size'
```

| 导出 | 作用 |
|---|---|
| `formatBytes(bytes)` | 把字节数格式化为紧凑的 `B`/`KB`/`MB` 标签，超过 1024 字节时保留一位小数。 |

## 使用形态

```ts
import { formatBytes } from '@deepseek-ai/dsh-byte-size'

formatBytes(0)               // '0 B'
formatBytes(1536)            // '1.5 KB'
formatBytes(5 * 1024 * 1024) // '5.0 MB'
```

## 模型体验

间接影响，通过诸如 `dsh-tool-science` 的 `run_python`/`run_r` 结果文本这样的消费方——它为每一条被捕获的 artifact 行追加一个字节数，使用的正是本包给出的紧凑标签。

#### KV Cache 影响

无直接失效；每个格式化后的标签都是作为其消费方自身工具结果的一部分被追加的，该结果的追加式或替换式 KV Cache 行为由消费方自己拥有。

## 已知限制与暂缓事项

- **未做本地化** — 标签的单位缩写不随调用方语言环境变化。`dsh-client-ui-science` 的 artifact 大小行会把该标签插入自己已本地化的 UI 文本中；`dsh-tool-science` 的运行结果摘要则直接把它渲染为未本地化的开发者可见文本。
