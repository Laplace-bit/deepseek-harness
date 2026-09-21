# Agent Note: SPPM upstream overlay architecture

Status: implemented

English | [中文](2026-09-21-sppm-upstream-overlay-architecture.zh.md)

## Problem

SPPM needs DeepSeek Harness `dsh-v0.1.6-alpha.2` image input while continuing to receive later upstream releases and small fixes in the user's fork. The old repository history imported a complete Harness source tree as one private commit, so SPPM commits had no common ancestor with upstream and a direct upstream merge turned the whole repository into a conflict set.

## Decision

Use the user's fork `master` as the Harness baseline, with local `origin` pointing to `https://github.com/Laplace-bit/deepseek-harness.git` and `upstream` pointing to `https://github.com/deepseek-ai/deepseek-harness.git`, then layer SPPM on `sppm/v0.1.6-alpha.2`. The old whole-tree import remains on `legacy/sppm-agent-pre-upstream-migration` for rollback and forensics, but is no longer a development baseline.

SPPM uses Harness extension points only: `packages/sppm/` contains the page bridge, Harness plugin, browser embed, and gateway; `packages/sppm/profile/cordis.patch.yml` is a fixed profile overlay passed as `--patch` when the gateway starts a child process; the gateway owns user authentication, instance isolation, HTTP/WebSocket proxying, and request-body limits. The CLI manifest explicitly declares every plugin named by that overlay, so a clean production install does not depend on pnpm hoisting. The official standard preset, core Agent loop, and model adapters remain unchanged so SPPM security restrictions and business semantics are not written into files that upstream changes frequently.

The image-input 503 fix belongs at the gateway boundary: Harness API request bodies allow 300 MiB by default and can be adjusted with `SPPM_MAX_HARNESS_REQUEST_BODY_BYTES`; control-plane requests retain their smaller fixed limit, and an oversized request returns 413 instead of being disguised as 503. Model input types remain owned by Harness `v0.1.6-alpha.2`'s native settings UI and `settings.yaml`; a vision model must declare `input: [text, image]` or inherit image capability from the catalog.

## Update workflow

When syncing an upstream release, merge upstream into the fork's `master` first, then replay the local SPPM commits on the SPPM branch:

```text
git fetch upstream --tags --prune
git switch master
git merge --no-ff upstream/master
git push origin master
git switch sppm/v0.1.6-alpha.2
git rebase origin/master
pnpm install --lockfile-only
pnpm run verify-cordis-config
pnpm run typecheck:sppm
```

When an upstream API changes, update the adapter or profile overlay inside `packages/sppm/` first; adjust root source-path mappings, project references, or startup scripts only when the upstream extension point itself changes. After every upgrade, rerun the SPPM tests and the browser assistant bundle build.

## Alternatives considered

**Continue merging upstream into the old private history.** There is no common ancestor, so every official file becomes a conflict and each upgrade repeats the historical import conflict at unacceptable maintenance cost.

**Copy each official release into a new SPPM repository.** A snapshot can work temporarily, but it cannot represent the fork's small fixes and upstream history together, nor can Git identify the SPPM delta accurately during upgrades.

**Modify the official standard preset directly.** SPPM tool-disable rules would drift silently when upstream renames or rearranges preset rows; a fixed profile overlay keeps the security boundary in SPPM code and lets the official preset evolve independently.

## Consequences

The current baseline can continue syncing upstream from the fork's alpha2 common ancestor while preserving the fork's scroll fix. `packages/sppm/` is independently typechecked and tested; the root adds only SPPM-specific scripts, source-resolution mappings, and explicit CLI runtime dependencies. The legacy branch preserves the old implementation and code snapshot; `.data/` remains a local runtime directory and must not be committed.

Verification includes `pnpm run verify-cordis-config`, `pnpm run typecheck:sppm`, 39 SPPM unit tests, and `pnpm run bundle:sppm-assistant`. The assistant bundle's `import.meta`/Node external warnings come from the existing IIFE bundling pipeline and do not prevent a successful build; warning cleanup can be scheduled separately.
