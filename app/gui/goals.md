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

1. [Onboarding & First-Run Experience](#1-onboarding--first-run-experience)
2. [Wallet & Authentication](#2-wallet--authentication)
3. [Node Sync & Process Management](#3-node-sync--process-management)
4. [Dashboard & Navigation](#4-dashboard--navigation)
5. [Marketplace Tab](#5-marketplace-tab)
6. [My Sales Tab](#6-my-sales-tab)
7. [My Purchases Tab](#7-my-purchases-tab)
8. [Library Tab](#8-library-tab)
9. [Create Listing Modal](#9-create-listing-modal)
10. [Place Bid Modal](#10-place-bid-modal)
11. [Media Viewers (PDF, Image, Audio, Video)](#11-media-viewers-pdf-image-audio-video)
12. [Settings Page](#12-settings-page)
13. [Notifications & Alerts](#13-notifications--alerts)
14. [Design System & Styling](#14-design-system--styling)
15. [Animations & Micro-Interactions](#15-animations--micro-interactions)
16. [Accessibility](#16-accessibility)
17. [Error Handling & User Feedback](#17-error-handling--user-feedback)
18. [Performance](#18-performance)
19. [Backend API](#19-backend-api)
20. [Rust Core & Security](#20-rust-core--security)
21. [Testing](#21-testing)
22. [Developer Experience & Tooling](#22-developer-experience--tooling)

---

## 1. Onboarding & First-Run Experience

> Key files: `fe/src/components/OnboardingOverlay.tsx`, `fe/src/services/onboardingStorage.ts`

- [x] 🟡 **Contextual help tooltips for domain-specific concepts**
  - **How**: Add info-icon tooltips (a small `ⓘ` SVG + absolute-positioned popover) next to "Collateral", "Defragmentation", "SNARK Proving", "Binding Proof", and "Future Price" wherever they first appear. Create a reusable `InfoTooltip` component in `fe/src/components/InfoTooltip.tsx` that takes `text` prop, positions a popover on hover/focus. Wire into `Settings.tsx` (wallet management section), `CreateListingModal.tsx`, `PlaceBidModal.tsx`, and `SnarkProvingModal.tsx`.
  - **Why**: Non-expert users encounter Cardano-specific jargon without explanation; tooltips lower the knowledge barrier without cluttering the UI.

- [x] 🟢 **Explain text vs file listing difference in Create Listing**
  - **How**: In `CreateListingModal.tsx`, below the category selector, add a one-line helper: "Text listings store content on-chain. All other categories encrypt and upload files to Iagon." Show conditionally when category is selected. Use `text-xs text-[var(--text-muted)]`.
  - **Why**: Users may not understand why some categories require Iagon auth and others don't.

---

## 2. Wallet & Authentication

> Key files: `fe/src/pages/WalletUnlock.tsx`, `fe/src/pages/WalletSetup.tsx`, `fe/src/contexts/WalletContext.tsx`

- [x] 🟢 **Eye icon for password show/hide toggle**
  - **How**: In `WalletUnlock.tsx` (line ~108-114), replace the "Show"/"Hide" text button with an inline SVG eye/eye-off icon (w-4 h-4, stroke-based, matching existing icon style). Add `aria-label="Toggle password visibility"`.
  - **Why**: Text toggle looks inconsistent with the icon-based UI elsewhere; eye icon is universally understood.

- [x] 🟢 **Delete wallet button loading state**
  - **How**: In `WalletUnlock.tsx` (line ~178), add `isDeleting` state. Set true before `invoke('delete_wallet')`, false after. Disable both confirm/cancel buttons, show `LoadingSpinner` in confirm button while `isDeleting`.
  - **Why**: Deletion involves Tauri file I/O; without loading state the button appears to hang briefly.

- [x] 🟢 **Mnemonic import word input focus ring**
  - **How**: In `MnemonicInput.tsx`, add `focus-visible:ring-2 focus-visible:ring-[var(--accent)]` to each word input element. The `data-import-index` inputs currently rely on browser default focus which is invisible in some themes.
  - **Why**: Keyboard users importing a mnemonic can't see which word field is focused.

---

## 3. Node Sync & Process Management

> Key files: `fe/src/pages/NodeSync.tsx`, `fe/src/pages/Settings.tsx`, `fe/src/contexts/NodeContext.tsx`

- [x] 🟢 **Skeleton placeholder for node sync console logs**
  - **How**: In `NodeSync.tsx` (line ~82), when logs are empty and node is starting, render 4-5 skeleton text lines (thin gray bars, shimmer animation matching `SkeletonCard` pattern) instead of "Waiting for logs..." text. Reuse the shimmer from `index.css`.
  - **Why**: The "Waiting for logs..." text looks unfinished; skeleton lines set the visual expectation of log output arriving.

- [x] 🟢 **Settings process log loading skeleton**
  - **How**: In `Settings.tsx` where `logsLoading` is true, render skeleton text lines (same pattern as above) instead of an empty area while process logs load after switching processes.
  - **Why**: Switching processes in Settings shows a blank space during log fetch — skeleton communicates loading.

---

## 4. Dashboard & Navigation

> Key files: `fe/src/pages/Dashboard.tsx`, `fe/src/App.tsx`

- [x] 🟡 **Marketplace toolbar visual hierarchy**
  - **How**: In `MarketplaceTab.tsx` (line ~298+), increase the search input prominence: wider default width, subtle left-aligned search icon inside the input, `text-sm` placeholder "Search listings by name or seller...". Move filter/sort controls into a collapsible "Filters" dropdown button that sits secondary (btn-tertiary style) next to search.
  - **Why**: Search, filters, and sort currently have equal visual weight; primary action (search) should be immediately obvious.

- [x] 🟢 **"Clear filters" button on empty search results**
  - **How**: In `MarketplaceTab.tsx` (line ~161-169), when `NoResultsIllustration` renders, add a "Clear filters" button below the illustration that calls `resetFilters()` / clears search query. Use `btn-tertiary` styling.
  - **Why**: Users who search and get 0 results must manually clear the input; a one-click reset reduces friction.

---

## 5. Marketplace Tab

> Key files: `fe/src/components/EncryptionCard.tsx`, `fe/src/components/MarketplaceTab.tsx`

- [x] 🟢 **Copy button on seller address display**
  - **How**: In `EncryptionCard.tsx` (line ~232-235), next to the truncated seller hex address, add a small copy icon button (w-3.5 h-3.5 clipboard SVG) that copies the full PKH to clipboard with `navigator.clipboard.writeText()` + brief checkmark feedback (reuse `copy-check` animation from `index.css`).
  - **Why**: Seller addresses are truncated with no way to copy the full value for verification or sharing.

- [x] 🟢 **Favorite toggle micro-animation**
  - **How**: In `EncryptionCard.tsx` (line ~82-91), add a CSS scale animation to the star icon on toggle: `transition: transform 200ms ease` with a brief `scale(1.3)` on click that returns to `scale(1)`. Similar pattern to the existing `bid-pulse` animation but simpler.
  - **Why**: The favorite star currently snaps between filled/unfilled without feedback; a brief pulse makes the interaction feel responsive.

---

## 6. My Sales Tab

> Key files: `fe/src/components/MySalesTab.tsx`, `fe/src/components/SalesListingCard.tsx`

- [x] 🟢 **Explain bid acceptance consequence in confirm dialog**
  - **How**: When accepting a bid via `ConfirmModal` in the sales flow, include a brief explanation line: "The buyer will receive the decryption key and your listing will close." Currently the confirm dialog states the action but not the consequence for non-expert users.
  - **Why**: First-time sellers may not understand that accepting a bid is irreversible and reveals the secret.

---

## 7. My Purchases Tab

> Key files: `fe/src/components/MyPurchasesTab.tsx`, `fe/src/components/MyPurchaseBidCard.tsx`

- [x] 🟢 **Bid status explanation tooltips**
  - **How**: In `MyPurchaseBidCard.tsx`, add a small `InfoTooltip` (from the reusable component proposed in §1) next to bid status badges (Pending, Accepted, etc.) explaining what each status means: "Pending: Waiting for the seller to accept or reject", "Accepted: Seller accepted — decrypt to claim content."
  - **Why**: Purchase status labels are technical; buyers need to know what action (if any) they should take.

---

## 8. Library Tab

> Key files: `fe/src/components/LibraryTab.tsx`, `fe/src/components/LibraryContentModal.tsx`

- [x] 🟡 **Bulk delete per-item status feedback**
  - **How**: In `LibraryTab.tsx` (line ~213-229), when bulk deleting, track a `Map<string, 'pending' | 'success' | 'error'>` of per-item results. Show a progress indicator ("Deleting 3 of 10...") in the confirmation modal. After completion, if any failed, show a toast with count: "Deleted 8 of 10 items. 2 items could not be removed."
  - **Why**: Currently bulk delete only logs errors to console; users can't see which items failed or why.

- [x] 🟢 **Library content modal loading skeleton**
  - **How**: In `LibraryContentModal.tsx`, when content is loading asynchronously (PDF, image, audio, video), show a content-area skeleton matching the expected viewer dimensions before the lazy-loaded component mounts. Use `React.Suspense` fallback with a shimmer rectangle.
  - **Why**: Modal appears instantly but content loads async — the empty content area feels broken for a moment.

---

## 9. Create Listing Modal

> Key files: `fe/src/components/CreateListingModal.tsx`

- [x] 🟢 **Character counter on description field**
  - **How**: In `CreateListingModal.tsx` (line ~166), below the description textarea, add `<span className="text-xs text-[var(--text-muted)]">{description.length}/500</span>`. Change color to `--warning` when >400 and `--error` when =500.
  - **Why**: Users don't know the 500-char limit until they exceed it and see an error; a live counter prevents this.

- [x] 🟢 **Auto-focus first input on modal open**
  - **How**: In `CreateListingModal.tsx`, in the Effect 1 `[isOpen]` block, after resetting form state, add `setTimeout(() => firstInputRef.current?.focus(), 50)`. Add a `ref` to the first form field (title/description). Same pattern should apply to `PlaceBidModal.tsx`.
  - **Why**: Users must Tab through the modal to reach the first input; auto-focus is standard modal UX.

- [x] 🟢 **Help text for "Future Price" option**
  - **How**: Next to the "Future Price" checkbox in `CreateListingModal.tsx`, add a brief inline note: "Set a suggested resale price. Buyers see this before bidding." Use `text-xs text-[var(--text-muted)]` below the checkbox label.
  - **Why**: "Future Price" is a marketplace concept that's unclear to new users; it's only explained in the error message after invalid input.

---

## 10. Place Bid Modal

> Key files: `fe/src/components/PlaceBidModal.tsx`

- [x] 🟢 **Show min bid constraint before user input**
  - **How**: In `PlaceBidModal.tsx`, below the amount input label, add helper text: "Minimum bid: 2 ADA" in `text-xs text-[var(--text-muted)]`. Currently this only appears as a validation error after the user types a value below 2.
  - **Why**: Constraints should be visible before the user encounters them, not after they fail validation.

- [x] 🟢 **Validate bid amount on blur**
  - **How**: In `PlaceBidModal.tsx` (line ~139), add an `onBlur` handler to the amount input that runs `validateForm()` and displays field-level errors. Currently validation only fires on submit; blur validation gives immediate feedback.
  - **Why**: Users enter an invalid value, tab away, and see nothing until they hit Submit — blur validation catches errors early.

- [x] 🟢 **Set HTML max attribute on bid amount input**
  - **How**: In `PlaceBidModal.tsx`, add `max={maxBidAda}` attribute to the amount input element where `maxBidAda = (lovelace ?? 0) / 1_000_000`. This enables browser-native constraint feedback alongside the JS validation.
  - **Why**: HTML constraints provide native browser hints (e.g., scroll wheel clamping on number inputs) without relying solely on JS validation.

---

## 11. Media Viewers (PDF, Image, Audio, Video)

> Key files: `fe/src/components/PdfViewer.tsx`, `fe/src/components/ImageViewer.tsx`, `fe/src/components/VideoPlayer.tsx`, `fe/src/components/AudioPlayer.tsx`

- [x] 🟢 **PdfViewer arrow key page navigation**
  - **How**: In `PdfViewer.tsx` (line ~216-240), add `ArrowLeft` → previous page and `ArrowRight` → next page to the existing keydown handler. Guard with `!isSearchOpen` to avoid conflicts with search input navigation.
  - **Why**: PDF viewers universally support arrow key navigation; users expect this keyboard shortcut.

- [x] 🟢 **ADA currency label in bid/price inputs**
  - **How**: In `PlaceBidModal.tsx` and `CreateListingModal.tsx` price fields, add a trailing "ADA" label inside the input wrapper (right-aligned, `text-sm text-[var(--text-muted)]`). This clarifies the unit without requiring a separate label.
  - **Why**: Users can't tell if the amount field expects ADA or Lovelace without reading surrounding text.

---

## 12. Settings Page

> Key files: `fe/src/pages/Settings.tsx`

- [x] 🟡 **Replace network switch alert() with toast + error handling**
  - **How**: In `Settings.tsx` (line ~241-250), replace `window.alert()` after network switch with `toast.success("Network switched to preprod. Restart required.")`. Wrap the switch in try-catch and show `toast.error()` with the specific failure reason on error. Add a "Restart Now" action button in the success toast that calls `invoke('stop_node')`.
  - **Why**: `alert()` is jarring, blocks the UI, and provides no error recovery path. Toast is consistent with the rest of the app.

- [x] 🟢 **Image cache empty state message**
  - **How**: In `Settings.tsx`, when `imageCacheStatus.cached.length === 0`, show "No cached images" text below the header instead of just a disabled "Clear All" button. Use `text-sm text-[var(--text-muted)]`.
  - **Why**: A disabled button with no explanation looks like a bug; explicit empty state communicates intent.

- [x] 🟢 **Proactive collateral/defrag explanation**
  - **How**: In `Settings.tsx` wallet management section, add a brief note above the "Create Collateral" button: "Collateral is a small ADA deposit (5 ADA) required by Cardano smart contracts for transaction validation." Below "Defragment UTxOs": "Combines small UTxOs into fewer, larger ones to reduce transaction fees."
  - **Why**: These terms are jargon; explanations currently only appear in error messages after the user encounters a problem.

- [x] 🟡 **Settings section visual hierarchy**
  - **How**: In `Settings.tsx`, group sections into categories with visual dividers: "Node & Network" (node info, process logs, network switch), "Wallet & Security" (collateral, defrag, auto-lock, delete wallet), "Storage & Data" (Iagon, cache, library). Add category headers in `text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]` with `mt-8 mb-4` spacing.
  - **Why**: 10+ flat sections all with the same heading style makes finding a specific setting require scrolling through everything.

---

## 13. Notifications & Alerts

> Key files: `fe/src/components/Toast.tsx`, `fe/src/services/desktopNotifications.ts`

- [x] 🟢 **Toast stagger animation for multiple concurrent toasts**
  - **How**: In `Toast.tsx`, when rendering multiple toasts, add a staggered entry delay: each toast's `animation-delay` increments by 50ms (e.g., toast 1: 0ms, toast 2: 50ms, toast 3: 100ms). This creates a cascade effect instead of all toasts appearing simultaneously.
  - **Why**: Multiple simultaneous toasts currently snap into position together, which feels abrupt.

- [x] 🟡 **Loading delay masking for spinners**
  - **How**: Create a `DelayedSpinner` component in `fe/src/components/LoadingSpinner.tsx` that wraps `LoadingSpinner` with a 300ms delay before rendering. Use `useState` + `useEffect` with a timeout. Replace direct `LoadingSpinner` usage in data-fetching contexts (tab content, modal content) with `DelayedSpinner`. Keep instant spinners for button loading states.
  - **Why**: Fast requests show a brief spinner flash (< 300ms); delaying the spinner eliminates the flicker for quick loads while still showing it for genuinely slow operations.

---

## 14. Design System & Styling

> Key files: `fe/src/index.css`, `fe/src/fonts.css`

- [x] 🟢 **Add line-height tokens to design system**
  - **How**: In `index.css`, add to the `:root` variables: `--line-height-tight: 1.2; --line-height-normal: 1.5; --line-height-relaxed: 1.75;`. These complement the existing typography scale and can be referenced in component styles for consistency.
  - **Why**: Components currently inherit browser default line-heights; explicit tokens ensure consistent vertical rhythm.

- [x] 🟢 **Add larger space tokens**
  - **How**: In `index.css`, add `--space-24: 6rem; --space-32: 8rem;` to the spacing scale. Update `EmptyState.tsx` from `p-12` (48px, not in token list) to use the new token or fall back to `p-8` (--space-8).
  - **Why**: EmptyState uses arbitrary `p-12` padding that doesn't map to any design token; larger tokens formalize these values.

- [x] 🟡 **Shared formatDate() utility**
  - **How**: Create `fe/src/utils/formatDate.ts` exporting `formatDate(dateString: string): string` using `Intl.DateTimeFormat` with a consistent short format (e.g., "Jan 15, 2025"). Replace inline `new Intl.DateTimeFormat(...)` calls in `EncryptionCard.tsx` (line ~50-55), `SalesListingCard.tsx`, and any other card components that format dates.
  - **Why**: Cards use inline DateTimeFormat with potentially inconsistent options; a shared utility ensures uniform date display.

- [x] 🟢 **Standardize font-weight across card components**
  - **How**: Audit `EncryptionCard.tsx`, `SalesListingCard.tsx`, `MyPurchaseBidCard.tsx`, `LibraryCard.tsx` for title/label font-weight. Ensure card titles use `font-semibold` (600) and card labels use `font-medium` (500) consistently. Currently some titles don't specify weight (inherit browser default 400).
  - **Why**: Inconsistent font weights across cards create subtle visual imbalance that undermines the design system.

---

## 15. Animations & Micro-Interactions

> Key files: `fe/src/index.css`, various components

- [x] 🟡 **Standardize transition durations to design tokens**
  - **How**: Grep for hardcoded `duration-150`, `duration-200`, `duration-300` across components. Replace with references to `--transition-fast` (150ms), `--transition-base` (200ms), or `--transition-slow` (300ms) as appropriate. Key files: `PlaceBidModal.tsx`, `Toast.tsx`, `TransactionLink.tsx`. Use Tailwind arbitrary values: `duration-[var(--transition-base)]` or switch to CSS `transition` property referencing the variable.
  - **Why**: Mixing hardcoded durations with design tokens creates inconsistency; animations should feel uniform.

- [x] 🟢 **Transaction success toast celebration**
  - **How**: In `Toast.tsx`, for `transactionSuccess` variant, add a subtle shine/glow animation on the checkmark icon: a CSS `@keyframes` that briefly scales the icon to 1.1x and adds a faint `box-shadow` glow in `--success` color, then settles back. Duration 600ms, ease-out.
  - **Why**: Successful transactions are the app's primary accomplishment moment; a brief celebration rewards the user's effort.

---

## 16. Accessibility

> Key files: `fe/src/index.css`, `fe/src/components/PriceRangeSlider.tsx`, `fe/src/components/Toast.tsx`

- [x] 🟡 **Focus indicators on all interactive elements**
  - **How**: In `index.css`, add explicit `button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { box-shadow: var(--focus-ring); }` rule to ensure all interactive elements inherit the focus ring. Currently the global `:focus-visible` rule may not reach all elements due to specificity. Verify in WalletUnlock.tsx password input, PriceRangeSlider thumbs, and Toast action links.
  - **Why**: ~40% of interactive elements lack visible focus indicators; keyboard users can't track which element has focus.

- [x] 🟢 **PriceRangeSlider thumb focus indicator**
  - **How**: In `PriceRangeSlider.tsx` (line ~51-55), add `:focus-visible` styling to range input thumbs: `[&:focus-visible]:ring-2 [&:focus-visible]:ring-[var(--accent)]`. Also add `aria-label="Minimum price"` and `aria-label="Maximum price"` to the two range inputs.
  - **Why**: Slider thumbs have no focus indicator; screen reader users have no label for what the sliders control.

- [x] 🟢 **Toast action link focus style**
  - **How**: In `Toast.tsx` (line ~171), add `focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 rounded` to action links. Currently links only show hover:underline with no focus indicator.
  - **Why**: Toast action links (e.g., "View on CardanoScan") are keyboard-navigable but have no visible focus state.

- [x] 🟢 **HistoryTab filter button aria-labels**
  - **How**: In `HistoryTab.tsx`, add `aria-label` attributes to filter buttons that describe their function (e.g., `aria-label="Filter by pending transactions"`, `aria-label="Filter by confirmed transactions"`). Screen readers currently announce only the button text which may be ambiguous.
  - **Why**: Filter buttons may show only icons or abbreviated text; explicit labels improve screen reader navigation.

---

## 17. Error Handling & User Feedback

> Key files: `be/src/services/kupo.ts`, `be/src/routes/`, `fe/src/services/errorMessages.ts`

- [x] 🟡 **Kupo-specific error codes for frontend messaging**
  - **How**: In `be/src/services/kupo.ts`, catch connection errors and return a structured error with code `KUPO_UNAVAILABLE`. In route handlers (`encryptions.ts`, `bids.ts`), detect this code and return 503 with `{ error: { code: 'KUPO_UNAVAILABLE', message: 'UTxO indexer is not reachable' } }`. In `fe/src/services/errorMessages.ts`, add a pattern for this code: title "Kupo Unavailable", message "The UTxO indexer is starting up or unreachable", action "Wait for the node to finish syncing, then try again."
  - **Why**: Kupo failures currently return generic 500 "Failed to fetch encryptions"; users can't distinguish between a bug and a service starting up.

- [s] 🟡 **Protocol params cache with fallback**
  - **How**: In `be/src/routes/protocol.ts` (line ~155-184), wrap the Koios params call in the existing TTL cache with a long TTL (300s — params rarely change). If both cache and Koios fail, return hardcoded Cardano defaults (minFeeA=44, maxTxSize=16384, etc.) with a `warnings: ['Using fallback protocol parameters']` field.
  - **Why**: When Koios is down, `/api/protocol/params` returns 500 and transaction building fails entirely; cached/fallback params keep the app functional.

- [x] 🟢 **Iagon cleanup per-item error feedback**
  - **How**: In `Settings.tsx` (line ~196-210), when bulk-deleting orphaned Iagon files, track success/failure per file. After completion, show toast: "Cleaned up X of Y files" and log failures. Currently bulk delete silently ignores individual file deletion errors.
  - **Why**: Users clicking "Delete All Orphans" get no feedback if some deletions fail due to network or permission errors.

---

## 18. Performance

> Key files: `fe/src/components/MarketplaceTab.tsx`, `fe/src/pages/Dashboard.tsx`

- [s] 🔴 **Virtual scrolling for Marketplace tab**
  - **How**: In `MarketplaceTab.tsx`, integrate `@tanstack/react-virtual` (already a dependency, used in HistoryTab) to virtualize the listing grid. Replace the current `.map()` over all filtered listings with a virtualized grid renderer. Requires calculating row heights based on card dimensions and window height. Model after HistoryTab's `useVirtualizer` implementation.
  - **Why**: With hundreds of listings, rendering all cards simultaneously causes jank on scroll; virtual scrolling renders only visible cards.

- [ ] 🟡 **Tab data caching with stale-while-revalidate**
  - **How**: In `Dashboard.tsx`, maintain a `Map<string, { data, timestamp }>` cache per tab. When switching tabs, immediately render cached data (if < 30s old) and refetch in the background. If refetch returns different data, update. This prevents skeleton flashing on every tab switch.
  - **Why**: Tab switching currently triggers full data refetch showing skeletons; cached data provides instant tab switching.

---

## 19. Backend API

> Key files: `be/src/routes/protocol.ts`, `be/src/app.ts`, `be/src/services/kupo.ts`

- [s] 🟡 **Protocol params bounds validation**
  - **How**: In `be/src/routes/protocol.ts` (line ~155-184), after fetching params from Koios, validate key fields: `minFeeA > 0`, `minFeeB > 0`, `maxTxSize > 0 && maxTxSize <= 32768`, `maxValSize > 0`. If any field is out of bounds, log a warning and return the previous cached value (or hardcoded defaults). This prevents a compromised/buggy Koios from sending invalid params that break transaction building.
  - **Why**: Protocol params are accepted as-is from Koios with no sanity checks; malformed values would cause all transaction building to fail.

- [ ] 🟢 **Health endpoint returns 503 for unhealthy status**
  - **How**: In `be/src/app.ts` (line ~28-63), change the `/health` endpoint to return HTTP 503 (not 200) when `status === 'unhealthy'`. The `/health/ready` endpoint already does this correctly; align `/health` to match.
  - **Why**: Load balancers and monitoring tools expect non-200 status codes for unhealthy services; returning 200 with `"status": "unhealthy"` in the body misleads automated health checks.

- [ ] 🟢 **Deduplicate pagination response structure**
  - **How**: In all paginated route handlers (`encryptions.ts`, `bids.ts`), remove the redundant `meta: { total }` field from responses. The `pagination: { total, limit, offset, hasMore }` field already contains the total count. Update frontend `api.ts` to read from `pagination` only.
  - **Why**: Having `total` in both `meta` and `pagination` is confusing for consumers; single source of truth prevents inconsistency.

- [x] 🟢 **Include requestId in all error responses**
  - **How**: In route-level 404 handlers (e.g., `GET /api/encryptions/:tokenName` when not found), ensure `requestId` from `req.requestId` (set by `requestLogger` middleware) is included in the error response object. Currently some 404 paths omit it while the global 404 handler in `app.ts` includes it.
  - **Why**: Consistent requestId in all errors enables log correlation for debugging, even for "not found" responses.

---

## 20. Rust Core & Security

> Key files: `src-tauri/src/commands/snark.rs`, `src-tauri/src/commands/iagon.rs`, `src-tauri/src/commands/media.rs`

- [ ] 🟡 **Serialize SNARK prove calls**
  - **How**: In `src-tauri/src/commands/snark.rs`, add a `tokio::sync::Mutex<()>` to the SNARK prove command's state (or use the existing NodeManager). Acquire the lock at the start of `snark_prove` and release on completion. This prevents two concurrent prove calls from reading/writing the same setup directory simultaneously.
  - **Why**: Two concurrent prove calls could corrupt shared state; proving takes minutes so the risk window is significant.

- [ ] 🟢 **Iagon API key length validation**
  - **How**: In `src-tauri/src/commands/iagon.rs` `store_iagon_api_key` command, add a length check: `if api_key.len() > 1024 { return Err("API key too long".into()); }`. This prevents theoretical disk DoS from extremely long strings.
  - **Why**: API key input is not length-validated; while unlikely, an extremely long string would waste disk space on the encrypted JSON.

- [ ] 🟡 **Image cache cleanup policy**
  - **How**: In `src-tauri/src/commands/media.rs`, add a periodic cleanup function (called from the existing hourly background task in `lib.rs`) that deletes cached images older than 30 days. Track image access time via file modification time. Also add a max cache size check (e.g., 500 MB) — if exceeded, delete oldest images until under limit.
  - **Why**: Image cache grows unbounded with no cleanup; long-running instances accumulate significant disk usage.

- [s] 🟢 **Secure delete SNARK temp files after use**
  - **How**: In `src-tauri/src/commands/snark.rs`, after the SNARK sidecar process completes, call `secure_delete()` (from `crypto/secrets.rs`) on the temp secrets file before dropping the `NamedTempFile`. Currently the file is auto-deleted on drop but NOT overwritten with zeros first.
  - **Why**: SNARK secrets (a, r, v, w0, w1 scalars) persist in the temp file until the hourly cleanup or app restart; secure deletion removes them immediately.

---

## 21. Testing

> Key files: `fe/src/components/__tests__/`, `fe/src/services/__tests__/`, `be/src/services/__tests__/`

- [ ] 🟡 **Component tests: ConfirmModal, DescriptionModal**
  - **How**: Create `fe/src/components/__tests__/ConfirmModal.test.tsx` testing: renders with title/message, calls onConfirm/onClose, shows danger variant styling, disables buttons during submission. Create `DescriptionModal.test.tsx` testing: renders full description text, handles empty description, closes on Escape.
  - **Why**: ConfirmModal is used by every destructive action in the app; DescriptionModal is a frequently opened modal. Both have zero test coverage.

- [ ] 🟡 **Component tests: SnarkProvingModal, SnarkDownloadModal**
  - **How**: Create test files testing: progress bar rendering, error state display, "Do not close" warning visibility, cancel button behavior. Mock `useSnarkProver` and `invoke` calls. Follow existing `DecryptModal.test.tsx` patterns for modal testing.
  - **Why**: SNARK modals are long-running user-facing UIs with complex state machines; bugs here leave users stuck.

- [ ] 🟡 **Component tests: PdfViewer, ImageViewer, VideoPlayer**
  - **How**: Create test files in `fe/src/components/__tests__/`. Mock `react-pdf`, Blob URL creation, and `<video>` element. Test: renders without crash, handles empty data, shows zoom controls, fullscreen toggle works. Use `@vitest-environment jsdom` pragma.
  - **Why**: Media viewers have zero test coverage despite complex error paths (invalid data, unsupported formats, FFmpeg fallback).

- [ ] 🟡 **Component tests: SalesListingCard, MyPurchaseBidCard, ListingImage, MnemonicInput**
  - **How**: Create test files testing basic rendering, prop variations, and user interactions. SalesListingCard: renders title/price/status. MyPurchaseBidCard: renders bid amount/status. ListingImage: handles missing/cached/error images. MnemonicInput: validates word count, handles paste, Tab navigation.
  - **Why**: These components are user-facing cards and inputs with zero coverage; rendering bugs would be visible immediately.

- [ ] 🟡 **Service tests: iagonApi.ts, iagonAuth.ts**
  - **How**: Create `fe/src/services/__tests__/iagonApi.test.ts` and `iagonAuth.test.ts`. Mock `invoke` from `@tauri-apps/api/core`. Test: upload returns file ID, download returns bytes, auth flow (getNonce → verify → generateApiKey), error handling for network failures and invalid responses.
  - **Why**: Iagon services are completely untested; they handle file upload/download/auth for all non-text listings. A broken wrapper silently blocks file marketplace features.

- [ ] 🟡 **Service tests: libraryService.ts, snark/index.ts, snark/prover.ts**
  - **How**: Create test files mocking Tauri `invoke`. Test: libraryService list/read/delete operations, SNARK setup decompression progress events, prover invocation and result parsing. Follow `imageCache` test patterns for Tauri IPC mocking.
  - **Why**: Library and SNARK services are untested Tauri IPC wrappers; invoke argument errors or response parsing bugs would be invisible until runtime.

- [ ] 🟢 **Hook test: useVisibility**
  - **How**: Create `fe/src/hooks/__tests__/useVisibility.test.ts`. Test: returns true when document is visible, returns false when hidden, fires callback on visibility change. Mock `document.visibilityState` and `visibilitychange` event.
  - **Why**: Only untested hook (10/11 tested); completes hook coverage.

- [ ] 🟢 **Utility tests: contentType.ts, logClassification.ts, walletErrors.ts**
  - **How**: Create test files in `fe/src/utils/`. contentType: test MIME type detection for various extensions. logClassification: test log line categorization (error, warning, info). walletErrors: test error message mapping patterns. Pure function tests — no mocking needed.
  - **Why**: Three untested utilities; pure functions are the easiest to test and provide the highest confidence per line of test code.

- [ ] 🟡 **Backend: koios.ts service test**
  - **How**: Create `be/src/services/__tests__/koios.test.ts`. Mock `fetch`. Test: circuit breaker integration (5 failures → open → 30s → half-open → probe), TTL cache stale fallback, fetchWithRetry exponential backoff. Test the interaction between all three resilience layers.
  - **Why**: Koios combines three resilience patterns (circuit breaker + cache + retry) that are tested individually but never together; integration bugs could cause silent data staleness.

- [ ] 🟢 **Backend: requestLogger middleware test**
  - **How**: Create `be/src/middleware/__tests__/requestLogger.test.ts`. Test: assigns 8-char requestId, logs method/path/status/duration, handles errors gracefully. Mock the logger and verify call arguments.
  - **Why**: RequestLogger middleware is untested; broken request ID generation or logging format would hinder debugging.

- [ ] 🟡 **Test data factories to reduce mock duplication**
  - **How**: Create `fe/src/test/factories.ts` with factory functions: `createEncryption()`, `createBid()`, `createWalletState()`, `createNodeState()` that return valid mock objects with sensible defaults and optional overrides. Replace inline mock objects in test files (currently duplicated across 40+ files).
  - **Why**: Duplicated mock setup across tests is fragile — changing a type requires updating mocks in 20+ files. Factories centralize mock construction.

- [ ] 🟢 **Test timeout configuration**
  - **How**: In `fe/vite.config.ts` test config, add `testTimeout: 30000` (30s default). For known slow tests (crypto operations), add `// vitest: { timeout: 60000 }` per-file pragma.
  - **Why**: No test timeout is configured; long-running crypto tests could hang indefinitely without failing.

---

## 22. Developer Experience & Tooling

> Key files: `build.sh`, `run.sh`, `check-prereqs.sh`

- [s] 🟡 **GitHub Actions CI/CD pipeline**
  - **How**: Create `.github/workflows/ci.yml` with jobs: (1) `lint` — runs `bash lint.sh`, (2) `test-frontend` — `cd fe && npm ci && npm test`, (3) `test-backend` — `cd be && npm ci && npm run build && npm test`. Trigger on push to main and all PRs. Use `ubuntu-latest` with Node 20 and Rust stable. Skip `tauri build` in CI (requires sidecar binaries).
  - **Why**: No CI pipeline exists; untested code can merge to main without any automated checks.

- [x] 🟢 **Backend .env.example file**
  - **How**: Create `be/.env.example` with documented environment variables: `USE_STUBS=false`, `LOG_LEVEL=info`, `PORT=3001`, `NETWORK=preprod`. Include comments explaining each variable and when to change them (e.g., `# Set USE_STUBS=true to develop without running cardano-node`).
  - **Why**: New developers don't know about stub mode or configurable options; `.env.example` is the standard way to document environment variables.

---

## Priority Guide

### Must-Have (blocks production readiness)
- GitHub Actions CI/CD pipeline (§22)
- Kupo-specific error codes for frontend messaging (§17)
- Health endpoint returns 503 for unhealthy status (§19)
- Serialize SNARK prove calls (§20)

### Should-Have (significant UX/reliability improvement)
- Protocol params cache with fallback (§17)
- Replace network switch alert() with toast (§12)
- Image cache cleanup policy (§20)
- Contextual help tooltips for domain concepts (§1)
- Service tests: iagonApi, iagonAuth (§21)
- Component tests: PdfViewer, ImageViewer, VideoPlayer (§21)

### Nice-to-Have (polish and delight)
- Character counter on description field (§9)
- Auto-focus first input on modal open (§9)
- Eye icon for password toggle (§2)
- Settings section visual hierarchy (§12)
- Virtual scrolling for Marketplace tab (§18)
- Tab data caching with stale-while-revalidate (§18)

### Craft (the details that make users say "this is well built")
- Focus indicators on all interactive elements (§16)
- Transaction success celebration animation (§15)
- Favorite toggle micro-animation (§5)
- Toast stagger animation (§13)
- Loading delay masking for spinners (§13)
- Standardize transition durations to design tokens (§15)

### Infrastructure (developer productivity)
- Test data factories (§21)
- Backend .env.example (§22)
- koios.ts service test (§21)
- Shared formatDate() utility (§14)
