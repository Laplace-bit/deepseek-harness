---
description: "SPPM 页面桥接协议：Vue 页面上下文和语义动作的通信契约。"
kind: "package-reference"
---

# SPPM 页面桥接协议

[English](sppm-page-bridge-protocol.md) | 中文

本文档定义 SPPM Vue 宿主、网关、Harness 插件和页面适配器之间的协议版本 1。消息类型和动作名称的可执行来源是 [src/index.ts](../packages/sppm/page-bridge/src/index.ts) 中的 TypeScript 声明。

## 范围

协议传输 JSON 页面上下文、语义页面操作请求和结构化回执。不暴露 DOM 选择器、任意 JavaScript、组件实例、Vuex store、浏览器 Cookie 或 Java 业务接口。

Web 应用拥有页面上下文和业务动作的含义。网关负责认证和路由。Harness 插件发布面向模型的工具，不自行编造页面数据或路由路径。

## 版本和消息规则

`SPPM_PAGE_BRIDGE_PROTOCOL_VERSION` 标识通信契约版本。为兼容旧适配器，协议版本 1 的上下文可以省略 `protocolVersion`，新适配器必须提供它；如果提供了其他版本，必须 fail closed，并要求用户刷新 Web 页面。新增可选字段保持兼容；修改必填字段、动作名称、状态或校验规则时必须变更协议版本。

所有标识都是不透明字符串。浏览器宿主创建 `browserInstanceId`，运行时把它绑定到发起请求的标签页。模型不能自行编造标签页 ID、页面 ID、指令 ID、会话 ID 或上下文版本。

消息只包含 JSON 值。页面适配器在桥接发送前把 Vue 状态转换为普通快照。函数、响应式对象、组件引用、循环对象、凭据和任意 store 内容都不是合法协议数据。

可选字段没有值时必须省略，不能把 JavaScript 的 `undefined` 放进回执或业务数据；发送前的 JSON 校验失败必须返回 `failed`，并在 `issues` 和 `nextAction` 中说明修复方向。

## 页面上下文

`PageContext` 是注册页面在某个 `contextVersion` 下的快照。

| 字段 | 契约 |
| --- | --- |
| `protocolVersion` | 页面适配器发出的页面桥接版本。 |
| `browserInstanceId` | 不透明的浏览器标签页绑定。 |
| `pageId` | 注册页面适配器的稳定 ID。`sppmHost` 表示全局宿主适配器。 |
| `contextVersion` | 非负版本；暴露的选中项、表单摘要、字段定义、路由或能力发生变化时递增。 |
| `route` | 当前完整 Web 路由，包括 query 字符串。 |
| `title` | 本地化页面标题。 |
| `selection` | 可选的页面选中项或查询值。 |
| `form` | 可选的页面表单摘要，不是权威的完整业务对象。 |
| `fieldSchema` | 可选字段定义，包括字段标识、名称、类型、单位、必填标记、选项、模块和阶段编码。 |
| `forms` | 可选的当前页面表单目录。每项包含稳定的 `formId`、`formVersion`、操作模式和 `draftSchema`，还可以声明业务阶段 `phase` 和绑定对象 `objectId`。模型必须先读取目录，再把相同的标识和值结构传给表单动作。 |
| `capabilities` | 页面适配器提供的语义动作。未知动作名称无效。 |

页面适配器通过 `readContext()` 发布经过白名单筛选的投影。完整业务对象、完整记录集合和已保存值通过 `readBusinessContext`、`queryRecords` 等业务动作读取。

## 请求

`PageActionRequest` 包含 `commandId`、`userId`、`sessionId`、`browserInstanceId`、`targetPageId`、`contextVersion`、`action`、`args`、`issuedAt` 和 `expiresAt`。

`commandId` 对一次投递尝试唯一。桥接层拒绝重复指令。`expiresAt` 是绝对截止时间，过期请求不能到达页面适配器。首次 `readPageContext` 发现请求可以使用空的 `sessionId`、`targetPageId` 和 `-1` 上下文版本；返回的页面上下文会提供后续动作所需的值。

只有发现请求允许省略 `targetPageId` 并使用负的 `contextVersion`。发现到的上下文提供后续动作使用的页面 ID 和版本。`args` 只能包含动作相关的语义 JSON，不能包含选择器或脚本。

传输使用经过认证的网关路由 `/api/sppm/v1/page-context` 和 `/api/sppm/v1/page-actions`。网关通过绑定到相同用户和浏览器实例的认证 WebSocket，把请求发送给浏览器页面桥接。

## 回执

`PageActionReceipt` 包含 `commandId`、`state`、`contextVersion`，以及可选的 `message`、`data`、`issues` 和 `nextAction`。

| 状态 | 含义 |
| --- | --- |
| `succeeded` | 读取、导航、准备或写入按照动作契约完成。写入只有在页面适配器完成核验后才算成功。 |
| `waiting_user` | 页面正在等待用户明确确认。该回执不是成功；支持该流程的动作可以通过操作 ID 恢复。 |
| `failed` | 请求无法完成。可用时由 `issues` 返回字段或业务问题。 |
| `cancelled` | 用户或页面取消了操作。 |
| `expired` | 请求或其上下文已失效。调用方必须重新读取上下文或状态后再重试。 |

