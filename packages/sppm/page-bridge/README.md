---
description: "SPPM page bridge: typed semantic actions between Vue business pages and Agent tools."
kind: "package-reference"
---

# SPPM page bridge

English | [中文](README.zh.md)

`@deepseek-ai/dsh-sppm-page-bridge` defines the typed browser-to-Agent page action contract. The registry accepts page-owned semantic actions and rejects unknown pages, duplicate command IDs, expired requests, stale context versions, wrong browser instances, and unsupported actions.

## Summary

The bridge is the shared contract for SPPM page discovery, context versions, semantic business actions, and structured receipts. It contains no DOM automation surface.

**Runtime invariant:** No invariant companion is published because the bridge exposes no package-owned invariant state.

The complete version 1 wire contract is documented in [SPPM page bridge protocol](../../../docs/sppm-page-bridge-protocol.md). Page adapters publish allowlisted JSON snapshots, and every action uses the shared request and receipt rules defined there.

## Table of Contents

- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Model Experience](#model-experience)
- [Dev Note](#dev-note)

A `readPageContext` request resolves the page registered for the requesting browser instance and returns its current context, so a caller can discover the page id and context version before issuing another action. The `searchRoutes` and `navigateTo` actions are global Web-owned capabilities: they use the host page's current router/menu context even when the target business page is not open or its form is still loading. `navigateTo` must use a target `href` returned by that search and is validated against the same live catalog. Every other action still requires the caller's page id and context version to match the live page.

The package has no DOM selector or script execution API. Vue pages own registration and disposal; the gateway and Harness plugin transport `PageActionRequest` and `PageActionReceipt` values.

## Model Experience

Indirectly, through the SPPM Harness plugin's use of the page-action contract.

#### KV Cache effect

The bridge returns versioned page receipts to the SPPM Harness plugin; new receipt data appends after prior transcript messages without rewriting them.

## Known Limitations and Deferred Work

- Field-level validation and unsaved-form conflict prompts remain owned by each registered Vue page. The bridge does not provide a generic browser automation fallback.

### Dev Note

This Dev Note is working context for maintainers. Vue adapters own business validation and disposal; the bridge only enforces the cross-page protocol.
