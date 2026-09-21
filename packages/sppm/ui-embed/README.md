---
description: "SPPM Harness UI embed: mount the Agent assistant into a Vue page."
kind: "package-reference"
---

# SPPM Harness UI embed

English | [中文](README.zh.md)

`@deepseek-ai/dsh-sppm-ui-embed` exposes `mountAssistant(container, options)` for direct Vue mounting. It bootstraps the pinned Harness web module graph through the gateway runtime namespace, mounts the React client without an iframe, and returns show, hide, context update, and destroy methods.

## Summary

The embed package mounts the Harness assistant in the SPPM shell and leaves window management, page bridging, and business adapters to the host application.

## Table of Contents

- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

The browser artifact is built as `lib/assistant.js` and `lib/style.css`; `patch-browser-bundle.mjs` removes the Node-only module wrapper and defines inert browser behavior for Harness's internal Node probe.

## Known Limitations and Deferred Work

The embed contract does not own the surrounding window, page bridge WebSocket, or SPPM translations. Those remain in `HarnessAssistantHost` and the Vue pages.

### Dev Note

This Dev Note is working context for maintainers. The package keeps the browser bundle free of direct business API and credential handling.
