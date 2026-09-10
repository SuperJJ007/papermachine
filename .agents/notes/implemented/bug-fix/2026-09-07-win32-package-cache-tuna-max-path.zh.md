# Agent Note: TUNA 在 win32 package cache 下必然超出 MAX_PATH；默认源改为 USTC

Status: implemented

[English](2026-09-07-win32-package-cache-tuna-max-path.md) | 中文

## 问题

即使 Windows 缓存根很短，micromamba 把长镜像域名加入包路径后仍可能没有余量。

## 决策

缓存根保持 `<SystemDrive>\pm\pkgs`，产品源顺序和中国 locale 默认优先 USTC。历史解压测量中，同一包在该根下 USTC 路径为 252 字符，TUNA 为 261 字符。再删除一段根路径只给 TUNA 留约两个字符余量，还会放弃现有缓存下载。TUNA 仍可选择，但不保证解决底层路径限制。下载体积估计须反映实际声明包集，而非较小历史猜测。

## 考虑过的替代方案

**立即启用 mirrored_channels。** 调查发现首镜像失败时疑似挂起；成为 provisioning 依赖前，需要真实硬件诊断可靠文件级回退。

**把下载硬链接到另一镜像缓存布局。** 依赖未公开 micromamba 内部结构，应先理解受支持镜像回退再考虑。

**继续缩短根。** 微小余量无法承受未来更长包成员，还会迫使重新下载缓存。

## 后果

源偏好减少已知失败，不保证未来全部归档路径都能放下。历史 USTC 安装成功不是当前平台验收。重引入文件级镜像须针对打包的 micromamba 版本取得有界失败和回退证据。

## 相关决策

相关 owner：[win32-package-cache-max-path](2026-09-05-win32-package-cache-max-path.zh.md); [desktop-owns-its-environment](../feature/2026-09-01-desktop-owns-its-environment.zh.md).
