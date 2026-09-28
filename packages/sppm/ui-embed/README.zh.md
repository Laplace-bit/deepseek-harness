---
description: "SPPM Harness UI 嵌入包：在 Vue 页面中挂载 Agent 助手。"
kind: "package-reference"
---

# SPPM Harness UI 嵌入包

[English](README.md) | 中文

`@deepseek-ai/dsh-sppm-ui-embed` 提供 `mountAssistant(container, options)` 供 Vue 直接挂载。它通过网关 runtime 命名空间引导固定版本的 Harness Web 模块图，在无 iframe 的情况下挂载 React 客户端，并返回显示、隐藏、更新上下文和销毁方法。

## 概述

嵌入包负责在 SPPM 外壳挂载 Harness 助手，窗口管理、页面桥接和业务适配器仍由宿主应用负责。

**运行时不变量：** 本包没有发布不变量伴随模块，因为嵌入包不暴露由本包拥有的不变量状态。

## 目录

- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [模型体验](#model-experience)
- [开发备注](#dev-note)

浏览器资源构建为 `lib/assistant.js` 和 `lib/style.css`；`patch-browser-bundle.mjs` 移除 Node 专用模块包装，并为 Harness 的内部 Node 探测提供惰性浏览器行为。

在重新构建 Client 包后，从 Harness 仓库执行 `pnpm run bundle:sppm-assistant`。该命令会重新生成资源，同步到相邻 Vue 仓库的 `public/ai-harness/` 目录，并校验两侧字节完全一致。`start-sppm.sh` 启动网关前也会执行同样的同步。

<a id="model-experience"></a>
## 模型体验

无；该包只挂载 Harness 浏览器界面，不构造模型请求。

#### KV Cache 效果

Vue 集成只更新浏览器界面和页面上下文；Harness 负责构造请求和维护历史，因此该包不会替换可复用的缓存前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 嵌入契约不负责外层窗口、页面桥接 WebSocket 或 SPPM 翻译，这些由 `HarnessAssistantHost` 和 Vue 页面负责。

<a id="dev-note"></a>
### 开发备注

这是供维护者参考的工作备注。该包的浏览器构建不直接处理业务 API 或凭证。
