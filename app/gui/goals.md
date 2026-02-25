# Veiled Desktop App — Goals & Improvements

A comprehensive backlog for making the Veiled Desktop App production-ready. Pick any item, implement it, check it off, and submit a PR.

Each item has:
- **What**: A brief description of the feature or improvement
- **How**: Implementation ideas and key files involved
- **Why**: The value it provides

---

## Table of Contents

1. [Audio Player](#1-audio-player)
2. [Video Player](#2-video-player)
3. [Image Viewer](#3-image-viewer)
4. [PDF Viewer](#4-pdf-viewer)
5. [Node Sync UX](#5-node-sync-ux)
6. [Dashboard & Navigation](#6-dashboard--navigation)
7. [Marketplace & Discovery](#7-marketplace--discovery)
8. [Transactions & Confirmations](#8-transactions--confirmations)
9. [Settings & Configuration](#9-settings--configuration)
10. [Wallet & Security](#10-wallet--security)
11. [Testing](#11-testing)
12. [Developer Experience](#12-developer-experience)
13. [Backend Reliability](#13-backend-reliability)
14. [Rust / Tauri Core](#14-rust--tauri-core)
15. [Accessibility](#15-accessibility)
16. [General UI Polish](#16-general-ui-polish)

---

## 1. Audio Player

> Key file: `fe/src/components/AudioPlayer.tsx`

- [ ] **Keyboard shortcuts for transport controls**
  - **How**: Add a `useEffect` keydown listener — Space for play/pause, Left/Right arrows for skip -/+ 10s, Up/Down for volume. Only active when AudioPlayer is mounted (not globally).
  - **Why**: Standard media player behavior. Users expect keyboard control without reaching for the mouse.

- [ ] **Drag-to-seek on the progress bar**
  - **How**: Add `onMouseDown` + `onMouseMove` + `onMouseUp` handlers to the seek bar div. Track a `isSeeking` ref to update position on drag. Currently only `onClick` is supported (`handleSeek`).
  - **Why**: Click-only seeking is imprecise. Drag seeking lets users scrub through audio fluidly.

- [ ] **Repeat / loop toggle**
  - **How**: Add a `loop` state toggle button next to transport controls. Set `audioRef.current.loop = true` when enabled. Persist preference in component state (or localStorage for stickiness).
  - **Why**: Users reviewing purchased audio content often want to loop a track. No loop means the audio stops and they must manually replay.

- [ ] **Waveform overview display**
  - **How**: Pre-compute a waveform summary from the decoded `AudioBuffer` (already available in `bufferRef`). Draw a static waveform on a second canvas layer behind the FFT bars. Highlight the played portion with accent color.
  - **Why**: Gives users a visual map of the entire track — they can see quiet/loud sections and seek to points of interest. Standard in modern audio players.

- [ ] **Better error state with format-specific guidance**
  - **How**: Expand the error display in AudioPlayer to show the detected MIME type, suggest specific conversion tools (e.g., "Try converting FLAC to MP3 with ffmpeg"), and offer a one-click "Open with system player" via Tauri shell open.
  - **Why**: Current error says "format not supported" but doesn't help the user fix it. Actionable error messages reduce frustration.

- [ ] **Audio metadata display (ID3 tags)**
  - **How**: Add a dependency like `music-metadata` (browser build) to parse ID3/Vorbis tags from the `Uint8Array`. Display artist, album, track number, and embedded album art above the visualization canvas.
  - **Why**: Purchased audio content often has metadata. Showing it makes the player feel professional and helps users identify what they're listening to.

---

## 2. Video Player

> Key file: `fe/src/components/VideoPlayer.tsx`

- [ ] **Playback speed control (0.5x — 2x)**
  - **How**: Add a speed selector dropdown/button group near the fullscreen toggle. Set `videoRef.current.playbackRate` on change. Options: 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x.
  - **Why**: Standard video player feature. Users reviewing educational or long-form content need speed control.

- [ ] **Progress feedback during FFmpeg remux**
  - **How**: FFmpeg.wasm supports a `progress` callback via `ffmpeg.on('progress', ...)`. Use it to show a percentage bar and ETA instead of the current static "Converting for playback..." spinner.
  - **Why**: Remuxing can take 10+ seconds for large files. Users need to know it's progressing and approximately how long it will take.

- [ ] **Keyboard shortcuts**
  - **How**: Add keydown listener — Space for play/pause, Left/Right for skip 5s, F for fullscreen toggle, M for mute. Scope to when VideoPlayer is mounted.
  - **Why**: Standard video player UX. Users expect keyboard-driven control.

- [ ] **Better error state with fallback guidance**
  - **How**: When remux fails, show the detected file extension and MIME type in the error. Offer a "Save As" button inline (not just as a suggestion) that triggers the export flow directly.
  - **Why**: Current error tells users the format is unsupported but requires them to figure out how to export. A direct action button reduces friction.

- [ ] **Picture-in-Picture support**
  - **How**: Check `document.pictureInPictureEnabled` and if supported, add a PiP button that calls `videoRef.current.requestPictureInPicture()`. WebKitGTK may not support this — degrade gracefully by hiding the button.
  - **Why**: PiP lets users watch video while browsing the marketplace. Nice-to-have for multitasking.

- [ ] **Volume control and mute toggle**
  - **How**: The native `<video controls>` provides some of this, but add an explicit mute button and volume slider in the custom toolbar for consistency with AudioPlayer's design language.
  - **Why**: Custom toolbar controls provide a consistent UX across audio and video players.

---

## 3. Image Viewer

> Key file: `fe/src/components/ImageViewer.tsx`

- [x] **Zoom controls (zoom in, zoom out, fit-to-screen)**
  - **How**: Add zoom state (0.25x to 4x range). Render zoom buttons (+/-/reset) in the toolbar. Apply `transform: scale(zoom)` with `transform-origin: center` on the image. Support mouse wheel zoom with Ctrl+scroll.
  - **Why**: PdfViewer already has zoom (0.5x-3x). ImageViewer should match. Large images need zoom to see detail; small images need zoom to fill the view.

- [x] **Pan/drag when zoomed**
  - **How**: When zoom > 1x, change cursor to `grab`/`grabbing`. Track mouse drag to update `translate(x, y)` on the image container. Constrain panning to image bounds.
  - **Why**: Without pan, zoomed images are stuck at center. Users need to navigate to specific regions.

- [x] **Rotate and flip buttons**
  - **How**: Add rotate (90/180/270) and horizontal flip buttons in the toolbar. Apply `transform: rotate(Ndeg) scaleX(-1)` alongside zoom transforms.
  - **Why**: Photos taken at odd orientations need rotation. EXIF orientation isn't always respected.

- [x] **Download/Save As button in toolbar**
  - **How**: Add a download button that triggers `export_library_content` Tauri command or creates a download link from the blob URL. Place it next to the fullscreen toggle.
  - **Why**: Users should be able to save decrypted images to their filesystem without navigating to the Library tab's export flow.

---

## 4. PDF Viewer

> Key file: `fe/src/components/PdfViewer.tsx`

- [x] **Page number jump input**
  - **How**: Replace or supplement the "Page X of Y" display with an editable input field. On Enter or blur, navigate to the specified page. Validate bounds (1 to totalPages).
  - **Why**: For long PDFs, clicking Next/Previous dozens of times is tedious. Direct page entry is essential.

- [x] **Download/Save As button**
  - **How**: Add a download button in the PdfViewer toolbar that triggers `export_library_content` or creates a blob download link.
  - **Why**: Same rationale as ImageViewer — users want to save PDFs without extra steps.

- [x] **Text search within PDF**
  - **How**: Use `react-pdf`'s text layer to extract page text, then implement Ctrl+F style search that highlights matches and navigates between them. This is complex but high-value.
  - **Why**: Searching within a purchased PDF document is a fundamental capability. Without it, users must export and open in an external reader.

---

## 5. Node Sync UX

> Key file: `fe/src/pages/NodeSync.tsx`

- [x] **Sync speed and ETA display**
  - **How**: Track `syncProgress` over time (sample every 5s) to compute blocks/second rate. Calculate ETA from `(100 - progress) / rate`. Display as "~X min remaining" below the progress bar. Store samples in a ref to avoid state churn.
  - **Why**: The progress percentage alone doesn't tell users how long they'll wait. ETA is the single most requested feature for any sync/download screen.

- [x] **Show current tip slot/height and network tip during sync**
  - **How**: Display `tipHeight` (already in NodeContext) alongside the known network tip. Show "Block 42,000,000 / 43,200,000" format. The network tip can be fetched from Koios `GET /tip` once on mount.
  - **Why**: Users can see exactly where the node is and how far behind it is. More informative than a percentage that may not be linear.

- [x] **Better "stuck at 99%" feedback**
  - **How**: When `syncProgress >= 99` for more than 60 seconds, show a contextual message: "The last few blocks take longer as the node validates recent transactions. This is normal." Also show the actual block gap.
  - **Why**: Users frequently think the sync is frozen at 99%. An explanation prevents them from force-restarting and losing progress.

- [x] **Detailed error recovery guidance**
  - **How**: When `stage === 'error'`, analyze the `error` string and show specific recovery steps. Common cases: "Disk full" suggests clearing old snapshots, "Port in use" suggests checking for orphan processes, "Connection refused" suggests firewall check. Add a "View Logs" expansion that auto-opens the console.
  - **Why**: Current error state just shows the raw error message. Users don't know how to fix it.

- [x] **Copy logs to clipboard button**
  - **How**: Add a "Copy Logs" button next to the console toggle. Use `copyToClipboard(logs.join('\n'))` (utility already exists in `fe/src/utils/clipboard.ts`).
  - **Why**: When users need to report issues or debug, they need to share logs. Manual selection in the console div is error-prone.

- [x] **Mithril download speed and ETA**
  - **How**: `mithrilProgress` already has `bytes_downloaded` and `total_bytes`. Compute download speed from delta bytes / delta time. Show "Downloading at X MB/s — ~Y min remaining".
  - **Why**: Mithril download is the longest first-run operation (10-20 min). Users need to know their download speed and time remaining.

---

## 6. Dashboard & Navigation

> Key files: `fe/src/pages/Dashboard.tsx`, tab components in `fe/src/components/`

- [x] **Persist tab filter/sort/search state across tab switches**
  - **How**: Move each tab's filter state (search query, sort option, status filter, category filter, view mode) into a context or `useReducer` at the Dashboard level. Pass state + dispatch to each tab. Alternatively, use `useSearchParams` from React Router to persist in the URL.
  - **Why**: Switching from Marketplace to MySales and back resets all filters. Users lose their search context and must re-apply filters every time.

- [x] **Skeleton loaders while tabs fetch data**
  - **How**: Create a `SkeletonCard` component that matches EncryptionCard dimensions. Show a grid of 4-8 skeleton cards while `loading === true` in each tab, instead of a centered spinner.
  - **Why**: Skeleton loaders communicate structure and reduce perceived wait time. A centered spinner feels slower.

- [x] **Lazy-load inactive tabs**
  - **How**: Wrap each tab component in `React.lazy()` + `Suspense` and only render the active tab. Currently all 5 tabs render on mount and fetch data immediately.
  - **Why**: Reduces initial API calls from 5 to 1. Faster initial load. Less memory usage for tabs the user may never visit.

- [x] **Memoize tab components to prevent re-renders**
  - **How**: Wrap `MarketplaceTab`, `MySalesTab`, etc. with `React.memo()`. Memoize callback props passed from Dashboard with `useCallback`. Profile with React DevTools to verify.
  - **Why**: Dashboard has ~80 state variables. Every state change re-renders all tabs. Memoization prevents unnecessary work.

- [x] **Unified data refresh orchestration**
  - **How**: Create a `useDataRefresh()` hook that manages a single refresh trigger, debounced polling interval, and manual refresh button. Replace the current mix of `refreshKey`, `historyKey`, escalating `setTimeout`s, and `setInterval`s.
  - **Why**: Current refresh logic is scattered across multiple mechanisms. A single orchestrator is easier to reason about and debug.

- [x] **Modal stacking management**
  - **How**: Create a `ModalProvider` context that tracks open modals in a stack. Enforce only one modal at a time (or allow stacking with proper z-index management). Prevent duplicate opens.
  - **Why**: If two modals trigger simultaneously (e.g., bid notification toast + user opens create listing), behavior is undefined. A modal stack prevents conflicts.

- [x] **Better draft recovery UX**
  - **How**: Instead of immediately showing a blocking modal on Dashboard mount, show a non-intrusive notification bar at the top: "You have a listing draft from a previous session. [Resume] [Discard]". Let users dismiss and come back to it.
  - **Why**: Current draft recovery modal blocks the entire Dashboard until dismissed. Users who just want to check the marketplace must deal with the modal first.

- [x] **Remember last active tab**
  - **How**: Store `activeTab` in localStorage. On Dashboard mount, read and restore it. Clear on wallet lock.
  - **Why**: Users returning to the Dashboard should land on their most recently used tab, not always Marketplace.

---

## 7. Marketplace & Discovery

> Key files: `fe/src/components/MarketplaceTab.tsx`, `fe/src/components/EncryptionCard.tsx`

- [x] **Search by description content**
  - **How**: Extend the search filter in `MarketplaceTab` (line 80-86) to also match against `e.description`. Currently only searches `tokenName` and `seller`.
  - **Why**: Description is the most meaningful field for finding relevant listings. Users searching for "research paper" should find listings whose description mentions it.

- [x] **Price range filter**
  - **How**: Add min/max price inputs (or a range slider) above the listing grid. Filter by `e.suggestedPrice >= min && e.suggestedPrice <= max`. Handle null prices with a "No price set" toggle.
  - **Why**: Buyers often have a budget. Browsing dozens of listings to find ones in their price range is tedious.

- [x] **Sort by popularity (bid count)**
  - **How**: Add a `'most-bids'` sort option. This requires fetching bids alongside encryptions (already done in `fetchEncryptions`) and computing bid count per encryption token. Sort descending by count.
  - **Why**: Popular listings (with many bids) signal market interest and help buyers discover high-demand content.

- [x] **Favorites / bookmarks**
  - **How**: Add a star/heart icon on EncryptionCard. Store favorited token names in localStorage (keyed by wallet PKH). Add a "Favorites" filter toggle in the toolbar. Show favorited count as a badge.
  - **Why**: Users browsing the marketplace find interesting listings but aren't ready to bid. Favorites let them save and return later.

- [x] **Pagination or infinite scroll**
  - **How**: Implement client-side pagination (data is already fully loaded). Show 12-20 items per page with page controls at the bottom. Or implement infinite scroll with `IntersectionObserver` to load more items as the user scrolls.
  - **Why**: With hundreds of listings, rendering all cards at once causes lag and overwhelming visual density. Pagination improves performance and browsability.

- [x] **Filtered empty state with clear-filters button**
  - **How**: When filters reduce results to 0, show a specific EmptyState: "No listings match your filters. [Clear Filters]" with a button that resets all filters. Currently shows a generic empty state or nothing.
  - **Why**: Users don't realize their filters are too restrictive. A clear-filters button provides a one-click escape.

- [x] **Listing card bid count badge**
  - **How**: Fetch bid counts per encryption token (already available from `bidsApi.getAll()`) and pass to EncryptionCard. Display a small badge: "3 bids" on each card.
  - **Why**: Helps buyers gauge competition and interest level at a glance.

---

## 8. Transactions & Confirmations

> Key files: `fe/src/pages/Dashboard.tsx`, `fe/src/components/ConfirmModal.tsx`, `fe/src/services/transactionHistory.ts`

- [x] **Confirmation dialogs for all destructive actions**
  - **How**: Use `ConfirmModal` (already exists) before: removing a listing, canceling a bid, canceling a pending listing, deleting a library item. Currently some actions fire immediately on button click.
  - **Why**: Accidental clicks on "Remove Listing" or "Cancel Bid" cause irreversible on-chain transactions. A confirmation step prevents costly mistakes.

- [x] **Transaction history filtering and search**
  - **How**: Add filter buttons for tx type (listing, bid, accept, cancel) and a search input for tx hash in `HistoryTab`. Add date range filtering.
  - **Why**: As transaction history grows, finding a specific transaction becomes difficult. Filtering reduces the haystack.

- [x] **Export transaction history as CSV**
  - **How**: Add an "Export" button in HistoryTab that serializes the transaction list to CSV format (date, type, amount, tx hash, status) and triggers a file download via Tauri save dialog.
  - **Why**: Users need transaction records for accounting, tax reporting, or dispute resolution.

- [x] **Better transaction status tracking**
  - **How**: Enhance the transaction history list to show real-time status: "Pending (2 confirmations)", "Confirmed (15+ blocks)", "Failed". Poll `GET /api/chain/confirmations/:txHash` for recent transactions and update status in-place.
  - **Why**: Users currently see "pending" with no indication of progress toward confirmation. Real-time confirmation count builds confidence.

---

## 9. Settings & Configuration

> Key file: `fe/src/pages/Settings.tsx`

- [x] **Image cache management UI**
  - **How**: Add a "Cache" section in Settings showing: total cache size, number of cached images, list of cached image URLs with delete buttons, "Clear All Cache" button. Use existing Tauri commands: `list_cached_images`, `delete_cached_image`.
  - **Why**: Users have no visibility into what's cached or how much disk space it uses. Cache can grow indefinitely.

- [x] **Transaction history cleanup**
  - **How**: Add a "Clear History" section with options: "Clear all", "Clear older than 30 days", "Clear only failed transactions". Operate on localStorage via `transactionHistory` service.
  - **Why**: Transaction history grows indefinitely. Users need housekeeping tools.

- [x] **Settings search / filter**
  - **How**: Add a search input at the top of Settings that filters visible settings across all tabs. Match against setting labels and descriptions.
  - **Why**: Settings page has 6+ sections. Users looking for "auto-lock" or "Iagon" shouldn't have to scan every section.

- [x] **Developer / debug mode toggle**
  - **How**: Add a hidden debug section (activated by a toggle in an "Advanced" section). Show: verbose logs toggle, process PIDs, config.json contents, localStorage viewer, force-refresh button.
  - **Why**: Power users and developers troubleshooting issues need detailed runtime info without reading Tauri logs.

- [x] **Toast notification duration setting**
  - **How**: Add a setting for toast auto-dismiss duration (3s, 5s, 8s, never). Store in localStorage. Read from `useToast()` hook default.
  - **Why**: Some users want toasts to stay longer (accessibility), others want them faster. Configurable duration respects user preference.

- [x] **Show orphan drafts section always**
  - **How**: In the Data Layer section, always show the "Orphaned Listing Drafts" area even when there are none. Display "No orphaned drafts found" when the list is empty.
  - **Why**: Users don't know this cleanup feature exists until they have orphaned drafts. Making it always visible builds awareness.

---

## 10. Wallet & Security

> Key files: `fe/src/contexts/WalletContext.tsx`, `fe/src/services/autolock.ts`, `fe/src/pages/Settings.tsx`

- [x] **Session timeout warning countdown**
  - **How**: When auto-lock timer is within 60 seconds of expiring, show a sticky toast: "Session expires in X seconds. [Extend]". Clicking "Extend" resets the inactivity timer. Use `autolock.ts` timer value.
  - **Why**: Auto-lock happens silently. Users in the middle of reviewing a listing lose their context. A warning gives them a chance to extend.

- [x] **Copy mnemonic to clipboard button**
  - **How**: Add a "Copy" button next to the mnemonic display in Settings reveal section. Use `copyToClipboard()` utility. Show a toast "Copied to clipboard" with a warning "Clear your clipboard after storing securely". Auto-clear clipboard after 30 seconds via `setTimeout`.
  - **Why**: Currently users must manually select all 24 words and copy. Error-prone and frustrating.

- [x] **Better wallet unlock error messages**
  - **How**: Map specific error strings from Tauri `unlock_wallet` to user-friendly messages: "Incorrect password" (argon2 mismatch), "Wallet file corrupted" (JSON parse error), "Wallet file not found" (missing file). Show recovery steps for each.
  - **Why**: Current unlock failure shows a generic error. Users don't know if they typed the wrong password or if something is broken.

- [x] **Password strength requirements display**
  - **How**: In `WalletSetup`, show specific requirements below the password field: minimum length, uppercase, number, special char (or just entropy-based). `usePasswordStrength` hook already exists — expose its criteria as a checklist.
  - **Why**: Users see a strength bar but don't know what makes a password "strong" in this context.

---

## 11. Testing

> Key files: `fe/src/test/setup.ts`, `test.sh`, various `__tests__/` directories

- [x] **Add Tauri invoke mock to test setup**
  - **How**: Create a `__mocks__/@tauri-apps/api.ts` file (or add to `fe/src/test/setup.ts`) that mocks `invoke()`, `listen()`, and `emit()`. Return sensible defaults. This unblocks all component and service tests that call Tauri commands.
  - **Why**: Most untested services (`imageCache`, `libraryService`, `iagonApi`, `secretStorage`, `listingDraftStorage`) can't be tested because they call Tauri `invoke()` which isn't available in the test environment.

- [x] **Test critical frontend services**
  - **How**: Add test files for: `secretCleanup.ts` (secret deletion timing), `contentStorage.ts` (file save logic), `kupoAdapter.ts` (UTxO fetching), `api.ts` (REST client), `listingDraftStorage.ts` (draft lifecycle). Mock Tauri invoke and HTTP fetch.
  - **Why**: These services handle money-adjacent operations (secrets, transactions, encrypted content). Bugs here cause data loss or failed transactions.

- [x] **Test all backend route handlers**
  - **How**: Create `be/src/routes/__tests__/` with tests for each route group. Use `supertest` to make HTTP requests against the Express app. Mock `kupo.ts` and `koios.ts` to return known responses.
  - **Why**: Zero backend routes are tested. Any refactor could break API contracts silently.

- [x] **Test React contexts (WalletContext, NodeContext, WasmContext)**
  - **How**: Use `@testing-library/react` `renderHook` to test context state transitions. Mock Tauri invoke for wallet operations and node status polling. Verify lifecycle: loading -> no_wallet -> locked -> unlocked.
  - **Why**: Contexts orchestrate all app state. Testing transitions catches regressions in authentication and sync flows.

- [x] **Test hooks (useSnarkProver, useBidNotifications)**
  - **How**: Use `renderHook` from `@testing-library/react-hooks`. Mock Tauri and API calls. Verify: setup file checking, decompression progress, prover readiness; bid polling, notification diffing, toast triggering.
  - **Why**: These hooks have complex async logic and polling. Without tests, timing bugs go undetected.

- [x] **Add component tests for critical modals**
  - **How**: Test `CreateListingModal`, `PlaceBidModal`, `DecryptModal` with `@testing-library/react`. Verify: form validation, submit flow, error display, loading states. Requires Tauri mock and context providers.
  - **Why**: Modals are where users perform financial operations. Rendering bugs or validation gaps here are high-impact.

- [x] **Set up coverage thresholds**
  - **How**: Add `coverage` config to `fe/vite.config.ts` and `be/vitest.config.ts`: `{ thresholds: { lines: 50, branches: 40, functions: 50 } }`. Start low and ratchet up. Add `npm run test:coverage` to CI.
  - **Why**: Without thresholds, coverage only goes down. Enforcing a minimum prevents regression.

- [x] **Add integration tests for tx building**
  - **How**: Create integration tests that run `createListing()`, `placeBid()`, etc. with mocked providers (Kupo, Ogmios). Verify the assembled transaction structure, datum contents, and metadata.
  - **Why**: `transactionBuilder.ts` is 2168 lines of critical business logic. End-to-end tx building tests catch serialization and datum encoding bugs.

- [x] **Add Rust unit tests**
  - **How**: Add `#[cfg(test)] mod tests {}` blocks in `wallet.rs`, `secrets.rs`, `manager.rs`. Test: wallet encryption/decryption round-trip, secrets store/retrieve, PID file read/write, process status transitions.
  - **Why**: Zero Rust tests exist. Crypto code and process management are foundational — bugs here are catastrophic.

- [x] **Add test for backend CIP-20 metadata parsing edge cases**
  - **How**: Extend `parsers.test.ts` to test: malformed CIP-20 JSON, missing `msg` key, strings exceeding 64 bytes, empty metadata, both old-format (flat array) and new-format (structured) parsing paths.
  - **Why**: CIP-20 parsing handles two formats with silent fallback. Edge cases could show wrong descriptions to users.

---

## 12. Developer Experience

> Key files: `build.sh`, `run.sh`, `lint.sh`, `test.sh`, `package.json`

- [x] **Backend hot-reload during development**
  - **How**: Add a `dev:be:watch` script using `tsx watch` or `nodemon` with `tsc --watch`. In `dev:all`, run the watcher alongside Vite. Alternative: use `concurrently` to run `tsc --watch` in the background.
  - **Why**: Currently every backend TS change requires a manual `cd be && npm run build`. This is the #1 DX friction point.

- [x] **Remove `--debug` flag from production build**
  - **How**: Change `build.sh` line 10 from `npx tauri build --debug` to `npx tauri build`. Add a separate `build-debug.sh` for debug builds.
  - **Why**: `--debug` produces an unoptimized binary with debug symbols. Production builds should be optimized.

- [x] **Add pre-commit hooks**
  - **How**: Install `husky` and `lint-staged`. Configure to run: ESLint on staged `.ts/.tsx` files, `tsc --noEmit` for type checking, `cargo fmt --check` for Rust files. Add to root `package.json`.
  - **Why**: Catches lint errors and type issues before they're committed. Saves review cycles.

- [x] **Add root-level npm scripts**
  - **How**: Add to root `package.json`: `"test": "bash test.sh"`, `"lint": "bash lint.sh"`, `"type-check": "npm --prefix fe run type-check && npm --prefix be run lint"`, `"clean": "rm -rf fe/node_modules be/node_modules be/dist src-tauri/target"`.
  - **Why**: Contributors shouldn't need to know about shell scripts. `npm test` and `npm run lint` are universal conventions.

- [x] **Add ESLint to backend**
  - **How**: Install `eslint` and `@typescript-eslint/*` in `be/`. Create `be/eslint.config.js` with recommended rules. Add `"lint:eslint": "eslint src/"` to `be/package.json`. Update `lint.sh` to run it.
  - **Why**: Backend currently only has `tsc --noEmit` (type checking). No style enforcement, no unused-variable warnings, no import ordering.

- [x] **Add CI pipeline (GitHub Actions)**
  - **How**: Create `.github/workflows/ci.yml` with jobs: lint (fe + be + Rust), test (fe + be), type-check. Run on push to main and PR branches. Skip Tauri build in CI (requires sidecar binaries).
  - **Why**: Without CI, broken tests and lint failures are only caught manually. Automated checks enforce quality on every PR.

- [x] **Add prerequisite check to run.sh**
  - **How**: Before running `tauri dev`, check that sidecar binaries exist in `src-tauri/binaries/`, Node.js version meets requirements, and Rust toolchain is installed. Print clear error messages if anything is missing.
  - **Why**: New contributors cloning the repo hit cryptic errors when sidecar binaries are missing. A pre-flight check saves debugging time.

---

## 13. Backend Reliability

> Key files: `be/src/services/`, `be/src/routes/`, `be/src/index.ts`

- [x] **Response caching with TTL**
  - **How**: Add a simple in-memory cache (Map with TTL) for `getAllEncryptions()` and `getAllBids()`. Cache for 10-30 seconds. Invalidate on manual refresh. Consider `node-cache` or a simple custom implementation.
  - **Why**: Every API request re-fetches all UTxOs from Kupo and metadata from Koios. With 100 UTxOs, that's 100+ HTTP calls per request. Caching reduces load by 95%+ for repeated requests.

- [x] **Batch CIP-20 metadata fetches**
  - **How**: Koios supports batch transaction queries. Replace the serial per-UTxO `fetchCip20Metadata()` loop in `encryptions.ts` with a single batch request for all tx hashes. Use `POST /api/v1/tx_metadata` with multiple hashes.
  - **Why**: N+1 query problem. With 50 listings, the current code makes 50 sequential HTTP requests. A batch call reduces this to 1.

- [x] **Retry with exponential backoff for Kupo/Koios**
  - **How**: Create a `fetchWithRetry(url, maxRetries=3, baseDelay=1000)` wrapper. On failure, retry with 1s, 2s, 4s delays. Use for all Kupo and Koios HTTP calls.
  - **Why**: Transient network errors (Kupo restart, Koios rate limit) cause immediate request failures. Retry logic handles brief outages transparently.

- [ ] **Input validation middleware**
  - **How**: Create validation middleware for common patterns: `validatePkh` (28-byte hex), `validateTokenName` (hex string), `validateTxHash` (64-char hex), `validateStatus` (enum). Apply to all route params.
  - **Why**: No input validation exists. Garbage params pass through to Kupo/Koios calls, causing confusing downstream errors.

- [x] **Structured logging**
  - **How**: Replace `console.log/warn/error` with a structured logger (e.g., `pino`). Add request IDs, timestamps, duration, and context to every log entry. Add request/response logging middleware.
  - **Why**: Current logging is unstructured `console.*` calls. Can't trace requests, can't measure performance, can't filter by severity.

- [ ] **Enhanced health check endpoint**
  - **How**: Expand `GET /health` to test Kupo and Koios connectivity. Return `{ status, kupo: { reachable, latency }, koios: { reachable, latency }, uptime, lastSuccessfulRefresh }`.
  - **Why**: Current health check returns "ok" even when Kupo/Koios are down. A real health check helps diagnose issues.

- [ ] **Circuit breaker for external dependencies**
  - **How**: Implement a simple circuit breaker pattern for Koios calls. After N consecutive failures, "open" the circuit and return cached/stale data for a cooldown period before retrying.
  - **Why**: If Koios goes down, every request fails and times out. A circuit breaker returns fast (stale) responses instead of hanging.

- [ ] **Datum parsing failure metrics**
  - **How**: Count skipped datums per request and include the count in the API response: `{ encryptions: [...], warnings: { skippedDatums: 3 } }`. Frontend can display "3 listings had parsing errors".
  - **Why**: Datum parsing failures are silently skipped. Frontend shows incomplete data with no indication that listings are missing.

---

## 14. Rust / Tauri Core

> Key files: `src-tauri/src/process/manager.rs`, `src-tauri/src/crypto/`, `src-tauri/src/commands/`

- [x] **Process health checks after spawn**
  - **How**: After spawning each process, verify it's actually ready: hit Express `/health`, query Ogmios WebSocket, check Kupo HTTP endpoint. Mark process as "Ready" only after health check passes. Retry with timeout if check fails.
  - **Why**: Processes are currently marked "Running" immediately after spawn. They may crash during startup, leaving the app in a partially broken state.

- [x] **Per-process shutdown timeouts**
  - **How**: Give `cardano-node` 45 seconds for graceful shutdown (it needs to flush ledger state). Give Express, Ogmios, Kupo 10 seconds each. Currently all share a 30-second budget.
  - **Why**: Cardano-node often gets SIGKILL'd because it can't flush in time. This causes longer startup next time as it replays the ledger.

- [x] **Key zeroization on error paths**
  - **How**: In `wallet.rs`, use the `zeroize` crate. Wrap key material in `Zeroizing<[u8; 32]>`. This automatically zeros memory on drop, including error paths.
  - **Why**: If argon2 hashing or AES encryption fails, the partially-derived key sits in memory until garbage collected. Zeroization prevents key material leaking.

- [x] **SNARK PID race condition fix**
  - **How**: Allow tracking multiple SNARK PIDs using a `Vec<u32>` behind `Arc<Mutex<>>` instead of a single `Option<u32>`. Add all spawned PIDs. On cleanup, kill all tracked PIDs.
  - **Why**: If a user starts a second SNARK proof before the first finishes, the first PID is overwritten and never cleaned up on shutdown.

- [x] **Temp file permissions for SNARK secrets**
  - **How**: After creating the `NamedTempFile` for SNARK input secrets, explicitly set permissions to `0600` using `std::fs::set_permissions`. Prevents other users on the system from reading secret material.
  - **Why**: Default temp file permissions may be world-readable depending on umask. SNARK secrets should be owner-only.

- [x] **Periodic process liveness monitoring**
  - **How**: Add a background task (tokio interval) that checks every 30 seconds whether managed processes are still running (check PID exists via `/proc/{pid}` on Linux). If a process has died unexpectedly, attempt restart per the restart policy.
  - **Why**: Currently dead processes are only detected when the frontend queries status. A zombie process could sit unnoticed for hours.

- [x] **Graceful handling of port conflicts on startup**
  - **How**: Before spawning Ogmios (1337), Kupo (1442), or Express (3001), check if the port is already in use. If so, attempt to kill the occupying process (if it's an orphan from a previous session) or report a clear error.
  - **Why**: Port conflicts cause cryptic "address already in use" errors. Proactive detection gives actionable feedback.

---

## 15. Accessibility

> Key files: all component files, `fe/src/index.css`

- [x] **Add ARIA labels to interactive elements**
  - **How**: Audit all `<button>`, `<input>`, `<select>` elements. Add `aria-label` to icon-only buttons (expand, collapse, delete, copy). Add `aria-describedby` to form fields with help text. Mark tab buttons with `role="tab"` and `aria-selected`.
  - **Why**: Screen readers can't describe icon-only buttons. ARIA labels make the app usable for visually impaired users.

- [x] **Mark toast notifications as ARIA live regions**
  - **How**: Add `role="alert"` and `aria-live="polite"` to the toast container in `Toast.tsx`. Error toasts should use `aria-live="assertive"`.
  - **Why**: Screen readers skip toast notifications unless marked as live regions. Users miss success/error feedback.

- [x] **Full keyboard navigation for marketplace filters**
  - **How**: Add `tabIndex` to filter buttons and sort dropdown. Ensure logical tab order: search input -> status filters -> category filters -> sort -> view mode -> first card. Add `onKeyDown` handlers for Enter/Space activation.
  - **Why**: Keyboard-only users (accessibility or power users) can't navigate the filter bar without mouse clicks.

- [x] **Color contrast audit and fixes**
  - **How**: Run automated contrast check on all CSS variable color combinations. Key concern: `--text-muted` (#666) on `--bg-secondary` (#141414) may fail WCAG AA. Lighten muted text to at least #888 or darken backgrounds.
  - **Why**: Low contrast text is hard to read for users with visual impairments or in bright environments.

- [x] **Focus visible indicators**
  - **How**: Add `:focus-visible` styles to all interactive elements. Use a visible outline (e.g., `outline: 2px solid var(--accent)`) that only appears on keyboard focus, not mouse click.
  - **Why**: Keyboard users need to see which element is focused. Default browser outlines are often hidden by `outline: none` styles.

---

## 16. General UI Polish

> Key files: `fe/src/index.css`, various components

- [x] **Consistent spacing system**
  - **How**: Define spacing tokens in CSS variables: `--space-xs: 4px`, `--space-sm: 8px`, `--space-md: 16px`, `--space-lg: 24px`, `--space-xl: 32px`. Replace hardcoded pixel values in component classes with these tokens.
  - **Why**: Inconsistent spacing (sometimes 4px gap, sometimes 8px) makes the UI feel unpolished. A system ensures visual rhythm.

- [x] **Responsive card grid breakpoints**
  - **How**: Update MarketplaceTab and LibraryTab grids to use responsive breakpoints: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`. Currently fixed column counts cause layout issues at the 1280x800 default window size.
  - **Why**: Cards may be too small or too large depending on window size. Responsive breakpoints adapt to available space.

- [x] **Modal max-height with scrollable body**
  - **How**: Ensure all modals use `max-h-[calc(100vh-4rem)]` on the modal body with `overflow-y-auto`. The submit button should always be visible (place it outside the scrollable area).
  - **Why**: On the default 1280x800 window, tall modals (CreateListingModal, DecryptModal) can overflow. The submit button becomes unreachable.

- [x] **Loading state consistency**
  - **How**: Audit all async operations and ensure each has: a loading indicator (spinner or skeleton), a disabled state on the trigger button, and an error state with retry. Create a shared `useAsyncAction()` hook that wraps this pattern.
  - **Why**: Some operations show spinners, others show nothing during loading. Inconsistent feedback confuses users about whether their action registered.

- [x] **Actionable error messages everywhere**
  - **How**: Replace generic error messages ("Something went wrong", "Failed to fetch") with specific ones that include: what failed, why it might have failed, and what to do next. Create an `errorMessages.ts` map from error codes to user-friendly strings.
  - **Why**: Generic errors leave users stuck. Actionable messages ("Failed to connect to Kupo — is the node running?") guide users to resolution.

- [x] **Smooth page transitions**
  - **How**: Add CSS transitions or use `framer-motion` for route changes (wallet setup -> unlock -> sync -> dashboard). A simple fade or slide transition makes navigation feel polished.
  - **Why**: Instant page swaps feel jarring. Subtle transitions make the app feel more professional and responsive.

- [x] **Notification badge on Dashboard tabs**
  - **How**: `useBidNotifications` already computes new bid count. Extend this to show a badge on the MySales tab. Similarly, show a badge on MyPurchases when a bid is accepted. Display counts in small circles on the tab buttons.
  - **Why**: Users need visual indicators that something requires their attention in a specific tab. Without badges, they must check each tab manually.

- [x] **Truncate long token names and addresses consistently**
  - **How**: Create a `<TruncatedText>` component that shows the first N and last M characters with "..." in between. Add a "Copy full value" button on hover/click. Use consistently across all cards and modals.
  - **Why**: Token names and addresses are long hex strings that overflow card layouts. Inconsistent truncation looks messy.

- [x] **Better empty states with illustrations**
  - **How**: Enhance the `EmptyState` component with small SVG illustrations for each context: no listings (marketplace icon), no bids (handshake icon), no purchases (shopping bag), no history (clock), empty library (books). Use the existing icon components as a starting point.
  - **Why**: Empty states are the first thing new users see. A friendly illustration with a call-to-action ("Create your first listing") guides them to the next step.

- [x] **Subtle hover effects on cards**
  - **How**: Add `hover:translate-y-[-2px] hover:shadow-lg` to EncryptionCard, SalesListingCard, LibraryCard. Add a border color transition on hover: `hover:border-[var(--accent)]/30`.
  - **Why**: Cards currently have minimal hover feedback. Subtle elevation and glow effects communicate clickability and add polish.

---

## Priority Guide

### Must-Have (blocks production readiness)
- Confirmation dialogs for destructive actions
- Backend input validation
- Better error messages (wallet unlock, node errors, tx failures)
- Session timeout warning
- Critical service tests (secretCleanup, transactionBuilder, routes)
- Remove `--debug` from build.sh

### Should-Have (significant UX improvement)
- Node sync ETA and speed display
- Search by description
- Audio player keyboard shortcuts and drag seek
- Video playback speed control
- Skeleton loaders
- Tab state persistence
- Retry logic for Kupo/Koios
- Backend response caching
- ARIA labels and keyboard navigation

### Nice-to-Have (polish and delight)
- Favorites/bookmarks
- Transaction history export
- Waveform visualization
- Image zoom/pan/rotate
- PDF text search
- Page transitions
- Developer debug mode
- Balance history chart
- Picture-in-Picture video
- Audio metadata display
