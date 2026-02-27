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

> Key files: `fe/src/pages/WalletSetup.tsx`, `fe/src/pages/NodeSync.tsx`, `fe/src/components/OnboardingOverlay.tsx`

- [x] **Clipboard paste failure feedback on mnemonic import**
  - **How**: In `WalletSetup.tsx`, the bulk paste handler catches `navigator.clipboard.readText()` rejection silently. Add `toast.warning('Could not access clipboard. Check browser permissions.')` in the catch block. Test with clipboard API denied in WebKitGTK.
  - **Why**: Users clicking "Paste all 24 words" see nothing happen if clipboard access is denied, with no way to know why.

- [x] **ETA bounds and validation on sync progress**
  - **How**: In `NodeSync.tsx` (lines 250-262), the ETA calculation from `syncSamplesRef` / `mithrilSamplesRef` can produce unrealistic values. Cap display at 48 hours (`if (etaSeconds > 172800) return 'Estimating...'`). Add a minimum sample count (3+) before showing any ETA.
  - **Why**: Early in the sync, ETAs can show "999+ hours" from a single slow sample, alarming users.

- [x] **Disk space check failure fallback warning**
  - **How**: In `NodeSync.tsx` (lines 236-241), `get_available_disk_space` invoke fails silently. Add a soft warning: "Could not verify disk space. Ensure you have at least 10 GB free." Show as an info banner, not a blocker.
  - **Why**: If the disk check itself fails, users get no warning at all, defeating the purpose of the check.

---

## 2. Wallet & Authentication

> Key files: `fe/src/pages/WalletUnlock.tsx`, `fe/src/contexts/WalletContext.tsx`, `src-tauri/src/crypto/wallet.rs`

- [x] **Delete wallet confirmation uses focus trap and modal stack**
  - **How**: In `WalletUnlock.tsx` (lines 142-221), the delete confirmation dialog uses raw fixed positioning without `useFocusTrap` or `useModalStack`. Refactor to use the standard modal pattern: register with `useModalStack('DeleteWalletConfirm')`, apply `useFocusTrap(dialogRef)`, and match the backdrop/animation pattern from other modals.
  - **Why**: Tab key escapes the delete dialog and interacts with background elements. This is a WCAG violation on a destructive action.

- [x] **Auto-lock countdown resets on user interaction during warning**
  - **How**: In `WalletContext.tsx` (lines 117-200), the auto-lock warning fires at T-90s but the countdown continues even if the user moves the mouse during the warning period. Modify `resetActivity()` to also cancel the warning state and restart the full timer, not just extend it.
  - **Why**: Users see the warning, wiggle their mouse expecting it to dismiss, but get locked out anyway if they don't perform a "real" interaction.

- [x] **Throttle all activity listeners in WalletContext**
  - **How**: In `WalletContext.tsx` (lines 133-196), `mousedown`, `keydown`, and `mousemove` all call `resetActivity()`. Throttle all three (not just mousemove) to once per second using a shared timestamp check: `if (Date.now() - lastResetRef.current < 1000) return`.
  - **Why**: Rapid typing fires `keydown` + `resetActivity()` on every keystroke, causing unnecessary work.

- [x] **Secure mnemonic zeroing on frontend after key derivation**
  - **How**: After `unlock_wallet` returns the mnemonic in the frontend (WalletContext), the string is held in JS memory for the session duration. After deriving the BLS secret via `walletSecret.ts`, overwrite the mnemonic variable with empty string and null the reference. Document that JS GC doesn't guarantee immediate cleanup.
  - **Why**: The raw mnemonic sitting in JS heap memory is a target for memory-scraping attacks. Zeroing it after use reduces the exposure window.

---

## 3. Node Sync & Process Management

> Key files: `fe/src/pages/NodeSync.tsx`, `src-tauri/src/process/manager.rs`, `src-tauri/src/commands/node.rs`

- [x] **Network tip fetch failure shows warning instead of silent catch**
  - **How**: In `NodeSync.tsx` (lines 370-388), the `get_network_tip` fetch failure is silently caught. Show a subtle info banner: "Could not fetch network tip — sync percentage may be approximate." Use a `tipFetchFailed` state flag.
  - **Why**: Without the network tip, sync progress percentage has no reference point. Users see "syncing" with no progress context.

- [x] **Process signal error logging with errno context**
  - **How**: In `manager.rs` (line 120), `send_signal()` uses `libc::kill()` but only returns `false` on failure without logging why. Add `let err = std::io::Error::last_os_error(); log::warn!("Failed to signal PID {}: {}", pid, err);` after a failed kill.
  - **Why**: When a process can't be signaled, the current code gives no clue why (permission denied? process gone?), making debugging difficult.

- [x] **Log buffer eviction notice in process logs**
  - **How**: In `manager.rs` (line 103-109), when the 500-line circular buffer evicts old entries, insert a marker line: `"... [N earlier lines dropped] ..."` so users know the log is incomplete. Track `dropped_count` and include it in the next `append_log` call.
  - **Why**: Users debugging issues in Settings log viewer may not realize they're missing the earliest (potentially most relevant) log entries.

- [x] **Configurable process shutdown timeouts**
  - **How**: In `manager.rs`, the shutdown timeouts (cardano-node 45s, mithril 30s, others 10s) are hardcoded. Add optional environment variable overrides: `SHUTDOWN_TIMEOUT_CARDANO=60`, `SHUTDOWN_TIMEOUT_MITHRIL=45`, etc. Fall back to current defaults if not set.
  - **Why**: Users with slow storage (spinning disks, NFS mounts) may need longer shutdown windows for cardano-node to flush its ledger state.

- [x] **Cache `app_data_dir()` path at startup instead of per-call**
  - **How**: In `node.rs` (line 33-36), `get_node_status()` calls `app.path().app_data_dir()` on every invocation (polled every 5s). Cache the path in `AppDataDir` state struct at startup (similar to existing `AppTmpDir`), and read from the cached state.
  - **Why**: `app_data_dir()` hits the filesystem each call. While fast, it's unnecessary repeated I/O on a path that never changes at runtime.

---

## 4. Dashboard & Navigation

> Key files: `fe/src/pages/Dashboard.tsx`, `fe/src/App.tsx`

- [x] **Keyboard shortcuts ignore input focus**
  - **How**: In `Dashboard.tsx` (lines 170-200), the `Ctrl+1`-`5` and `Ctrl+R` shortcuts fire even when the user is typing in a search input. Add a guard: `if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return` before handling shortcuts.
  - **Why**: Users typing in the marketplace search box accidentally trigger tab switches when pressing Ctrl+key combos.

