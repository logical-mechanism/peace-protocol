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

> Key files: `fe/src/pages/WalletSetup.tsx`, `fe/src/components/MnemonicInput.tsx`

- [x] **Guided onboarding tour for new users**
  - **How**: Build a lightweight step-by-step overlay (tooltip + highlight box) that walks through: wallet creation → node sync → marketplace browse → first bid. Use a simple state machine stored in localStorage (`onboarding_step`). No library needed — just a `<div>` with absolute positioning and a backdrop cutout.
  - **Why**: First-time users landing on a blank wallet setup screen have zero context about what the app does. A 4-step tour reduces drop-off and builds confidence.

- [x] **Step progress indicator on wallet creation**
  - **How**: Add a horizontal stepper bar (circles connected by lines) above the form in WalletSetup. Steps: "Create Password" → "Backup Mnemonic" → "Verify" → "Done". Highlight current step with accent color. Pure CSS + state tracking on the existing `step` state.
  - **Why**: Users currently see forms appear and disappear with no sense of how many steps remain. A progress indicator sets expectations.

- [x] **Password requirements checklist during wallet creation**
  - **How**: Below the password field, render a live checklist: length ≥ 12, uppercase, lowercase, number, special char. Each requirement shows a green check or gray dash as user types. Reuse logic from `usePasswordStrength` hook.
  - **Why**: The PasswordStrengthIndicator shows a bar but doesn't explain what's missing. Users guess at requirements until they pass.

- [x] **Bulk paste for mnemonic import**
  - **How**: Add a "Paste all 24 words" button above the MnemonicInput grid. On click, read clipboard, split by whitespace, and populate all 24 fields. The existing `onChange` per-word handler stays for manual entry.
  - **Why**: Typing 24 words one-by-one is tedious. Most users have their mnemonic in a password manager and want to paste once.

- [x] **Disk space check before first sync**
  - **How**: Before starting Mithril bootstrap in NodeSync, call `get_disk_usage` and check available space (needs a new Rust command `get_available_disk_space` using `fs2::available_space`). Warn if < 10 GB free. Show estimated space needed (~5 GB for preprod, ~100 GB for mainnet).
  - **Why**: Users who start a multi-hour sync only to run out of disk space have a terrible experience. A 2-second check prevents it.

---

## 2. Wallet & Authentication

> Key files: `fe/src/pages/WalletUnlock.tsx`, `src-tauri/src/crypto/wallet.rs`, `src-tauri/src/commands/wallet.rs`

- [x] **BIP39 checksum validation on mnemonic import**
  - **How**: In `wallet.rs`, after splitting the mnemonic into words, validate the BIP39 checksum (last word encodes checksum bits). The `bip39` Rust crate handles this. Reject invalid mnemonics with a clear error.
  - **Why**: Currently any 24 words are accepted. A typo in the mnemonic creates a valid-looking but wrong wallet with no warning.

- [x] **Wallet file permissions hardening (Linux/macOS)**
  - **How**: After writing `wallet.json`, call `std::os::unix::fs::PermissionsExt::set_mode(0o600)` to restrict read/write to the file owner only. Same for the `secrets/` directory.
  - **Why**: Default file permissions (644) let other users on the system read the encrypted wallet file. While AES-256-GCM is strong, defense in depth matters.

- [x] **Minimum password length enforcement**
  - **How**: In `create_wallet` and the frontend WalletSetup, reject passwords shorter than 12 characters. Show error inline before submission.
  - **Why**: Empty or short passwords bypass the entire Argon2id protection. A minimum length is the simplest security improvement.

- [x] **Session timeout warning before auto-lock**
  - **How**: The `SessionWarningBanner` component exists but could show remaining time (countdown). 60 seconds before auto-lock, show a subtle banner: "Session will lock in 60s — move mouse to stay active." Activity resets the timer.
  - **Why**: Users lose work mid-transaction when the auto-lock fires without warning. A countdown lets them extend.

---

## 3. Node Sync & Process Management

> Key files: `fe/src/pages/NodeSync.tsx`, `src-tauri/src/process/`

- [x] **Estimated time remaining for Mithril download**
  - **How**: NodeSync already shows download speed. Calculate ETA from `(totalBytes - downloadedBytes) / currentSpeedBytesPerSec`. Display as "~12 min remaining" next to the progress bar. Smooth the estimate with a rolling average over the last 5 samples.
  - **Why**: A 2 GB download with no ETA feels interminable. Users need to know if they can grab coffee or if it's 30 seconds away.

- [x] **Service health tooltips on NodeSync status cards**
  - **How**: Add info icons (?) next to each service name (Cardano Node, Ogmios, Kupo) with hover tooltips explaining what each does: "Cardano Node: Validates blocks from the Cardano blockchain", "Ogmios: Translates node data into WebSocket protocol", "Kupo: Indexes UTxOs for fast wallet queries."
  - **Why**: Non-technical users see cryptic service names and don't know if a failure is serious or ignorable.

- [x] **Process health checks for Ogmios and Kupo**
  - **How**: Ogmios has a `GET /health` endpoint; Kupo has `GET /health`. In `src-tauri/src/process/ogmios.rs` and `kupo.rs`, add health check functions similar to `express.rs`. Poll every 10s after process starts. Emit health status as Tauri events.
  - **Why**: Currently only Express has a health check. If Ogmios or Kupo crash silently, the app shows confusing errors instead of "Ogmios is down, restarting..."

- [x] **Restart-with-jitter for process backoff**
  - **How**: In `manager.rs`, add random jitter (±20%) to the exponential backoff delay. Use `rand::thread_rng().gen_range(0.8..1.2)` as a multiplier on the delay. This prevents all processes from retrying simultaneously.
  - **Why**: If the system is under load, synchronized restarts (all at exactly 2s, then 4s, then 8s) create thundering herd pressure that makes recovery harder.

- [x] **Process log search and filtering**
  - **How**: In the Settings page process logs viewer, add a text input that filters log lines by substring match. Use `lines.filter(line => line.toLowerCase().includes(query))`. Add log level coloring (ERROR=red, WARN=yellow).
  - **Why**: Scrolling through 500 raw log lines to find an error is painful. A search box instantly surfaces relevant entries.

