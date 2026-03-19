# Veiled Desktop App — Goals & Improvements

A comprehensive backlog for making Veiled exceptional. Pick any item, implement it, check it off, and submit a PR.

Each item has:
- **What**: A brief description of the feature or improvement
- **How**: Implementation ideas and key files involved
- **Why**: The value it provides

Difficulty ratings:
- 🟢 Small — isolated change, single file, < 1 hour
- 🟡 Medium — touches 2-4 files, may need testing, < half day
- 🔴 Large — cross-cutting, multiple components/services, needs design thought

---

## Table of Contents

1. [Marketplace & Cards](#1-marketplace--cards)
2. [Modals & Forms](#2-modals--forms)
3. [Library](#3-library)
4. [Error Handling & Resilience](#4-error-handling--resilience)
5. [Accessibility](#5-accessibility)
6. [Backend API](#6-backend-api)
7. [Rust Core & Security](#7-rust-core--security)
8. [Testing & CI](#8-testing--ci)

---

## 1. Marketplace & Cards

> Key files: `fe/src/components/EncryptionCard.tsx`, `fe/src/components/MySalesTab.tsx`, `fe/src/components/MyPurchasesTab.tsx`

- [ ] 🟢 **Add `aria-pressed` to EncryptionCard favorite button**
  - **How**: In `EncryptionCard.tsx` (line 93–98), the favorite toggle button has `aria-label` but no `aria-pressed={isFavorite}`. Add `aria-pressed={isFavorite}` to the `<button>` element.
  - **Why**: Screen readers can't distinguish between active/inactive favorite state. The button already toggles visual fill — ARIA should match.

- [ ] 🟡 **Replace `alert()` fallbacks in MySalesTab and MyPurchasesTab with no-ops or logging**
  - **How**: `MySalesTab.tsx` lines 232, 246, 261 and `MyPurchasesTab.tsx` lines 229, 243 use `alert()` as fallbacks when optional callbacks aren't provided. Replace with `console.warn('callback not provided')` or remove the else branches entirely. These fire only when components are used outside Dashboard (where callbacks are always wired), but alert() in a desktop app is jarring if ever triggered.
  - **Why**: Native `alert()` dialogs look foreign in a Tauri app and can't be dismissed normally. Even as defensive fallbacks, they should fail silently or log.

---

## 2. Modals & Forms

> Key files: `fe/src/components/InfoTooltip.tsx`, `fe/src/components/MnemonicInput.tsx`, `fe/src/components/PasswordStrengthIndicator.tsx`

- [ ] 🟢 **Add Escape key to dismiss InfoTooltip**
  - **How**: In `InfoTooltip.tsx`, the tooltip opens on click/focus but has no `onKeyDown` handler for Escape. Add a `useEffect` or inline `onKeyDown` on the button: when `isVisible && event.key === 'Escape'`, call `setIsVisible(false)`. The component already handles show/hide via `onFocus`/`onBlur` (lines 76–77), so Escape just adds parity with the modal Escape pattern.
  - **Why**: Keyboard-only users who open a tooltip via Tab+Enter have no way to dismiss it without tabbing away. Escape is the expected pattern.

- [ ] 🟢 **Add `aria-invalid` and `aria-describedby` to MnemonicInput**
  - **How**: In `MnemonicInput.tsx` (line ~131–150), the `<input>` element lacks ARIA validation attributes. Add `aria-invalid={!isValid && trimmed.length > 0}` and `aria-describedby` pointing to an error hint `<span>`. The component already computes `isValid` (line 103) — just expose it to assistive tech.
  - **Why**: Screen reader users can't tell whether a mnemonic word is valid. Visual border color changes aren't announced.

- [ ] 🟢 **Add `aria-live="polite"` to PasswordStrengthIndicator**
  - **How**: In `PasswordStrengthIndicator.tsx`, wrap the requirements list or strength level text in `<div aria-live="polite">`. The component dynamically shows/hides requirement checkmarks (lines 30–73) and changes strength bar color (lines 76–93), but none of this is announced.
  - **Why**: Screen reader users get no feedback as they type — they can't tell which requirements are met or the overall strength level.

---

## 3. Library

> Key files: `fe/src/components/LibraryTab.tsx`

- [ ] 🟢 **Show keyboard hint for select mode Escape**
  - **How**: In `LibraryTab.tsx`, when `selectMode` is true, the toolbar already shows a "Cancel" button. Add a subtle `<kbd>Esc</kbd>` hint next to it (e.g., `<span className="text-xs text-[var(--text-muted)]"><kbd>Esc</kbd></span>`). Escape already works (line 217–221) — this just makes it discoverable.
  - **Why**: Users don't know Escape exits select mode unless they try it. A visible hint prevents confusion.

---

## 4. Error Handling & Resilience

> Key files: `be/src/services/cbor.ts`, `be/src/services/health.ts`, `be/src/services/encryptions.ts`

- [ ] 🟢 **Add bounds check to CBOR indefinite-length parsing**
  - **How**: In `cbor.ts` (lines 83, 111, 133), the `while (data[pos] !== 0xff)` loops have no guard against `pos >= data.length`. If the CBOR input is malformed (missing `0xff` break byte), this causes an infinite loop reading `undefined` values. Add `if (pos >= data.length) throw new Error('Malformed CBOR: missing break byte')` at the top of each while loop body.
  - **Why**: A malicious or corrupted on-chain datum could crash the backend Express server. This is a denial-of-service vector via crafted CBOR data.

- [ ] 🟢 **Log missing tx hashes in metadata batch fetch**
  - **How**: In `encryptions.ts` (line ~169–181), when `getTxMetadataBatch()` returns fewer results than requested, the missing tx hashes get empty `{}` metadata silently. After the batch call, compute `const missing = uncachedHashes.filter(h => !result[h])` and log: `logger.warn('Missing metadata for tx hashes', { missing, count: missing.length })`.
  - **Why**: Operators can't tell when listings are missing metadata. Silent fallback to empty makes debugging impossible.

- [ ] 🟡 **Reset cached health status when circuit breaker transitions from OPEN to HALF_OPEN**
  - **How**: In `health.ts` (line ~76–88), when the circuit breaker is OPEN, the health check skips the Koios ping and caches the "unhealthy" result. But when the breaker transitions to HALF_OPEN (after cooldown), the cached result may still say "unhealthy" for up to 5 minutes. Either reduce the cache TTL for unhealthy results or subscribe to circuit state changes and invalidate the cached Koios result.
  - **Why**: The health endpoint reports "unhealthy" even after Koios recovers, giving operators a false impression of prolonged outage.

---

## 5. Accessibility

> Key files: `fe/src/components/BidTimeline.tsx`, `fe/src/components/EncryptionCard.tsx`

- [ ] 🟢 **Add ARIA progress semantics to BidTimeline**
  - **How**: In `BidTimeline.tsx`, the component renders a visual timeline of bid stages but has no ARIA attributes. Add `role="progressbar"` with `aria-valuetext` describing the current stage (e.g., "Bid placed, awaiting acceptance") and `aria-label="Bid progress"`. The stages are already computed — just expose them to assistive tech.
  - **Why**: Screen readers see the timeline as meaningless divs. Users who can't see the visual progression have no way to understand bid status.

---

## 6. Backend API

> Key files: `be/src/services/encryptions.ts`, `be/src/services/cbor.ts`

- [ ] 🟢 **Guard against invalid `block_time` in createdAt conversion**
  - **How**: In `encryptions.ts` (line ~120), `new Date(utxo.block_time * 1000).toISOString()` trusts that `block_time` is a valid epoch. If Koios returns `null` or `0`, this produces `"1970-01-01T00:00:00.000Z"` or `"Invalid Date"`. Add: `const createdAt = utxo.block_time > 0 ? new Date(utxo.block_time * 1000).toISOString() : null`.
  - **Why**: Invalid ISO date strings break frontend sorting/filtering and display nonsensical dates.

---

## 7. Rust Core & Security

> Key files: `src-tauri/src/lib.rs`, `src-tauri/src/commands/secrets.rs`, `src-tauri/src/config.rs`

- [ ] 🟡 **Handle media server bind failure gracefully**
  - **How**: In `lib.rs` (line ~174), `TcpListener::bind("127.0.0.1:0").expect(...)` panics if binding fails. Replace with `match` that logs an error and skips media server startup. Store `Option<u16>` in `MediaServerPort` state. Frontend `get_media_server_port()` already returns `Result` — return an error when port is `None`. Video/audio streaming degrades gracefully (user sees "media server unavailable" instead of app crash).
  - **Why**: Port exhaustion or race conditions during startup shouldn't crash the entire app. Library text/PDF/image content still works without the media server.

- [ ] 🟢 **Detect stale lock files in secrets file locking**
  - **How**: In `secrets.rs` (line ~29–48), `acquire_file_lock()` creates `.lock` files but doesn't handle stale locks from crashed processes. Before acquiring, check the `.lock` file's modification time: if older than 1 hour, remove it and recreate. The advisory lock via `File::lock()` is released when the process exits, but the `.lock` file persists on disk.
  - **Why**: After an app crash while holding a secret lock, users can't access secrets until they manually find and delete `.lock` files — an invisible failure with no error guidance.

- [ ] 🟢 **Validate contracts section exists in config**
  - **How**: In `config.rs` `validate()` (line ~262–350), validation only runs when `self.contracts` is `Some`. If `contracts` is absent from `config.json`, the app starts with no contract addresses and all API calls fail cryptically. Add: `if self.contracts.is_none() { errors.push("contracts configuration is required".into()) }` at the start of `validate()`.
  - **Why**: The app starts but silently fails on every transaction operation. An early validation error with a clear message saves hours of debugging.

- [ ] 🟢 **Add missing MIME types for multimedia formats**
  - **How**: In `lib.rs` `media_mime_type()` (line ~41–61), add entries for `.3gp` → `"video/3gpp"`, `.m2ts` → `"video/mp2t"`, `.wma` → `"audio/x-ms-wma"`, `.wmv` → `"video/x-ms-wmv"`. Currently these fall through to `application/octet-stream`, which prevents GStreamer from selecting the correct codec pipeline.
  - **Why**: Users who store these formats in their library see broken playback because the media server doesn't advertise the correct content type.

- [ ] 🟡 **Distinguish file-open error types in media server**
  - **How**: In `lib.rs` (line ~123–126), all file-open errors return 404. Distinguish: `Err(e) if e.kind() == io::ErrorKind::NotFound => 404`, `Err(e) if e.kind() == io::ErrorKind::PermissionDenied => 403`, `Err(_) => 500`. Log the actual error kind for debugging.
  - **Why**: Permission errors masquerading as "not found" make debugging library playback failures confusing. The current catch-all hides real issues.

---

## 8. Testing & CI

> Key files: `.github/workflows/ci.yml`, `fe/vite.config.ts`, `be/vitest.config.ts`

- [ ] 🟡 **Enforce coverage thresholds in CI**
  - **How**: In `fe/vite.config.ts` (lines 75–85), coverage thresholds are defined but vitest doesn't fail CI when thresholds are breached. Verify that `npm run test:coverage` uses `--coverage.thresholdAutoUpdate=false` so the process exits non-zero on threshold violation. Same for `be/vitest.config.ts`. If thresholds are already enforced, this is a no-op.
  - **Why**: Thresholds exist as aspirational numbers but may not actually prevent coverage regression.

- [ ] 🟢 **Add aiken.toml version to CI version consistency check**
  - **How**: In `.github/workflows/ci.yml` (lines 95–111), the version check compares 5 sources but misses `app/contracts/aiken.toml`. Add: `V_AIKEN=$(grep '^version' ../contracts/aiken.toml | sed 's/.*"\(.*\)"/\1/')` and include it in the mismatch check. The CLAUDE.md version bump checklist already lists aiken.toml — CI should enforce it.
  - **Why**: Contract version can drift from app version without any CI failure, creating release inconsistencies.

- [ ] 🟢 **Cache backend npm dependencies in CI**
  - **How**: In `.github/workflows/ci.yml` (line ~120–124), `actions/setup-node` caches only `app/gui/package-lock.json`. Add a second cache entry or change `cache-dependency-path` to a list: `["app/gui/package-lock.json", "app/gui/be/package-lock.json", "app/gui/fe/package-lock.json"]`.
  - **Why**: Backend `npm ci` re-downloads all dependencies on every CI run. Caching saves ~30s per workflow.

---

## Priority Guide

### Must-Have (blocks production readiness)
- CBOR bounds check (S4) — denial-of-service via malformed datum
- Validate contracts config (S7) — app starts but fails silently without contracts
- Handle media server bind failure (S7) — port conflict crashes entire app

### Should-Have (significant UX/reliability improvement)
- Stale lock file detection (S7) — secrets inaccessible after crash
- Health check circuit breaker sync (S4) — false "unhealthy" status
- Guard block_time conversion (S6) — invalid dates break frontend

### Nice-to-Have (polish and delight)
- Replace alert() fallbacks (S1) — native dialogs in desktop app
- InfoTooltip Escape key (S2) — keyboard UX parity
- MIME type additions (S7) — rare format playback
- Library select mode Escape hint (S3) — discoverability

### Craft (the details that make users say "this is well built")
- aria-pressed on favorites (S1) — screen reader toggle state
- aria-invalid on MnemonicInput (S2) — form validation announcements
- aria-live on PasswordStrength (S2) — live requirement updates
- BidTimeline ARIA (S5) — progress semantics for screen readers
- File-open error distinction (S7) — clearer debugging

### Infrastructure (developer productivity)
- Enforce coverage thresholds (S8) — prevent regression
- Aiken version in CI check (S8) — version consistency
- Cache backend deps (S8) — faster CI
- Log missing metadata hashes (S4) — operator visibility