- [x] **Smooth tab content transition**
  - **How**: Wrap the tab panel content area in a CSS transition container. On tab switch, apply `opacity: 0` → `opacity: 1` over 150ms using a `key={activeTab}` prop and CSS `@keyframes fadeIn`. Keep it subtle — no sliding.
  - **Why**: Tab content switches instantly with a flash. A brief fade smooths the visual transition.

- [x] **Balance unavailable indicator when Kupo is down**
  - **How**: In the Dashboard balance display area, when `lovelace` from WalletContext is `null`, show "Balance unavailable" with a small info icon instead of showing nothing or "0 ADA". Add tooltip: "Waiting for Kupo to start. Your funds are safe."
  - **Why**: Before Kupo starts, users see no balance and may panic thinking their funds are gone.

---

## 5. Marketplace Tab

> Key files: `fe/src/components/MarketplaceTab.tsx`, `fe/src/components/EncryptionCard.tsx`

- [x] **Image cache fetch error handling**
  - **How**: In `MarketplaceTab.tsx` (line 48), the image cache fetch uses `.catch(() => {})`. Replace with `.catch(err => console.warn('Image cache refresh failed:', err))` and optionally set a `cacheError` state to show a subtle warning icon.
  - **Why**: Silent failures make debugging impossible. If the image cache is broken, all listing images fail without any diagnostic trail.

- [x] **Null-safe price range computation**
  - **How**: In `MarketplaceTab.tsx` (lines 120-129), the price range `useMemo` assumes `suggestedPrice` is always a number. Add null coalescing: `const price = Number(e.suggestedPrice) || 0; if (isNaN(price)) return;` to skip malformed prices.
  - **Why**: A single malformed price datum from the blockchain could cause `NaN` to propagate through the price range slider.

- [x] **Null-safe sort comparisons**
  - **How**: In MarketplaceTab and MySalesTab filter/sort logic, add null-safe comparisons for nullable fields: `(a.suggestedPrice ?? Infinity) - (b.suggestedPrice ?? Infinity)` for price sort, and `(a.createdAt ?? '').localeCompare(b.createdAt ?? '')` for date sort.
  - **Why**: Undefined sort values cause inconsistent ordering. Listings without prices should sort last, not cause NaN comparisons.

- [x] **Low balance warning on bid button**
  - **How**: In `EncryptionCard.tsx` (lines 59-65), `canBid` doesn't check wallet balance. Add `const hasBalance = lovelace !== null && parseInt(lovelace) >= 2_000_000;` and when `!hasBalance`, show the Bid button as disabled with tooltip: "Insufficient balance (minimum 2 ADA)".
  - **Why**: Users can open the bid modal, fill out the form, and only discover they can't afford it after tx building fails.

- [x] **Price fallback displays "No price" instead of 1 ADA**
  - **How**: In `EncryptionCard.tsx` (lines 52-57), when `suggestedPrice` is invalid/NaN, the fallback is 1 ADA which is misleading. Replace with `"Price: TBD"` or `"No suggested price"` for listings where the seller didn't set a price.
  - **Why**: Showing "1 ADA" for a listing that has no price set confuses buyers into thinking it's cheap.

---

## 6. My Sales Tab

> Key files: `fe/src/components/MySalesTab.tsx`, `fe/src/components/SalesListingCard.tsx`

- [s] **Bulk cancel listings**
  - **How**: Add a "Select" mode toggle that shows checkboxes on each SalesListingCard. When items are selected, show a floating action bar: "3 selected — Cancel All". Each cancel calls `removeListing()` sequentially (batch tx not possible on Cardano). Disable select mode while cancellations are in progress.
  - **Why**: Sellers with many expired or unwanted listings must cancel them one by one. Bulk select speeds this up.

- [x] **Image cache error handling in MySalesTab**
  - **How**: In `MySalesTab.tsx` (line 65-66), the image cache fetch is fire-and-forget with `.catch(() => {})`. Add `console.warn` at minimum for diagnostic logging, matching MarketplaceTab improvements.
  - **Why**: Same silent failure issue as MarketplaceTab — broken image cache is invisible.

- [x] **Combined bid iteration for stats calculation**
  - **How**: In `MySalesTab.tsx` (lines 119-143), the code iterates through bids twice — once in `useMemo` for counts and once for separate logic. Merge into a single pass that computes all stats (total bids, pending count, total earned) in one loop.
  - **Why**: Double iteration is wasteful when the marketplace has hundreds of bids.

---

## 7. My Purchases Tab

> Key files: `fe/src/components/MyPurchasesTab.tsx`, `fe/src/components/MyPurchaseBidCard.tsx`

- [x] **Bid secrets fetch error feedback**
  - **How**: In `MyPurchasesTab.tsx` (lines 86-106), `getBidSecretsForEncryption()` errors are silently caught. Add `console.warn('Failed to load bid secrets:', err)` and set a `secretsError` flag to show a warning icon on affected bid cards: "Some bid data could not be loaded."
  - **Why**: If encrypted secrets can't be read (corruption, key mismatch), users see confusing bid states with no explanation.

- [x] **Offline detection for bid placement**
  - **How**: Before opening PlaceBidModal, check `navigator.onLine`. If offline, show toast: "You're offline. Bids require a network connection." Also save draft bid form state to `bidDraftStorage` on submit failure so users can retry without re-entering.
  - **Why**: If the network drops mid-bid, the user sees a generic error and loses their form input.

---

## 8. History Tab

> Key files: `fe/src/components/HistoryTab.tsx`, `fe/src/services/transactionHistory.ts`

- [s] **Group transactions by date**
  - **How**: After sorting transactions by timestamp, group into date buckets: "Today", "Yesterday", "This Week", "This Month", "Older". Render date headers between groups using `Intl.DateTimeFormat` for locale-aware dates. Use a `groupByDate(txList)` utility function.
  - **Why**: A flat list of 50+ transactions with timestamps is hard to scan. Date grouping creates natural visual landmarks.

- [x] **On-chain vs localStorage reconciliation conflict handling**
  - **How**: In `HistoryTab.tsx` (lines 67-123), when on-chain data conflicts with localStorage records (e.g., tx confirmed on-chain but marked "pending" locally), always prefer on-chain truth. Log discrepancies: `console.warn('Tx ${hash} status mismatch: local=${local} vs chain=${onChain}')`.
  - **Why**: After a crash or app update, localStorage could contain stale transaction states that confuse users.

