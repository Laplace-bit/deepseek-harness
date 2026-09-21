---
description: "SPPM Harness UI 嵌入包：在 Vue 页面中挂载 Agent 助手。"
kind: "package-reference"
---

# SPPM Harness UI 嵌入包

[English](README.md) | 中文

`@deepseek-ai/dsh-sppm-ui-embed` 提供 `mountAssistant(container, options)` 供 Vue 直接挂载。它通过网关 runtime 命名空间引导固定版本的 Harness Web 模块图，在无 iframe 的情况下挂载 React 客户端，并返回显示、隐藏、更新上下文和销毁方法。

## 概述

嵌入包负责在 SPPM 外壳挂载 Harness 助手，窗口管理、页面桥接和业务适配器仍由宿主应用负责。

## 目录

- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

浏览器资源构建为 `lib/assistant.js` 和 `lib/style.css`；`patch-browser-bundle.mjs` 移除 Node 专用模块包装，并为 Harness 的内部 Node 探测提供惰性浏览器行为。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

嵌入契约不负责外层窗口、页面桥接 WebSocket 或 SPPM 翻译，这些由 `HarnessAssistantHost` 和 Vue 页面负责。

<a id="dev-note"></a>
### 开发备注

这是供维护者参考的工作备注。该包的浏览器构建不直接处理业务 API 或凭证。