- [x] **Graceful shutdown with timeout enforcement**
  - **How**: In `lib.rs`, after sending SIGTERM to all processes, start a 15-second countdown. If any process hasn't exited by then, SIGKILL it. Show a "Shutting down..." overlay in the frontend during this period so users know the app is closing, not frozen.
  - **Why**: The current shutdown can hang if a process ignores SIGTERM. Users force-quit the app, leaving orphan processes.

---

## 4. Dashboard & Navigation

> Key files: `fe/src/pages/Dashboard.tsx`, `fe/src/App.tsx`

- [x] **Proper tab accessibility with ARIA roles**
  - **How**: Wrap the tab bar in `<nav role="tablist">`. Each tab button gets `role="tab"`, `aria-selected`, `aria-controls`. Tab panels get `role="tabpanel"`, `aria-labelledby`. Support arrow keys for tab navigation (Left/Right to switch tabs).
  - **Why**: Screen readers can't identify the current tab or navigate between them. This is a WCAG 2.1 AA requirement for tab patterns.

- [x] **Persist active tab across page navigations**
  - **How**: Store the active tab index in localStorage (keyed by wallet PKH). When Dashboard mounts, restore the last active tab. Already partially done for filters via `useTabFilterState` — extend to the tab index itself.
  - **Why**: Navigating to Settings and back resets the user to the Marketplace tab, losing their place.

- [x] **Global refresh button with last-updated timestamp**
  - **How**: Add a small refresh icon button in the Dashboard header that calls `fetchEncryptions()` / `fetchBids()` on the active tab. Show "Last updated: 30s ago" next to it, updated every second via `setInterval`. Disable during loading.
  - **Why**: Users have no way to manually refresh data. They must switch tabs or navigate away and back.

- [x] **Badge count on tabs for pending items**
  - **How**: On the My Sales tab, show a badge with the count of listings that have new unviewed bids (using `useBidNotifications`). On My Purchases, show count of pending bids. Use the existing `Badge` component. Animate the badge on count change.
  - **Why**: Users shouldn't have to click into each tab to discover if anything needs their attention.

- [x] **Quick-stat cards above tabs**
  - **How**: Add a row of 3-4 small stat cards between the balance display and tab bar: "Active Listings: 5", "Pending Bids: 3", "Library Items: 12", "Total Earned: 500 ADA". Fetch counts from the same data the tabs use.
  - **Why**: An at-a-glance summary lets users understand their marketplace position without clicking into each tab.

- [x] **Keyboard shortcut for tab switching**
  - **How**: Add a global `useEffect` keydown listener on Dashboard. `Ctrl+1` through `Ctrl+5` switches to tabs 1-5. `Ctrl+R` triggers refresh. Show shortcuts in a tooltip on the tab bar.
  - **Why**: Power users want to navigate without the mouse. Tab switching is the most common action on the dashboard.

---

## 5. Marketplace Tab

> Key files: `fe/src/components/MarketplaceTab.tsx`, `fe/src/components/EncryptionCard.tsx`

- [x] **Persist filters and view mode across sessions**
  - **How**: In `useTabFilterState`, serialize the filter state to localStorage on every change (debounced). On mount, hydrate from localStorage. Key by wallet PKH so different wallets have independent filters.
  - **Why**: Every page navigation or app restart resets all filters. Users who set price range + category + sort have to redo it every time.

- [x] **"Clear all filters" button**
  - **How**: Add a "Clear filters" link/button that appears when any filter is active (non-default). Dispatch a `RESET_FILTERS` action to the reducer. Show count of active filters: "3 filters active — Clear".
  - **Why**: Users with multiple active filters must reset each one individually. A single clear button speeds this up.

- [x] **Search result highlighting**
  - **How**: When `searchQuery` is non-empty, wrap matching substrings in card titles/descriptions with a `<mark>` tag styled with `background: var(--accent-muted)`. Use a simple `text.replace(new RegExp(query, 'gi'), '<mark>$&</mark>')` with `dangerouslySetInnerHTML` (sanitize first) or split + span approach.
  - **Why**: Users search for a term but can't see why each result matched. Highlighting shows the match context.

- [x] **Price range slider instead of text inputs**
  - **How**: Replace the min/max price text inputs with a dual-thumb range slider. Use two `<input type="range">` overlaid on the same track, or a lightweight lib like `rc-slider`. Show current values as labels above the thumbs.
  - **Why**: Text inputs for price filtering are clunky. A slider lets users visually define a range with immediate feedback.

- [x] **Infinite scroll or "Load more" pagination**
  - **How**: Instead of rendering all encryptions at once, show 20 items initially with a "Load more" button at the bottom. Use `IntersectionObserver` to auto-load the next batch when the user scrolls near the bottom. Track `currentPage` in the filter reducer.
  - **Why**: As the marketplace grows, rendering 100+ cards at once causes lag. Pagination keeps the DOM lean.

- [x] **Favorite listings**
  - **How**: The `favoritesStorage.ts` service and heart icon on EncryptionCard already exist. Add a "Favorites" filter toggle in the filter bar (already in the reducer as `showFavoritesOnly`). Ensure favorites persist across sessions per wallet PKH.
  - **Why**: Users browsing a large marketplace want to bookmark interesting listings and revisit them later.

- [x] **Sort by "most bids" and "newest first"**
  - **How**: Add `sortBy: 'most-bids'` and `sortBy: 'newest'` to the sort options in the filter reducer. Sort by `bidCount` descending for most-bids. Sort by `createdAt` descending for newest. The bid count is already computed from `allBids`.
  - **Why**: Popular listings (most bids) signal quality. Newest listings let users discover fresh content.

---

## 6. My Sales Tab

> Key file: `fe/src/components/MySalesTab.tsx`, `fe/src/components/SalesListingCard.tsx`

- [x] **Earnings summary at the top**
  - **How**: Calculate total earned ADA from accepted bids (sum of bid amounts for completed sales). Show as a banner: "Total Earned: 1,250 ADA from 8 sales". Pull data from transaction history or on-chain data.
  - **Why**: Sellers want to see their total earnings at a glance without mentally adding up individual sales.

- [ ] **Bulk cancel listings**
  - **How**: Add a "Select" mode toggle that shows checkboxes on each SalesListingCard. When items are selected, show a floating action bar: "3 selected — Cancel All". Each cancel calls `removeListing()` sequentially (batch tx not possible on Cardano).
  - **Why**: Sellers with many expired or unwanted listings must cancel them one by one. Bulk select speeds this up.