`data` 由动作定义。`readPageContext` 在 `data.context` 下返回上下文。成功的写入结果包含页面适配器定义的业务对象标识和核验数据。缺少必需核验数据的回执不能作为成功写入结果。

`searchRoutes` 的 `data` 同时提供保留父子关系的 `tree` 和便于模型直接选择的 `matches`。`matches` 只包含 `targetable=true` 的可导航节点，并带有 `href`、`routeVersion` 所属的菜单版本和必要的 `ancestors`；模型必须使用这些返回值导航，不能猜测路径。

## 动作分类

协议动作列表是封闭集合，并由 `SPPM_PAGE_BRIDGE_ACTIONS` 导出。

| 动作 | 分类 | 必须遵循的行为 |
| --- | --- | --- |
| `readPageContext` | 发现 | 解析与浏览器实例绑定的页面并返回当前上下文。 |
| `searchRoutes` | 全局读取 | 搜索当前用户可见的 Web 菜单树。只有搜索结果可以作为 `navigateTo` 的来源。 |
| `navigateTo` | 全局导航 | 接受搜索得到的 `href` 和可选的 `routeVersion`，在导航前按实时 Web 菜单校验两者。 |
| `readBusinessContext` | 业务读取 | 通过现有 Web 客户端读取页面拥有的业务数据和字段定义。 |
| `queryRecords` | 业务读取 | 应用明确筛选条件，返回包含完整性和证据的分析结果。 |
| `openDialog` | 草稿准备 | 打开页面拥有的业务弹窗。 |
| `fillForm` | 草稿准备 | 使用表单目录中的 `formId` 和 `formVersion`，把对应 `values` 应用到页面表单，不持久化。不同业务表单不能共用未标注的字段或草稿结构。 |
| `validateDraft` | 草稿校验 | 对输入草稿返回字段级和业务规则问题。 |
| `requestConfirmation` | 用户交互 | 展示具体的拟议变更，在用户决定前返回 `waiting_user`。 |
| `submitForm` | 业务写入 | 复用页面草稿，要求确认，通过现有 Web 流程保存，并在返回 `succeeded` 前回读核对保存结果。 |

`searchRoutes` 和 `navigateTo` 由 `sppmHost` 处理，不等待业务表单。其他动作都要求存在激活的注册页面、匹配的浏览器实例、当前上下文版本以及页面声明的能力。

表单动作使用判别式参数：`formId` 和 `formVersion` 必须来自当前 `PageContext.forms` 或 `readBusinessContext.data.forms`，业务值放在 `values` 中。两阶段业务（例如工艺卡）为每个阶段声明独立的 `phase` 和草稿结构；表头阶段可以只接受 `{ config }`，参数阶段接受 `{ config, moduleDtoList }`。工艺卡和工艺卡模板的参数模块、阶段和参数编码必须保留原目录标识；`fields`、顶层 `templateStandards` 或其他未声明字段不会被静默解释。`readBusinessContext` 默认只返回摘要和字段目录；只有明确传入 `includeDraft=true` 才返回可供填充的完整草稿。页面适配器必须在收到表单标识不匹配、版本过期或草稿结构不符时返回字段级问题。

Harness 在已解析页面上下文后会先检查动作是否由该页面声明；能力缺失时不发送页面指令，回执返回当前页面能力和下一步建议，避免无效的 WebSocket 往返。

## 目标定位和就绪状态

请求省略页面标识时，网关只在能够确定一个浏览器实例时自动解析。多个浏览器实例会产生明确的歧义错误；运行时必须先把对话绑定到发起请求的标签页，再重试。

Vue keep-alive 页面在停用后仍可能注册，但非全局动作只在激活页面执行。页面适配器可以提供 `waitForReady`；桥接层在读取上下文或执行动作前等待字典、表单元数据和必需业务依赖就绪。

桥接层拒绝协议不匹配、未知页面、错误浏览器实例、旧上下文版本、重复指令、过期请求、不支持的动作、适配器异常和格式错误的回执。页面注册返回注销函数，页面销毁时调用它。

## 数据和安全规则

页面上下文是模型可见数据。适配器只发布 Agent 下一步决策所需的字段，使用稳定的业务键和类型，并把用户输入文本视为不可信业务数据，而不是指令。适配器不发布凭据、授权 Token、原始 Vue 组件状态、Vuex store、DOM 节点或无关缓存记录。

上下文快照区分页面摘要、草稿和已保存业务数据。任何暴露值变化都递增 `contextVersion`。大型或分页业务数据通过带有完整性和截断信息的独立动作读取，不嵌入 `PageContext`。

## 一致性要求

协议实现使用共享动作列表和版本，生成 JSON 安全的白名单上下文，把请求绑定到用户和浏览器实例，执行过期和上下文版本校验，拒绝不支持或格式错误的消息，并返回规定的回执状态。测试覆盖发现、无页面、多标签页、协议不匹配、页面未就绪、停用的 keep-alive 页面、旧版本、重复指令、格式错误上下文、适配器失败和真实浏览器传输。
