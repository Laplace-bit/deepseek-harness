---
description: "SPPM page bridge protocol: the wire contract for Vue page context and semantic actions."
kind: "package-reference"
---

# SPPM Page Bridge Protocol

English | [中文](sppm-page-bridge-protocol.zh.md)

This document defines protocol version 1 between the SPPM Vue host, the gateway, the Harness plugin, and registered page adapters. The TypeScript declarations in [src/index.ts](../packages/sppm/page-bridge/src/index.ts) are the executable source for the message types and action names.

## Scope

The protocol carries JSON page context, semantic page-action requests, and structured receipts. It does not expose DOM selectors, arbitrary JavaScript, component instances, Vuex stores, browser cookies, or Java business endpoints.

The Web application owns the meaning of page context and business actions. The gateway authenticates and routes messages. The Harness plugin publishes model-facing tools and does not invent page data or route paths.

## Version and message rules

`SPPM_PAGE_BRIDGE_PROTOCOL_VERSION` identifies the wire contract. A version 1 context may omit `protocolVersion` for legacy adapters, while new adapters emit it; when present, a different version fails closed and asks the user to refresh the Web page. New optional fields are compatible; changing a required field, action name, state, or validation rule requires a protocol version change.

All identifiers are opaque strings. The browser host creates `browserInstanceId`; the runtime binds it to the originating tab. The model does not invent a tab id, page id, command id, session id, or context version.

Messages contain JSON values only. A page adapter converts Vue state into a plain snapshot before the bridge sends it. Functions, reactive objects, component references, cyclic objects, credentials, and arbitrary store contents are invalid protocol data.

Optional fields with no value are omitted; JavaScript `undefined` must never appear in a receipt or business data. A failed JSON validation returns `failed` with `issues` and `nextAction` that identify the correction path.

## Page context

`PageContext` is a snapshot of the registered page at one `contextVersion`.

| Field | Contract |
| --- | --- |
| `protocolVersion` | The page bridge version emitted by the page adapter. |
| `browserInstanceId` | The opaque browser-tab binding. |
| `pageId` | The stable id of the registered page adapter. `sppmHost` identifies the global host adapter. |
| `contextVersion` | A non-negative version that changes whenever an exposed selection, form summary, field definition, route, or capability changes. |
| `route` | The current full Web route, including its query string. |
| `title` | The localized page title. |
| `selection` | Optional page-owned selection or query values. |
| `form` | Optional page-owned form summary. It is not an authoritative complete business object. |
| `fieldSchema` | Optional field definitions with keys, labels, types, units, required flags, options, module codes, and stage codes. |
| `forms` | An optional directory of forms on the active page. Each entry carries a stable `formId`, `formVersion`, operation mode, and `draftSchema`, and may declare a workflow `phase` and bound `objectId`; form actions reuse these identifiers. |
| `capabilities` | The semantic actions the adapter exposes for this page. Unknown action names are invalid. |

The page adapter publishes an allowlisted projection through `readContext()`. Full business objects, complete record sets, and persisted values use business actions such as `readBusinessContext` and `queryRecords`.

## Requests

`PageActionRequest` contains `commandId`, `userId`, `sessionId`, `browserInstanceId`, `targetPageId`, `contextVersion`, `action`, `args`, `issuedAt`, and `expiresAt`.

`commandId` is unique for one attempted delivery. The bridge rejects a duplicate command. `expiresAt` is an absolute deadline; an expired request cannot reach a page adapter. The initial `readPageContext` discovery may use an empty `sessionId`, `targetPageId`, and context version `-1`; the returned context supplies the values for subsequent actions.

`targetPageId` and `contextVersion` are empty or negative only for discovery. A discovered context supplies the values used by later actions. `args` contains action-specific semantic JSON, never selectors or scripts.

The transport uses the authenticated gateway routes `/api/sppm/v1/page-context` and `/api/sppm/v1/page-actions`. The gateway sends the request to the browser page bridge over the authenticated WebSocket bound to the same user and browser instance.

## Receipts

`PageActionReceipt` contains `commandId`, `state`, `contextVersion`, and optional `message`, `data`, `issues`, and `nextAction`.

| State | Meaning |
| --- | --- |
| `succeeded` | The requested read, navigation, preparation, or write completed according to the action contract. A write is successful only after its page-owned verification completes. |
| `waiting_user` | The page is waiting for an explicit user confirmation. The receipt is not success and the command may be resumed through the action's operation id. |
| `failed` | The request could not be completed. `issues` identifies field or business problems when available. |
| `cancelled` | The user or page cancelled the operation. |
| `expired` | The request or its context is no longer valid. The caller rereads context or status before retrying. |