- [x] **Listing analytics per item**
  - **How**: On each SalesListingCard, show "Views: N/A | Bids: 3 | Created: 2d ago". Bid count is already available. Created time comes from the on-chain datum. Views would need a backend counter (optional — can start with just bids + age).
  - **Why**: Sellers have no insight into how their listings are performing. Basic analytics help them adjust pricing.

---

## 7. My Purchases Tab

> Key file: `fe/src/components/MyPurchasesTab.tsx`, `fe/src/components/MyPurchaseBidCard.tsx`

- [x] **Bid status timeline**
  - **How**: On each MyPurchaseBidCard, add a small horizontal timeline: "Bid Placed → Accepted → Decrypting → Complete". Highlight the current stage. Gray out future stages. Derive state from bid status + accept-bid secrets existence + library item existence.
  - **Why**: The purchase flow has multiple steps. Users don't know where they are in the process or what to do next.

- [x] **"Retry decrypt" button for failed decryptions**
  - **How**: If a decryption fails (SNARK error, download failure), show a "Retry" button on the bid card instead of just an error message. The retry should re-enter the decrypt flow from the last successful step.
  - **Why**: Decryption failures are currently dead ends. Users must refresh and start over with no guidance.

- [x] **Filter purchases by status**
  - **How**: Add status filter chips: "All | Pending | Accepted | Complete". Map each bid's status from on-chain + local state. Reuse the filter reducer pattern from MarketplaceTab.
  - **Why**: Users with many purchases need to quickly find their pending or completed items without scrolling.

---

## 8. History Tab

> Key file: `fe/src/components/HistoryTab.tsx`, `fe/src/services/transactionHistory.ts`

- [ ] **Group transactions by date**
  - **How**: After sorting transactions by timestamp, group them into date buckets: "Today", "Yesterday", "This Week", "This Month", "Older". Render date headers between groups. Use `Intl.DateTimeFormat` for locale-aware dates.
  - **Why**: A flat list of 50+ transactions with timestamps is hard to scan. Date grouping creates natural visual landmarks.

- [x] **Search by transaction hash**
  - **How**: Add a search input that filters transactions by txHash substring match. Display the full hash in a monospace font on match. Support pasting a full hash for exact match.
  - **Why**: When investigating a specific transaction (from a block explorer link or support request), users need to find it by hash.

- [x] **Transaction amount display**
  - **How**: Store the ADA amount in `transactionHistory.ts` alongside `txHash`, `type`, and `timestamp`. Display it on each history row: "Placed bid: 50 ADA", "Listed for sale", "Cancelled listing: refund 2 ADA".
  - **Why**: Transaction history shows types and hashes but not amounts. Users can't see their financial history at a glance.

- [x] **CSV export with full details**
  - **How**: Expand the existing CSV export to include: date, type, txHash, amount, status, confirmation block, counterparty. Use proper CSV escaping for fields containing commas.
  - **Why**: Users may need transaction records for tax reporting or personal accounting. A detailed CSV export covers this.

---

## 9. Library Tab

> Key file: `fe/src/components/LibraryTab.tsx`, `fe/src/components/LibraryCard.tsx`, `fe/src/components/LibraryContentModal.tsx`

- [ ] **File size display on library cards**
  - **How**: Include the file size in the metadata JSON written by `contentStorage.ts`. Display it on LibraryCard: "PDF — 2.3 MB". Format with `formatBytes()` utility.
  - **Why**: Users have no sense of how much disk space their library uses or how large individual files are.

- [ ] **Sort by size, type, and date added**
  - **How**: Add sort options to LibraryTab: "Name", "Date Added", "Size", "Type". The metadata JSON already includes `savedAt` timestamp and `category`. Size needs to be added (see above).
  - **Why**: Users with large libraries need to organize and find items. Sorting by size helps identify large files for cleanup.

- [ ] **Bulk delete with confirmation**
  - **How**: Add select mode (checkbox on each LibraryCard). Show floating action bar: "5 selected — Delete All". Confirm via ConfirmModal with: "Delete 5 items? This removes files from your local library. You can re-download them by decrypting again."
  - **Why**: Cleaning up a library with many items one by one is tedious. Bulk delete with a safety confirmation speeds this up.

- [ ] **Previous/next navigation in LibraryContentModal**
  - **How**: Pass the full library item list and current index to LibraryContentModal. Add left/right arrow buttons (and keyboard arrows) to navigate to the adjacent item without closing the modal.
  - **Why**: Users reviewing multiple library items must close and reopen the modal for each one. Inline navigation is much faster.

- [ ] **Storage usage summary**
  - **How**: At the top of LibraryTab, show "Library: 23 items — 1.2 GB". Calculate by summing file sizes from metadata. Optionally break down by category.
  - **Why**: Users need to know their total library disk usage, especially on machines with limited storage.

---

## 10. Create Listing Modal

> Key file: `fe/src/components/CreateListingModal.tsx`

- [ ] **Drag-and-drop file upload**
  - **How**: Wrap the file input area in a `<div onDragOver onDrop>` handler. On drop, extract `e.dataTransfer.files[0]` and process like the existing file input `onChange`. Show a visual drop zone with dashed border and "Drop file here" text on drag over.
  - **Why**: Click-to-browse is the only upload method. Drag-and-drop is the expected interaction for file uploads in desktop apps.

- [ ] **File size warning before upload**
  - **How**: After file selection, check `file.size` against limits (e.g., 100 MB for Iagon free tier). Show warning: "This file is 150 MB. Large files take longer to upload and cost more to store." Allow proceeding but with informed consent. Max file size needs to be a parameter to be set.
  - **Why**: Users might accidentally select a multi-GB file. Showing size and implications prevents surprise upload failures.

- [ ] **Description character counter**
  - **How**: Below the description textarea, show live character count: "142 / 1024 characters". Use CIP-20 metadata's max length as the limit. Change color to warning when approaching limit (> 900), error when exceeded.
  - **Why**: Description length is limited by CIP-20 metadata constraints, but users don't know the limit until they hit an error after submitting.

- [ ] **Image link preview**
  - **How**: When the image URL field loses focus, attempt to load the image in a small preview thumbnail (64x64) below the input. Show a green check if loaded, red X if failed. Use `new Image()` to test loading.
  - **Why**: Users paste image URLs but can't verify they're valid until the listing appears in the marketplace. A preview catches bad URLs early.

