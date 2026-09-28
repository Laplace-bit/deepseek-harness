---
description: "SPPM 包组：通过类型化页面动作将已登录的 Vue 业务页面连接到 Harness 助手。"
kind: "package-group"
---

# SPPM/ — 工艺参数管理集成

[English](README.md) | 中文

## 概述

SPPM 组把已登录的 Vue 业务页面连接到 Harness 助手。页面桥接定义带版本的动作和回执；Harness 插件向模型提供获准的动作；网关认证并路由每位用户的 Harness 进程；嵌入包把助手挂载到 Vue 中。profile 补丁为托管助手组合 SPPM 工具。各包 README 负责说明自身的配置和限制。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

当 SPPM 页面需要向嵌入式助手提供业务动作时，可组合使用这些包。

| 包 | 职责 |
|---|---|
| [`page-bridge/`](page-bridge/README.zh.md) | 共享页面上下文、动作、回执类型和页面能力注册表 |
| [`harness-plugin/`](harness-plugin/README.zh.md) | 校验并传输页面动作的 SPPM 模型工具 |
| [`gateway/`](gateway/README.zh.md) | 认证后的用户级 Harness 路由和页面动作投递 |
| [`ui-embed/`](ui-embed/README.zh.md) | 助手浏览器资源和 Vue 挂载 API |

-----

<a id="related-documentation"></a>
## 相关文档

- [SPPM 集成](../../docs/sppm-integration.zh.md)——工作区设置和集成流程。
- [SPPM 页面桥接协议](../../docs/sppm-page-bridge-protocol.zh.md)——共享动作名称、上下文版本、回执和校验规则。
- [SPPM profile 补丁](gateway/profile/cordis.patch.yml)——SPPM 助手启用的 Harness 配置行。

<a id="dev-note"></a>
## 开发备注

无。
