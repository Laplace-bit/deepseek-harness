---
description: "The SPPM package group connects logged-in Vue business pages to the Harness assistant through typed page actions."
kind: "package-group"
---

# SPPM/ — process parameter management integration

English | [中文](README.zh.md)

## Summary

The SPPM group connects logged-in Vue business pages to the Harness assistant. The page bridge defines versioned actions and receipts; the Harness plugin exposes permitted actions to the model; the gateway authenticates and routes each user's Harness process; the embed mounts the assistant in Vue. The profile patch composes the SPPM tools for the hosted assistant. Package READMEs own setup and limits.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Use these packages together when an SPPM page needs to expose business actions to the embedded assistant.

| Package | Role |
|---|---|
| [`page-bridge/`](page-bridge/README.md) | Shared page context, action, and receipt types plus page capability registry |
| [`harness-plugin/`](harness-plugin/README.md) | SPPM model tools that validate and transport page actions |
| [`gateway/`](gateway/README.md) | Authenticated per-user Harness routing and page action delivery |
| [`ui-embed/`](ui-embed/README.md) | Browser bundle and Vue mounting API for the assistant |

-----

<a id="related-documentation"></a>
## Related documentation

- [SPPM integration](../../docs/sppm-integration.md) — workspace setup and integration flow.
- [SPPM page bridge protocol](../../docs/sppm-page-bridge-protocol.md) — shared action names, context versions, receipts, and validation rules.
- [SPPM profile patch](gateway/profile/cordis.patch.yml) — Harness rows enabled for the SPPM assistant.

<a id="dev-note"></a>
## Dev Note

None.