- [ ] **Price input formatting**
  - **How**: Format the price input with a trailing "ADA" label and thousands separators. Use `Intl.NumberFormat` on blur to format the displayed value. Store the raw number in state for submission.
  - **Why**: "1500" is less readable than "1,500 ADA". Visual formatting reduces input errors and improves comprehension.

- [ ] **Auto-save listing draft on form changes**
  - **How**: Debounce form state changes (500ms) and persist to `listingDraftStorage`. On modal open, check for an unsaved draft and offer "Resume draft?" or "Start fresh". This extends the existing draft system to cover pre-upload state.
  - **Why**: Users who close the modal accidentally (or the app crashes mid-form) lose all their input. Auto-save prevents this.

---

## 11. Place Bid Modal

> Key file: `fe/src/components/PlaceBidModal.tsx`

- [ ] **Suggested minimum bid display**
  - **How**: Show the listing's `suggestedPrice` above the bid amount input: "Seller's suggested price: 50 ADA". If the user enters less, show a gentle hint: "Your bid is below the suggested price."
  - **Why**: Buyers have no pricing context. Showing the seller's expectation helps them bid competitively.

- [ ] **Bid count on the listing**
  - **How**: Display "X other bids on this listing" in the modal header. Fetch from the already-loaded `allBids` data filtered by encryption token.
  - **Why**: Knowing that 5 others have bid creates urgency. Knowing nobody has bid suggests the listing might be overpriced.

- [ ] **Wallet balance display with "max bid" button**
  - **How**: Show current wallet balance below the bid input: "Balance: 1,234 ADA". Add a "Max" button that fills the input with `balance - 5 ADA` (reserve for fees). Disable submit if bid exceeds balance.
  - **Why**: Users must mentally track their balance. Showing it inline prevents "insufficient funds" errors after a slow tx build.

---

## 12. Media Viewers (PDF, Image, Audio, Video)

> Key files: `fe/src/components/PdfViewer.tsx`, `fe/src/components/ImageViewer.tsx`, `fe/src/components/AudioPlayer.tsx`, `fe/src/components/VideoPlayer.tsx`

- [x] **PDF: Text search match counter**
  - **How**: In PdfViewer, show "Match 3 of 12" next to the search input when a search is active. Track `currentMatchIndex` and `totalMatches` in state. Update on next/prev navigation.
  - **Why**: Users searching a long PDF don't know how many results exist or where they are in the list.

- [ ] **PDF: Page thumbnails sidebar**
  - **How**: Render a narrow sidebar (width ~80px) on the left of the PDF viewer showing miniature page thumbnails. Click a thumbnail to jump to that page. Lazy-render thumbnails as they scroll into view.
  - **Why**: Navigating a 50+ page document by typing page numbers is slow. Thumbnails give a visual overview and quick navigation.

- [x] **Image: Zoom level indicator**
  - **How**: Overlay a small pill showing the current zoom percentage: "150%". Update on zoom in/out. Fade after 1.5s of inactivity.
  - **Why**: Users zooming in/out have no reference for the current magnification level.

- [x] **Image: Fit-to-screen and actual-size toggles**
  - **How**: Add two buttons in the image toolbar: "Fit" (scales image to container) and "1:1" (actual pixel size). "Fit" sets `object-fit: contain` on the image. "1:1" sets width/height to natural dimensions with scrollable overflow.
  - **Why**: Large images either overflow or get scaled down. Users need to switch between overview and detail views.

- [ ] **Audio: Playback speed control**
  - **How**: Add a speed button (e.g., "1x") next to the transport controls. Click to cycle through: 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x. Set `audioRef.current.playbackRate` on change.
  - **Why**: Standard media player feature. Useful for spoken word content, podcasts, or audio review.

- [x] **Video: Playback speed control**
  - **How**: Same approach as audio — add a speed selector near the video controls. Set `videoRef.current.playbackRate`. Show the current speed on the button.
  - **Why**: Standard feature for video players. Essential for educational content and long-form video review.

- [ ] **Video: Subtitle/CC support**
  - **How**: If a `.vtt` or `.srt` file is present alongside the video in the library, load it as a `<track>` element on the `<video>`. Add a CC toggle button in the toolbar.
  - **Why**: Accessibility feature. Some video content includes subtitles, and the player should display them.

- [ ] **Unified "Open with system player" button**
  - **How**: Add an "Open externally" button on all media viewer modals. Use Tauri's `shell.open()` to open the file with the OS default application. Requires writing a temp file or using the library path.
  - **Why**: The built-in viewers handle common formats, but edge cases (exotic codecs, DRM) work better in dedicated apps like VLC.

---

## 13. Settings Page

> Key file: `fe/src/pages/Settings.tsx`

- [ ] **Settings sidebar navigation**
  - **How**: Replace the current flat layout with a sidebar on the left listing sections: Node, Wallet, Storage, Iagon, Cache, Logs. Clicking a section scrolls to (or shows) that section. Active section highlighted.
  - **Why**: The Settings page is long and disorganized. A sidebar gives structure and lets users jump directly to what they need.

- [ ] **Disk usage visualization**
  - **How**: Replace the text-only disk usage display with a horizontal stacked bar chart showing chain data, SNARK data, wallet, library, and cache sizes. Color-code each segment. Show percentages on hover.
  - **Why**: Numbers like "Chain: 4.2 GB, SNARK: 650 MB" are harder to grasp than a visual proportional bar.

- [ ] **Auto-lock timeout preset buttons**
  - **How**: Replace the raw number input for auto-lock with preset buttons: 5, 10, 15, 30, 60 min, Never. Highlight the active preset. Allow custom input as a fallback.
  - **Why**: Typing a number is more cognitive effort than clicking a preset. Most users want one of a few common values.

- [ ] **Network switch confirmation with restart warning**
  - **How**: When toggling between preprod and mainnet, show a ConfirmModal: "Switching networks will restart all services and may take several minutes to sync. Continue?" Show estimated sync time if possible.
  - **Why**: Network switches restart the node and require re-sync. Users need to understand the impact before confirming.

- [ ] **Export all settings as JSON**
  - **How**: Add an "Export Settings" button that serializes: auto-lock timeout, toast duration, active network, view preferences. Download as `veiled-settings.json` via Tauri's save dialog. Add a corresponding "Import Settings" button.
  - **Why**: Users reinstalling the app or setting up on a new machine want to restore their preferences without reconfiguring everything.

