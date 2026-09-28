---
description: "SPPM Harness 插件：认证页面能力的类型化模型工具。"
kind: "package-reference"
---

# SPPM Harness 插件

[English](README.md) | 中文

`@deepseek-ai/dsh-sppm-harness-plugin` 为语义 SPPM 页面动作和 Web 业务能力注册模型工具。传输层使用固定 Harness 实例令牌向网关发送类型化指令，并返回浏览器回执。页面标识是可选工具参数：模型省略时，插件先通过网关解析当前活动页面上下文，并按 Agent 会话绑定解析到的浏览器标签页，再携带解析结果发送动作；多个标签页首次发现时会明确返回歧义，不会自行选择。模板上下文、记录查询、草稿校验和用户确认后的表单提交都在已认证的 Web 页面中通过现有 Web API 客户端执行，Agent 不直接调用 Java 业务接口。它不提供任意 JavaScript、选择器、终端或文件操作。

## 概述

该插件是面向模型的 SPPM 能力边界。它发布业务参数工具，解析当前浏览器上下文，传输类型化页面动作，并保留等待、失败和已核验保存等结构化回执。

**运行时不变量：** 本包没有发布不变量伴随模块，因为插件不暴露由本包拥有的不变量状态。

## 目录

- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

`sppm_searchRoutes` 通过当前登录用户的 Web 菜单权限搜索可用路由，返回保留父子关系的 JSON 树以及便于直接选择的精简 `matches` 列表。仅返回当前用户可见的菜单项；分组、重定向和外链节点不能直接导航。请在 `navigateTo` 前调用此工具，并使用结果中的 `targetable=true`、`href` 和 `routeVersion`。该工具会自动发现并绑定当前浏览器标签页，搜索前不需要额外读取页面上下文。该工具只读，不修改页面或业务数据。返回数据还包含当前路由、菜单版本、匹配数量以及截断/完整性标记；当前页面不支持某项业务动作时，插件会在本地拒绝请求并返回页面能力和下一步建议。

`submitForm` 接收可选的客户端 `operationId`；省略时插件从 command id 派生操作 ID。首次提交结果可能是 `waiting_user`；页面展示实际草稿差异并在用户确认后异步继续保存。请使用相同的 `operationId` 再次调用 `submitForm`，取得经过回读核验的保存结果。页面刷新后，可省略 `values`，只传入该操作 ID，利用浏览器本地操作记录和现有 Web 列表/详情接口回读结果。由于现有 Web 接口没有服务端幂等账本，超时会标记为结果待核实，绝不会自动重发写入。

`fillForm`、`validateDraft` 和 `submitForm` 先使用 `sppm_readPageContext` 或 `sppm_readBusinessContext` 发现表单目录，再传入对应的 `formId`、`formVersion` 和 `values`。工艺卡表头阶段使用 `{ config }`，参数阶段和工艺卡模板使用 `{ config, moduleDtoList }`；模块、阶段和参数标识必须沿用目录返回值，不能把不同页面的 `fields` 或顶层 `templateStandards` 混用。表单标识或版本不匹配时，页面适配器返回可修正的字段问题而不会修改表单。

`readBusinessContext` 默认只返回摘要和字段目录；只有需要填充或校验完整草稿时才传 `includeDraft=true`，避免把大段参数数据无谓地放入模型上下文。

插件包提供源文件 `skills/sppm-process-card-create/SKILL.md`。SPPM 网关在启动每个用户的 Harness 子进程前，会把该文件幂等安装到用户 Harness 的 `${DSH_HOME}/skills`。SPPM 使用的 standard agent preset 挂载 Harness 原生的 `skill-filesystem` 和 `tool-skill`，因此该文件会经过同一套目录扫描、frontmatter 校验、变更监视和 skill 目录展示，并通过标准 `skill` 工具按需加载。插件不会向 `ctx.skills` 注册自定义提供方，不会在 `agent/pre-step` 注入指令，也不会使用按关键词自动加载器。该 skill 将工艺卡明确拆成表头和参数两个阶段：表头使用 `process-card-header`，确认并回读对象 ID 后使用 `editCardParameters` 打开参数页，再使用 `process-card-parameters` 按模块、工段、参数和单位填写完整 `moduleDtoList`。参数行的标准值、上下限、设定/实际值开关、设备菜单和参考图两个索引都有明确语义；图片或文件只能作为待核对证据，未知或歧义值必须询问。任一阶段未得到确认和 `verified=true` 回读，不能报告整张工艺卡完成。

<a id="model-experience"></a>
## 模型体验

### SPPM 页面动作调用

#### 模型看到什么

插件提供 `sppm_readPageContext`、`sppm_searchRoutes` 和其他已注册动作。结果包含当前页面上下文、路由匹配项、业务记录、校验问题或页面回执。`readBusinessContext` 默认返回摘要和字段目录；只有填充或校验需要完整草稿时才设置 `includeDraft=true`。

#### Token 效果

每个选中的动作都会提供工具定义，每次调用都会提供结果。路由和记录数量限制返回列表；`includeDraft` 控制完整表单数据是否进入结果。

#### KV Cache 效果

动作回执会追加到当前对话已有前缀之后。页面数据更新只会改变新结果的 token，不会替换先前消息；插件工具定义发生变化时，请求 schema 可能变化。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 参数录入依赖当前页面的菜单、字段目录和既有 Web API；插件不提供服务端事务或幂等账本。

- 材料解析仍属于独立能力，不放入本页面动作包。模板上下文、记录查询、草稿校验和提交都作为页面动作，由 Web 端继续负责凭证、权限、表单规则和业务请求格式。提交始终沿用 Web 表单自身的确认与保存流程。

<a id="dev-note"></a>
### 开发备注

这是供维护者参考的工作备注。插件不持有业务凭证，也不绕过页面权限，只能调用当前 Vue 适配器声明的能力。
