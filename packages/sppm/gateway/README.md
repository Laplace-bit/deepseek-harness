---
description: "SPPM Agent gateway: authenticated Harness routing and browser page-action delivery."
kind: "package-reference"
---

# SPPM Agent gateway

English | [中文](README.zh.md)

`@deepseek-ai/dsh-sppm-gateway` authenticates SPPM requests, maintains signed browser sessions, routes each user to one fixed Harness process, proxies Harness runtime assets and streams, and delivers page actions only to the selected browser instance. It deliberately does not expose or proxy model-provider routes. Harness remains the sole owner of provider, API key, model, capability and credential persistence through each managed instance's private `DSH_HOME` and its native settings UI.

## Summary

The gateway is the authenticated boundary between the Vue page bridge and a per-user Harness process. It resolves an active browser page for discovery, forwards typed page actions, enforces session and browser binding, and keeps model-provider traffic inside Harness.

## Table of Contents

- [Local startup](#local-startup)
- [Reverse proxy requirements for embedding](#reverse-proxy-requirements-for-embedding)
- [Deployment and workspace placement](#deployment-and-workspace-placement)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

`maxInstances` bounds concurrent user processes. The gateway never accepts a requested command, profile, workspace, or plugin.

`POST /api/sppm/v1/page-context`, authenticated by the Harness instance token, returns the page context of the user's active browser bridge. It answers 409 when no page bridge is connected and when several open tabs make the target ambiguous; a caller may pass `browserInstanceId` to select one.

## Local startup

With dependencies installed and Java and Vue running, execute `./start-sppm.sh` from the repository root. The foreground gateway uses `apps/cli/src/bin.ts`, listens on loopback port 3180, and derives `/getInfo` from the sibling frontend's `proxy.config.json` target. The listening message confirms gateway startup, not authenticated Harness readiness; open the assistant from a logged-in Vue page to verify the latter.

Optional dotenv settings belong in `.data/sppm.env`; exported `SPPM_*` variables take precedence. The local cookie secret persists in `.data/sppm-local/cookie-secret`. The launcher accepts loopback hosts only, defaults to non-Secure cookies for local HTTP, and refuses `NODE_ENV=production`. Ctrl+C requests shutdown of this gateway and its owned Harness children. An occupied port is an error, not permission to stop another process. RuoYi `/getInfo` requires business code 200 with `user.userId` and top-level `roles`; HTTP 200 alone is not authentication success.

Image prompts cross the gateway as JSON requests containing base64 image data. `SPPM_MAX_HARNESS_REQUEST_BODY_BYTES` controls the maximum request body forwarded to Harness and defaults to 300 MiB, leaving headroom over Harness's attachment request limit; requests above the limit return 413 instead of being misreported as a 503 Harness outage. If you tighten the limit, keep it above the base64-encoded image payload plus request envelope overhead.

## Reverse proxy requirements for embedding

The Harness React client uses same-origin `/api/*`, `/api/remote.mux`, and `/api/file` paths. An embedded deployment must proxy those paths, together with `/api/sppm/v1/*`, to this gateway. Browsers must never connect to a per-user Harness port directly. The reverse proxy must preserve WebSocket upgrades:

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

The gateway maps the SPPM session to the fixed Harness child’s browser-auth cookie. That cookie remains in gateway memory and is never returned to the browser.

## Deployment and workspace placement

In SPPM Web mode the Agent runs on the gateway host, not in the user’s browser, the Java process, or the user’s workstation. The gateway starts one fixed-profile Harness child per user. The per-user directory under `SPPM_INSTANCE_ROOT` stores Harness sessions, settings, and credentials; the workspace should be mounted as a dedicated persistent volume with service-account permissions. Before the child starts, the gateway idempotently installs the packaged SPPM skills under `${DSH_HOME}/skills`; the native `skill-filesystem` and `tool-skill` rows then discover and load them through the normal Harness skill path. `DSH_HOME` is Harness state, not the business attachment store; attachments continue to use the existing MinIO prefix.

The SPPM web profile pins the in-browser directory picker. The picker therefore shows the filesystem of the server running Harness. Production should mount approved workspace roots into a dedicated container path and constrain access with container, service-account, and filesystem permissions. The browser picker is an interaction layer, not a multi-tenant security boundary; strict root confinement belongs in deployment isolation or a future restricted Host adapter.

Native macOS or Windows directory dialogs apply only when the Agent and the operator run on the same desktop. A remote embedded browser cannot read a user’s local paths. That capability requires a separate desktop Connector rather than direct local-file access from the Web Agent.

## Known Limitations and Deferred Work

Idle process reaping and durable gateway session storage are deployment follow-up work. Model configuration recovery follows Harness's own profile and credential persistence; Java and the gateway do not restore, transform or mirror those settings.

### Dev Note

This Dev Note is working context for maintainers. The gateway intentionally does not own business data or model-provider credentials; those contracts remain in Harness and the SPPM page adapters.