---

## 14. Notifications & Alerts

> Key files: `fe/src/hooks/useBidNotifications.ts`, `fe/src/components/Toast.tsx`

- [ ] **Desktop notifications for new bids**
  - **How**: Use the `tauri-plugin-notification` to send system-level desktop notifications when new bids arrive (detected by `useBidNotifications`). Show: "New bid on [listing name]: 50 ADA". Add a toggle in Settings to enable/disable.
  - **Why**: Users who aren't actively looking at the app miss new bids. Desktop notifications ensure they don't miss opportunities.

- [ ] **Notification sound option**
  - **How**: Play a short notification sound when a new bid arrives or a transaction confirms. Use the Web Audio API or an `<audio>` element with a bundled sound file. Add a toggle + volume control in Settings.
  - **Why**: Visual-only notifications are easy to miss. A subtle sound (like a coin drop for ADA received) adds a satisfying feedback layer.

- [ ] **Toast queue management**
  - **How**: In the Toast component, limit visible toasts to 3 at a time. When a 4th arrives, queue it and show when a slot opens. Stack toasts vertically with newest on top. Add a "Dismiss all" button when multiple toasts are visible.
  - **Why**: Rapid actions (like multiple tx confirmations arriving at once) can stack 5+ toasts that overlap and obscure the UI.

- [ ] **Transaction confirmation toast with details**
  - **How**: When a transaction confirms, show a rich toast with: tx type, amount, and a "View on Explorer" link. Use the existing `toast.transactionSuccess()` but add amount information.
  - **Why**: The current confirmation toast just says "Transaction confirmed" with a hash link. Adding context makes it more informative.

---

## 15. Design System & Styling

> Key files: `fe/src/index.css`, all components

- [ ] **Light theme option**
  - **How**: Define a second set of CSS variables under `[data-theme="light"]` in index.css. Add a theme toggle in Settings that sets `document.documentElement.dataset.theme`. Persist preference in localStorage. Map all `--bg-*`, `--text-*`, `--border-*` to appropriate light values.
  - **Why**: Some users prefer light mode, especially in bright environments. A theme toggle is a standard expectation for desktop apps.

- [ ] **`prefers-reduced-motion` support**
  - **How**: Wrap all CSS animations and transitions in `@media (prefers-reduced-motion: no-preference)`. When reduced motion is preferred, disable `animate-pulse`, page transitions, and card hover animations. Use instant state changes instead.
  - **Why**: Users with motion sensitivity or vestibular disorders are excluded by animations. Respecting OS accessibility settings is a WCAG requirement.

- [ ] **Consistent button hover/active states**
  - **How**: Define shared CSS classes or Tailwind utilities for button states: `.btn-primary:hover { background: var(--accent-hover) }`, `.btn-primary:active { transform: scale(0.98) }`. Apply consistently across all buttons.
  - **Why**: Some buttons have hover effects and some don't. Inconsistent feedback makes the UI feel unpolished.

- [ ] **Focus ring improvement**
  - **How**: Replace the default `outline: 2px solid var(--accent)` with a subtle glow: `box-shadow: 0 0 0 3px var(--accent-muted)`. This looks softer and more integrated with the dark theme.
  - **Why**: The hard outline focus indicator looks harsh on a dark background. A glow is more visually appealing while still being accessible.

- [ ] **Loading skeleton shimmer animation**
  - **How**: Add a shimmer gradient animation to SkeletonCard: a light band sweeping left-to-right across the gray surface. Use `background: linear-gradient(-90deg, transparent, rgba(255,255,255,0.05), transparent)` animated with `@keyframes shimmer`.
  - **Why**: Static gray rectangles don't communicate "loading." A shimmer animation is the universal signal for placeholder content.

---

## 16. Animations & Micro-Interactions

> Key files: `fe/src/index.css`, various components

- [ ] **Modal entrance/exit animations**
  - **How**: Add CSS keyframes for modal enter (fade-in + scale from 0.95 to 1.0) and exit (fade-out + scale to 0.95). Use React's `onAnimationEnd` to delay unmounting until exit animation completes. Backdrop fades in/out separately.
  - **Why**: Modals appearing and disappearing instantly feels jarring. A 200ms animation smooths the transition.

- [ ] **Card entrance stagger animation**
  - **How**: When a list of cards renders, stagger their entrance by 50ms each: card 1 at 0ms, card 2 at 50ms, card 3 at 100ms, etc. Use `animation-delay: calc(var(--index) * 50ms)` via inline style. Limit to first 10 cards to avoid long waits.
  - **Why**: A wall of cards appearing instantly is visually overwhelming. Staggered entrance creates a pleasing cascade effect.

- [ ] **Copy-to-clipboard feedback animation**
  - **How**: When copying an address or txHash, briefly flash a green checkmark icon next to the copied text (scale in + fade out over 1s). Use CSS `@keyframes` with React state toggle.
  - **Why**: The current "Copied!" text change is functional but not delightful. A checkmark animation is universally understood.

- [ ] **Button press effect**
  - **How**: Add `transform: scale(0.97)` on `:active` state for all interactive buttons. Return to `scale(1)` on release with `transition: transform 100ms`. Apply via a shared CSS class.
  - **Why**: Physical buttons depress when pressed. Digital buttons should simulate this tactile feedback.

- [ ] **Toast slide-in animation**
  - **How**: Toasts should slide in from the right side (or top-right corner) instead of appearing instantly. Use `@keyframes slideIn { from { transform: translateX(100%); opacity: 0 } }`. Slide out on dismiss.
  - **Why**: Instant appearance of toasts is easy to miss. A sliding animation draws the eye to the notification.

---

## 17. Accessibility

> Key files: all components, `fe/src/index.css`

- [ ] **Focus trap in modals**
  - **How**: When a modal opens, trap keyboard focus within it. Tab from the last focusable element should cycle to the first. Escape closes the modal. On close, return focus to the element that opened it. Implement with a `useFocusTrap` hook.
  - **Why**: Without focus trapping, Tab key escapes the modal and interacts with hidden background elements. This is a WCAG 2.1 AA violation.

- [ ] **`aria-live` regions for dynamic content**
  - **How**: Add `aria-live="polite"` to toast container, bid notification badge, sync progress display, and loading states. Add `aria-live="assertive"` for error messages.
  - **Why**: Screen readers don't announce dynamically updated content unless it's in an `aria-live` region. Users miss critical status changes.

