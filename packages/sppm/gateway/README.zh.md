---
description: "SPPM Agent 网关：认证 Harness 路由与浏览器页面动作投递。"
kind: "package-reference"
---

# SPPM Agent 网关

[English](README.md) | 中文

`@deepseek-ai/dsh-sppm-gateway` 验证 SPPM 请求，维护签名浏览器会话，为每个用户路由到一个固定 Harness 进程，代理 Harness 资源和流，并只向选定的浏览器实例投递页面动作。它不暴露或代理模型供应商路由；提供方、API Key、模型、能力和凭据由每个 Harness 实例的原生设置界面及私有 `DSH_HOME` 完整管理。

## 概述

网关是 Vue 页面桥接与每用户 Harness 进程之间的认证边界。它解析当前浏览器页面供发现，转发类型化页面动作，约束会话和浏览器绑定，并让模型供应商流量留在 Harness 内部。

## 目录

- [本地启动](#local-startup)
- [嵌入主站时的反向代理](#reverse-proxy-requirements-for-embedding)
- [Web 部署与工作区](#deployment-and-workspace-placement)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

`maxInstances` 限制并发用户进程数。网关不接受请求方指定命令、profile、工作区或插件。

`POST /api/sppm/v1/page-context` 使用 Harness 实例令牌认证，返回用户当前浏览器桥接页面的上下文。未连接页面桥接、或打开的标签页过多导致目标不唯一时返回 409；调用方可传入 `browserInstanceId` 指定标签页。

<a id="local-startup"></a>
## 本地启动

安装依赖并启动 Java 和 Vue 后，在仓库根目录执行 `./start-sppm.sh`。前台网关使用 `apps/cli/src/bin.ts`，监听回环地址的 3180 端口，并从相邻 frontend 的 `proxy.config.json` 中读取 target，派生 `/getInfo` 地址。监听日志只代表网关启动成功，不代表已认证的 Harness 就绪；需要在已登录的 Vue 页面打开助手验证后者。

可选 dotenv 配置保存在 `.data/sppm.env`，已导出的 `SPPM_*` 环境变量优先。本地 Cookie 密钥保存在 `.data/sppm-local/cookie-secret` 并重复使用。启动器只接受回环地址，为本地 HTTP 默认关闭 Secure Cookie，并拒绝 `NODE_ENV=production`。Ctrl+C 请求关闭本网关及其拥有的 Harness 子进程。端口被占用时报错，不会停止其他进程。RuoYi `/getInfo` 需要业务码 200、`user.userId` 和顶层 `roles`；仅 HTTP 200 不代表认证成功。

图片提示词会以包含 base64 图片数据的 JSON 请求经过网关。`SPPM_MAX_HARNESS_REQUEST_BODY_BYTES` 控制转发到 Harness 的最大请求体，默认 300 MiB，与 Harness 附件请求上限保持余量；超过限制时网关返回 413，而不是把请求误报为 Harness 不可用的 503。若需要收紧限制，请确保它仍大于图片附件的 base64 编码大小和请求封装开销。

<a id="reverse-proxy-requirements-for-embedding"></a>
## 嵌入主站时的反向代理

Harness 自带页面的 React 客户端使用固定的同源 `/api/*`、`/api/remote.mux` 和 `/api/file` 路径。主站嵌入时必须把这些路径与 `/api/sppm/v1/*` 一起转发到本网关，浏览器不能直接访问每个用户的 Harness 端口。生产反向代理至少需要保留 WebSocket 升级头，例如：

```nginx
location /api/sppm/v1/ {
  proxy_pass http://127.0.0.1:3180/api/sppm/v1/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}

location /api/ {
  proxy_pass http://127.0.0.1:3180/api/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}
```

网关会把主站会话映射到对应 Harness 子进程的内部浏览器认证 Cookie；该 Cookie 只在网关内存中保存，不会返回给浏览器。

<a id="deployment-and-workspace-placement"></a>
## Web 部署与工作区

SPPM Web 模式把 Agent 运行在网关所在服务器上，而不是用户浏览器、Java 进程或用户电脑本地。网关为每个用户启动固定 profile 的 Harness 子进程；`SPPM_INSTANCE_ROOT` 下的用户目录保存 Harness 会话、设置和凭据，工作区目录应使用专用持久卷和服务账号权限管理。子进程启动前，网关会把随包 SPPM skill 幂等安装到 `${DSH_HOME}/skills`；随后由 Harness 原生 `skill-filesystem` 和 `tool-skill` 按标准 skill 路径发现和加载。`DSH_HOME` 是 Harness 状态目录，不应当被当作业务附件目录；附件继续使用现有 MinIO 前缀。

Web profile 固定使用浏览器内目录选择器。选择器显示的是运行 Harness 的服务器文件系统，因此生产部署应把允许使用的工作区挂载到专用容器目录，并在反向代理之外通过容器、服务账号和文件系统权限限制访问范围。当前浏览器选择器是交互层，不是多租户安全边界；若需要严格的根目录限制，应在部署隔离或后续受限 Host 适配器中实现。

macOS 或 Windows 原生目录对话框只适用于 Agent 与用户在同一台电脑上的桌面部署。嵌入主站的远程浏览器不能访问用户电脑本地路径；需要该能力时应提供独立桌面 Connector，而不是让 Web Agent 直接读取本地文件。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

空闲进程回收和网关会话持久化属于部署后续工作。网关重启后的模型配置恢复遵循 Harness 自身的 profile 与凭据持久化，不需要 Java 或网关交接、改写或镜像模型设置。

<a id="dev-note"></a>
### 开发备注

这是供维护者参考的工作备注。网关有意不持有业务数据或模型供应商凭据，这些契约仍由 Harness 和 SPPM 页面适配器负责。