- [x] **Stale data warning when API fallback to cache**
  - **How**: In `HistoryTab.tsx` (lines 113-119), when the API fetch fails and data falls back to localStorage, show a subtle banner: "Showing cached transaction history. Refresh to update." with a retry button.
  - **Why**: Users may see outdated transaction statuses without realizing the data isn't fresh.

---

## 9. Library Tab

> Key files: `fe/src/components/LibraryTab.tsx`, `fe/src/components/LibraryCard.tsx`, `fe/src/components/LibraryContentModal.tsx`

- [x] **Library content type icon on cards**
  - **How**: On each LibraryCard, show a small icon indicating the content type: PDF icon, image icon, audio waveform, video play, text document. Derive from `category` field in metadata or from `getViewMode()` result in `LibraryContentModal.tsx`.
  - **Why**: In compact/list view mode, all library items look identical. Type icons help users find content without opening each item.

---

## 10. Create Listing Modal

> Key files: `fe/src/components/CreateListingModal.tsx`

- [x] **Real-time field validation during typing**
  - **How**: In `CreateListingModal.tsx`, add `onBlur` validation for description length, price format, and image URL validity. Show inline error messages below each field as soon as the user leaves it, instead of waiting for form submit. Use a `fieldErrors` state object keyed by field name.
  - **Why**: Users fill out the entire form, hit submit, and only then discover their description is too long or price is invalid. Real-time feedback prevents wasted effort.

- [x] **`maxLength` HTML attribute on text inputs**
  - **How**: Add `maxLength={500}` to the description textarea and `maxLength={280}` to the secret message input in `CreateListingModal.tsx`. This provides a hard browser-level limit in addition to the existing character counter.
  - **Why**: The character counter shows the limit but doesn't prevent typing past it. Users can paste 10,000 characters and only discover the issue at submit time.

- [x] **Auto-save visual feedback indicator**
  - **How**: In `CreateListingModal.tsx` (lines 110-129), the form auto-save to `listingFormDraftStorage` happens silently. Add a tiny "Draft saved" text that appears briefly (1.5s fade) near the form footer when auto-save completes. Use CSS `@keyframes` with opacity.
  - **Why**: Users don't know their progress is being saved. Visible feedback builds trust that they can safely close and reopen the form.

- [x] **Unsaved changes warning on modal close**
  - **How**: Track a `isDirty` flag (set true on any form change, false after save/submit). In the Escape key handler and backdrop click handler, if `isDirty && !isSubmitting`, show a confirm: "You have unsaved changes. Discard?" before closing.
  - **Why**: Clicking outside the modal or pressing Escape discards all form input with no warning.

- [s] **Upload time estimate for large files**
  - **How**: After file selection, if `file.size > 10_000_000` (10 MB), show an estimate: "Estimated upload time: ~X min" based on a conservative 2 Mbps assumption. Adjust the estimate based on actual Iagon upload speed once available from previous uploads.
  - **Why**: Users selecting a 500 MB file have no idea if the upload will take 1 minute or 30 minutes.

---

## 11. Place Bid Modal

> Key files: `fe/src/components/PlaceBidModal.tsx`

- [x] **Min bid explanation in plain language**
  - **How**: In `PlaceBidModal.tsx` (lines 99-105), the minimum 2 ADA message mentions "UTxO minimum" which is technical jargon. Replace with: "Minimum bid is 2 ADA (required by the Cardano network to hold bid data on-chain)." Add a small "Why?" link/tooltip that explains UTxO minimums briefly.
  - **Why**: Non-technical users don't understand why they can't bid 0.5 ADA. A clear explanation prevents confusion and support requests.

- [x] **Balance parsing safety check**
  - **How**: In `PlaceBidModal.tsx` (lines 85-87), `balanceLovelace` is parsed with `parseInt()` without validating the input. Add: `const parsed = parseInt(balanceLovelace ?? '0', 10); const balanceAda = isNaN(parsed) ? undefined : parsed / 1_000_000;`. When `undefined`, show "Balance: loading..." instead of "0 ADA".
  - **Why**: If Kupo is slow to respond, `balanceLovelace` could be `undefined` or empty string, causing NaN display.

---

## 12. Media Viewers (PDF, Image, Audio, Video)

> Key files: `fe/src/components/PdfViewer.tsx`, `fe/src/components/ImageViewer.tsx`, `fe/src/components/AudioPlayer.tsx`, `fe/src/components/VideoPlayer.tsx`

- [x] **PDF page jump invalid input feedback**
  - **How**: In `PdfViewer.tsx` (lines 131-138), entering an invalid page number silently resets to the current page. Show a brief red border flash (200ms) on the page number input and set `aria-invalid="true"` temporarily when the entered page is out of range.
  - **Why**: Users typing page "200" in a 50-page PDF see the input reset with no explanation. A visual cue indicates the page doesn't exist.

- [x] **Image viewer EXIF orientation handling**
  - **How**: In `ImageViewer.tsx`, some JPEG images have EXIF orientation metadata that causes them to display rotated. Before creating the Blob URL, check for EXIF orientation tag using a lightweight parser (e.g., read the first 64KB of JPEG for APP1 marker) and apply CSS `image-orientation: from-image` or transform accordingly.
  - **Why**: Photos taken on phones often have EXIF rotation. Displaying them sideways makes the viewer feel broken.

- [x] **Audio player elapsed/remaining time toggle**
  - **How**: In `AudioPlayer.tsx`, clicking the time display toggles between "elapsed / total" and "elapsed / -remaining" format. Store preference in a local `showRemaining` state. Update display in the existing time render logic.
  - **Why**: Standard media player feature. Some users prefer seeing how much time is left rather than total duration.

- [x] **Video player keyboard shortcuts**
  - **How**: In `VideoPlayer.tsx`, add keyboard event handlers: Space = play/pause, Left/Right = seek ±5s, Up/Down = volume ±10%, F = toggle fullscreen, M = mute. Only active when the video player has focus. Show a brief key hint overlay on first interaction.
  - **Why**: Standard video player keyboard controls are expected. Mouse-only control is frustrating for keyboard users.

---

## 13. Settings Page

> Key files: `fe/src/pages/Settings.tsx`

- [s] **Express log level configurable from Settings**
  - **How**: Add a "Log Level" dropdown (debug/info/warn/error) in the Node section of Settings. Store in `AppConfig` via a new Tauri command `set_log_level`. Pass as `LOG_LEVEL` env var in `config.rs` `express_env_vars()` (currently not set). Restart Express after change.
  - **Why**: When users report issues, support needs debug logs. Currently there's no way to enable debug logging without code changes.

