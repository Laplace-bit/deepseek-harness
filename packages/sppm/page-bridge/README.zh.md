---
description: "SPPM 页面桥接：Vue 业务页面与 Agent 工具之间的类型化语义动作。"
kind: "package-reference"
---

# SPPM 页面桥接

[English](README.md) | 中文

`@deepseek-ai/dsh-sppm-page-bridge` 定义浏览器与 Agent 之间的类型化页面动作契约。注册表拒绝未知页面、重复指令 ID、过期请求、旧上下文版本、错误浏览器实例和不支持的动作。

## 概述

桥接包统一 SPPM 页面发现、上下文版本、语义业务动作和结构化回执，不提供 DOM 自动化接口。

**运行时不变量：** 本包没有发布不变量伴随模块，因为桥接包不暴露由本包拥有的不变量状态。

完整的协议版本 1 通信契约见 [SPPM 页面桥接协议](../../../docs/sppm-page-bridge-protocol.zh.md)。页面适配器发布经过白名单筛选的 JSON 快照，所有动作都遵循其中定义的共享请求和回执规则。

## 目录

- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [模型体验](#model-experience)
- [开发备注](#dev-note)

`readPageContext` 请求会解析发出请求的浏览器实例所注册的页面并返回其当前上下文，调用方因此可以在执行其他动作前先获知页面 ID 和上下文版本。`searchRoutes` 和 `navigateTo` 是由 Web 端提供的全局能力：即使目标业务页面尚未打开或表单仍在加载，也会使用宿主页当前的路由/菜单上下文。`navigateTo` 必须使用搜索结果返回的目标 `href`，并由同一份实时菜单目录校验。其他动作仍要求调用方提供的页面 ID 和上下文版本与实时页面一致。

该包不提供 DOM 选择器或脚本执行 API。Vue 页面负责注册和注销，网关与 Harness 插件传输 `PageActionRequest` 和 `PageActionReceipt`。

<a id="model-experience"></a>
## 模型体验

间接地，通过 SPPM Harness 插件对页面动作协议的使用。

#### KV Cache 效果

桥接层向 SPPM Harness 插件返回带版本的页面回执；新回执会追加到先前对话消息之后，不会改写它们。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 字段级校验和未保存表单冲突提示由各个注册页面负责；桥接层不提供通用浏览器自动化后备能力。

<a id="dev-note"></a>
### 开发备注

这是供维护者参考的工作备注。Vue 适配器负责业务校验和注销，桥接包只执行跨页面协议约束。
