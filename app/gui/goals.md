# Veiled Desktop App — Goals & Improvements

A comprehensive backlog for making Veiled exceptional. Pick any item, implement it, check it off, and submit a PR.

Each item has:
- **What**: A brief description of the feature or improvement
- **How**: Implementation ideas and key files involved
- **Why**: The value it provides

---

## Table of Contents

1. [Onboarding & First-Run Experience](#1-onboarding--first-run-experience)
2. [Wallet & Authentication](#2-wallet--authentication)
3. [Node Sync & Process Management](#3-node-sync--process-management)
4. [Dashboard & Navigation](#4-dashboard--navigation)
5. [Marketplace Tab](#5-marketplace-tab)
6. [My Sales Tab](#6-my-sales-tab)
7. [My Purchases Tab](#7-my-purchases-tab)
8. [History Tab](#8-history-tab)
9. [Library Tab](#9-library-tab)
10. [Create Listing Modal](#10-create-listing-modal)
11. [Place Bid Modal](#11-place-bid-modal)
12. [Media Viewers (PDF, Image, Audio, Video)](#12-media-viewers-pdf-image-audio-video)
13. [Settings Page](#13-settings-page)
14. [Notifications & Alerts](#14-notifications--alerts)
15. [Design System & Styling](#15-design-system--styling)
16. [Animations & Micro-Interactions](#16-animations--micro-interactions)
17. [Accessibility](#17-accessibility)
18. [Error Handling & User Feedback](#18-error-handling--user-feedback)
19. [Performance](#19-performance)
20. [Backend API](#20-backend-api)
21. [Rust Core & Security](#21-rust-core--security)
22. [Testing](#22-testing)
23. [Developer Experience & Tooling](#23-developer-experience--tooling)
24. [Documentation & CI/CD](#24-documentation--cicd)

---

## 1. Onboarding & First-Run Experience

> Key files: `fe/src/components/OnboardingOverlay.tsx`, `fe/src/pages/WalletSetup.tsx`, `fe/src/pages/NodeSync.tsx`

- [ ] **Add step indicator accessibility labels**
  - **How**: Add `aria-label={`Step ${i+1} of ${total}: ${label}`}` to the step circles in `WalletSetup.tsx` (around line 29-55). Include `aria-current="step"` on the active step.
  - **Why**: Screen reader users have no way to know which step they're on or how many remain.

- [ ] **Warn before discarding unsaved mnemonic progress**
  - **How**: In `WalletSetup.tsx`, add a `beforeunload` handler and intercept the "Back" button (line 324-332) with a `ConfirmModal` when the user has entered mnemonic words but not completed setup.
  - **Why**: Users can lose a partially written mnemonic by accidentally navigating away.

- [ ] **Show character/word count during mnemonic verification**
  - **How**: In `WalletSetup.tsx` verification step (line 449-459), display `{entered}/{expected} words` below the input area.
  - **Why**: Users don't know how many words they've entered vs. how many are needed.

- [ ] **Add Mithril cancellation warning**
  - **How**: In `NodeSync.tsx` (line 454), show a `ConfirmModal` when stopping bootstrap that explains ~500MB of downloaded data will be wasted.
  - **Why**: Users may not realize cancelling a 70% bootstrap wastes significant bandwidth and time.

- [ ] **Re-check disk space during sync**
  - **How**: In `NodeSync.tsx` (line 222-241), poll disk space every 60s with `get_disk_usage` instead of only on mount. Show a warning banner if free space drops below 2GB.
  - **Why**: Disk can fill during the multi-hour sync; checking only on mount misses this.

---

## 2. Wallet & Authentication

> Key files: `fe/src/contexts/WalletContext.tsx`, `fe/src/pages/WalletUnlock.tsx`, `src-tauri/src/crypto/wallet.rs`, `src-tauri/src/commands/wallet.rs`

- [ ] **Add "I understand" checkbox to wallet deletion**
  - **How**: In `WalletUnlock.tsx` (line 190-204), add a checkbox like `"I understand this action is irreversible and will delete my wallet"` that must be checked before the delete button enables.
  - **Why**: Single-click delete for a cryptocurrency wallet is dangerously easy to trigger accidentally.

- [ ] **Use Zeroizing<String> for mnemonic in Rust**
  - **How**: In `src-tauri/src/crypto/wallet.rs`, change mnemonic `String` fields to `Zeroizing<String>` from the `zeroize` crate (already a dependency). Apply to the decrypted mnemonic in `decrypt_mnemonic()` and the in-memory wallet state.
  - **Why**: Mnemonics currently persist in memory after the function returns until the allocator reclaims the page; `Zeroizing` auto-clears on drop.

- [ ] **Add visual feedback before redirect on successful unlock**
  - **How**: In `WalletUnlock.tsx` (line 24), show a brief success checkmark animation (200ms) before navigating to the next page.
  - **Why**: Immediate redirect feels jarring; a quick confirmation reassures the user.

- [ ] **Export secrets backup before wallet deletion**
  - **How**: Add a "Download backup" button to the delete-wallet flow that calls a new `export_all_secrets` Tauri command, which zips all `secrets/` files into an encrypted archive using the current wallet password.
  - **Why**: Users may have active bids or listings; losing secrets means losing funds.

- [ ] **Session extension notification**
  - **How**: In `SessionWarningBanner.tsx`, make the countdown font larger (text-lg) and add an "Extend" button that's visible for the full warning period, not just the last 5 minutes.
  - **Why**: Users miss the small countdown and get unexpectedly locked out.

---

## 3. Node Sync & Process Management

> Key files: `fe/src/pages/NodeSync.tsx`, `fe/src/contexts/NodeContext.tsx`, `src-tauri/src/process/manager.rs`, `src-tauri/src/process/cardano.rs`

- [ ] **Highlight error keywords in process logs**
  - **How**: In `NodeSync.tsx` log display (line 82-106), apply `text-red-400` to lines containing "error", "failed", "exception" using a simple regex highlight.
  - **Why**: Users scrolling through hundreds of log lines can't quickly spot problems.

- [ ] **Add per-process health indicators to node status**
  - **How**: In `NodeContext.tsx`, extend `get_node_status` to return individual process states (cardano-node, Ogmios, Kupo, Express). Display as colored dots in `NodeSync.tsx` status section.
  - **Why**: Users see "Error" but can't tell which of the 4 processes failed.

- [ ] **Add port-based health checks for Ogmios and Kupo**
  - **How**: In `src-tauri/src/process/manager.rs`, add TCP connect checks to ports 1337 (Ogmios) and 1442 (Kupo) alongside Express's HTTP health check. Mark process healthy only when its port is accepting connections.
  - **Why**: Currently only Express has a health check; Ogmios/Kupo can crash without detection until a query fails.

- [ ] **Document cardano-node 45s shutdown timeout**
  - **How**: Add a code comment in `src-tauri/src/process/manager.rs` (line 77-82) explaining WHY cardano-node needs 45s (in-memory ledger state must flush to disk; SIGKILL = potential corruption requiring re-sync).
  - **Why**: Future developers may "optimize" the timeout and break ledger persistence.

- [ ] **Improve stuck-at-99% UX during sync**
  - **How**: In `NodeSync.tsx` (line 423-441), when progress >= 99% for >30s, show "Verifying ledger state..." instead of a percentage. Remove the 60-second static wait message.
  - **Why**: Users think the app is frozen when sync hovers at 99%.

- [ ] **Add SNARK prover timeout**
  - **How**: In `src-tauri/src/commands/snark.rs`, wrap the prover execution with `tokio::time::timeout(Duration::from_secs(600), ...)`. Return a descriptive timeout error if exceeded.
  - **Why**: A hung SNARK binary currently runs forever with no way for the user to recover without killing the app.

---

## 4. Dashboard & Navigation

> Key files: `fe/src/pages/Dashboard.tsx`, `fe/src/components/KeyboardShortcutsOverlay.tsx`

- [ ] **Add Suspense fallback for lazy-loaded tabs**
  - **How**: In `Dashboard.tsx` (line 9-13), wrap each lazy-loaded tab with `<Suspense fallback={<SkeletonCard count={6} />}>` to show a loading skeleton during tab switch.
  - **Why**: Blank content flickers for 100-300ms on first tab switch; skeletons maintain layout stability.

- [ ] **Preserve scroll position on data refresh**
  - **How**: In `Dashboard.tsx` (line 143-150), save `window.scrollY` before refresh and restore it in the `useEffect` cleanup after data loads.
  - **Why**: Users scroll to a listing, refresh data, and lose their position.

- [ ] **Make keyboard shortcuts discoverable**
  - **How**: Add a small "? Shortcuts" button in the Dashboard footer/toolbar that opens `KeyboardShortcutsOverlay.tsx`. Currently only accessible via the '?' key.
  - **Why**: Keyboard shortcuts are invisible to users who don't know to press '?'.

- [ ] **Show draft recovery confirmation**
  - **How**: In `Dashboard.tsx` (line 224-236), when a recoverable draft is detected, show a toast notification "Draft listing found — Resume?" with Accept/Dismiss actions instead of auto-opening the modal.
  - **Why**: Auto-opening a pre-filled modal is disorienting when the user just opened the app.

---

## 5. Marketplace Tab

> Key files: `fe/src/components/MarketplaceTab.tsx`, `fe/src/components/EncryptionCard.tsx`, `fe/src/services/favoritesStorage.ts`

- [ ] **Persist price range filter across refresh**
  - **How**: In `MarketplaceTab.tsx` (line 145-150), save filter state to localStorage via `useTabFilterState`. Restore on mount.
  - **Why**: Users set a price filter, data refreshes, and the filter resets to defaults.

- [ ] **Highlight search matches in card titles**
  - **How**: In `MarketplaceTab.tsx` search results rendering, wrap matched substrings in `<mark className="bg-yellow-500/30 text-inherit">`. Use a simple `string.indexOf()` approach.
  - **Why**: Users type a search query but can't see which part of the listing matched.

- [ ] **Show favorites count badge**
  - **How**: In `MarketplaceTab.tsx` favorites toggle button, add a badge showing `favorites.size` from `favoritesStorage.ts`.
  - **Why**: Users don't know how many listings they've favorited without toggling the view.

- [ ] **Show category item counts in filter**
  - **How**: In `MarketplaceTab.tsx` category filter dropdown, display counts like "Images (5)" by aggregating filtered results per category.
  - **Why**: Users select empty categories and think the app is broken.

- [ ] **Add copy-to-clipboard for token names on cards**
  - **How**: In `EncryptionCard.tsx`, add a small copy icon next to the truncated token name. On click, copy full token name and show a brief "Copied" tooltip.
  - **Why**: Users need to share or reference token names but can't easily copy truncated text.

- [ ] **Retry individual failed images**
  - **How**: In `EncryptionCard.tsx` image error state, show a "Retry" icon button that re-fetches via `imageCache.ts` instead of showing a permanent broken state.
  - **Why**: Transient image load failures permanently hide the listing preview.

---

## 6. My Sales Tab

> Key files: `fe/src/components/MySalesTab.tsx`, `fe/src/components/SalesListingCard.tsx`, `fe/src/components/BidsModal.tsx`

- [ ] **Show bid amount range on listing cards**
  - **How**: In `SalesListingCard.tsx`, display "Bids: 3 (1.5-8.0 ADA)" by computing min/max from the listing's bids array.
  - **Why**: Sellers see bid count but not the range, making it hard to assess demand without opening each listing.

- [ ] **Add bulk bid review**
  - **How**: In `MySalesTab.tsx`, add a "Review all bids" button that opens `BidsModal.tsx` pre-filtered to show unreviewed bids across all listings in a unified list.
  - **Why**: Sellers with many listings must click through each one individually to check bids.

---

## 7. My Purchases Tab

> Key files: `fe/src/components/MyPurchasesTab.tsx`, `fe/src/components/MyPurchaseBidCard.tsx`

- [ ] **Show decryption eligibility status**
  - **How**: In `MyPurchaseBidCard.tsx`, add a badge indicating whether decryption is available (bid accepted + secrets present) vs. pending (bid placed, awaiting acceptance).
  - **Why**: Users can't tell which purchases are ready to decrypt without clicking each one.

- [ ] **Add bid cancellation confirmation**
  - **How**: In `MyPurchasesTab.tsx` cancel-bid handler, show a `ConfirmModal` with the bid amount and any fees before proceeding.
  - **Why**: Cancelling a bid is irreversible and may have fees; one-click cancellation is risky.

---

## 8. History Tab

> Key files: `fe/src/components/HistoryTab.tsx`, `fe/src/services/transactionHistory.ts`

- [ ] **Add transaction type filter**
  - **How**: In `HistoryTab.tsx`, add a filter bar with checkboxes for transaction types (listing, bid, cancel, accept, decrypt). Filter the history list by `tx.type`.
  - **Why**: Users with many transactions can't find specific types without scrolling through everything.

- [ ] **Show pending transaction confirmation progress**
  - **How**: In `HistoryTab.tsx`, for transactions with `status: 'pending'`, show a progress indicator (e.g., "3/15 confirmations") by polling `/api/chain/confirmations/:txHash`.
  - **Why**: Users submit a transaction and have no visibility into confirmation progress from the history view.

---

## 9. Library Tab

> Key files: `fe/src/components/LibraryTab.tsx`, `fe/src/components/LibraryCard.tsx`, `fe/src/components/LibraryContentModal.tsx`

- [ ] **Persist view mode preference (grid/compact)**
  - **How**: In `LibraryTab.tsx` (line 27), save the grid/compact toggle to localStorage. Restore on mount. Follow `tabStorage.ts` pattern.
  - **Why**: Users switch to compact mode and it resets to grid on every tab switch.

- [ ] **Show loading item count**
  - **How**: In `LibraryTab.tsx` (line 22-24), display "Loading N items..." by reading the count from `list_library_items` response metadata before rendering cards.
  - **Why**: Users don't know if the library has 10 or 1000 items while the skeleton loads.

- [ ] **Bulk delete with confirmation**
  - **How**: In `LibraryTab.tsx` (line 40-43), add a selection mode toolbar that shows the count of selected items and a "Delete N items" button opening a `ConfirmModal`.
  - **Why**: Deleting library items one at a time is tedious for users cleaning up old content.

- [ ] **Show category counts in library filter**
  - **How**: In `LibraryTab.tsx` (line 77-79), compute per-category counts from the items array and display "Images (5)" style labels in the filter.
  - **Why**: Users can't see which categories have content without selecting each one.

---

## 10. Create Listing Modal

> Key files: `fe/src/components/CreateListingModal.tsx`, `fe/src/services/iagonApi.ts`, `fe/src/services/listingDraftStorage.ts`

- [ ] **Show file upload progress bar for Iagon uploads**
  - **How**: In `CreateListingModal.tsx` (line 39-40), track upload progress from the `iagon_upload` Tauri command by adding a progress callback. Display a progress bar with percentage and upload speed.
  - **Why**: Large file uploads (10MB+) show no progress; users think the app is frozen.

- [ ] **Validate image preview URL during input**
  - **How**: In `CreateListingModal.tsx` (line 176-184), debounce-fetch the image URL on blur and show a thumbnail preview with an error state if unreachable, instead of only validating on submit.
  - **Why**: Users enter a broken image URL and don't find out until form submission fails.

- [ ] **Handle Iagon disconnection gracefully**
  - **How**: In `CreateListingModal.tsx` (line 36), check Iagon connectivity before showing the file upload section. If unreachable, show "Iagon storage unavailable — text listings only" with a retry button.
  - **Why**: Users select a file category, fill out the form, and get an opaque upload error only on submit.

- [ ] **Show draft file context in recovery prompt**
  - **How**: In `CreateListingModal.tsx` (line 86-91), include the draft's filename, category, and creation date in the recovery dialog.
  - **Why**: Users can't tell which listing draft is being recovered when they have multiple abandoned attempts.

- [ ] **Preserve file when switching categories**
  - **How**: In `CreateListingModal.tsx` (line 136), when switching from a file category to "text", prompt the user before clearing the file reference instead of silently discarding it.
  - **Why**: Users accidentally lose their uploaded file by toggling the category dropdown.

---

## 11. Place Bid Modal

> Key files: `fe/src/components/PlaceBidModal.tsx`, `fe/src/services/transactionBuilder.ts`

- [ ] **Account for transaction fees in max bid calculation**
  - **How**: In `PlaceBidModal.tsx` (line 42), subtract the estimated tx fee (~0.3 ADA) from the max amount. Use `estimateMinLovelace()` from `transactionBuilder.ts` for accuracy instead of the hardcoded `FEE_RESERVE`.
  - **Why**: The "Max" button can produce a bid that fails validation because fees weren't subtracted.

- [ ] **Refresh balance before bid submission**
  - **How**: In `PlaceBidModal.tsx` (line 86-87), call `wallet.getBalance()` just before `transactionBuilder.placeBid()` and re-validate the bid amount against the fresh balance.
  - **Why**: Balance may have changed between opening the modal and clicking submit (other transactions, incoming ADA).

- [ ] **Make below-suggested-price warning sticky**
  - **How**: In `PlaceBidModal.tsx` (line 79-83), change the warning from a dismissible toast to a persistent inline warning below the amount input that stays visible as long as the bid is below suggested price.
  - **Why**: The warning disappears and users forget they're bidding below the suggested price.

---

## 12. Media Viewers (PDF, Image, Audio, Video)

> Key files: `fe/src/components/PdfViewer.tsx`, `fe/src/components/ImageViewer.tsx`, `fe/src/components/AudioPlayer.tsx`, `fe/src/components/VideoPlayer.tsx`

- [ ] **Add page jump input to PdfViewer**
  - **How**: In `PdfViewer.tsx`, add a page number input field between the prev/next buttons that allows typing a specific page number to jump to.
  - **Why**: Users with long PDFs must page through sequentially to reach a specific page.

- [ ] **Persist zoom level in PdfViewer**
  - **How**: In `PdfViewer.tsx`, save the current zoom level to localStorage keyed by `pdf-zoom`. Restore on next open.
  - **Why**: Users set their preferred zoom and lose it every time they close the viewer.

- [ ] **Add playback speed control to AudioPlayer**
  - **How**: In `AudioPlayer.tsx`, add a speed selector (0.5x, 1x, 1.5x, 2x) that sets `audioElement.playbackRate`. Style as a small dropdown next to the volume slider.
  - **Why**: Users listening to spoken content often want to speed up playback.

- [ ] **Show FFmpeg.wasm download progress for VideoPlayer**
  - **How**: In `VideoPlayer.tsx`, when FFmpeg.wasm fallback is triggered, display a progress bar during the WASM download (~25MB) before playback begins.
  - **Why**: First video play with unsupported format triggers a large download with no progress indication.

- [ ] **Clean up Blob URLs on viewer close**
  - **How**: In `ImageViewer.tsx` and `PdfViewer.tsx`, call `URL.revokeObjectURL(blobUrl)` in the `useEffect` cleanup when the modal closes.
  - **Why**: Blob URLs for large files (images, PDFs) accumulate and consume memory until the page is fully reloaded.

---

## 13. Settings Page

> Key files: `fe/src/pages/Settings.tsx`

- [ ] **Replace browser confirm() with ConfirmModal for cache deletion**
  - **How**: In `Settings.tsx` (line 220), replace the native `confirm()` call with the app's `ConfirmModal` component for image cache and library deletion actions.
  - **Why**: Native browser dialogs look foreign in a desktop app and can't be themed.

- [ ] **Show file cleanup progress**
  - **How**: In `Settings.tsx` (line 171-203), display a progress indicator during orphaned file cleanup operations (e.g., "Deleting 5 of 12 files...").
  - **Why**: Users click "Clean up" and see no feedback until the operation completes.

- [ ] **Add timeout to Iagon API key verification**
  - **How**: In `Settings.tsx` (line 15), wrap the Iagon verify call with a 10s timeout using `Promise.race`. Show "Verification timed out — check your internet connection" on timeout.
  - **Why**: If Iagon is unreachable, the verification spinner spins forever.

- [ ] **Show transaction history preview before export**
  - **How**: In `Settings.tsx` (line 92-93), show a summary (count, date range, types) before the user confirms the export.
  - **Why**: Users export blindly without knowing what they're getting.

---

## 14. Notifications & Alerts

> Key files: `fe/src/components/Toast.tsx`, `fe/src/services/bidNotifications.ts`, `fe/src/hooks/useBidNotifications.ts`

- [ ] **Add toast notification history**
  - **How**: Create `fe/src/components/NotificationHistory.tsx` that stores the last 50 toasts in a context. Add a bell icon to the Dashboard header that opens a dropdown showing recent notifications.
  - **Why**: Users miss toasts when focused elsewhere (multi-monitor, other window); there's no way to see past notifications.

- [ ] **Make toasts screen-reader accessible**
  - **How**: In `Toast.tsx`, add `role="alert"` and `aria-live="polite"` (or `"assertive"` for errors) to the toast container.
  - **Why**: Screen reader users never hear toast notifications appear.

- [ ] **Show bid notification source**
  - **How**: In `useBidNotifications.ts`, include the listing description/token name in the bid notification toast instead of a generic "New bid received" message.
  - **Why**: Sellers with multiple listings can't tell which listing received a bid.

---

## 15. Design System & Styling

> Key files: `fe/src/index.css`, `fe/src/fonts.css`

- [ ] **Document CSS custom properties**
  - **How**: Add a comment block at the top of `index.css` listing all CSS variables grouped by purpose (backgrounds, text, accents, spacing, shadows, transitions, radii) with brief descriptions.
  - **Why**: Developers adding new components guess at variable names; no legend exists.

- [ ] **Ensure focus rings are visible on dark backgrounds**
  - **How**: In `index.css`, add a custom focus-visible style: `*:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }` that provides consistent contrast across all dark backgrounds.
  - **Why**: Default browser focus rings are nearly invisible on the dark theme's backgrounds.

- [ ] **Add font subsetting for woff2 files**
  - **How**: In the font build pipeline, use `pyftsubset` to subset Inter and JetBrains Mono to Latin + common symbols only. Update `fonts.css` to reference the subsetted files.
  - **Why**: Full font files include unused glyphs (Cyrillic, Greek, Vietnamese); subsetting reduces load by ~60%.

- [ ] **Standardize price formatting**
  - **How**: Create a `formatAda(lovelace: bigint): string` utility in `fe/src/utils/` that always formats to 2 decimal places with the ADA symbol. Use it consistently in `EncryptionCard.tsx`, `SalesListingCard.tsx`, `PlaceBidModal.tsx`.
  - **Why**: Some prices show 6 decimals, some show 0; inconsistent formatting confuses users.

---

## 16. Animations & Micro-Interactions

> Key files: `fe/src/index.css`, various modal and component files

- [ ] **Add consistent modal enter/exit animations**
  - **How**: Define CSS keyframes in `index.css` for modal backdrop (fade 200ms) and content (slide-up 200ms). Apply via `useModalStack` hook's `isAnimatingOut` state. Ensure all modals use the same timing.
  - **Why**: Some modals appear instantly while others have transitions; inconsistency feels unpolished.

- [ ] **Add loading skeleton pulse animation**
  - **How**: In `fe/src/components/SkeletonCard.tsx`, add a CSS `@keyframes shimmer` animation (linear-gradient translating left to right) matching the dark theme colors.
  - **Why**: Static gray rectangles during loading look broken; shimmer communicates "loading" to users.

- [ ] **Add copy-to-clipboard feedback animation**
  - **How**: When copy succeeds, briefly scale the copy icon to 1.1x and change color to `var(--success)` using a CSS transition.
  - **Why**: The current "Copied!" text change is subtle; a visual pulse makes the confirmation more noticeable.

---

## 17. Accessibility

> Key files: All components, `fe/src/index.css`

- [ ] **Add aria-labels to icon-only buttons**
  - **How**: Audit all `<button>` elements that contain only an SVG/icon (copy, refresh, close, settings gear, favorites heart) and add `aria-label` describing the action. Start with `EncryptionCard.tsx`, `SalesListingCard.tsx`, `Dashboard.tsx` toolbar buttons.
  - **Why**: Screen reader users hear "button" with no description for icon-only actions.

- [ ] **Add aria-invalid and aria-describedby to form validation**
  - **How**: In `WalletSetup.tsx` (line 727-731) and `PlaceBidModal.tsx`, add `aria-invalid={!!error}` and `aria-describedby="error-{fieldId}"` to inputs with validation errors. Wrap error messages in `<span id="error-{fieldId}">`.
  - **Why**: Screen readers don't announce that a field has a validation error or read the error message.

- [ ] **Add focus trap to all modals**
  - **How**: Verify `useFocusTrap` from `useModalStack` is applied to every modal. Audit `ConfirmModal.tsx`, `DecryptModal.tsx`, `BidsModal.tsx` — any missing should add `useFocusTrap(modalRef)`.
  - **Why**: Tab key can escape modals and interact with background content, which is confusing and potentially dangerous for destructive actions.

- [ ] **Use color + icon for error states, not color alone**
  - **How**: In form validation errors, add an error icon (exclamation triangle) next to the red border/text. In `PlaceBidModal.tsx` and `CreateListingModal.tsx` error states.
  - **Why**: Color-blind users can't distinguish error states from normal states when only border color changes.

- [ ] **Add keyboard navigation for card grids**
  - **How**: In `MarketplaceTab.tsx` and `LibraryTab.tsx`, add arrow key navigation between cards using `tabIndex` and `onKeyDown` handlers. Focus should move left/right/up/down through the grid.
  - **Why**: Keyboard users must tab through every interactive element on every card instead of navigating between cards.

---

## 18. Error Handling & User Feedback

> Key files: `fe/src/services/errorMessages.ts`, `fe/src/hooks/useAsyncAction.ts`, `fe/src/components/ErrorBoundary.tsx`

- [ ] **Add response schema validation for API calls**
  - **How**: In `fe/src/services/api.ts`, add a lightweight runtime validator (e.g., check required fields exist and are the expected type) for each API response. On validation failure, throw a typed error that `errorMessages.ts` can map.
  - **Why**: If the backend returns malformed data, the frontend currently crashes with an opaque property-access error instead of a helpful message.

- [ ] **Add request deduplication to API client**
  - **How**: In `fe/src/services/api.ts`, maintain an in-flight request map keyed by URL. If a request for the same URL is already pending, return the existing promise instead of firing a duplicate. Clear on completion.
  - **Why**: Rapid refresh clicks and auto-refresh can fire identical requests simultaneously, wasting bandwidth and causing UI flicker.

- [ ] **Distinguish "not found" from "service unavailable" in chain confirmations**
  - **How**: In `be/src/routes/chain.ts` (line 41), return `{ confirmations: 0, status: 'not_found' }` for genuinely missing txs vs. `503` with `{ error: { code: 'SERVICE_UNAVAILABLE' } }` when Koios is down.
  - **Why**: The frontend currently treats both cases as "0 confirmations", which is incorrect when the indexer is simply unreachable.

- [ ] **Add stale data indicator**
  - **How**: In `fe/src/services/api.ts`, when backend returns data from cache (add `X-Cache: HIT` response header in `be/src/services/cache.ts`), display a subtle "Data may be stale" indicator in the Dashboard header.
  - **Why**: When Kupo/Koios are temporarily down, users see cached data without knowing it may be outdated.

---

## 19. Performance

> Key files: `fe/src/pages/Dashboard.tsx`, `fe/src/components/MarketplaceTab.tsx`, various card components

- [ ] **Add virtual scrolling for long listing lists**
  - **How**: Install `@tanstack/react-virtual` and apply to `MarketplaceTab.tsx` and `LibraryTab.tsx` card grids. Only render cards visible in the viewport + a small overscan buffer.
  - **Why**: Rendering 200+ cards simultaneously causes janky scrolling and high memory usage.

- [ ] **Memoize bid count map computation**
  - **How**: In `Dashboard.tsx`, wrap the `bidCountMap` derivation with `useMemo` keyed on the bids array reference. Currently recalculated on every render.
  - **Why**: O(n) map computation runs on every keystroke in any Dashboard input field.

- [ ] **Lazy-load media viewers**
  - **How**: Verify `PdfViewer`, `ImageViewer`, `AudioPlayer`, `VideoPlayer` are all imported via `React.lazy()` in `LibraryContentModal.tsx`. If any are statically imported, convert them.
  - **Why**: pdfjs-dist (~500KB) and ffmpeg.wasm (~25MB) should only load when actually needed, not on modal mount.

- [ ] **Add image lazy-loading to card grids**
  - **How**: In `ListingImage.tsx`, add `loading="lazy"` to the `<img>` element. Only images in or near the viewport will be loaded.
  - **Why**: Marketplace pages with 50+ listings fetch all images immediately, even those scrolled well below the fold.

- [ ] **Stagger tab data refresh**
  - **How**: In `useDataRefresh.ts`, add a 500ms delay between refreshing each tab's data instead of firing all tab refreshes simultaneously.
  - **Why**: Simultaneous refresh of all 5 tabs creates a burst of API calls that can briefly freeze the UI.

---

## 20. Backend API

> Key files: `be/src/routes/`, `be/src/services/`, `be/src/middleware/`

- [ ] **Fix PKH matching from substring to exact match**
  - **How**: In `be/src/routes/encryptions.ts` (line 188) and `be/src/routes/bids.ts` (line 146), change `.includes(pkh)` to `=== pkh` (case-insensitive). Current substring matching could return other users' data.
  - **Why**: A shorter PKH could match as a substring of a longer one, leaking unrelated listings/bids.

- [ ] **Don't retry 4xx errors in fetchWithRetry**
  - **How**: In `be/src/services/fetchWithRetry.ts` (line 32), only retry on `response.status >= 500` or network errors. Return immediately for 4xx responses.
  - **Why**: Retrying client errors (400, 404, 403) wastes time and adds load; these won't succeed on retry.

- [ ] **Add rate limiting middleware**
  - **How**: Install `express-rate-limit` and add to `be/src/app.ts`: `app.use(rateLimit({ windowMs: 60_000, max: 200 }))`. Use a higher limit for health endpoints.
  - **Why**: No rate limiting means a misbehaving frontend (or external caller) can overwhelm the backend.

- [ ] **Add individual fetch timeout via AbortController**
  - **How**: In `be/src/services/fetchWithRetry.ts` (line 30), create an `AbortController` with a 15s timeout for each fetch attempt. Pass `signal: controller.signal` to `fetch()`.
  - **Why**: `fetch()` has no built-in timeout; a hung Koios/Kupo connection blocks indefinitely.

- [ ] **Standardize warnings field in all responses**
  - **How**: In all `be/src/routes/` handlers, always include a `warnings` field (even if `{}`) in successful responses. Currently only some endpoints include it.
  - **Why**: Frontend must use `?.warnings?.skippedDatums` checks; a consistent shape simplifies consumption.

- [ ] **Add periodic cache cleanup**
  - **How**: In `be/src/services/cache.ts`, add `setInterval(() => { for (const [k, v] of store) if (Date.now() > v.expiresAt) store.delete(k) }, 60_000)` to periodically evict expired entries.
  - **Why**: Expired entries persist in the Map until overwritten by `set()` or `invalidate()`; this leaks memory slowly over days of uptime.

- [ ] **Return 503 from health endpoint when all services down**
  - **How**: In `be/src/routes/health.ts`, return HTTP 503 instead of 200 when both Kupo and Koios health checks fail.
  - **Why**: Load balancers and monitoring tools expect non-200 status when the service can't fulfill requests.

- [ ] **Add per-route timeout overrides**
  - **How**: In `be/src/routes/encryptions.ts` levels endpoint, override the global 30s timeout with 60s using `router.get('/:tokenName/levels', timeout(60000), ...)`. The levels endpoint fetches tx history which can be slow for active listings.
  - **Why**: Encryption levels queries hit Koios for historical data and can exceed the 30s default, causing spurious timeouts.

---

## 21. Rust Core & Security

> Key files: `src-tauri/src/commands/secrets.rs`, `src-tauri/src/commands/media.rs`, `src-tauri/src/crypto/`

- [ ] **Validate token_name against path traversal**
  - **How**: In `src-tauri/src/commands/secrets.rs`, ensure the `validate_token_name()` function (line 80) rejects any token_name containing `/`, `\`, `..`, or null bytes. Verify it's called before ALL file operations including `store_seller_secrets`, `store_bid_secrets`, `store_accept_bid_secrets`.
  - **Why**: Token names are user-supplied and used to construct file paths; a token_name of `../../etc/passwd` could write to arbitrary locations.

- [ ] **Validate token_name in media commands**
  - **How**: In `src-tauri/src/commands/media.rs` (line 71-73), apply the same path traversal validation as secrets.rs before constructing cache paths.
  - **Why**: Same path traversal risk as secrets; image cache paths are derived from user-supplied token names.

- [ ] **Add custom Tauri error enum**
  - **How**: In `src-tauri/src/`, create an `error.rs` with an enum: `WalletLocked`, `InvalidMnemonic`, `InvalidTokenName`, `IOError(String)`, `CryptoError(String)`, etc. Implement `Into<String>` for Tauri compatibility. Use across all commands instead of ad-hoc `.map_err(|e| e.to_string())`.
  - **Why**: The frontend receives opaque error strings and must pattern-match to determine the error type; typed errors enable precise error handling.

- [ ] **Don't log Iagon API key in error messages**
  - **How**: In `src-tauri/src/commands/iagon.rs`, audit `map_iagon_error` and ensure it strips any headers or API key values from error messages before returning them to the frontend.
  - **Why**: API keys in error strings could leak to UI toast messages or frontend console logs.

- [ ] **Make process log buffer size configurable**
  - **How**: In `src-tauri/src/process/manager.rs` (line 58), read `LOG_BUFFER_SIZE` from environment: `env::var("LOG_BUFFER_SIZE").ok().and_then(|v| v.parse().ok()).unwrap_or(500)`.
  - **Why**: 500 lines may be insufficient for debugging complex cardano-node issues; developers need to increase without recompiling.

- [ ] **Add Iagon timeout configurability**
  - **How**: In `src-tauri/src/commands/iagon.rs` (line 50), read timeout from config: `env::var("IAGON_TIMEOUT_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(60)`. Use different defaults for upload (120s) vs. download (60s) operations.
  - **Why**: Large file uploads may need more than 60s; users on slow connections hit timeouts.

---

## 22. Testing

> Key files: `fe/src/test/`, `be/src/services/__tests__/`, `src-tauri/src/`

- [ ] **Add Rust unit tests for wallet crypto**
  - **How**: In `src-tauri/src/crypto/wallet.rs`, add `#[cfg(test)] mod tests` with: AES-GCM encrypt/decrypt round-trip, Argon2id with known test vectors, mnemonic validation edge cases (23 words, 25 words, non-BIP39 words).
  - **Why**: Zero Rust tests exist. Wallet encryption is the most security-critical code and has no regression protection.

- [ ] **Add Rust unit tests for secrets module**
  - **How**: In `src-tauri/src/crypto/secrets.rs`, add tests for: key derivation consistency (same input = same key), secret encrypt/decrypt round-trip, version migration (v1 → v2), `secure_delete` behavior.
  - **Why**: Secrets module handles seller keys and bid data; a regression means lost funds.

- [ ] **Add Rust unit tests for token_name validation**
  - **How**: In `src-tauri/src/commands/secrets.rs`, test `validate_token_name` with: valid hex, path traversal attempts (`../etc`), null bytes, empty string, 65-char string (exceeds max).
  - **Why**: Path traversal prevention must be verified; a gap is a critical security vulnerability.

- [ ] **Add backend tests for CBOR datum parsing**
  - **How**: Create `be/src/services/__tests__/cbor.test.ts` with tests for: normal CBOR decoding, indefinite-length byte string reassembly (G2 points), slot-to-time conversion for preprod and mainnet, malformed CBOR input.
  - **Why**: `cbor.ts` is used by every endpoint and has no tests; a parsing bug silently corrupts all displayed data.

- [ ] **Add backend tests for Koios service**
  - **How**: Create `be/src/services/__tests__/koios.test.ts` testing: circuit breaker transitions (closed→open after 5 failures, open→half-open after 30s), TTL cache stale fallback, batch metadata chunking, fetch retry behavior.
  - **Why**: Koios is the primary historical data source; its resilience logic is entirely untested.

- [ ] **Add backend tests for encryptions service**
  - **How**: Create `be/src/services/__tests__/encryptions.test.ts` testing: CIP-20 metadata parsing for both old (flat array) and new (structured) formats, 64-byte chunk reassembly, filtering by status/owner/token, edge cases (missing metadata, malformed datum).
  - **Why**: The core encryption display logic has no tests; CIP-20 format changes would break silently.

- [ ] **Add backend tests for bids service**
  - **How**: Create `be/src/services/__tests__/bids.test.ts` testing: bid parsing, status filtering, amount sorting, edge cases (bid pointing to non-existent encryption).
  - **Why**: Bid display logic is untested; incorrect bid matching would show wrong data to buyers/sellers.

- [ ] **Add page component tests for WalletSetup**
  - **How**: Create `fe/src/pages/__tests__/WalletSetup.test.tsx` testing: step navigation, mnemonic generation display, verification input handling, password creation validation, form submission. Mock `invoke('create_wallet')`.
  - **Why**: The most critical onboarding page has zero tests; a regression blocks new users entirely.

- [ ] **Add page component tests for Dashboard**
  - **How**: Create `fe/src/pages/__tests__/Dashboard.test.tsx` testing: tab switching, data refresh, draft recovery, bid notification badge. Mount with all required providers (Wallet, Node, Wasm, Modal contexts).
  - **Why**: Dashboard is the most complex page and the primary user interaction surface; entirely untested.

- [ ] **Add component tests for ErrorBoundary**
  - **How**: Create `fe/src/components/__tests__/ErrorBoundary.test.tsx` testing: renders children normally, catches render errors and shows fallback, recovery (try again) works, doesn't catch async errors.
  - **Why**: The error boundary wraps the entire app; if it breaks, all errors become white screens.

- [ ] **Add component tests for EncryptionCard**
  - **How**: Create `fe/src/components/__tests__/EncryptionCard.test.tsx` testing: renders with full data, renders with missing optional fields, image error fallback, truncation tooltip, favorite toggle.
  - **Why**: Most-rendered component in the app; used on Marketplace, MySales, and search results.

- [ ] **Add E2E test framework**
  - **How**: Install `@playwright/test` and create `e2e/` directory. Write a basic test: app starts → wallet setup screen appears → create wallet → unlock → node sync begins. Use `tauri-driver` for WebView interaction.
  - **Why**: No integration tests exist; individual unit tests can't catch interaction bugs between pages/contexts.

- [ ] **Add `cargo test` to CI pipeline**
  - **How**: In `.github/workflows/ci.yml` Tauri job, add a step after clippy: `run: cargo test --manifest-path src-tauri/Cargo.toml`.
  - **Why**: Even after writing Rust tests, they won't run in CI without this step; regressions will merge undetected.

---

## 23. Developer Experience & Tooling

> Key files: `app/gui/package.json`, `.github/workflows/ci.yml`, `app/gui/lint.sh`

- [ ] **Add pre-commit hooks with husky + lint-staged**
  - **How**: `npm install -D husky lint-staged`. Configure in `package.json`: lint-staged runs `eslint --fix` on `*.{ts,tsx}`, `cargo fmt --check` on `*.rs`. Add `prepare: "husky"` script.
  - **Why**: Developers can commit code that fails linting; CI catches it minutes later. Pre-commit hooks give immediate feedback.

- [ ] **Add Prettier for consistent formatting**
  - **How**: `npm install -D prettier`. Create `.prettierrc`: `{ "printWidth": 100, "singleQuote": true, "trailingComma": "es5" }`. Add to lint-staged config.
  - **Why**: No code formatter is enforced; formatting varies by developer preference, causing noisy diffs.

- [ ] **Add .editorconfig**
  - **How**: Create `app/gui/.editorconfig` with: `charset = utf-8`, `indent_style = space`, `indent_size = 2`, `trim_trailing_whitespace = true`, `insert_final_newline = true`.
  - **Why**: Different editors use different defaults; `.editorconfig` ensures consistency without manual setup.

- [ ] **Add VS Code launch configuration**
  - **How**: Create `app/gui/.vscode/launch.json` with debug configurations for: Vite dev server (attach to Chrome DevTools), Express backend (node --inspect), Tauri Rust (lldb/gdb).
  - **Why**: Developers debug by adding console.log; launch configs enable breakpoint debugging.

- [ ] **Add Makefile for common commands**
  - **How**: Create `app/gui/Makefile` with targets: `dev` (run.sh), `lint` (lint.sh), `test` (test.sh), `build` (build.sh), `clean` (rm -rf node_modules, dist, target), `install` (npm run install:all).
  - **Why**: `npm --prefix fe run lint && npm --prefix be run lint && cd src-tauri && cargo clippy` is hard to remember; `make lint` is not.

- [ ] **Add bundle size analysis**
  - **How**: Install `rollup-plugin-visualizer` and add to `fe/vite.config.ts` as a conditional plugin when `ANALYZE=true`. Add `npm run build:analyze` script.
  - **Why**: No way to detect if a new dependency bloats the bundle; WASM and crypto libraries are particularly heavy.

- [ ] **Fix CI TypeScript job working directory**
  - **How**: In `.github/workflows/ci.yml`, the TypeScript job points to `app/ui/fe` — change to `app/gui/fe` and update `cache-dependency-path` accordingly.
  - **Why**: The CI job is testing a different project directory; GUI frontend lint/test may not actually run.

---

## 24. Documentation & CI/CD

> Key files: `.github/workflows/ci.yml`, `app/gui/CHANGELOG.md`

- [ ] **Create CONTRIBUTING.md**
  - **How**: Create `app/gui/CONTRIBUTING.md` covering: dev environment setup (Node 20+, Rust, WebKitGTK, sidecar binaries), running the app (`run.sh`), running tests (`test.sh`), adding new Tauri commands, adding new API endpoints, commit message format.
  - **Why**: New contributors have no onboarding guide; setup requires knowledge scattered across CLAUDE.md, check-prereqs.sh, and tribal knowledge.

- [ ] **Add .env.example for backend**
  - **How**: Create `be/.env.example` listing all environment variables: `NETWORK`, `KUPO_URL`, `KOIOS_URL`, `USE_STUBS`, `LOG_LEVEL`, `PORT`, with comments explaining each.
  - **Why**: Developers must discover environment variables by reading source code; an example file makes configuration obvious.

- [ ] **Add automated release workflow**
  - **How**: Create `.github/workflows/release.yml` triggered on `v*` tags. Steps: checkout → install deps → build (tauri build) → create GitHub Release → upload AppImage/deb artifacts. Use `softprops/action-gh-release`.
  - **Why**: Releases are currently manual; automation ensures consistent builds and artifact distribution.

- [ ] **Add security scanning to CI**
  - **How**: In `.github/workflows/ci.yml`, add steps: `cargo audit` for Rust dependency vulnerabilities, `npm audit --production` for JS dependencies. Run on schedule (weekly) and on PR.
  - **Why**: No dependency vulnerability scanning; a compromised transitive dependency would go undetected.

- [ ] **Add multi-platform CI builds**
  - **How**: In the Tauri CI job, add a matrix: `os: [ubuntu-latest, macos-latest, windows-latest]`. Each platform needs its own sidecar binary stubs and system dependency installs.
  - **Why**: Currently only Linux is tested in CI; macOS/Windows builds may break without detection.

- [ ] **Add build artifact caching**
  - **How**: In `.github/workflows/ci.yml`, add `actions/cache` for: Cargo registry + target/ (keyed on Cargo.lock hash), npm node_modules (keyed on package-lock.json hash).
  - **Why**: CI reinstalls all dependencies on every run; caching cuts build time by ~50%.

- [ ] **Automate version bumping**
  - **How**: Create a `scripts/bump-version.sh` that takes a semver argument and updates all 6 version locations: `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `package.json`, `fe/package.json`, `be/package.json`, `CHANGELOG.md` header.
  - **Why**: Manual version bumping across 6 files is error-prone; missing one causes build/runtime version mismatches.

---

## Priority Guide

### Must-Have (blocks production readiness)
- **Validate token_name against path traversal** (Section 21) — security vulnerability
- **Fix PKH matching from substring to exact match** (Section 20) — data leak
- **Use Zeroizing<String> for mnemonic in Rust** (Section 2) — secret in memory
- **Add "I understand" checkbox to wallet deletion** (Section 2) — data loss risk
- **Add Rust unit tests for wallet crypto** (Section 22) — no regression protection for critical code
- **Add backend tests for CBOR datum parsing** (Section 22) — silent data corruption risk

### Should-Have (significant UX/reliability improvement)
- **Add file upload progress bar for Iagon** (Section 10) — users think app is frozen
- **Add toast notification history** (Section 14) — missed notifications
- **Add Suspense fallback for lazy-loaded tabs** (Section 4) — blank flicker on tab switch
- **Fix CI TypeScript job working directory** (Section 23) — CI may not be testing GUI
- **Don't retry 4xx errors in fetchWithRetry** (Section 20) — wasted retries
- **Add per-process health indicators** (Section 3) — users can't diagnose errors

### Nice-to-Have (polish and delight)
- **Add playback speed control to AudioPlayer** (Section 12)
- **Persist zoom level in PdfViewer** (Section 12)
- **Highlight search matches in card titles** (Section 5)
- **Add consistent modal enter/exit animations** (Section 16)
- **Standardize price formatting** (Section 15)
- **Show favorites count badge** (Section 5)

### Infrastructure (developer productivity)
- **Add pre-commit hooks with husky + lint-staged** (Section 23)
- **Add Prettier for consistent formatting** (Section 23)
- **Add automated release workflow** (Section 24)
- **Add `cargo test` to CI pipeline** (Section 22)
- **Create CONTRIBUTING.md** (Section 24)
- **Add bundle size analysis** (Section 23)