- [s] **Settings export/import for backup**
  - **How**: Add "Export Settings" button that serializes all localStorage keys (autolock, theme, toast duration, filter prefs) and Tauri config into a JSON file via `export_text_file`. Add "Import Settings" that reads and applies. Exclude sensitive data (secrets, wallet, mnemonic).
  - **Why**: Users reinstalling the app or setting up a second machine want to restore their preferences without reconfiguring everything.

- [x] **Cache clear with size display**
  - **How**: In the Storage section, show individual cache sizes: "Image cache: 45 MB", "API cache: 2 KB". Add "Clear" buttons next to each. For image cache, call `delete_cached_image` for each item. Show a confirmation with the space to be freed.
  - **Why**: Users see total disk usage but can't clear individual caches. Some may want to free image cache space while keeping chain data.

---

## 14. Notifications & Alerts

> Key files: `fe/src/hooks/useBidNotifications.ts`, `fe/src/components/Toast.tsx`

- [x] **Transaction retry action in error toasts**
  - **How**: When a transaction fails, add a "Retry" button to the error toast. The retry button re-invokes the same transaction builder function with the same parameters. Store the failed tx params in a `lastFailedTx` ref. Toast becomes sticky (no auto-dismiss) on tx failure.
  - **Why**: Transaction failures currently require users to navigate back to the modal and re-enter everything. A retry button reduces friction.

- [x] **Notification grouping for multiple simultaneous events**
  - **How**: When multiple bids arrive within 5 seconds, group them into a single notification: "3 new bids on your listings" instead of 3 separate toasts. In `useBidNotifications`, buffer incoming notifications with a 5s debounce window before dispatching to the toast system.
  - **Why**: During active marketplace periods, a burst of bid notifications can stack 5+ toasts that obscure the UI.

---

## 15. Design System & Styling

> Key files: `fe/src/index.css`, all components

- [x] **WCAG AA color contrast audit and fixes**
  - **How**: Run a contrast checker on all CSS variable combinations in both dark and light themes. `--text-muted` (rgb 138,138,138) on `--bg-primary` likely fails WCAG AA 4.5:1 ratio. Increase to at least rgb(156,163,175) for dark theme. Document all color pairs and their contrast ratios.
  - **Why**: Users with low vision or color blindness cannot read muted text. WCAG AA compliance is a baseline accessibility requirement.

- [x] **Consistent empty state messages with actionable CTAs**
  - **How**: Audit all tabs' empty states (EmptyState, EmptyStateIllustrations). Ensure each includes: (1) an illustration, (2) a clear message explaining why it's empty, (3) a call-to-action button. Example: Library empty → "No items yet. Purchase and decrypt a listing to see it here." with "Browse Marketplace" button.
  - **Why**: Empty states vary in tone and detail. Some show just "No items" with no guidance on what to do next.

- [x] **Modal max-height constraint for small screens**
  - **How**: Add `max-h-[90vh] overflow-y-auto` to the modal content container in all modals (CreateListingModal, PlaceBidModal, DecryptModal, etc.). Test at 800px viewport height. Ensure submit buttons remain visible (sticky footer or scroll into view).
  - **Why**: On smaller displays (800px height), modals can extend below the viewport with no scroll, hiding the submit button.

- [x] **Scrollbar styling for dark theme**
  - **How**: In `index.css`, add custom scrollbar styles for WebKitGTK: `::-webkit-scrollbar { width: 8px }`, `::-webkit-scrollbar-track { background: var(--bg-secondary) }`, `::-webkit-scrollbar-thumb { background: var(--border-primary); border-radius: 4px }`. Apply to both themes.
  - **Why**: Default scrollbars appear as bright white bars on dark backgrounds, breaking the visual cohesion of the dark theme.

---

## 16. Animations & Micro-Interactions

> Key files: `fe/src/index.css`, various components

- [x] **Bid count badge pulse on increment**
  - **How**: On EncryptionCard and SalesListingCard, when the bid count increases between renders, apply a CSS `@keyframes pulse { 0% { transform: scale(1) } 50% { transform: scale(1.2) } 100% { transform: scale(1) } }` animation to the bid count badge. Track previous count in a ref to detect changes.
  - **Why**: Updated bid counts are easy to miss in a grid of cards. A brief pulse draws attention to new activity.

- [x] **Skeleton card count matches expected data**
  - **How**: When loading, show the same number of skeleton cards as the previous data load (stored in a ref), or default to 6. This prevents the visual "jump" when 6 skeletons are replaced by 20 real cards.
  - **Why**: A fixed skeleton count that doesn't match actual data causes layout shifts on load completion.

- [x] **Progress bar smooth interpolation**
  - **How**: In NodeSync progress bars, use CSS `transition: width 500ms ease-out` so progress jumps (e.g., 45% → 52%) animate smoothly instead of jumping. Apply to both Mithril download and sync progress bars.
  - **Why**: Choppy progress bar updates (jumping in 5% increments) feel less polished than smooth continuous movement.

---

## 17. Accessibility

> Key files: all components, `fe/src/index.css`

- [x] **`focus-visible` styles on all interactive elements**
  - **How**: Audit all clickable elements (favorite buttons, bid buttons, card actions, tab buttons) and ensure each has a `:focus-visible` style (not just `:focus`). Use `outline: 2px solid var(--accent); outline-offset: 2px` as the standard. Remove `:focus` styles that show on mouse click.
  - **Why**: `:focus` shows outlines on mouse click (distracting), while `:focus-visible` only shows for keyboard users (correct behavior).

- [x] **Comprehensive aria-label audit for icon-only buttons**
  - **How**: Search all components for `<button>` elements that contain only SVG/icon children (no text). Verify each has `aria-label` or `aria-labelledby`. Priority targets: close buttons (X), zoom controls (+/-), refresh icons, copy icons, settings gear, navigation arrows.
  - **Why**: Screen readers announce these as just "button" with no description of what they do.

- [x] **Disable filter controls during initial data load**
  - **How**: In MarketplaceTab, MySalesTab, LibraryTab — while `isLoading` is true, set `disabled` and `aria-disabled="true"` on search input, sort dropdown, and filter controls. Add `opacity-50 pointer-events-none` for visual indication.
  - **Why**: Interacting with filters before data loads can dispatch actions on empty arrays, causing flash-of-empty-state before real data appears.