- [ ] **Skip-to-content link**
  - **How**: Add a visually hidden link as the first focusable element on every page: `<a href="#main-content" class="sr-only focus:not-sr-only">Skip to content</a>`. Add `id="main-content"` to the main content area.
  - **Why**: Keyboard users must Tab through the entire nav bar to reach content. A skip link is a standard accessibility pattern.

- [ ] **Form input `aria-invalid` on errors**
  - **How**: When a form field has a validation error, add `aria-invalid="true"` and `aria-describedby="fieldname-error"` to the input. The error message element gets `id="fieldname-error"`.
  - **Why**: Screen readers don't announce form errors unless they're programmatically associated with the input field.

- [ ] **Icon-only buttons need `aria-label`**
  - **How**: Audit all icon-only buttons (favorite heart, copy, refresh, close X, zoom +/-). Add `aria-label` describing the action: `aria-label="Add to favorites"`, `aria-label="Copy address"`.
  - **Why**: Screen readers announce icon-only buttons as just "button" with no indication of what they do.

- [ ] **Keyboard shortcut documentation overlay**
  - **How**: Add a `?` key shortcut (or Ctrl+/) that opens an overlay listing all keyboard shortcuts: Tab navigation, media controls, modal escape, etc. Display as a simple two-column table.
  - **Why**: Keyboard shortcuts exist but are undiscoverable. A help overlay teaches users about them.

---

## 18. Error Handling & User Feedback

> Key files: `fe/src/components/Toast.tsx`, `fe/src/components/ErrorBoundary.tsx`, `fe/src/services/api.ts`

- [ ] **Actionable error messages**
  - **How**: Create an error message mapping in `fe/src/services/errorMessages.ts` that translates raw errors into user-friendly guidance. Examples: "Failed to fetch" → "Can't reach the backend. Check that your node is running." "Insufficient funds" → "Your wallet doesn't have enough ADA. You need at least X ADA for this action."
  - **Why**: Raw error messages like "Network error" or "CBOR decode failed" mean nothing to users. Actionable messages tell them what to do.

- [ ] **"Copy error" button on error displays**
  - **How**: Add a small "Copy" icon button next to error messages in modals and toasts. Copies the full error text (including stack trace if available) to clipboard for bug reports.
  - **Why**: When users report bugs, they need to share the exact error. Selecting and copying error text from toasts is awkward.

- [ ] **Retry button on failed data fetches**
  - **How**: When `fetchEncryptions()` or `fetchBids()` fails, show an error state with a "Retry" button instead of just an error message. The retry button calls the same fetch function.
  - **Why**: Transient network errors currently leave users staring at an error with no recourse except refreshing the page.

- [ ] **Offline detection banner**
  - **How**: Listen to `window.addEventListener('offline', ...)` and show a sticky banner: "You're offline. Some features are unavailable." Dismiss when `online` event fires. Also check Kupo/backend reachability periodically.
  - **Why**: When Kupo or the backend is unreachable, individual errors appear throughout the app. A single banner explains the root cause.

- [ ] **Transaction failure diagnosis**
  - **How**: When a tx submission fails, parse the Ogmios error response and categorize: "Insufficient collateral", "Script execution failed", "UTxO already spent" (contention), "Fee too low". Show category-specific guidance.
  - **Why**: Transaction failures show raw Ogmios errors that are incomprehensible. Categorized errors with remediation help users recover.

---

## 19. Performance

> Key files: `fe/src/components/MarketplaceTab.tsx`, `fe/src/services/api.ts`

- [ ] **Virtual scrolling for long lists**
  - **How**: Use `@tanstack/react-virtual` (lightweight, no dependencies) for History and Library tabs. Render only visible rows plus a small overscan buffer. Keep the card grid layout by virtualizing rows of cards.
  - **Why**: Rendering 200+ DOM nodes for a long history or library causes scroll jank. Virtual scrolling keeps the DOM at ~20 nodes regardless of list length.

- [ ] **Image lazy loading in card grids**
  - **How**: Add `loading="lazy"` to all `<img>` tags in EncryptionCard, SalesListingCard, and LibraryCard. For listing images loaded via the image cache service, use `IntersectionObserver` to trigger the download only when the card is visible.
  - **Why**: All images fetch immediately even when off-screen. Lazy loading reduces initial bandwidth and speeds up first paint.

- [ ] **API response caching with TTL**
  - **How**: Wrap `api.ts` fetch calls with a simple in-memory cache (Map with TTL). Cache marketplace listings for 15s, protocol config for 60s. Bypass cache on explicit refresh. The backend already has a cache module — mirror the pattern in the frontend.
  - **Why**: Tab switching triggers full re-fetches of the same data. A 15s cache eliminates redundant network calls.

- [ ] **Debounce search input**
  - **How**: In MarketplaceTab and LibraryTab, debounce the search query filter by 300ms using a `useDebounce` hook. The raw input updates immediately for responsive typing, but the filter dispatch is delayed.
  - **Why**: Each keystroke in the search box re-filters and re-renders the entire card grid. Debouncing batches rapid keystrokes.

- [ ] **Memoize expensive card grid computations**
  - **How**: Wrap the `filteredAndSorted` computation in MarketplaceTab with `useMemo` (already done partially). Ensure the dependency array is minimal — only the filter values and raw data, not the entire component state.
  - **Why**: Filter/sort on every render is O(n log n). Memoization ensures it only recalculates when inputs actually change.

---

## 20. Backend API

> Key files: `be/src/routes/`, `be/src/services/`, `be/src/index.ts`

- [ ] **Pagination for listing and bid endpoints**
  - **How**: Add `?limit=20&offset=0` query params to `GET /api/encryptions`, `GET /api/bids`, and their sub-routes. Default to limit=50. Return `{ data: [...], pagination: { total, limit, offset, hasMore } }`.
  - **Why**: As the marketplace grows, returning all results in one response becomes slow and wasteful. Pagination lets the frontend load incrementally.

- [ ] **Response caching headers**
  - **How**: Add `Cache-Control: max-age=10, stale-while-revalidate=30` headers to encryption and bid list endpoints. Reference/script endpoints should use longer TTLs (max-age=300) since they rarely change.
  - **Why**: Without caching headers, the frontend's HTTP layer can't avoid redundant requests. Proper headers enable browser-level caching.