`data` is action-specific. `readPageContext` returns the context under `data.context`. A successful write result includes the business object identity and verification data defined by that page adapter. A receipt without the required verification data is not a successful write result.

`searchRoutes` returns both a parent-preserving `tree` and a compact `matches` list for direct model selection. `matches` contains only `targetable=true` nodes and includes `href`, the menu `routeVersion`, and the necessary `ancestors`; navigation must use these returned values instead of guessing a path.

## Action classes

The protocol action list is closed and exported as `SPPM_PAGE_BRIDGE_ACTIONS`.

| Action | Class | Required behavior |
| --- | --- | --- |
| `readPageContext` | Discovery | Resolve the page bound to the browser instance and return its current context. |
| `searchRoutes` | Global read | Search the current user's visible Web menu tree. The result is the only source accepted by `navigateTo`. |
| `navigateTo` | Global navigation | Accept a searched `href` and optional `routeVersion`; validate both against the live Web menu before navigation. |
| `readBusinessContext` | Business read | Read page-owned business data and field definitions through existing Web clients. |
| `queryRecords` | Business read | Apply explicit filters and return an analysis result with completeness and evidence. |
| `openDialog` | Draft preparation | Open a page-owned business dialog. |
| `fillForm` | Draft preparation | Apply `values` to the form selected by a catalogued `formId` and `formVersion` without persisting it. Unlabelled fields and drafts are invalid. |
| `validateDraft` | Draft validation | Return field-level and business-rule issues for the supplied draft. |
| `requestConfirmation` | User interaction | Show the concrete proposed change and return `waiting_user` until the user decides. |
| `submitForm` | Business write | Reuse the page draft, require confirmation, persist through the existing Web workflow, and read back the saved result before returning `succeeded`. |

`searchRoutes` and `navigateTo` are handled by `sppmHost` and do not wait for a business form. All other actions require an active registered page, the matching browser instance, the current context version, and the advertised capability.

Form actions use discriminated arguments: `formId` and `formVersion` must come from `PageContext.forms` or `readBusinessContext.data.forms`, and business values are nested under `values`. A two-stage business workflow such as a process card declares a separate `phase` and draft contract for each stage: the header stage may accept `{ config }`, while the parameter stage accepts `{ config, moduleDtoList }`. Process-card and template identifiers for modules, stages, and parameters remain those returned by the directory. `fields`, top-level `templateStandards`, and undeclared fields are not interpreted implicitly. `readBusinessContext` returns summaries and field directories by default; callers set `includeDraft=true` only when they need a complete draft for filling or validation. Adapters return field-level issues when the form identity, version, or draft structure does not match.

After resolving the page context, Harness preflights the requested capability. When the page does not advertise the action, no page command is sent; the receipt includes the current capabilities and a next step so the model can change pages without an unnecessary WebSocket round trip.

## Targeting and readiness

When a request omits its page identifiers, the gateway resolves exactly one browser instance. Multiple connected browser instances are ambiguous and return an explicit error; the runtime must bind the conversation to its originating tab before retrying.

Vue keep-alive pages remain registered while inactive, but non-global actions execute only on the active page. Page adapters may provide `waitForReady`; the bridge waits for dictionaries, form metadata, and required business dependencies before reading context or executing the action.

The bridge rejects protocol mismatches, unknown pages, wrong browser instances, stale context versions, duplicate commands, expired requests, unsupported actions, adapter exceptions, and malformed receipts. Page registration returns a disposer and pages call it on destruction.

## Data and security rules

Page context is model-visible data. Adapters expose only the fields required for the next Agent decision, use stable business keys and types, and treat user-entered text as untrusted data rather than instructions. They do not expose credentials, authorization tokens, raw Vue component state, Vuex stores, DOM nodes, or unrelated cached records.

The context snapshot distinguishes page summaries and drafts from persisted business data. A changing exposed value increments `contextVersion`. Large or paginated business data uses a dedicated action with explicit completeness and truncation information instead of being embedded in `PageContext`.

## Conformance

A protocol implementation is conformant when it uses the shared action list and version, emits JSON-safe allowlisted contexts, binds requests to a user and browser instance, enforces expiry and context versions, rejects unsupported or malformed messages, and returns the defined receipt states. Tests cover discovery, no page, multiple tabs, protocol mismatch, page readiness, inactive keep-alive pages, stale versions, duplicate commands, malformed contexts, adapter failures, and real browser transport.