- [x] **Announce dynamic content changes to screen readers**
  - **How**: Ensure the toast container, bid notification badge, loading/error states, and pagination info all live within `aria-live` regions. Add `role="status"` to the pagination summary ("Showing 1-20 of 150"). Add `role="alert"` to error messages.
  - **Why**: Screen reader users miss dynamically updated content (new toasts, bid count changes, loading completions) unless announced via ARIA live regions.

- [s] **Automated a11y testing with vitest-axe**
  - **How**: Install `vitest-axe` (or `jest-axe`). Add a11y tests for critical components: `expect(await axe(container)).toHaveNoViolations()` for CreateListingModal, PlaceBidModal, WalletSetup, WalletUnlock, Dashboard. Run as part of `npm test`.
  - **Why**: Manual accessibility audits miss issues. Automated axe scans catch 30-50% of WCAG violations automatically on every test run.

---

## 18. Error Handling & User Feedback

> Key files: `fe/src/components/Toast.tsx`, `fe/src/services/errorMessages.ts`, `fe/src/services/api.ts`

- [x] **DecryptModal save failure shows warning toast**
  - **How**: In `DecryptModal.tsx` (lines 83-105), when `save_content` invoke fails, the error is only logged as a warning. Add `toast.warning('Decryption succeeded but file could not be saved to library. Try again from My Purchases.')` so the user knows the file isn't persisted.
  - **Why**: Users see "Decryption complete!" but the file isn't in their library. They think it worked and can't find the content later.

- [x] **Silent API failure logging throughout**
  - **How**: Search all `.catch(() => {})` and `.catch(() => undefined)` patterns in the frontend. Replace with `.catch(err => console.warn('Operation failed:', err))` at minimum. Affected files: MarketplaceTab, MySalesTab, MyPurchasesTab, image cache fetches.
  - **Why**: Empty catch blocks make debugging impossible. Even console warnings provide diagnostic value when users share logs.

- [x] **Clipboard access failure feedback**
  - **How**: In all clipboard operations (CreateListingModal paste, address copy, txHash copy), add a catch handler that shows `toast.warning('Could not access clipboard')` instead of failing silently. Check `navigator.clipboard` availability first on WebKitGTK.
  - **Why**: WebKitGTK has inconsistent clipboard API support. Users clicking "Copy" see the success animation but nothing is actually copied.

- [x] **ModalContext error boundary and stack corruption guard**
  - **How**: In `ModalContext.tsx` (lines 36-75), add a guard in `closeModal()`: if the modal being closed isn't in the stack, log a warning instead of corrupting the stack. Add `if (!stack.includes(modalId)) { console.warn('Attempted to close unregistered modal:', modalId); return; }`.
  - **Why**: Double-closing a modal (e.g., from both Escape and onClose callback) can corrupt the stack, causing z-index issues for subsequent modals.

---

## 19. Performance

> Key files: `fe/src/components/`, `fe/src/services/`

- [x] **React.memo() on card components**
  - **How**: Wrap `EncryptionCard`, `SalesListingCard`, `MyPurchaseBidCard`, and `LibraryCard` with `React.memo()`. These are rendered in lists of 20-100+ items and receive stable props (datum objects, callbacks). Use a custom comparison for props that contain objects.
  - **Why**: Without memo, every parent re-render (filter change, new data) re-renders all cards. With 100+ cards, this causes visible frame drops.

