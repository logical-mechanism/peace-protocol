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

1. [Marketplace Tab](#1-marketplace-tab)
2. [Place Bid Modal](#2-place-bid-modal)
3. [History Tab](#3-history-tab)
4. [Library Tab](#4-library-tab)
5. [Create Listing Modal](#5-create-listing-modal)
6. [Media Viewers](#6-media-viewers)
7. [Settings Page](#7-settings-page)
8. [Error Handling & User Feedback](#8-error-handling--user-feedback)
9. [Design System & Styling](#9-design-system--styling)
10. [Accessibility](#10-accessibility)
11. [Backend API](#11-backend-api)
12. [Rust Core & Security](#12-rust-core--security)
13. [Testing](#13-testing)
14. [CI/CD](#14-cicd)

---

## 1. Marketplace Tab

> Key files: `fe/src/components/MarketplaceTab.tsx`

- [x] 🟢 **Close filters panel on Escape key**
  - **How**: In `MarketplaceTab.tsx`, add a `useEffect` that listens for `keydown` when `filtersOpen` is true. On Escape, call `setFiltersOpen(false)`. Clean up the listener when `filtersOpen` changes.
  - **Why**: Users who open the filters panel with the keyboard have no way to dismiss it without clicking; Escape is the expected pattern.

- [x] 🟡 **Distinguish "no listings exist" from "fetch failed"**
  - **How**: In `MarketplaceTab.tsx` (line ~283), the error state shows a generic "Failed to load listings" EmptyState. When `error` is null and `filteredAndSorted.length === 0` with no active filters, show a distinct EmptyState: "No listings available yet — be the first to create one!" with a CTA to create a listing. Currently both cases funnel into the same empty view.
  - **Why**: A new user seeing "no listings" after a successful fetch needs different guidance than one who hit a network error.

---

## 2. Place Bid Modal

> Key files: `fe/src/components/PlaceBidModal.tsx`

- [x] 🟢 **Add title tooltip to truncated token/seller in listing details**
  - **How**: In `PlaceBidModal.tsx` (lines 261–268), the Token and Seller values use `truncateHex()` but have no `title` attribute. Add `title={encryption.tokenName}` and `title={encryption.seller}` to the respective `<span>` elements so hovering reveals the full value.
  - **Why**: Users inspecting listing details before bidding cannot see the full token name or seller address.

- [x] 🟢 **Use `type="number"` for future price input**
  - **How**: In `PlaceBidModal.tsx` (line 498), change `type="text"` to `type="number"` with `min="0"` and `step="0.000001"` on the futurePrice input. This brings numeric keyboard on mobile (future-proofing) and prevents alphabetic input.
  - **Why**: The futurePrice field accepts any text, requiring extra validation. `type="number"` gives native browser constraints for free.

- [x] 🟡 **Show actionable guidance on submit error**
  - **How**: In `PlaceBidModal.tsx` (lines 184–186), when `setSubmitError` is called, parse the error via `errorMessages.ts` `mapError()` to get a `FriendlyError` with `action` guidance. Display the `action` field below the error message in a muted text style.
  - **Why**: "Failed to place bid. Please try again." doesn't help users diagnose whether the issue is balance, collateral, network, or something else.

---

## 3. History Tab

> Key files: `fe/src/components/HistoryTab.tsx`

- [x] 🟢 **Replace native `confirm()` with ConfirmModal for clear history**
  - **How**: In `HistoryTab.tsx` (line 241), `confirm()` is used for "Clear locally recorded transaction history?". Replace with a state-driven `ConfirmModal` (same pattern as LibraryTab delete). Add `showClearConfirm` state, render `<ConfirmModal>` with `variant="destructive"`, and wire the confirm callback to `clearHistory()`.
  - **Why**: Native browser `confirm()` dialogs look foreign in a polished desktop app and can't be styled to match the design system.

- [x] 🟢 **Add InfoTooltip for "confirmations" column**
  - **How**: In `HistoryTab.tsx`, next to the "Confirmations" column header, add `<InfoTooltip text="Number of blocks added after your transaction. 15+ confirmations means the transaction is final." />`.
  - **Why**: Non-blockchain users don't understand what confirmation counts mean or when a transaction is truly finalized.

---

## 4. Library Tab

> Key files: `fe/src/components/LibraryTab.tsx`

- [x] 🟢 **Add Escape key to exit select mode**
  - **How**: In `LibraryTab.tsx`, add a `useEffect` that listens for Escape when `selectMode` is true. On Escape, call `setSelectMode(false)` and `setSelectedItems(new Set())`. This matches the modal Escape pattern users already expect.
  - **Why**: Users entering select mode have no keyboard shortcut to exit; they must click the "Cancel" text button.

---

## 5. Create Listing Modal

> Key files: `fe/src/components/CreateListingModal.tsx`

- [ ] 🟢 **Replace native `confirm()` with ConfirmModal for unsaved changes**
  - **How**: In `CreateListingModal.tsx` (line 170), `window.confirm('You have unsaved changes...')` is used when closing with unsaved state. Replace with a state-driven ConfirmModal (same pattern as delete flows). Add `showCloseConfirm` state, render the modal with "Discard changes?" title, and wire confirm to proceed with close.
  - **Why**: Native confirm dialogs break the visual consistency of the app.

---

## 6. Media Viewers

> Key files: `fe/src/components/AudioPlayer.tsx`

- [ ] 🟢 **Use CSS variables for AudioPlayer FFT gradient colors**
  - **How**: In `AudioPlayer.tsx` (lines 348–351), the gradient hardcodes `#6366f1`, `#818cf8`, `#a5b4fc`. Replace with CSS variables: add `--audio-gradient-start`, `--audio-gradient-mid`, `--audio-gradient-end` to `index.css` (dark: current indigo values; light: theme-appropriate variants). Read them in the canvas via `getComputedStyle()`.
  - **Why**: The hardcoded indigo colors don't adapt to light theme, breaking theme parity. CSS variables ensure the visualization matches whichever theme is active.

---

## 7. Settings Page

> Key files: `fe/src/pages/Settings.tsx`

- [ ] 🟢 **Replace native `confirm()` dialogs with ConfirmModal**
  - **How**: In `Settings.tsx`, `confirm()` is used at lines 199 (orphaned Iagon files) and 1631 (clear transaction history). Replace both with state-driven ConfirmModals, using `variant="destructive"` and descriptive consequence text.
  - **Why**: Three native confirm dialogs across the app (Settings ×2, HistoryTab ×1, CreateListingModal ×1) break visual consistency with the styled ConfirmModal used everywhere else.

---

## 8. Error Handling & User Feedback

> Key files: `fe/src/services/errorMessages.ts`, `fe/src/components/MarketplaceTab.tsx`

- [ ] 🟡 **Add stale-data banner to MarketplaceTab on refresh failure**
  - **How**: In `MarketplaceTab.tsx`, when a background refresh fails (data was previously loaded successfully but refresh returned an error), show a subtle banner like HistoryTab's stale pattern (line 266–314): `"Showing cached data — refresh failed. Retry"`. Track `isStale` state alongside `error` and `loading`.
  - **Why**: HistoryTab correctly warns about stale data; MarketplaceTab silently shows old data after a failed refresh, giving users a false sense of currency.

- [ ] 🟡 **Propagate stale flag from backend cache fallback**
  - **How**: In `be/src/services/encryptions.ts` (lines 161–167) and `bids.ts` (lines 128–135), when the circuit breaker returns stale cached data, add a `stale: true` field to the API response metadata. Frontend API client (`fe/src/services/api.ts`) can then surface this to components.
  - **Why**: The backend serves stale data transparently — the frontend has no way to know it's looking at cached data from minutes ago.

---

## 9. Design System & Styling

> Key files: `fe/src/index.css`, `fe/src/components/InfoTooltip.tsx`, `fe/src/components/Toast.tsx`, `fe/src/components/OnboardingOverlay.tsx`

- [ ] 🟢 **Unify focus ring styling to use `var(--focus-ring)` token**
  - **How**: `InfoTooltip.tsx` (line 54), `Toast.tsx` (line 174), and `MnemonicInput.tsx` (line 108) define custom focus-visible styles (`ring-2 ring-[var(--accent)]`) instead of using the global `var(--focus-ring)` box-shadow from `index.css` (line 82). Replace these with `focus-visible:shadow-[var(--focus-ring)]` or add a `.focus-ring` utility class in `index.css` that applies `box-shadow: var(--focus-ring)`.
  - **Why**: Three different focus ring implementations create subtle visual inconsistencies and a maintenance burden. The global token already defines the correct dual-ring pattern.

- [ ] 🟢 **Move OnboardingOverlay inline keyframe to index.css**
  - **How**: In `OnboardingOverlay.tsx` (lines 75–80), the `@keyframes onboarding-slide-up` is defined in an inline `<style>` tag. Move it to `index.css` alongside the other animation keyframes (page-fade-in, modal-entrance, etc.). Reference it with a CSS class.
  - **Why**: All other animations live in `index.css`; this inline style tag is the only exception, creating an inconsistent pattern.

---

## 10. Accessibility

> Key files: `fe/src/components/KeyboardShortcutsOverlay.tsx`, `fe/src/components/AudioPlayer.tsx`

- [ ] 🟢 **`<kbd>` elements — screen reader improvement**
  - **How**: In `KeyboardShortcutsOverlay.tsx` (line 78), `<kbd>` elements style keyboard keys but aren't announced distinctly by screen readers. Wrap each `<kbd>` with `aria-label="Key: {keyName}"` so screen readers say "Key: Escape" instead of just "Escape" in a table context.
  - **Why**: Screen reader users need context that these are keyboard shortcuts, not just text in a table.

- [ ] 🟢 **Add visible focus indicators to AudioPlayer transport buttons**
  - **How**: In `AudioPlayer.tsx`, the play/pause/stop/skip buttons (lines 614–617) lack explicit focus ring styling. Add `focus-visible:shadow-[var(--focus-ring)]` to the transport button class string so keyboard users can see which button is focused.
  - **Why**: The AudioPlayer is fully functional via keyboard, but users can't see which transport button is currently focused.

---

## 11. Backend API

> Key files: `be/src/routes/protocol.ts`, `be/src/services/encryptions.ts`

- [ ] 🟡 **Align stub and production response shapes for `/protocol/reference`**
  - **How**: In `be/src/routes/protocol.ts`, the stub path (line ~77) returns `STUB_PROTOCOL_CONFIG.referenceScripts` while the production path (line ~98) returns a differently shaped `references` object. Align the stub response to match the production shape so frontend code doesn't break when switching between stub and production modes.
  - **Why**: Developers using `USE_STUBS=true` may write frontend code that works against stubs but fails against production data due to different response shapes.

---

## 12. Rust Core & Security

> Key files: `src-tauri/src/crypto/wallet.rs`, `src-tauri/src/process/manager.rs`, `src-tauri/src/commands/secrets.rs`

- [ ] 🟡 **Zeroize mnemonic String after use**
  - **How**: In `wallet.rs`, `decrypt_mnemonic()` (line ~112) returns a plain `String`. Rust Strings are not zeroized on drop — the plaintext mnemonic lingers in freed heap memory. Use the `zeroize` crate: change the return type to `Zeroizing<String>` from `zeroize::Zeroizing`, or manually zero the bytes before dropping. Audit all callers to ensure the `Zeroizing` wrapper is held (not `.into()` a bare String).
  - **Why**: An attacker with heap access (e.g., a memory dump) could recover the mnemonic from freed memory. Defense-in-depth for the most sensitive secret in the app.

- [ ] 🟢 **Log warning on invalid shutdown timeout env vars**
  - **How**: In `manager.rs` (lines 80–90), `default_shutdown_timeout()` reads env vars like `SHUTDOWN_TIMEOUT_CARDANO` and silently falls back on parse failure. Add an `eprintln!("Warning: invalid value for {}, using default {}s", var_name, default)` when `.parse().ok()` returns `None` but the env var is set.
  - **Why**: Developers setting custom timeout values get no feedback that their config was ignored due to a typo.

- [ ] 🟡 **Add file-level advisory locking for secret operations**
  - **How**: In `secrets.rs`, concurrent calls to `store_seller_secrets` and `get_seller_secrets` for the same token can race. Before writing a secret file, acquire an advisory lock using `fs2::FileExt::lock_exclusive()` (or `flock` on Linux). Release on drop. This prevents partial reads during writes.
  - **Why**: While unlikely in single-user operation, concurrent Tauri IPC calls from React (e.g., rapid retry clicks) could cause a read to return partial or corrupted encrypted data.

---

## 13. Testing

> Key files: `fe/src/components/EmptyStateIllustrations.tsx`, `fe/vite.config.ts`, `be/vitest.config.ts`

- [ ] 🟢 **Add test for `EmptyStateIllustrations.tsx`**
  - **How**: Create `fe/src/components/__tests__/EmptyStateIllustrations.test.tsx`. Test that each exported illustration renders an SVG element with expected `viewBox` and theme CSS variable usage (`var(--text-muted)`, `var(--accent)`). ~6 test cases (one per illustration).
  - **Why**: This is the only untested component file. All other 44 components have tests.

- [ ] 🟡 **Enforce coverage thresholds in CI**
  - **How**: In `fe/vite.config.ts` (lines 75–85), coverage thresholds are defined (`lines: 70, branches: 90`) but vitest doesn't fail CI when thresholds are breached. Update the CI workflow to use `npx vitest run --coverage` with `--coverage.thresholdAutoUpdate=false` so the process exits non-zero on threshold violation. Same for `be/vitest.config.ts` (lines 8–18).
  - **Why**: Thresholds exist as aspirational numbers but don't actually prevent coverage regression. Tests pass even when coverage drops below the defined minimums.

---

## 14. CI/CD

> Key files: `.github/workflows/ci.yml`

- [ ] 🟢 **Fix broken TypeScript CI job path**
  - **How**: In `.github/workflows/ci.yml` (line 76), the TypeScript job's `working-directory` is `app/ui/fe` — this directory does not exist. Change to `app/gui/fe`. Also update line 83 (`cache-dependency-path`) from `app/ui/fe/package-lock.json` to `app/gui/fe/package-lock.json`.
  - **Why**: The TypeScript CI job has been silently failing (or skipped) due to the wrong path. Frontend tests are not running in CI.

---

## Priority Guide

### Must-Have (blocks production readiness)
- Fix broken TypeScript CI job path (§14) — frontend tests not running in CI
- Enforce coverage thresholds in CI (§13) — thresholds exist but don't actually gate merges
- Zeroize mnemonic String after use (§12) — most sensitive secret lingers in freed memory

### Should-Have (significant UX/reliability improvement)
- Stale-data banner for MarketplaceTab (§8) — users see old data without knowing
- Propagate stale flag from backend cache fallback (§8) — backend hides staleness from frontend
- Actionable guidance on PlaceBidModal submit error (§2) — generic error message doesn't help
- Align stub/production response shapes (§11) — stub mode gives false confidence
- File-level advisory locking for secrets (§12) — prevents rare but possible data corruption

### Nice-to-Have (polish and delight)
- Replace all native `confirm()` with ConfirmModal (§3, §5, §7) — 4 instances of visual inconsistency
- Distinguish "no listings" from "fetch failed" in MarketplaceTab (§1) — better empty state guidance
- Tooltips on truncated values in PlaceBidModal (§2) — full value visible on hover
- InfoTooltip for confirmations column in HistoryTab (§3) — explains blockchain concept

### Craft (the details that make users say "this is well built")
- Unify focus ring styling to use `var(--focus-ring)` (§9) — 3 inconsistent focus patterns
- CSS variables for AudioPlayer gradient (§6) — theme parity for visualization
- Move OnboardingOverlay keyframe to index.css (§9) — consistent animation location
- Close filters/select-mode on Escape (§1, §4) — keyboard flow completeness
- AudioPlayer transport focus indicators (§10) — keyboard a11y for media player

### Infrastructure (developer productivity)
- EmptyStateIllustrations test (§13) — closes the last untested component gap
- Log warning on invalid env vars (§12) — debuggability for custom config
- `type="number"` for futurePrice input (§2) — native validation for free