- [ ] **Health check returns proper HTTP status codes**
  - **How**: In `be/src/index.ts`, the health endpoint should return `200` when healthy and `503 Service Unavailable` when unhealthy. Currently it always returns 200. Change the catch block to `res.status(503).json(...)`.
  - **Why**: Load balancers and monitoring tools rely on HTTP status codes. A 200 for an unhealthy service is misleading.

- [ ] **Request timeout middleware**
  - **How**: Add a middleware that sets a 30-second timeout on all requests. If a Kupo/Koios call hangs, the middleware returns a 504 Gateway Timeout instead of hanging forever. Use `setTimeout` + `res.destroyed` check.
  - **Why**: If Kupo is down, requests hang until the client's own timeout fires. A server-side timeout gives faster, cleaner failures.

- [ ] **Circuit breaker for Kupo**
  - **How**: Apply the existing `CircuitBreaker` class (used for Koios) to Kupo calls. In `be/src/services/kupo.ts`, wrap `fetchWithRetry` calls with circuit breaker logic. Open after 5 failures, close after 30s recovery.
  - **Why**: Kupo has no circuit breaker — if it goes down, every request fails and retries, wasting resources. A circuit breaker fails fast and returns stale cache.

- [ ] **Structured request logging**
  - **How**: Add a request logging middleware that logs: method, path, status code, latency, and a request ID (UUID). Use the existing `logger.ts`. Include the request ID in error responses so users can reference it in bug reports.
  - **Why**: Debugging production issues without request logs is guesswork. Structured logs enable filtering and correlation.

- [ ] **Graceful shutdown handler**
  - **How**: In `be/src/index.ts`, add `process.on('SIGTERM', ...)` that stops accepting new connections, waits for in-flight requests (up to 10s), then exits. Log "Shutting down gracefully."
  - **Why**: Tauri kills the Express process, which may have in-flight requests. Graceful shutdown prevents truncated responses.

---

## 21. Rust Core & Security

> Key files: `src-tauri/src/crypto/`, `src-tauri/src/commands/`, `src-tauri/src/process/`

- [ ] **Stronger secrets key derivation**
  - **How**: In `secrets.rs`, increase Argon2id params from (4 MiB, 1 iter) to (32 MiB, 2 iter). This is still lighter than wallet encryption (64 MiB, 3 iter) but much harder to brute-force. Profile the time increase and ensure it stays under 1s.
  - **Why**: The current light params mean an attacker with the secrets file could brute-force the key in seconds. Stronger params raise the bar significantly.

- [ ] **Per-user salt for secrets key derivation**
  - **How**: Replace the fixed `"PEACE_SECRETS_V1"` salt with a random 16-byte salt generated on first wallet creation. Store it alongside the wallet file. Pass it to `derive_secrets_key()`.
  - **Why**: A fixed salt means all users have the same key derivation inputs (except the mnemonic). A random salt makes precomputation attacks impossible.

- [ ] **Config.json schema validation at startup**
  - **How**: Define a JSON schema for `resources/config.json` (contract addresses, policy IDs, ports). Validate on app startup. If validation fails, show a user-friendly error: "Configuration file is corrupted. Please reinstall."
  - **Why**: A malformed config.json causes cryptic runtime errors. Early validation catches the problem at startup with a clear message.

- [ ] **Auto-updater integration**
  - **How**: Add `tauri-plugin-updater` to Cargo.toml. Configure an update endpoint (GitHub Releases or a custom server). On app launch, check for updates. If available, show a non-intrusive banner: "Version X.Y.Z available — Update now?"
  - **Why**: Without auto-updates, users must manually download and reinstall new versions. Most will run outdated software with known bugs.

- [ ] **Secrets directory audit logging**
  - **How**: In `secrets.rs`, log every read/write/delete operation with timestamp and operation type (not the secret content). Write to a `secrets_audit.log` file in the app data directory. Rotate when > 1 MB.
  - **Why**: If secrets are compromised, an audit log helps determine when and how. It also helps debug "my secret disappeared" issues.

- [ ] **Secure temp file cleanup on crash**
  - **How**: On app startup, scan the system temp directory for files matching the SNARK temp file pattern (e.g., `snark_input_*.json`). Delete any orphans from previous crashed sessions.
  - **Why**: SNARK input temp files contain secret cryptographic material. If the app crashes during proving, these files persist on disk.

---

## 22. Testing

> Key files: `fe/src/test/`, `be/src/services/__tests__/`, test configs

- [ ] **Component tests for critical modals**
  - **How**: Write tests for CreateListingModal, PlaceBidModal, BidsModal, and DecryptModal using `@testing-library/react`. Mock Tauri invoke and context providers. Test: form validation, submit flow, error states, keyboard interactions.
  - **Why**: Modals are the core interactive UI and have zero tests. A bug in PlaceBidModal could cause users to lose funds.

- [ ] **Context provider tests**
  - **How**: Write tests for WalletContext, NodeContext, and WasmContext. Mock Tauri invoke responses. Test state transitions: `loading → no_wallet → locked → unlocked`, `stopped → syncing → synced → error`. Test edge cases: unlock failure, node crash during sync.
  - **Why**: Contexts manage all critical app state. Untested context logic is the #1 risk for hard-to-debug state bugs.

- [ ] **Express route handler tests**
  - **How**: Use `supertest` (already a dependency) to test all route groups. Mock Kupo/Koios responses. Test: happy path responses, error handling, query param validation, missing data handling.
  - **Why**: Zero route tests exist. Backend changes could silently break API contracts.

- [ ] **Raise test coverage thresholds**
  - **How**: After adding component and route tests, raise thresholds from 40%/50% to 60%/65% in vitest configs. Add coverage enforcement in CI (fail the job if below threshold).
  - **Why**: Current thresholds are low (40% FE, 50% BE). Higher thresholds prevent coverage regression as the codebase grows.

- [ ] **End-to-end test for listing + bid flow**
  - **How**: Write a test that exercises: create listing → listing appears in marketplace → place bid → bid appears in seller's view. Use mocked Tauri IPC and API responses. Run with Vitest in a jsdom environment.
  - **Why**: The full listing-to-bid flow spans multiple components and services. A single e2e test catches integration bugs that unit tests miss.

