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

1. [Wallet & Authentication](#1-wallet--authentication)
2. [Node Sync & Process Management](#2-node-sync--process-management)
3. [Dashboard & Navigation](#3-dashboard--navigation)
4. [Marketplace Tab](#4-marketplace-tab)
5. [Create Listing Modal](#5-create-listing-modal)
6. [Place Bid Modal](#6-place-bid-modal)
7. [Settings Page](#7-settings-page)
8. [Design System & Styling](#8-design-system--styling)
9. [Animations & Micro-Interactions](#9-animations--micro-interactions)
10. [Accessibility](#10-accessibility)
11. [Error Handling & User Feedback](#11-error-handling--user-feedback)
12. [Performance](#12-performance)
13. [Backend API](#13-backend-api)
14. [Testing](#14-testing)

---

## 1. Wallet & Authentication

> Key files: `fe/src/pages/WalletSetup.tsx`, `fe/src/pages/WalletUnlock.tsx`

- [x] 🟢 **WalletSetup hover states via CSS instead of inline JS**
  - **How**: In `WalletSetup.tsx` (line ~264-301), the "Create New Wallet" and "Import Existing Wallet" buttons use `onMouseEnter`/`onMouseLeave` handlers with manual DOM style manipulation. Replace with CSS `:hover` pseudo-classes and `transition-all duration-[var(--transition-fast)]`. Remove the inline event handlers entirely.
  - **Why**: Inline hover handlers are fragile (don't fire on keyboard focus), feel janky, and bypass the design system's transition tokens.

- [x] 🟢 **Consistent "wallet password" terminology**
  - **How**: In `WalletSetup.tsx` (line ~675), "Spending password" is used as the label. Rename to "Wallet Password" across all occurrences (WalletSetup.tsx, WalletUnlock.tsx). Search for "spending password" and "Spending password" case-insensitively. This is a pure copy change — no logic affected.
  - **Why**: "Spending password" implies it's only used for spending, not for unlocking. "Wallet Password" is clearer and matches what other Cardano wallets use.

- [x] 🟢 **HTML constraints on password inputs**
  - **How**: In `WalletSetup.tsx` password fields, add `minLength={12}` and `maxLength={128}` attributes. In `WalletUnlock.tsx` password input, add `maxLength={128}`. These complement the existing JavaScript validation with browser-native constraint feedback.
  - **Why**: Native HTML constraints enable browser-level hints (form validity API, autocomplete behavior) alongside JavaScript validation.

---

## 2. Node Sync & Process Management

> Key files: `fe/src/pages/NodeSync.tsx`, `fe/src/contexts/NodeContext.tsx`

- [x] 🟢 **Elapsed timer human-readable format for long syncs**
  - **How**: In `NodeSync.tsx`, the elapsed timer displays `00:00:00` format (HH:MM:SS). For syncs exceeding 1 hour, switch to a human-readable format: "2h 34m 12s". Use the existing `formatDuration()` pattern from `fe/src/utils/time.ts` or add a small helper. Keep HH:MM:SS for syncs under 1 hour.
  - **Why**: Clock format is hard to parse at a glance for long operations; "2h 34m" is instantly understandable.

---

## 3. Dashboard & Navigation

> Key files: `fe/src/pages/Dashboard.tsx`, `fe/src/App.tsx`

- [x] 🟢 **Home/End key support for Dashboard tab navigation**
  - **How**: In `Dashboard.tsx`, the tab navigation already handles ArrowLeft/ArrowRight for tab switching. Add `Home` key → jump to first tab (Marketplace) and `End` key → jump to last tab (Library) in the same `onKeyDown` handler.
  - **Why**: Standard WAI-ARIA tab pattern includes Home/End keys; keyboard-heavy users expect these shortcuts.

- [ ] 🟡 **Background refresh indicator on data tabs**
  - **How**: In `MarketplaceTab.tsx`, `MySalesTab.tsx`, and `LibraryTab.tsx`, background data refreshes (triggered by `tipSlot` changes) currently show no visual feedback. Add a subtle "Refreshing..." badge or a thin animated bar at the top of the tab content area. Track `isRefreshing` state separately from the initial `loading` state. Initial load shows skeletons; background refresh shows the badge over existing data.
  - **Why**: Users can't tell whether the marketplace is re-fetching or stale when the block tip advances.

---

## 4. Marketplace Tab

> Key files: `fe/src/components/EncryptionCard.tsx`, `fe/src/components/MarketplaceTab.tsx`

- [x] 🟢 **Token name tooltip showing full value**
  - **How**: In `EncryptionCard.tsx` (line ~104 compact, line ~184 standard), the token name is truncated via `truncateHex(encryption.tokenName, 8, 4)` but has no `title` attribute or tooltip showing the full hex. Add `title={encryption.tokenName}` to the wrapping element (or use the existing `InfoTooltip` component for a styled popover).
  - **Why**: Users verifying a specific listing have no way to see the full token name without opening browser dev tools.

- [x] 🟢 **Disabled bid button visual distinction**
  - **How**: In `EncryptionCard.tsx` (line ~139-141), when `hasLowBalance` is true, the Bid button uses `opacity-50 cursor-not-allowed` which is too subtle. Replace with a more distinct disabled state: `bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border-subtle)]` (which is partially there) and add a small inline hint below the button: `<span className="text-xs text-[var(--error)]">Insufficient balance</span>`.
  - **Why**: Low-opacity buttons look broken rather than intentionally disabled; an explicit message explains why bidding is blocked.

---

## 5. Create Listing Modal

> Key files: `fe/src/components/CreateListingModal.tsx`

- [ ] 🟡 **File upload progress indicator**
  - **How**: In `CreateListingModal.tsx`, file uploads to Iagon via `iagon_upload` Tauri command currently show a spinning "Creating listing..." state with no progress. The `onProgress` callback (line ~35) tracks `ListingCreationStep` stages. Add a visual step indicator showing: "Encrypting file → Uploading to Iagon → Building transaction → Signing → Submitting". Render as a vertical stepper with checkmarks for completed steps and a spinner on the active step.
  - **Why**: File uploads for large files (up to 100MB) can take significant time; users need to know what's happening and how far along the process is.

- [x] 🟢 **HTML constraints on suggested price input**
  - **How**: In `CreateListingModal.tsx`, the `suggestedPrice` input field validates via JavaScript only. Add `type="number"` with `min="0"` `max="1000000"` `step="0.000001"` attributes. This enables browser-native validation hints (scroll wheel clamping, up/down arrows).
  - **Why**: Number inputs without `type="number"` accept any text; native HTML constraints provide guardrails before JavaScript validation fires.

- [x] 🟢 **Placeholder text for form fields**
  - **How**: In `CreateListingModal.tsx`, the `description` textarea and `suggestedPrice` input lack placeholder text. Add `placeholder="Describe what buyers will receive..."` to description and `placeholder="e.g. 50"` to suggested price.
  - **Why**: Empty fields with no placeholder give no guidance on expected input format or content.

---

## 6. Place Bid Modal

> Key files: `fe/src/components/PlaceBidModal.tsx`

- [ ] 🟢 **HTML min/max/step attributes on bid amount input**
  - **How**: In `PlaceBidModal.tsx`, the bid amount input validates via JavaScript (line ~113-121 checks `MIN_BID_ADA`). Add `type="number"` with `min={MIN_BID_ADA}` `step="0.1"` attributes to the `<input>`. If `balanceLovelace` is available, compute `max={(parseInt(balanceLovelace) / 1_000_000) - FEE_RESERVE_ADA}`.
  - **Why**: Native number input constraints enable browser scroll-wheel clamping and up/down arrow increments alongside existing JavaScript validation.

---

## 7. Settings Page

> Key files: `fe/src/pages/Settings.tsx`

- [x] 🟢 **Auto-lock input min/max constraints** *(N/A — UI uses preset buttons, not a free-text input; values are already constrained by design)*

---

## 8. Design System & Styling

> Key files: `fe/src/index.css`, various components

- [ ] 🟡 **Consistent spacing token usage across components**
  - **How**: Audit components that use hardcoded Tailwind spacing (`p-6`, `gap-3`, `mt-8`) instead of CSS variable tokens (`p-[var(--space-lg)]`). Key offenders identified by the audit: `NodeSync.tsx` uses `mx-3 mb-5`, `px-3 py-1`; `WalletSetup.tsx` uses `p-6 rounded-xl`; card components mix `p-4` and `p-6` without clear rules. Establish a rule: card inner padding = `--space-md` (16px), section spacing = `--space-lg` (24px), page padding = `--space-xl` (32px). Update components to use `p-[var(--space-md)]` etc.
  - **Why**: Mixing hardcoded Tailwind values with design tokens creates subtle spacing inconsistencies and makes system-wide adjustments impossible.

- [ ] 🟡 **Define modal entrance/exit animations**
  - **How**: In `index.css`, add `@keyframes modal-enter` (opacity 0→1 + translateY(8px→0), 200ms ease-out) and `@keyframes modal-exit` (reverse). Create `.modal-enter` class. Apply in modal components' backdrop/dialog containers. Currently modals appear/disappear instantly with no transition.
  - **Why**: Instant modal appearance feels abrupt and disorienting; a subtle slide-up + fade creates spatial context.

---

## 9. Animations & Micro-Interactions

> Key files: `fe/src/index.css`, `fe/src/pages/WalletSetup.tsx`

- [ ] 🟢 **Add hover transition to buttons using inline style changes**
  - **How**: In `WalletSetup.tsx` (line ~264-301), the mode selection buttons use `onMouseEnter`/`onMouseLeave` to change background color instantly. Remove inline handlers and add `transition-colors duration-[var(--transition-fast)]` via Tailwind classes with `:hover` state classes. This is the same fix as §1 item 1 but specifically about the animation aspect.
  - **Why**: Abrupt color changes on hover feel unpolished; CSS transitions create smooth visual feedback.

---

## 10. Accessibility

> Key files: `fe/src/components/InfoTooltip.tsx`, `fe/src/components/MnemonicInput.tsx`

- [ ] 🟢 **InfoTooltip focus ring visibility**
  - **How**: In `InfoTooltip.tsx` (line ~54), the trigger button has `focus-visible:text-[var(--accent)]` (color change only) but no visible focus ring. Add `focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:rounded-full` to match the global focus ring pattern from `index.css`.
  - **Why**: Color-only focus indicators fail for color-blind users; a ring provides a shape-based indicator that works universally.

- [ ] 🟢 **Focus return to trigger element on modal close**
  - **How**: In `useModalStack` or the modal Effect 2 pattern, save `document.activeElement` when modal opens and restore focus to it when modal closes. Currently focus is trapped inside the modal (via `useFocusTrap`) but not restored on close, leaving focus on `<body>`.
  - **Why**: WAI-ARIA dialog pattern requires focus to return to the triggering element on close; losing focus position forces keyboard users to re-navigate.

---

## 11. Error Handling & User Feedback

> Key files: `fe/src/services/errorMessages.ts`, `fe/src/pages/NodeSync.tsx`

- [ ] 🟢 **Copyable raw error details in error displays**
  - **How**: In `WalletUnlock.tsx` (line ~156-169), the `<details>` element shows raw error text. Add a small copy button (clipboard icon) inside the `<details>` that copies the raw error string via `copyToClipboard()`. Use the existing copy-check animation pattern from `index.css`. Apply the same pattern in `NodeSync.tsx` error displays.
  - **Why**: Users reporting bugs need to share exact error messages; manually selecting text inside a `<details>` element is awkward.

---

## 12. Performance

> Key files: `fe/src/pages/Dashboard.tsx`

- [ ] 🟡 **Preload adjacent Dashboard tabs**
  - **How**: In `Dashboard.tsx`, tab components are lazy-loaded via `React.lazy()`. When a user is on the Marketplace tab, prefetch the MySales and MyPurchases tab chunks in the background using `import()` after a 2s idle timeout. Use `requestIdleCallback` or a simple `setTimeout`. This eliminates the loading flash on first tab switch.
  - **Why**: First-time tab switches trigger lazy chunk loading which briefly shows the Suspense fallback; preloading eliminates this jank for commonly-used adjacent tabs.

---

## 13. Backend API

> Key files: `be/src/routes/encryptions.ts`, `be/src/routes/bids.ts`

- [ ] 🟢 **Validate `refresh` query parameter explicitly**
  - **How**: In `be/src/routes/encryptions.ts` (line ~35) and `be/src/routes/bids.ts` (line ~34), the `refresh` query parameter is used as `req.query.refresh === 'true'` without validation. Add a check: if `req.query.refresh` is present but not `'true'` or `'false'`, return 400 with `{ error: { code: 'INVALID_PARAM', message: 'refresh must be true or false' } }`. Alternatively, add a `validateRefreshParam` middleware in `validate.ts`.
  - **Why**: Unvalidated query params accept arbitrary values silently; explicit validation catches typos and misuse.

---

## 14. Testing

> Key files: `fe/src/components/__tests__/`, `fe/src/services/__tests__/`, `fe/src/services/crypto/__tests__/`

- [ ] 🟡 **Component tests: EncryptionCard**
  - **How**: Create `fe/src/components/__tests__/EncryptionCard.test.tsx`. Test: renders token name and price, compact vs standard modes, favorite toggle calls `onToggleFavorite`, bid button disabled when `hasLowBalance`, "Bid Placed" badge shows when `hasBid`, copy seller address triggers clipboard. Mock `copyToClipboard` from utils. Follow `SalesListingCard.test.tsx` patterns.
  - **Why**: EncryptionCard is the primary marketplace component — every listing in the Marketplace tab renders through it. Zero test coverage.

- [ ] 🟡 **Component tests: LibraryContentModal**
  - **How**: Create `fe/src/components/__tests__/LibraryContentModal.test.tsx`. Test: renders with text content, lazy-loads PdfViewer/ImageViewer/AudioPlayer/VideoPlayer based on view mode, handles loading state, export button calls export function. Mock `React.lazy` components and Tauri `invoke` calls. Use `@vitest-environment jsdom`.
  - **Why**: LibraryContentModal is the gateway to all media viewing; bugs here block access to purchased content.

- [ ] 🟡 **Component tests: OnboardingOverlay**
  - **How**: Create `fe/src/components/__tests__/OnboardingOverlay.test.tsx`. Test: renders first step on initial launch, advances through 4 steps, marks complete on finish, doesn't render when onboarding is complete. Mock `onboardingStorage`. Follow `ShutdownOverlay.test.tsx` patterns.
  - **Why**: First-run experience sets user expectations; a broken onboarding overlay is the first impression.

- [ ] 🟢 **Component tests: PasswordStrengthIndicator**
  - **How**: Create `fe/src/components/__tests__/PasswordStrengthIndicator.test.tsx`. Test: renders 3 strength segments, shows "Weak"/"Fair"/"Strong" labels correctly, requirement checklist items check/uncheck based on password prop (length ≥ 12, uppercase, lowercase, number, special char). Pure rendering test — no mocking needed.
  - **Why**: Password strength logic affects wallet security UX; rendering bugs could mislead users about password quality.

- [ ] 🟢 **Component tests: PriceRangeSlider**
  - **How**: Create `fe/src/components/__tests__/PriceRangeSlider.test.tsx`. Test: renders min/max labels, fires `onChange` with updated range on input change, clamps values within bounds. Follow existing input component test patterns.
  - **Why**: PriceRangeSlider is a filter control used in MarketplaceTab; incorrect onChange behavior silently breaks filtering.

- [ ] 🟢 **Component tests: presentational primitives (Badge, EmptyState, LoadingSpinner, SkeletonCard, TransactionLink, ScrollToTop)**
  - **How**: Create test files for each in `fe/src/components/__tests__/`. These are simple render tests: Badge renders variant classes correctly, EmptyState renders illustration + message + CTA, LoadingSpinner renders with/without label, SkeletonCard renders all 5 layout variants, TransactionLink renders CardanoScan link with truncated hash, ScrollToTop appears on scroll. Group simple tests efficiently — can be ~10-15 lines each.
  - **Why**: Presentational primitives are used across the entire app; render tests catch Tailwind class typos and prop mishandling.

- [ ] 🟡 **Service tests: secretStorage, bidSecretStorage, acceptBidStorage**
  - **How**: Create test files in `fe/src/services/__tests__/`. Mock Tauri `invoke` from `@tauri-apps/api/core`. Test: store/get/remove operations, list operations, error handling when invoke rejects (wallet locked, file not found). These services wrap `store_seller_secrets`, `store_bid_secrets`, `store_accept_bid_secrets` Tauri commands. Follow `listingDraftStorage.test.ts` patterns.
  - **Why**: Secret storage services manage encryption keys critical to the marketplace — silent failures could cause permanent data loss.

- [ ] 🟡 **Service tests: imageCache**
  - **How**: Create `fe/src/services/__tests__/imageCache.test.ts`. Mock Tauri `invoke`. Test: `downloadImage` calls `download_image`, `getCachedImage` returns cached data, `banImage`/`unbanImage` toggle ban state, `deleteCachedImage` calls removal. Follow `libraryService.test.ts` patterns for Tauri IPC mocking.
  - **Why**: Image cache is used by every listing card with images; untested invoke wrappers could silently fail.

- [ ] 🟢 **Service tests: fileExport**
  - **How**: Create `fe/src/services/__tests__/fileExport.test.ts`. Mock Tauri `invoke` (`export_text_file` command). Test: exports text content successfully, handles invoke rejection gracefully. Small service — likely 5-10 test cases.
  - **Why**: File export is the only way users can save content outside the app; an untested wrapper risks silent failures.

- [ ] 🟡 **Crypto tests: fileEncryption.ts**
  - **How**: Create `fe/src/services/crypto/__tests__/fileEncryption.test.ts`. Use `// @vitest-environment node` pragma for WebCrypto API. Test: `encryptFileForUpload` returns encrypted blob + key + nonce + digest, `decryptDownloadedFile` with matching key/nonce recovers original bytes, `verifyFileDigest` passes for correct data and fails for tampered data. Test round-trip: encrypt → decrypt → verify.
  - **Why**: File encryption is the security boundary for all non-text listings; incorrect encryption or decryption means permanent data loss or exposure.

- [ ] 🟡 **Crypto tests: decrypt.ts**
  - **How**: Create `fe/src/services/crypto/__tests__/decrypt.test.ts`. This module likely calls the native SNARK CLI for BLS pairings, so mock `invoke('snark_decrypt_to_hash', ...)`. Test: decryption flow with valid inputs produces expected output, invalid inputs return appropriate errors. Follow `snarkProver.test.ts` for Tauri CLI mocking patterns.
  - **Why**: Decryption is the core value delivery — buyers pay ADA to decrypt content. Bugs here mean paid content is inaccessible.

- [ ] 🟡 **Storage services: error path tests for corrupted data**
  - **How**: In existing test files for `listingDraftStorage.test.ts`, `bidFormDraftStorage.test.ts`, `filterStorage.test.ts`, `favoritesStorage.test.ts`, `tabStorage.test.ts`, `onboardingStorage.test.ts`, and `themeStorage.test.ts`, add test cases for: corrupted JSON in localStorage (`JSON.parse` throws), missing keys in parsed objects, quota exceeded errors (`localStorage.setItem` throws `DOMException`). Mock `localStorage.getItem` to return malformed strings and `localStorage.setItem` to throw.
  - **Why**: 16 storage services currently test only happy paths; localStorage corruption (browser crash, quota exceeded) is a real failure mode that could crash the app.

---

## Priority Guide

### Must-Have (blocks production readiness)
- Service tests: secretStorage, bidSecretStorage, acceptBidStorage (§14) — encryption key persistence has zero test coverage
- Crypto tests: fileEncryption.ts (§14) — security-critical encryption/decryption untested
- Component tests: EncryptionCard (§14) — primary marketplace component untested

### Should-Have (significant UX/reliability improvement)
- File upload progress indicator (§5) — large uploads leave users in the dark
- Background refresh indicator on data tabs (§3) — users can't tell if data is stale
- Crypto tests: decrypt.ts (§14) — core value delivery flow untested
- Component tests: LibraryContentModal, OnboardingOverlay (§14) — feature-critical components
- Storage error path tests (§14) — prevents crash on corrupted localStorage

### Nice-to-Have (polish and delight)
- Modal entrance/exit animations (§8) — instant appearance feels unpolished
- Consistent spacing token usage (§8) — design system consistency
- Preload adjacent Dashboard tabs (§12) — eliminates first-switch loading flash
- HTML input constraints on forms (§1, §5, §6, §7) — browser-native guardrails

### Craft (the details that make users say "this is well built")
- Focus return to trigger on modal close (§10) — keyboard navigation completeness
- Copyable raw error details (§11) — bug reporting convenience
- WalletSetup hover via CSS (§1) — smooth interaction feedback
- InfoTooltip focus ring (§10) — universal accessibility
- Elapsed timer human-readable format (§2) — small readability win

### Infrastructure (developer productivity)
- Component tests for presentational primitives (§14) — broad coverage increase with minimal effort
- Service tests: imageCache, fileExport (§14) — fills Tauri IPC testing gaps
- Validate `refresh` query param (§13) — API input hygiene
