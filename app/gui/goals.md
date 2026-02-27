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
4. [My Sales Tab](#4-my-sales-tab)
5. [Create Listing Modal](#5-create-listing-modal)
6. [Place Bid Modal](#6-place-bid-modal)
7. [Settings Page](#7-settings-page)
8. [Design System & Styling](#8-design-system--styling)
9. [Accessibility](#9-accessibility)
10. [Error Handling & User Feedback](#10-error-handling--user-feedback)
11. [Backend API](#11-backend-api)
12. [Rust Core & Security](#12-rust-core--security)
13. [Testing](#13-testing)
14. [Developer Experience & Tooling](#14-developer-experience--tooling)

---

## 1. Wallet & Authentication

> Key files: `fe/src/pages/WalletSetup.tsx`, `fe/src/pages/WalletUnlock.tsx`

- [x] 🟡 **Caps Lock warning on password fields**
  - **How**: In `WalletUnlock.tsx` and `WalletSetup.tsx` password inputs, add an `onKeyDown` handler that checks `event.getModifierState('CapsLock')`. When true, show a small warning below the input: `<p className="text-xs text-[var(--warning)] mt-1">Caps Lock is on</p>`. Store in component state (`capsLockOn`), clear when Caps Lock is toggled off.
  - **Why**: Users accidentally entering passwords with Caps Lock on waste time and get frustrated by repeated "incorrect password" errors.

- [ ] 🟡 **Delete wallet confirmation checkbox**
  - **How**: In the delete wallet flow (triggered from `WalletUnlock.tsx`), the ConfirmModal currently shows a warning message but no explicit acknowledgment. Add a checkbox: `<label><input type="checkbox" /> I have backed up my 24-word recovery phrase</label>` and disable the delete button until checked. Pass a custom `children` or `description` prop to ConfirmModal, or create a specialized `DeleteWalletModal` component.
  - **Why**: Wallet deletion is irreversible without the recovery phrase; a checkbox forces users to consciously acknowledge the risk before proceeding.

---

## 2. Node Sync & Process Management

> Key files: `fe/src/pages/NodeSync.tsx`, `fe/src/contexts/NodeContext.tsx`

- [x] 🟢 **Progress bar shimmer animation during sync**
  - **How**: In `NodeSync.tsx`, the progress bar gradient (`from-[var(--accent)] to-[var(--success)]`) is static. Add a CSS `@keyframes shimmer` animation in `index.css`: `@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }` and apply `animation: shimmer 2s ease-in-out infinite` with `background-size: 200% 100%` to the progress bar. Respect `prefers-reduced-motion` by disabling in the existing media query.
  - **Why**: A static bar during a multi-hour sync feels frozen; a subtle shimmer signals the process is alive.

- [x] 🟢 **NodeSync "stuck at 99%" — add estimated wait time**
  - **How**: In `NodeSync.tsx` (line ~632), the message says "This is normal" for the final sync phase. Append: "The last few percent may take 5–15 minutes as the node validates recent blocks." This is a pure copy change.
  - **Why**: Users panic when sync appears stalled at 99% and may restart the node, losing progress.

---

## 3. Dashboard & Navigation

> Key files: `fe/src/pages/Dashboard.tsx`, `fe/src/pages/Settings.tsx`

- [x] 🟢 **Dashboard tab `aria-selected` attribute**
  - **How**: In `Dashboard.tsx`, add `aria-selected={activeTab === tab.id}` to each tab button in the tab bar. The buttons already have `role="tab"` styling but lack the ARIA attribute.
  - **Why**: Screen readers cannot distinguish the active tab from inactive ones without `aria-selected`.

- [x] 🟡 **HistoryTab filter-empty state**
  - **How**: In `HistoryTab.tsx`, when filters produce zero results but unfiltered data exists, show a distinct EmptyState: `<EmptyState title="No transactions match filters" description="Try adjusting your filters or date range." action={<button onClick={clearFilters}>Clear Filters</button>} />`. This is separate from the "no history at all" empty state.
  - **Why**: Users filtering by date/type who get zero results need guidance to clear filters rather than thinking they have no transactions.

- [x] 🟡 **Settings page active section highlight**
  - **How**: In `Settings.tsx`, the `activeSection` state tracks which section is displayed, but the section nav buttons have no visual active indicator. Add `bg-[var(--accent-muted)] border-l-2 border-[var(--accent)]` to the active section's button, and `text-[var(--text-muted)]` to inactive ones.
  - **Why**: Users lose context about which settings section they're viewing, especially after scrolling.

---

## 4. My Sales Tab

> Key files: `fe/src/components/SalesListingCard.tsx`, `fe/src/components/EncryptionCard.tsx`

- [x] 🟢 **Align fallback price display between SalesListingCard and EncryptionCard**
  - **How**: In `SalesListingCard.tsx` (line 11), `DEFAULT_FALLBACK_PRICE = 1` causes listings without a suggested price to display "1 ADA", which is misleading. `EncryptionCard.tsx` (line 55) correctly shows "No suggested price". Remove the `DEFAULT_FALLBACK_PRICE` constant and use the same `formatPrice()` pattern from EncryptionCard: return `'No suggested price'` when price is undefined/null/NaN/negative.
  - **Why**: "1 ADA" is a fabricated price that misleads sellers into thinking their listing has a real price when none was set.

---

## 5. Create Listing Modal

> Key files: `fe/src/components/CreateListingModal.tsx`

- [x] 🟡 **Iagon disconnected state shown before upload attempt**
  - **How**: In `CreateListingModal.tsx`, when `isFileMode && !isIagonConnected`, the file upload button is disabled but no explanation is shown. Add an inline message: `<p className="text-xs text-[var(--error)] mt-2">Iagon connection required for file uploads. Connect in Settings → Data Layer.</p>` below the file input area when `!isIagonConnected`.
  - **Why**: Users selecting a file category see a disabled button with no explanation, leading to confusion about why they can't create a listing.

- [x] 🟡 **Image preview error state visible to user**
  - **How**: In `CreateListingModal.tsx`, `imagePreviewState` can be `'error'` (line 103) but no error UI is rendered. When `imagePreviewState === 'error'`, display: `<p className="text-xs text-[var(--error)]">Failed to load image from URL. Check the link and try again.</p>` in the image preview area.
  - **Why**: Users enter an invalid image URL and see nothing — no feedback that the preview failed.

- [x] 🟢 **Image preview loading spinner**
  - **How**: In `CreateListingModal.tsx`, when `imagePreviewState === 'loading'`, show a `<LoadingSpinner size="sm" />` in the preview area. Currently the area is blank while the image loads.
  - **Why**: Slow-loading images from external URLs leave users wondering if anything is happening.

- [x] 🟢 **Description character counter**
  - **How**: In `CreateListingModal.tsx`, below the description `<textarea>`, add: `<span className="text-xs text-[var(--text-muted)]">{formData.description.length} / 500</span>`. The 500-char limit is already enforced in validation; this makes it visible while typing.
  - **Why**: Users don't know the character limit until they exceed it and see an error on submit.

- [x] 🟡 **File size validation feedback before upload**
  - **How**: In `CreateListingModal.tsx`, in the file input `onChange` handler, check `file.size` before proceeding. If the file exceeds the Iagon max (100MB), show an inline error immediately: `setErrors({ ...errors, file: 'File too large (max 100 MB)' })` and don't set the file. Add `accept` attribute to `<input type="file">` based on the selected category (e.g., `accept=".pdf,.doc,.docx"` for documents, `accept="audio/*"` for audio).
  - **Why**: Users selecting a 500MB video file should learn immediately it's too large, not after waiting for encryption to complete.

---

## 6. Place Bid Modal

> Key files: `fe/src/components/PlaceBidModal.tsx`

- [x] 🟡 **"Max" button to auto-fill wallet balance**
  - **How**: In `PlaceBidModal.tsx`, add a small "Max" button next to the bid amount input. On click, compute `(parsedLovelace / 1_000_000) - FEE_RESERVE_ADA` and set `formData.bidAmount` to that value (formatted to 6 decimals). Disable the Max button when `balanceAda === undefined`.
  - **Why**: Users must manually calculate max bid from their balance; a "Max" button is standard UX in crypto apps and prevents "exceeds balance" errors.

- [x] 🟢 **Future price field labeled "(optional)"**
  - **How**: In `PlaceBidModal.tsx`, the "Future price" label doesn't indicate it's optional. Change the label to `"Future price (optional)"`. The field is already optional (line 125: only validated when `showFuturePrice && formData.futurePrice.trim()`), but users may not realize this.
  - **Why**: Users unsure whether to fill in a future price may abandon the bid form entirely.

- [x] 🟢 **Future price InfoTooltip explanation**
  - **How**: In `PlaceBidModal.tsx`, add `<InfoTooltip text="The price you'll set if you win this bid and re-list the decrypted content." />` next to the "Future price" label. Import `InfoTooltip` from `../components/InfoTooltip`.
  - **Why**: "Future price" is domain-specific jargon — new users won't know what it means or when it matters.

- [x] 🟢 **Simplify minimum bid error message**
  - **How**: In `PlaceBidModal.tsx` (line 116), change error from `'Minimum bid is ${MIN_BID_ADA} ADA (required by the Cardano network to hold bid data on-chain)'` to `'Minimum bid is ${MIN_BID_ADA} ADA'`. Move the technical explanation to an InfoTooltip near the bid input label.
  - **Why**: The parenthetical about network requirements is confusing for non-technical users and clutters the error message.

---

## 7. Settings Page

> Key files: `fe/src/pages/Settings.tsx`

- [x] 🟡 **Collateral creation explanation**
  - **How**: In `Settings.tsx`, near the "Set Collateral" button, add an `<InfoTooltip text="Collateral is a small ADA deposit required by the Cardano network to execute smart contracts. It's returned when you're done." />`. If the collateral is already set, show a green checkmark badge.
  - **Why**: Users don't understand why collateral is needed and may skip it, only to encounter errors when trying to bid.

- [x] 🟡 **Wallet defragmentation status indicator**
  - **How**: In `Settings.tsx`, near the "Defragment Wallet" button, show the current UTxO count from `useWalletHealth()` hook: `<p className="text-xs text-[var(--text-muted)]">Your wallet has {utxoCount} UTxOs. {utxoCount > 20 ? 'Consider defragmenting for better performance.' : 'Wallet is healthy.'}</p>`. Disable the button when UTxO count is already optimal (< 10).
  - **Why**: Users don't know if defragmentation is needed or what "defragment" means in a wallet context.

- [ ] 🟡 **Disable network switch during sync**
  - **How**: In `Settings.tsx`, disable the network toggle when `nodeStage` is not `'stopped'` or `'synced'`. Show: `<p className="text-xs text-[var(--text-muted)]">Stop the node before switching networks.</p>` when disabled. Switching mid-sync could leave the node in an inconsistent state.
  - **Why**: Users switching networks while syncing may corrupt chain data or cause the node to crash.

- [ ] 🟢 **Iagon API key removal — re-authentication guidance**
  - **How**: In `Settings.tsx`, when the "Remove Iagon API Key" confirm dialog appears, set the ConfirmModal `description` prop to: `"You'll need to re-authenticate with your wallet before uploading files again."`.
  - **Why**: Users may not realize removing the key means they need to re-authenticate, not just click a button.

---

## 8. Design System & Styling

> Key files: `fe/src/index.css`, `fe/src/components/ConfirmModal.tsx`, `fe/src/utils/formatAda.ts`

- [ ] 🟢 **InfoTooltip focus ring offset**
  - **How**: In `InfoTooltip.tsx` (line 54), the focus ring has `focus-visible:ring-2 focus-visible:ring-[var(--accent)]` but no `ring-offset`. Add `focus-visible:ring-offset-1` to match other inline buttons (e.g., Toast.tsx line 174 uses `ring-offset-1`).
  - **Why**: Without ring-offset, the focus ring sits directly on the icon and is harder to see, especially on dark backgrounds.

- [ ] 🟡 **Extract `.btn-danger` CSS class**
  - **How**: In `index.css`, add a `.btn-danger` class alongside the existing `.btn-primary`, `.btn-error` classes: `.btn-danger { background: var(--error); color: white; } .btn-danger:hover { opacity: 0.8; }`. Update `ConfirmModal.tsx` (line 39) to use `btn-base btn-danger` instead of inline `bg-[var(--error)] hover:bg-[var(--error)]/80 text-white`. Search for other inline danger button styles across the codebase.
  - **Why**: Inline danger button styling is duplicated and won't update if the error color changes; a CSS class ensures consistency.

- [ ] 🟡 **Document or unify ADA formatting functions**
  - **How**: In `fe/src/utils/formatAda.ts`, `formatAda()` (line 5) trims trailing zeros ("1.5 ADA") while `formatAdaDisplay()` (line 17) forces 2 decimal places ("1.50 ADA"). These appear side-by-side in marketplace cards (listing price vs wallet balance). Either: (a) add a JSDoc comment explaining the intentional distinction, or (b) unify to always show 2 decimals for consistency. If unifying, update `formatAda()` to use `minimumFractionDigits: 2`.
  - **Why**: "50 ADA" next to "1,234.50 ADA" looks inconsistent and erodes confidence in the app's attention to detail.

- [ ] 🟢 **SessionWarningBanner copy improvement**
  - **How**: In `SessionWarningBanner.tsx` (line 45), change `"move mouse or press a key to stay active"` to `"click Stay Active or press any key to continue"`. The current copy mentions mouse movement but doesn't reference the actual "Stay Active" button prominently.
  - **Why**: Users should focus on the button (the clearest action) rather than vague mouse movement instructions.

---

## 9. Accessibility

> Key files: `fe/src/pages/Dashboard.tsx`, `fe/src/components/KeyboardShortcutsOverlay.tsx`

- [ ] 🟢 **`<kbd>` elements — screen reader improvement**
  - **How**: In `KeyboardShortcutsOverlay.tsx` (line 78), `<kbd>` elements style keyboard keys but aren't announced distinctly by screen readers. Wrap each `<kbd>` with `aria-label="Key: {keyName}"` so screen readers say "Key: Escape" instead of just "Escape" in a table context.
  - **Why**: Screen reader users need context that these are keyboard shortcuts, not just text in a table.

---

## 10. Error Handling & User Feedback

> Key files: `fe/src/services/errorMessages.ts`, `fe/src/components/SnarkProvingModal.tsx`, `fe/src/components/PlaceBidModal.tsx`

- [ ] 🟡 **Iagon error messages — distinguish failure types**
  - **How**: In `errorMessages.ts` (line 101–110), the generic Iagon pattern matches all errors containing "iagon". Add two earlier patterns before it: `{ test: (e) => /invalid.*api.*key|api.*key.*invalid|unauthorized/i.test(e), result: { title: 'Iagon Authentication Failed', message: 'Your Iagon API key is invalid or expired.', action: 'Go to Settings → Data Layer and re-authenticate.', recoverable: true } }` and a quota pattern for 413/quota errors.
  - **Why**: Users get "Could not reach Iagon" when the real issue is an expired API key, leading them to check their internet instead of re-authenticating.

- [ ] 🟡 **SNARK proving error classification**
  - **How**: In `SnarkProvingModal.tsx`, when proof generation fails, parse the error string to distinguish: timeout (>10min), memory ("out of memory", "allocation"), missing files ("setup files not found"), and crypto errors. Show distinct messages: "Proof generation timed out — try closing other applications to free memory" vs "SNARK setup files missing — go to Settings to re-download."
  - **Why**: A generic "Proof generation failed" doesn't help users fix the issue, and SNARK proving is the most technically opaque operation in the app.

- [ ] 🟢 **SNARK proving modal — show estimated time**
  - **How**: In `SnarkProvingModal.tsx`, below the elapsed timer, add: `<p className="text-xs text-[var(--text-muted)]">Typically takes 2–4 minutes</p>`. This is static text based on benchmarked timing (~3 min on desktop hardware).
  - **Why**: First-time users seeing a timer count up with no reference point panic and close the app, losing the proof computation.

- [ ] 🟡 **Strip commas from ADA amount inputs**
  - **How**: In `PlaceBidModal.tsx` (line 112) and `CreateListingModal.tsx` price validation, before `parseFloat(formData.bidAmount)`, add: `const sanitized = formData.bidAmount.replace(/,/g, '')`. Users entering "1,000" expect 1000 ADA, not 1 ADA (which is what `parseFloat("1,000")` returns). Apply the same sanitization in all ADA-parsing code paths.
  - **Why**: Comma-as-thousands-separator is standard in many locales; silently parsing "1,000" as "1" could cause users to bid/price dramatically less than intended.

---

## 11. Backend API

> Key files: `be/src/middleware/timeout.ts`, `be/src/middleware/pagination.ts`, `be/src/services/health.ts`, `be/src/config/index.ts`

- [ ] 🟡 **Timeout middleware — guard against double response**
  - **How**: In `timeout.ts`, the timeout handler sends a 504 response but doesn't prevent the route handler from also sending a response if it completes just after the timeout. Add a `res.locals.timedOut = true` flag in the timeout callback and check it in the response: `const origSend = res.send; res.send = function(...args) { if (res.locals.timedOut) return res; return origSend.apply(this, args); };`. Alternatively, check `res.headersSent` before sending the timeout response.
  - **Why**: Double response causes "Cannot set headers after they are sent" crashes in Express, which are intermittent and hard to reproduce.

- [ ] 🔴 **Timeout middleware — abort underlying operations**
  - **How**: In `timeout.ts`, create an `AbortController` per request, attach it to `req` (e.g., `req.abortSignal = controller.signal`), and call `controller.abort()` when the timeout fires. Thread this signal through service calls: `kupo.ts` and `koios.ts` should pass it to `fetch()`. Requires updating all `fetch` calls in `fetchWithRetry.ts` to accept and forward the signal.
  - **Why**: Timed-out requests continue consuming resources (HTTP connections, CPU for CBOR parsing) even after the client has received 504.

- [ ] 🟢 **Pagination integer overflow bounds check**
  - **How**: In `pagination.ts` (line ~44), add a guard before computing `hasMore`: `if (offset > Number.MAX_SAFE_INTEGER - limit) return { ...result, hasMore: false }`. Also cap `offset` to a reasonable maximum (e.g., 1,000,000) in the query param parsing to prevent abuse.
  - **Why**: Extremely large offset values could cause incorrect pagination behavior or be used for denial-of-service.

- [ ] 🟢 **Health check timestamps — add max age**
  - **How**: In `health.ts`, `lastKupoSuccess` and `lastKoiosSuccess` persist indefinitely. Add a staleness check: if `Date.now() - lastSuccess > 5 * 60 * 1000` (5 minutes), report the dependency as "stale" rather than "reachable" in the health response.
  - **Why**: A health endpoint reporting Kupo as "reachable" based on a success from 2 hours ago is misleading for monitoring.

- [ ] 🟢 **Validate numeric environment variable ranges**
  - **How**: In `be/src/config/index.ts`, after `parseInt()` for reference output indices, add range validation: `if (val < 0 || val > 255) throw new Error('Invalid output index')`. Negative indices parse successfully but are invalid on-chain.
  - **Why**: A misconfigured env var like `ENCRYPTION_REF_OUTPUT_INDEX_PREPROD="-1"` silently becomes -1, causing cryptic transaction build failures.

---

## 12. Rust Core & Security

> Key files: `src-tauri/src/lib.rs`, `src-tauri/src/process/manager.rs`, `src-tauri/src/commands/snark.rs`

- [ ] 🔴 **SNARK cleanup task — synchronize with active prove operations**
  - **How**: In `lib.rs` (line ~142), the hourly cleanup task deletes SNARK temp files older than 1 hour. But if a prove operation takes >1 hour (rare but possible on slow hardware), cleanup could delete files mid-operation. Solution: before deleting, check if the `SnarkLock` mutex is held (i.e., a prove is in progress). If locked, skip cleanup for that cycle. Alternatively, track active temp directories in a `HashSet<PathBuf>` behind the `SnarkLock` and exclude them from cleanup.
  - **Why**: Deleting temp files during an active SNARK proof would cause the proof to fail silently or produce corrupt output, wasting 3+ minutes of computation.

- [ ] 🔴 **Process manager orphan detection — validate process identity**
  - **How**: In `manager.rs`, `kill_orphans_on_ports()` uses `fuser` to find PIDs on ports 3001/1337/1442 and kills them. But if a new, unrelated process has taken the same port, it gets killed. Before sending SIGTERM, read `/proc/{pid}/cmdline` and verify it contains an expected binary name (e.g., "node", "ogmios", "kupo", "cardano-node"). Skip killing if the process doesn't match.
  - **Why**: On a developer machine running other services, orphan cleanup could kill an unrelated process using port 3001 (e.g., another Express app).

- [ ] 🔴 **SNARK lock — guard temp directory creation**
  - **How**: In `snark.rs`, verify that temp directory creation and the SNARK sidecar invocation are both under the `SnarkLock` mutex. If two concurrent `snark_prove` calls arrive, only one should proceed; the other should wait or return an error ("SNARK operation already in progress"). Check that the lock is acquired before `NamedTempFile` creation, not just before the sidecar spawn.
  - **Why**: Concurrent prove operations could race on temp directories, causing file conflicts or corrupt output.

---

## 13. Testing

> Key files: `be/src/services/cbor.ts`, `be/src/app.ts`, `fe/src/services/providers.ts`

- [ ] 🔴 **Backend test: `cbor.ts` — CBOR decode + slot-to-time**
  - **How**: Create `be/src/services/__tests__/cbor.test.ts`. Test: `slotToUnixTime()` with preprod slot 0 → 1654041600, mainnet slot 4492800 → 1596491091, negative slot (should handle gracefully). `decodePlutusData()` with valid CBOR for Constructor, Integer, ByteString, List, Map. Test indefinite-length byte strings (G2 point chunking). Test malformed CBOR input (truncated, invalid tags). ~30+ test cases.
  - **Why**: `cbor.ts` is the foundation of all datum parsing — incorrect slot-to-time or CBOR decode silently corrupts all marketplace data.

- [ ] 🟡 **Backend test: `app.ts` — Express app factory**
  - **How**: Create `be/src/__tests__/app.test.ts`. Use `supertest`. Test: CORS headers present on responses, JSON body parsing works, 404 returned for unknown routes, error handler returns `{ error: { code, message } }` format. Test request size limits if configured.
  - **Why**: The app factory wires all middleware together; a misconfigured middleware order (e.g., CORS after routes) silently breaks the entire API.

- [ ] 🟡 **Frontend test: `providers.ts` — singleton lifecycle**
  - **How**: Create `fe/src/services/__tests__/providers.test.ts`. Mock `OgmiosProvider` and `KupoAdapter`. Test: `getKupoAdapter()` returns same instance on repeated calls, `getOgmiosProvider()` returns same instance, `FixedOgmiosProvider.evaluateTx()` remaps `WITHDRAW` → `REWARD` tags.
  - **Why**: Provider singletons are used by every transaction build; a broken `WITHDRAW`→`REWARD` tag fix would silently break all bid acceptance operations.

- [ ] 🟡 **Error path tests for Tauri IPC services**
  - **How**: In existing test files for `imageCache.test.ts`, `iagonApi.test.ts`, `iagonAuth.test.ts`, `libraryService.test.ts`, and `snarkProver.test.ts`, add test cases for: `invoke()` rejecting with "wallet locked" error, `invoke()` rejecting with "file not found", `invoke()` rejecting with permission denied, `invoke()` timing out. Mock `invoke` to throw and verify the service either re-throws with a meaningful error or returns a failure result.
  - **Why**: All Tauri IPC services only test happy paths; invoke failures (locked wallet, missing files, process crash) are real production scenarios that could crash the UI.

- [ ] 🟡 **Raise frontend coverage thresholds**
  - **How**: In `fe/vite.config.ts`, update coverage thresholds from `lines: 55, statements: 55` to `lines: 80, statements: 80`. Run `npm test -- --coverage` to verify current coverage meets the threshold, or incrementally raise (e.g., 65 → 75 → 80) over multiple PRs.
  - **Why**: 55% line coverage is too low for a financial application handling real ADA; higher thresholds prevent regression.

---

## 14. Developer Experience & Tooling

> Key files: `.github/workflows/`, `package.json`

- [ ] 🟡 **GitHub Actions CI pipeline**
  - **How**: Create `.github/workflows/ci.yml` with jobs: (1) `lint` — runs `bash lint.sh` (eslint fe/be, tsc be, cargo fmt/clippy), (2) `test` — runs `bash test.sh` (vitest fe + be), (3) `typecheck` — runs `cd fe && npx tsc --noEmit`. Trigger on push to `main` and all pull requests. Use Node 20, Rust stable. Cache `node_modules`, `target/`, and `~/.cargo/registry`.
  - **Why**: No automated quality gate means regressions can slip into main unnoticed; CI catches lint errors, type errors, and test failures before merge.

- [ ] 🟡 **Pre-commit hooks**
  - **How**: Install `husky` and `lint-staged` in the root `package.json`. Configure `lint-staged` to run `eslint --fix` on staged `.ts/.tsx` files and `cargo fmt` on staged `.rs` files. Run `npx husky install` and add a `.husky/pre-commit` hook that runs `npx lint-staged`.
  - **Why**: Without pre-commit hooks, developers must remember to lint manually; hooks enforce consistent code style automatically.

---

## Priority Guide

### Must-Have (blocks production readiness)
- SNARK cleanup task synchronization (§12) — could corrupt active proof output
- Backend test: `cbor.ts` (§13) — untested foundation of all datum parsing
- Timeout middleware double response guard (§11) — causes intermittent Express crashes
- Strip commas from ADA inputs (§10) — users could bid 1000x less than intended

### Should-Have (significant UX/reliability improvement)
- Iagon disconnected state in CreateListingModal (§5) — silently blocks file listings
- "Max" bid button (§6) — standard crypto UX, prevents balance errors
- Delete wallet confirmation checkbox (§1) — irreversible action needs explicit ack
- SNARK proving estimated time (§10) — prevents users from killing the app mid-proof
- Error path tests for Tauri IPC (§13) — real production failures untested
- Iagon error message classification (§10) — wrong guidance for expired API keys
- Disable network switch during sync (§7) — could corrupt chain data

### Nice-to-Have (polish and delight)
- GitHub Actions CI (§14) — automated quality gate
- Frontend coverage thresholds raised (§13) — prevent regression
- File size validation before upload (§5) — saves time on large files
- Description character counter (§5) — visibility of limits
- Defragmentation status indicator (§7) — guidance for wallet health

### Craft (the details that make users say "this is well built")
- ADA formatting consistency (§8) — side-by-side decimal mismatch
- SalesListingCard fallback price fix (§4) — no more phantom "1 ADA" prices
- Progress bar shimmer (§2) — alive feedback during long sync
- SessionWarningBanner copy (§8) — clearer urgency messaging
- InfoTooltip focus ring offset (§8) — subtle a11y polish
- Future price InfoTooltip (§6) — domain term explanation

### Infrastructure (developer productivity)
- Pre-commit hooks (§14) — enforce lint on commit
- Backend test: `app.ts` (§13) — verify middleware wiring
- Frontend test: `providers.ts` (§13) — singleton + tag fix coverage
- Validate env var ranges (§11) — prevent config-caused build failures