- [x] **Extract shared utility functions from components**
  - **How**: In `DecryptModal.tsx` (line 148-154), `formatAda()` is defined inside the component and recreated on every render. Move to `fe/src/utils/formatAda.ts` and import. Similarly, extract `formatBytes` (already in utils — verify it's used everywhere instead of inline formatting).
  - **Why**: Functions defined inside components are recreated on every render, defeating memoization of child components that receive them as props.

- [x] **Backend cache periodic cleanup**
  - **How**: In `be/src/services/cache.ts`, add a `cleanupExpired()` method that removes entries past their TTL. Call via `setInterval(cleanupExpired, 60_000)` in the app startup. Currently expired entries persist in memory until their key is accessed again.
  - **Why**: Long-running backend instances accumulate stale cache entries. While they're overwritten on next fetch, the memory is held unnecessarily.

- [x] **Lazy load heavy modal content**
  - **How**: Use React `lazy()` + `Suspense` for SnarkProvingModal and SnarkDownloadModal (which import heavy SNARK-related code). These modals are rarely opened but their imports increase initial bundle size. Follow the pattern already used in LibraryContentModal for media viewers.
  - **Why**: Reducing initial bundle size improves app startup time, especially on first launch when WebKitGTK is compiling JS.

---

## 20. Backend API

> Key files: `be/src/routes/`, `be/src/services/`, `be/src/middleware/`

- [x] **Extract shared status enum validator middleware**
  - **How**: In `be/src/middleware/validate.ts`, add `validateStatusParam(validStatuses: string[])` that returns 400 `INVALID_PARAM` for unknown statuses. Replace inline validation in `encryptions.ts` (line 164-171) and `bids.ts` (line 169-176) with the shared middleware.
  - **Why**: Status validation is duplicated across routes with hardcoded strings. A shared validator prevents drift when new statuses are added.

- [x] **Exact PKH matching instead of substring includes**
  - **How**: In `be/src/routes/encryptions.ts` (line 136) and `be/src/routes/bids.ts` (line 101), change `.includes(pkh.toLowerCase())` to `=== pkh.toLowerCase()` for user lookups. The current substring match means PKH "abc" would match "abcdef...".
  - **Why**: Substring matching is a correctness bug. A short PKH prefix could return other users' data. This is both a privacy and data integrity issue.

- [x] **Distinguish "not confirmed" vs "unable to check" in confirmations endpoint**
  - **How**: In `be/src/routes/chain.ts` (lines 40-42), the `/confirmations/:txHash` endpoint returns `{ confirmations: 0 }` for both "tx exists but unconfirmed" and "Koios is unreachable". Return `{ confirmations: 0, status: 'pending' }` for unconfirmed and `{ error: { code: 'TIP_UNAVAILABLE', message: '...' } }` with 503 when Koios is down.
  - **Why**: Frontend treats all zeros as "pending" and keeps polling. If Koios is down, it polls forever instead of showing "confirmation check unavailable."

- [x] **Failed datum parsing includes error context**
  - **How**: In `be/src/services/encryptions.ts` (lines 140-142), log the actual error with context: `logger.warn('Datum parse failed', { txHash, txIndex, error: String(err), datumPreview: JSON.stringify(utxo.inline_datum).slice(0, 200) })` instead of just `txHash` and `txIndex`.
  - **Why**: When a malformed datum is skipped, developers have no way to know what went wrong without the error details and a sample of the bad datum.

- [x] **Kupo error wrapping with operation context**
  - **How**: In `be/src/services/kupo.ts` (lines 119-125), wrap circuit breaker errors with the operation name: `catch (err) { throw new Error(\`Kupo ${path}: ${err.message}\`); }`. This helps distinguish "Kupo /matches failed" from "Kupo /datums failed" in logs.
  - **Why**: All Kupo failures currently look the same in logs. Adding the path makes it clear which operation triggered the circuit breaker.

- [x] **Levels endpoint pagination**
  - **How**: In `be/src/routes/encryptions.ts`, the `GET /encryptions/:tokenName/levels` endpoint returns all levels without pagination. Apply the existing `paginate()` middleware with a generous default (limit=100). Return `{ data, pagination }` wrapper.
  - **Why**: A token with many re-encryption hops could return an unbounded array, causing slow responses and high memory usage.

- [x] **Health check includes circuit breaker state**
  - **How**: In `be/src/services/health.ts`, add the circuit breaker's current state (CLOSED/OPEN/HALF_OPEN) and failure count to the health response for both Kupo and Koios: `{ kupo: { reachable, latencyMs, circuitBreaker: 'CLOSED' } }`.
  - **Why**: Operators need to know if the circuit breaker is open (degraded mode) vs just slow (healthy but latent). Current health check doesn't expose this.

- [x] **Chain tip response includes slot number**
  - **How**: In `be/src/routes/chain.ts`, the `GET /tip` endpoint returns `block_no`, `epoch_no`, `block_time` but not `abs_slot`. Add `slot_no` from the Koios `/tip` response (which returns it). Frontend needs this for sync calculation.
  - **Why**: Frontend calculates sync percentage using slot numbers. Without the tip slot in the API response, it makes a separate Tauri invoke for the same data.

- [x] **Bid cache refresh query parameter**
  - **How**: In `be/src/routes/bids.ts`, add `?refresh=true` query param support (already exists for encryptions, missing for bids). Set `skipCache = req.query.refresh === 'true'` to bust the cache on manual refresh.
  - **Why**: After a bid is accepted, the cache still shows the old state until TTL expires. Frontend refresh button should force a fresh fetch.

---

## 21. Rust Core & Security

> Key files: `src-tauri/src/crypto/`, `src-tauri/src/commands/`, `src-tauri/src/process/`, `src-tauri/src/config.rs`

- [x] **Argon2id memory allocation fallback for low-memory systems**
  - **How**: In `wallet.rs` (lines 26-34), `m=65536` (64 MiB) Argon2id can fail on low-memory systems. Wrap the KDF call in a retry: if the first attempt fails with memory error, try again with `m=32768` (32 MiB, still secure). Log a warning about reduced security params.
  - **Why**: Users on older hardware or VMs with limited RAM get a cryptic error on wallet creation instead of a graceful fallback.

- [x] **Secrets KDF v2 strength parity with wallet KDF**
  - **How**: In `secrets.rs` (lines 52-59), `derive_secrets_key_v2()` uses `m=32768, t=2, p=1` which is weaker than wallet KDF (`m=65536, t=3, p=4`). Increase to `m=65536, t=3, p=2` (parallelism 2 to keep it faster than wallet which uses 4). Profile to ensure < 500ms on typical hardware.
  - **Why**: Secrets (seller keys, bid keys, Iagon API key) are equally sensitive as the wallet. Weaker KDF means an attacker with the secrets files has an easier brute-force target.

- [x] **SNARK setup directory existence validation before proving**
  - **How**: In `snark.rs` (lines 66-75), before spawning the SNARK sidecar, verify the setup directory exists and contains `pk.bin` and `ccs.bin`: `if !setup_dir.join("pk.bin").exists() { return Err("SNARK setup files not found. Run setup first.".into()); }`.
  - **Why**: Running the prover without setup files produces a cryptic sidecar error instead of a user-friendly message.

- [x] **Iagon typed error codes instead of string errors**
  - **How**: In `iagon.rs` (lines 56-71), replace the generic string errors from `map_iagon_error()` with structured JSON: `{ "code": "AUTH_FAILED" | "TIMEOUT" | "UPLOAD_FAILED" | "SERVER_ERROR", "message": "..." }`. Frontend can then parse the code for specific handling (e.g., re-auth on AUTH_FAILED).
  - **Why**: Frontend can't distinguish a timeout from an auth failure from a server error. All Iagon errors look the same to the user.

- [x] **Config load failure warning log**
  - **How**: In `config.rs` (lines 157-174), `AppConfig::load()` silently falls back to `Default::default()` when both config paths fail. Add `eprintln!("Warning: config.json not found at either path, using defaults")` and emit a Tauri event `config-warning` so the frontend can show a banner.
  - **Why**: A missing or corrupted config file causes the app to run with default (likely wrong) contract addresses. Users see confusing errors instead of "config file missing."

- [x] **Atomic secret file creation with pre-set permissions**
  - **How**: In `secrets.rs` (line 31-32), secret files are written then have permissions set afterwards. Use `std::fs::OpenOptions::new().create(true).write(true).mode(0o600).open(path)?` to create the file with restricted permissions atomically, before writing any data.
  - **Why**: If the process crashes between write and chmod, the secret file could briefly be world-readable. Atomic permission setting eliminates this race.

- [x] **Seller secret input hex validation**
  - **How**: In `secrets.rs`, `store_seller_secrets()` accepts `a` and `r` as strings without validating format. Add: `if a.len() > 128 || !a.chars().all(|c| c.is_ascii_hexdigit()) { return Err("Invalid hex for seller secret 'a'".into()); }`. Same for `r`.
  - **Why**: Malformed secrets stored to disk will cause cryptic failures later during SNARK proving or re-encryption. Validation at storage time catches the issue early.

- [x] **Wallet operation audit logging**
  - **How**: In `commands/wallet.rs`, add audit log entries for: `WALLET_CREATED`, `WALLET_UNLOCKED`, `WALLET_LOCKED`, `WALLET_DELETED`, `MNEMONIC_REVEALED`. Use the existing `audit.rs` logging infrastructure. Include timestamps but never secret material.
  - **Why**: Secrets operations are audited but wallet operations (the most security-sensitive) are not. An attacker who unlocks the wallet leaves no trace.

- [x] **Skip empty env vars in config generation**
  - **How**: In `config.rs` (lines 62-125), `to_env_vars()` adds all config values as env vars including empty strings. Add `if !value.is_empty()` guard before each push. Express currently handles empty values with `||` fallbacks, but passing empty strings can cause subtle bugs.
  - **Why**: Empty env vars override Express defaults (which expect the var to be unset, not empty). `PORT="" || 3001` works, but `process.env.KUPO_URL || 'http://...'` would fail with empty string since `""` is falsy.

- [x] **Periodic temp file cleanup during long-running sessions**
  - **How**: In `lib.rs`, add a `tokio::spawn` task that runs every hour and scans the app temp directory for files older than 1 hour. Securely delete (overwrite + remove) any orphaned SNARK input files. Currently cleanup only happens on startup.
  - **Why**: If a SNARK proving attempt fails mid-way, the temp file with secret material persists until the next app restart — which could be days.

---

## 22. Testing

> Key files: `fe/src/test/`, `be/src/services/__tests__/`, vitest configs

- [ ] **Page component integration tests**
  - **How**: Create `fe/src/pages/__tests__/Dashboard.test.tsx`, `NodeSync.test.tsx`, `Settings.test.tsx`, `WalletSetup.test.tsx`, `WalletUnlock.test.tsx`. Mock all contexts (WalletContext, NodeContext, WasmContext) and Tauri invokes. Test: route guards, state transitions, error states, keyboard navigation. Use `@testing-library/react` + `renderWithProviders` helper.
  - **Why**: Page components are the top-level integration points. Currently only helper functions are tested, not the pages themselves.

- [ ] **Tab component rendering tests**
  - **How**: Create tests for `MarketplaceTab`, `MySalesTab`, `MyPurchasesTab`, `HistoryTab`, `LibraryTab`. Test: empty states, loading states, filter interactions, card rendering with mock data, error states. Mock API calls and Tauri invokes.
  - **Why**: Tab components contain the core business logic (filtering, sorting, data display) with zero test coverage.

- [x] **Untested component coverage: ErrorBoundary, SessionWarningBanner, ShutdownOverlay**
  - **How**: Add `fe/src/components/__tests__/ErrorBoundary.test.tsx` — test that render errors are caught and recovery UI shown. `SessionWarningBanner.test.tsx` — test countdown display and dismiss. `ShutdownOverlay.test.tsx` — test Tauri event listener and overlay rendering.
  - **Why**: These are safety-critical components (error recovery, session management, shutdown) that have no tests.

- [x] **Backend bids and encryptions service tests**
  - **How**: Create `be/src/services/__tests__/bids.test.ts` and `be/src/services/__tests__/encryptions.test.ts`. Mock Kupo HTTP responses with various datum shapes (valid, malformed, missing fields). Test: datum parsing, CIP-20 metadata extraction, status filtering, pagination.
  - **Why**: The core business logic for transforming raw blockchain data into display models is untested. A CBOR change could silently break bid/encryption parsing.

- [ ] **Stricter Tauri mock defaults**
  - **How**: In `fe/src/test/__mocks__/tauri.ts`, change the default `invoke` mock from resolving to `undefined` to throwing: `vi.fn().mockRejectedValue(new Error('invoke() not mocked for this command'))`. Tests must explicitly mock each command they use.
  - **Why**: Tests that forget to mock a Tauri command silently succeed with `undefined`, hiding real bugs. Strict mocks force explicit setup.

- [ ] **Verify invoke call arguments in tests**
  - **How**: Add assertion patterns to existing tests: `expect(invoke).toHaveBeenCalledWith('store_seller_secrets', expect.objectContaining({ tokenName: 'abc', a: '...', r: '...' }))`. Priority: secrets storage, wallet operations, SNARK commands.
  - **Why**: Many tests mock `invoke` return values but never verify the arguments passed. A renamed parameter would silently pass tests.

- [ ] **Error path test coverage**
  - **How**: For each test file, add at least one error-path test: `it('handles API failure gracefully', ...)`. Priority: transactionBuilder (invalid inputs, network errors), apiCache (fetch failure), walletManagement (insufficient UTxOs).
  - **Why**: Most tests only cover happy paths. Error paths are where users actually encounter bugs.

- [ ] **Snapshot test staleness CI guard**
  - **How**: Add a CI step: `npx vitest run 2>&1 | grep -q "Snapshots.*written" && echo "ERROR: Stale snapshots detected" && exit 1`. This fails CI if snapshots were regenerated (likely accidental), forcing explicit `--update-snapshots`.
  - **Why**: Snapshots can become stale without anyone noticing. Accidental regeneration (e.g., `vitest -u`) silently updates wrong snapshots.

---

## 23. Developer Experience & Tooling

> Key files: build scripts, package.json, configs

- [s] **Parallel test execution in test.sh**
  - **How**: Change `test.sh` from sequential `npm --prefix fe test && npm --prefix be test` to parallel: `npm --prefix fe test & npm --prefix be test & wait`. Frontend (~20s) and backend (~15s) tests have no dependencies. Reduces total time from ~35s to ~20s.
  - **Why**: Sequential test execution wastes time when both suites are independent.

- [s] **Conditional npm install in build scripts**
  - **How**: In `build.sh` and `build-debug.sh`, skip `npm install` if `node_modules/` is newer than `package-lock.json`. Add check: `if [ package-lock.json -nt node_modules/.package-lock.json ]; then npm ci; fi`. Same for fe/ and be/ directories.
  - **Why**: Unconditional `npm install` on every build wastes 10-30 seconds when dependencies haven't changed.

- [s] **Backend watch:test script for TDD**
  - **How**: Add `"watch:test": "vitest --watch"` to `be/package.json` scripts. Frontend already has this via default vitest behavior. This enables fast feedback during test-driven development.
  - **Why**: Backend developers must manually run `npm test` after each change. A watch mode gives instant feedback.

- [s] **Root type-check script**
  - **How**: Add `"type-check": "npm --prefix fe run type-check && npm --prefix be run type-check"` to root `package.json`. Add `"type-check": "tsc --noEmit"` to both fe and be package.json. This gives developers a quick type verification command.
  - **Why**: Type checking is only available via `lint.sh` (which also runs ESLint and Cargo checks). A standalone type-check is faster for quick iteration.

- [s] **Conditional Rust linting in lint.sh**
  - **How**: In `lint.sh`, only run `cargo fmt --check` and `cargo clippy` if Rust files changed since last commit: `if git diff --name-only HEAD | grep -q "^app/gui/src-tauri/"; then cargo fmt --check && cargo clippy; fi`. Falls back to running always if not in a git context.
  - **Why**: Cargo fmt + clippy takes 30-60s even with no changes. Skipping when only TS files changed saves significant time.

- [x] **More specific WebKit process cleanup**
  - **How**: In `run.sh`, the `pkill -u "$USER" -f 'WebKitNetworkProcess'` could kill unrelated WebKit processes. Change to: `lsof -ti:5173 2>/dev/null | xargs -r kill` (kill only processes holding the dev port), or pattern-match the Tauri app: `pgrep -f 'webkit.*veiled' | xargs -r kill`.
  - **Why**: Users running other WebKit-based apps (GNOME Web, other Tauri apps) get those killed when starting Veiled.

- [x] **Wait for initial TSC compilation before starting Tauri**
  - **How**: In `run.sh`, after starting `tsc --watch` in background, add a wait: `until [ -f be/dist/index.js ]; do sleep 0.5; done` to ensure the backend is compiled before Tauri tries to spawn Express. Currently, race condition on fresh checkout.
  - **Why**: If tsc watch hasn't finished its first compilation when Tauri starts, Express fails to launch because `dist/index.js` doesn't exist.

- [x] **Node engine version constraint in package.json**
  - **How**: Add `"engines": { "node": ">=20.0.0", "npm": ">=10.0.0" }` to fe/package.json and be/package.json. This causes `npm install` to warn if the Node version is incompatible.
  - **Why**: Code uses Node 20+ features (e.g., `fetch` global). Developers on Node 18 get cryptic runtime errors instead of a clear version mismatch warning.

- [x] **Remove dead tsconfig path alias**
  - **How**: In `fe/tsconfig.app.json` (lines 24-26), the `@/*` path alias is configured but never used anywhere in the codebase (all imports are relative `../`). Remove it to avoid confusion.
  - **Why**: Dead configuration misleads developers into thinking path aliases work, then their imports fail at runtime because Vite isn't configured to resolve them.

---

## 24. Documentation & CI/CD

> Key files: `.github/workflows/ci.yml`, `CHANGELOG.md`

- [s] **CI coverage threshold enforcement**
  - **How**: In `.github/workflows/ci.yml`, add `--coverage.thresholdAutoUpdate=false` flag to vitest commands (or check exit code). Currently coverage is generated but thresholds aren't enforced — the job passes even if coverage drops below configured minimums.
  - **Why**: Coverage thresholds (55% FE, 60% BE) exist in config but aren't gates. Coverage can regress silently.

- [x] **CI version consistency check**
  - **How**: Add a CI step that verifies all version fields match: `V1=$(jq -r .version app/gui/package.json); V2=$(jq -r .version app/gui/fe/package.json); V3=$(jq -r .version app/gui/be/package.json); if [ "$V1" != "$V2" ] || [ "$V1" != "$V3" ]; then echo "Version mismatch!" && exit 1; fi`. Include `tauri.conf.json` and `Cargo.toml` versions too.
  - **Why**: Five files must have matching version numbers. It's easy to update some but forget others during a version bump.

- [s] **Upload coverage reports to tracking service**
  - **How**: Add `- uses: codecov/codecov-action@v4` step after test jobs in CI. This uploads coverage to codecov.io, enabling trend tracking, PR annotations, and coverage delta reporting.
  - **Why**: Coverage reports are generated but discarded. Without history tracking, it's impossible to know if a PR improves or degrades coverage.

- [s] **PR template with testing checklist**
  - **How**: Create `.github/PULL_REQUEST_TEMPLATE.md` with sections: Summary (1-3 bullets), Testing (checkbox list: ran tests, tested on Linux, checked linter), Breaking Changes (yes/no), Version Bump (yes/no with checklist of 5 files).
  - **Why**: PRs lack consistent format. Reviewers must ask the same questions every time. A template standardizes expectations.

- [x] **CI backend build step before tests**
  - **How**: In `.github/workflows/ci.yml`, add `npm --prefix be run build` step after `npm run install:all` and before running tests. This catches backend TypeScript compilation errors that unit tests alone might miss.
  - **Why**: Backend `tsc` compilation errors don't fail the unit test job because tests use their own tsconfig. A separate build step catches type errors.

- [s] **CI npm cache for all lockfiles**
  - **How**: Update the `cache-dependency-path` in CI to include all lockfiles: `cache-dependency-path: | app/gui/package-lock.json app/gui/fe/package-lock.json app/gui/be/package-lock.json`. This ensures cache hits when any sub-project's deps change.
  - **Why**: Current CI only caches based on root lockfile. Changes to fe/ or be/ deps bust the cache unnecessarily.

---

## Priority Guide

### Must-Have (blocks production readiness)
- Exact PKH matching instead of substring includes (#20) — correctness/privacy bug
- Distinguish "not confirmed" vs "unable to check" in confirmations (#20) — UX correctness
- Delete wallet focus trap and modal stack (#2) — accessibility on destructive action
- SNARK setup directory validation before proving (#21) — prevents cryptic errors
- Atomic secret file permissions (#21) — security race condition
- Seller secret hex validation (#21) — data integrity

### Should-Have (significant UX/reliability improvement)
- Real-time field validation in CreateListingModal (#10) — reduces form friction
- Balance unavailable indicator (#4) — prevents user panic
- DecryptModal save failure toast (#18) — prevents silent data loss
- Group transactions by date (#8) — major UX improvement for History tab
- Tab component rendering tests (#22) — covers core untested business logic
- Iagon typed error codes (#21) — enables specific error handling
- Backend bids/encryptions service tests (#22) — covers untested critical paths
- CI coverage threshold enforcement (#24) — prevents coverage regression

### Nice-to-Have (polish and delight)
- WCAG AA color contrast fixes (#15) — accessibility polish
- Bid count badge pulse animation (#16) — engagement micro-interaction
- Smooth tab transitions (#4) — visual polish
- Undo after library deletion (#9) — safety net
- Audio elapsed/remaining toggle (#12) — media player polish
- Video keyboard shortcuts (#12) — media player completeness
- Scrollbar styling for dark theme (#15) — visual coherence
- Settings export/import (#13) — power user feature

### Infrastructure (developer productivity)
- Parallel test execution (#23) — faster CI and local dev
- Conditional npm install in build scripts (#23) — faster builds
- CI version consistency check (#24) — prevents release mistakes
- Stricter Tauri mock defaults (#22) — catches test bugs
- Wait for TSC compilation in run.sh (#23) — fixes race condition
- Node engine constraints (#23) — catches version mismatches early
