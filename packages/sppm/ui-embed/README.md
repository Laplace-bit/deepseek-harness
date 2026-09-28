---
description: "SPPM Harness UI embed: mount the Agent assistant into a Vue page."
kind: "package-reference"
---

# SPPM Harness UI embed

English | [中文](README.zh.md)

`@deepseek-ai/dsh-sppm-ui-embed` exposes `mountAssistant(container, options)` for direct Vue mounting. It bootstraps the pinned Harness web module graph through the gateway runtime namespace, mounts the React client without an iframe, and returns show, hide, context update, and destroy methods.

## Summary

The embed package mounts the Harness assistant in the SPPM shell and leaves window management, page bridging, and business adapters to the host application.

**Runtime invariant:** No invariant companion is published because the embed exposes no package-owned invariant state.

## Table of Contents

- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Model Experience](#model-experience)
- [Dev Note](#dev-note)

The browser artifact is built as `lib/assistant.js` and `lib/style.css`; `patch-browser-bundle.mjs` removes the Node-only module wrapper and defines inert browser behavior for Harness's internal Node probe.

Run `pnpm run bundle:sppm-assistant` from the Harness repository after rebuilding client packages. The command rebuilds these assets, synchronizes them into the sibling Vue host's `public/ai-harness/` directory, and verifies byte equality. `start-sppm.sh` performs the same synchronization before it starts the gateway.

## Model Experience

None, as the package mounts the Harness browser interface without constructing model requests.

#### KV Cache effect

Vue integration changes browser presentation and page context; Harness owns request construction and history, so this package does not replace cached prefixes.

## Known Limitations and Deferred Work

- The embed contract does not own the surrounding window, page bridge WebSocket, or SPPM translations. Those remain in `HarnessAssistantHost` and the Vue pages.

### Dev Note

This Dev Note is working context for maintainers. The package keeps the browser bundle free of direct business API and credential handling.