- [ ] **Rust core tests**
  - **How**: Add `#[cfg(test)]` modules to `wallet.rs`, `secrets.rs`, and `manager.rs`. Test: wallet create/unlock/lock cycle, secrets encrypt/decrypt round-trip, process restart backoff timing.
  - **Why**: The Rust crypto and process management code has no visible tests. These are security-critical paths.

---

## 23. Developer Experience & Tooling

> Key files: build scripts, package.json, configs

- [ ] **Prettier configuration**
  - **How**: Add `.prettierrc` with consistent settings (singleQuote, trailingComma, printWidth: 100). Add `format` scripts to fe/ and be/ package.json. Run on CI.
  - **Why**: No auto-formatter means code style varies by contributor. Prettier eliminates style debates and ensures consistency.

- [ ] **VS Code workspace configuration**
  - **How**: Create `.vscode/settings.json` with: format-on-save enabled, ESLint auto-fix, Tailwind CSS IntelliSense paths, Rust Analyzer settings, recommended extensions list in `.vscode/extensions.json`.
  - **Why**: New contributors must manually configure their editor. A workspace config provides instant productivity.

- [ ] **Backend hot-reload**
  - **How**: In `run.sh`, run `tsc --watch` in the background and use `nodemon dist/index.js` instead of plain `node dist/index.js`. This auto-restarts Express when `tsc --watch` emits new compiled files.
  - **Why**: Frontend changes hot-reload via Vite, but backend changes require manual `npm run build` + Tauri restart. This inconsistency wastes developer time.

- [ ] **npm workspaces migration**
  - **How**: Convert the root `package.json` to use npm workspaces: `"workspaces": ["fe", "be"]`. Update scripts to use `npm -w fe` instead of `npm --prefix fe`. Share common dev dependencies.
  - **Why**: The current `--prefix` approach works but doesn't share dependencies. Workspaces reduce `node_modules` size and simplify dependency management.

- [ ] **Docker development environment**
  - **How**: Create a `docker-compose.yml` that runs: cardano-node, Ogmios, Kupo (pre-configured for preprod). This lets developers skip sidecar binary setup and test against real chain data without Mithril bootstrap.
  - **Why**: Sidecar binaries are ~600 MB, gitignored, and platform-specific. A Docker environment provides consistent, shareable infrastructure.

---

## 24. Documentation & CI/CD

> Key files: `.github/workflows/ci.yml`, `CHANGELOG.md`, `CONTRIBUTING.md`

- [ ] **Fix CI path references**
  - **How**: In `.github/workflows/ci.yml`, update the TypeScript job path from `app/ui/fe` to `app/gui/fe`. Verify all path references match the current repo structure.
  - **Why**: The CI TypeScript job references a stale path (`app/ui/fe`), meaning frontend tests may not run in CI at all.

- [ ] **Add Tauri build to CI**
  - **How**: Add a CI job that runs `npx tauri build` (with stub sidecar binaries). This verifies the Rust compilation, Vite build, and Tauri packaging all succeed. Cache `target/` and `node_modules/` between runs.
  - **Why**: CI currently only lints and runs unit tests. A build failure would only be caught when someone tries to create a release.

- [ ] **Coverage reporting in CI**
  - **How**: Run `vitest --coverage` in CI for both FE and BE. Fail the job if coverage drops below thresholds. Optionally post a coverage summary comment on PRs using a GitHub Action.
  - **Why**: Coverage thresholds exist in config but aren't enforced. Without CI enforcement, coverage can silently regress.

- [ ] **Dependency security audit in CI**
  - **How**: Add `npm audit --audit-level=high` and `cargo audit` jobs to the CI pipeline. Run weekly on a schedule. Fail on critical vulnerabilities.
  - **Why**: No security scanning exists. A vulnerable dependency could compromise wallet security without anyone noticing.

- [ ] **Update CONTRIBUTING.md path references**
  - **How**: Change all references from `app/ui/` to `app/gui/` in CONTRIBUTING.md. Update the development setup instructions. Add the version bump checklist.
  - **Why**: CONTRIBUTING.md references the old `app/ui/` directory structure. New contributors following these instructions will get confused.

- [ ] **Changelog automation**
  - **How**: Adopt conventional commits (`feat:`, `fix:`, `chore:`) and add `conventional-changelog` as a dev dependency. Add a `changelog` npm script that auto-generates entries from commit messages. Run before each release.
  - **Why**: CHANGELOG.md is manually maintained and sparse (only v0.3.0). Automated generation ensures every change is documented.

- [ ] **PR template**
  - **How**: Create `.github/pull_request_template.md` with sections: Summary, Changes, Test Plan, Screenshots, Checklist (tests pass, lint passes, changelog updated). This appears automatically when creating a PR.
  - **Why**: PRs without context make review slow. A template ensures consistent, reviewable PRs.

- [ ] **Release automation**
  - **How**: Create a GitHub Actions workflow triggered by a version tag (e.g., `v0.4.0`). Steps: run tests, build Tauri for Linux (and optionally macOS/Windows), create a GitHub Release with the installer artifacts and auto-generated release notes.
  - **Why**: Manual release builds are error-prone. Automated releases ensure every version is built consistently and published immediately.

---

## Priority Guide

### Must-Have (blocks production readiness)
- Unlock attempt rate limiting (#2)
- BIP39 checksum validation (#2)
- Focus trap in modals (#17)
- Health check proper HTTP status codes (#20)
- Fix CI path references (#24)
- Component tests for critical modals (#22)

### Should-Have (significant UX/reliability improvement)
- Onboarding tour (#1)
- Step progress indicator on wallet creation (#1)
- Persist filters across sessions (#5)
- Desktop notifications for new bids (#14)
- Pagination for API endpoints (#20)
- Circuit breaker for Kupo (#20)
- Stronger secrets key derivation (#21)
- Express route handler tests (#22)

### Nice-to-Have (polish and delight)
- Light theme option (#15)
- Modal entrance/exit animations (#16)
- Card entrance stagger animation (#16)
- Toast slide-in animation (#16)
- Loading skeleton shimmer (#15)
- Keyboard shortcuts overlay (#17)
- PDF page thumbnails (#12)
- Earnings summary on My Sales (#6)

### Infrastructure (developer productivity)
- Prettier configuration (#23)
- Pre-commit hooks (#23)
- Backend hot-reload (#23)
- Coverage reporting in CI (#24)
- PR template (#24)
- Release automation (#24)
