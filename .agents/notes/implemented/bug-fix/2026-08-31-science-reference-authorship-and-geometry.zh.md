# Agent Note: Science 引用保留用户身份与导出几何信息

Status: implemented

[English](2026-08-31-science-reference-authorship-and-geometry.md) | 中文

## 问题

选中的产物区域在裁剪和插入 composer 后，必须保留用户作者身份及精确图像坐标。

## 决策

Science 通过拥有该输入的 Chat source 注册引用输入。用户创建的选择保持为用户输入，不根据通用消息文本或私有 composer 插槽分类。引用指定不可变版本。矩形坐标在裁剪变换后依据原始 PNG 尺寸换算，而不是依据缩放后的显示元素。

裁剪图片与元数据描述同一源矩形；浏览器缩放和布局变化不能改变所选科学区域。

## 考虑过的替代方案

**扫描任意内容来推断作者。** 生成文本可能仿似用户引用，从而取得错误权限或位置。

**把 CSS 显示像素当作源坐标。** 缩放和裁剪会静默改变选区。

**增加第二条 composer 路径。** 会分裂输入所有权并绕过原生 Chat 注册。

## 后果

几何测试需要实际裁剪偏移和缩放，不能只测恒等变换。精确版本引用避免后续产物更新改变已提交选择的含义。

## 相关决策

相关 owner：[science-native-sidebar](../architecture/2026-09-10-science-native-sidebar.zh.md); [science-read-remotes](../architecture/2026-09-09-science-read-remotes.zh.md).
