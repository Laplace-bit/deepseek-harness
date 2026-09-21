---
description: "SPPM Harness plugin: typed model tools for authenticated page capabilities."
kind: "package-reference"
---

# SPPM Harness plugin

English | [中文](README.zh.md)

`@deepseek-ai/dsh-sppm-harness-plugin` registers model-facing tools for SPPM page actions and Web-owned business capabilities. The transport sends typed commands to the gateway with the fixed Harness instance token and returns the browser receipt. Page identifiers are optional tool arguments: when the model omits them, the plugin first resolves the active page context through the gateway, binds that result to the Agent session's browser tab, and then sends the action with the resolved identifiers; if multiple tabs are present during first discovery, it returns an explicit ambiguity instead of choosing one. Business reads, draft validation, and user-confirmed form submission run inside the authenticated Web page through existing Web API clients; the Agent never calls a Java business endpoint directly. It never exposes arbitrary JavaScript, selectors, terminal, or file operations.

## Summary

This plugin is the model-facing SPPM capability boundary. It publishes business-shaped tools, resolves the active browser context, transports typed page actions, and preserves structured waiting, failure, and verified-save receipts.

## Model Experience

When a user asks to create a process card, the built-in `sppm-process-card-create` skill gives the model a staged procedure: discover a permitted route, fill and confirm the header, wait for a verified object id, then open the parameter editor and reconcile every value with the live module directory. The model receives actionable field-level issues and must ask about missing or ambiguous values instead of guessing.

## Table of Contents

- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

`sppm_searchRoutes` searches routes available through the current logged-in user's Web menu permissions and returns a JSON tree that preserves parent-child relationships plus a compact `matches` list for direct selection. It returns only menu items visible to the current user; group, redirect, and external-link nodes cannot be navigated to directly. Call it before `navigateTo` and use `targetable=true`, `href`, and `routeVersion` from the result. The tool is read-only and does not modify the page or business data. It automatically discovers and binds the current browser tab, so a separate context read is not required before searching. The result also includes the current route, menu version, match counts, and truncation/completeness flags; unsupported business actions are rejected locally with the active page capabilities and a next step.

`submitForm` accepts an optional client-side `operationId`; when omitted, the plugin derives one from the command id. The first submit receipt can be `waiting_user`; the page shows the concrete draft diff and continues the save asynchronously after confirmation. Call `submitForm` again with the same `operationId` to collect the verified save receipt. After a refresh, omit `values` and pass that operation id to use the browser's local operation record and the existing Web list/detail APIs for readback. Because the existing Web endpoints have no server-side idempotency ledger, a timeout is reported as uncertain and is never automatically resubmitted.

`fillForm`, `validateDraft`, and `submitForm` first discover a form directory through `sppm_readPageContext` or `sppm_readBusinessContext`, then pass its `formId`, `formVersion`, and `values`. The process-card header phase uses `{ config }`; the parameter phase and process-card templates use `{ config, moduleDtoList }`. Module, stage, and parameter identifiers must come from the directory, and `fields` or top-level `templateStandards` from another page are not interpreted. A form identity or version mismatch returns field-level issues without changing the page.

`readBusinessContext` returns summaries and field directories by default. Set `includeDraft=true` only when a complete draft is needed for filling or validation so large parameter payloads do not enter the model context unnecessarily.

The plugin package ships the source bundle `skills/sppm-process-card-create/SKILL.md`. The SPPM gateway installs that file idempotently into each user's Harness `${DSH_HOME}/skills` before starting the child process. SPPM's standard agent preset mounts Harness's native `skill-filesystem` and `tool-skill` rows, so the file is discovered, frontmatter-validated, watched, listed in the normal skill catalog, and loaded through the same `skill` tool as every other Harness skill. The plugin does not register a provider on `ctx.skills`, inject instructions at `agent/pre-step`, or use a semantic keyword loader. The skill separates header entry (`process-card-header`) from parameter maintenance: after the header is confirmed and read back with an object id, Harness opens `editCardParameters`, reads the `process-card-parameters` form, and fills the complete `moduleDtoList` by module, stage, parameter, unit, standard/limits, setting/actual values, device menu, and two reference-image indices. Files and images are evidence that must be reconciled against the live directory; unknown or ambiguous values are collected from the user. Neither phase is reported complete without confirmation and a `verified=true` readback.

## Known Limitations and Deferred Work

Material parsing remains outside this page-action package. Template context, record queries, draft validation, and submission are page actions so the Web application remains the owner of credentials, permissions, form rules, and business request shapes. Submission always uses the Web form's own confirmation and save flow.
- Parameter entry remains dependent on the active page's menus, field definitions, and existing Web APIs; the plugin does not provide a server-side transaction or idempotency ledger.

## Dev Note

This Dev Note is working context for maintainers. The plugin does not own business credentials or bypass page permissions; it can only call capabilities advertised by the active Vue adapter.
