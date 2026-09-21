# SPPM integration boundary

English | [中文](sppm-integration.zh.md)

SPPM embeds the Harness React client through the versioned `@deepseek-ai/dsh-sppm-ui-embed` contract. Vue owns the floating host window and registers semantic page capabilities. Harness owns sessions, history, attachments, model selection, tool results, and HTTP/WebSocket stream recovery.

The gateway authenticates the existing SPPM login and routes each user to a fixed Harness profile and data directory. A request never chooses a command, profile, workspace, or plugin. Terminal, server file, arbitrary JavaScript, and arbitrary CSS selector tools are disabled for the SPPM profile.

Page operations cross the boundary as `PageActionRequest` values from `@deepseek-ai/dsh-sppm-page-bridge`. Every request is bound to a user session, browser instance, target page, context version, command id, and expiry. Vue rejects stale or duplicate requests and reports a typed receipt. A tool that omits the page identifiers resolves the user's active page through the gateway first, so the model can read or act on the page the user is viewing; several open tabs make that resolution ambiguous and require an explicit browser instance. Save, delete, and approve remain Java business operations requiring a real user confirmation.

The complete context, request, receipt, action, targeting, and conformance rules are defined in the [SPPM page bridge protocol](sppm-page-bridge-protocol.md). Page adapters publish allowlisted plain-data snapshots; complete business data and writes remain action-specific.

The current implementation adds no Java endpoint. Business capabilities reuse the existing Web client APIs and page form flows; the bridge carries semantic data and reads the saved result back for verification. Existing Java services continue to enforce their permissions, business rules, and transactions.

Harness is the sole owner of model provider configuration. Users configure providers, protocols, base URLs, models, capabilities and credentials through Harness's native settings surface; each managed instance persists that state in its private `DSH_HOME`. Neither the gateway nor Java mirrors, restores or rewrites model configuration. Java remains the boundary for SPPM identity, business queries, draft validation and transactional writes.

## Deployment and workspace placement

In the SPPM Web embedding mode, Harness processes run on the gateway server; the browser hosts only the React surface and page bridge, while Java remains responsible for business rules and transactions. Each user has an isolated Harness process and `DSH_HOME`; the workspace belongs on a dedicated persistent server volume with service-account permissions. The in-browser picker shows that server filesystem and cannot access paths on the user's workstation; local desktop files require a separate local Connector.

`DSH_HOME` stores Harness sessions, settings and credentials, while business attachments continue to use the existing MinIO store. The browser picker is an interaction surface rather than a multi-tenant security boundary. Production must constrain visible workspaces with container, service-account and filesystem permissions; strict root confinement belongs in a restricted Host adapter.
