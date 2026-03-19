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

1. [Modals & Forms](#1-modals--forms)
2. [Accessibility](#2-accessibility)
3. [Backend API & Resilience](#3-backend-api--resilience)
4. [Hooks & Lifecycle](#4-hooks--lifecycle)

---

## 1. Modals & Forms

> Key files: `fe/src/components/SnarkProvingModal.tsx`

- [ ] 🟡 **Add cancellation guard to SnarkProvingModal on unmount**
  - **How**: In `SnarkProvingModal.tsx`, the `useEffect` at line 66 calls `generateProof()` which spawns a sidecar process via `prover.generateProof(inputs, ...)`. If the modal closes mid-proof (parent unmounts, navigation change), the async function continues and calls `setState` after unmount. Add a `cancelled` flag in the effect cleanup: `let cancelled = false; return () => { cancelled = true }`, then guard all `setState` calls inside `generateProof()` with `if (cancelled) return`. The sidecar process will finish naturally, but the component won't attempt state updates. Same pattern used in `DecryptModal.tsx` line 241.
  - **Why**: Prevents React "setState on unmounted component" warnings and avoids orphaned state updates if the user navigates away during the ~3 minute proof generation.

---

## 2. Accessibility

> Key files: `fe/src/components/PriceRangeSlider.tsx`, `fe/src/components/Badge.tsx`

- [ ] 🟢 **Add `role="group"` to PriceRangeSlider container**
  - **How**: In `PriceRangeSlider.tsx` line 31, the wrapping `<div>` contains two `<input type="range">` elements with individual `aria-label` attributes ("Minimum price" / "Maximum price") but no semantic grouping. Add `role="group"` and `aria-label="Price range filter"` to the outermost `<div>`.
  - **Why**: Screen readers don't associate the two range inputs as a single price range control. Users hear two independent sliders with no relationship.

- [ ] 🟢 **Add `aria-hidden` to Badge dot indicators**
  - **How**: In `Badge.tsx` lines 38–40, the colored dot `<span>` is decorative (the text label already conveys status). Add `aria-hidden="true"` to the dot span to prevent screen readers from announcing it as an empty element.
  - **Why**: Screen readers may announce the dot as a blank interactive element, adding noise without information.

---

## 3. Backend API & Resilience

> Key files: `be/src/services/encryptions.ts`, `be/src/services/bids.ts`, `be/src/index.ts`

- [ ] 🟢 **Fix PKH filtering to use exact match instead of substring match**
  - **How**: In `encryptions.ts` line 226, change `e.sellerPkh.toLowerCase().includes(pkh.toLowerCase())` to `e.sellerPkh.toLowerCase() === pkh.toLowerCase()`. Same fix in `bids.ts` line 176: change `b.bidderPkh.toLowerCase().includes(pkh.toLowerCase())` to `b.bidderPkh.toLowerCase() === pkh.toLowerCase()`. The `validate.ts` middleware already enforces that `pkh` is exactly 56 hex chars, so exact match is the correct semantic.
  - **Why**: Substring matching means a request with a partial PKH could return data belonging to other users. While the 56-char validation makes exploitation unlikely with the current middleware, the service layer should enforce exact semantics as defense-in-depth.

- [ ] 🟢 **Don't persist empty metadata to disk cache for missing tx hashes**
  - **How**: In `encryptions.ts` lines 179–182, the loop iterates over `uncachedHashes` (all hashes sent to Koios) instead of only the hashes that Koios actually returned. Change `for (const hash of uncachedHashes)` to `for (const [hash, entries] of metadataMap)` and adjust: `const cip20 = extractCip20FromMetadata(entries); metadataCache.set(hash, cip20)`. Same fix in `bids.ts` lines 129–131: change `for (const hash of uncachedHashes)` to `for (const [hash, entries] of metadataMap)` and `const cip20 = extractBidCip20FromMetadata(entries); bidMetadataCache.set(hash, cip20)`.
  - **Why**: Missing hashes get `{}` cached permanently in the disk cache. Since the cache treats on-chain metadata as immutable, these empty entries are never refreshed — even if Koios was temporarily behind and the metadata becomes available later. Listings permanently lose their description, price, and image.

- [ ] 🟢 **Flush metadata disk caches on Express shutdown**
  - **How**: In `be/src/index.ts`, import the metadata cache singletons from their respective service modules and call `.flush()` in `gracefulShutdown()` before `process.exit(0)`. The `MetadataDiskCache` uses debounced writes (5s default), so any metadata fetched within 5s of shutdown is lost without an explicit flush. Add: `import { metadataCache } from './services/encryptions.js'; import { bidMetadataCache } from './services/bids.js';` then in `gracefulShutdown`: `metadataCache.flush(); bidMetadataCache.flush();` before `server.close()`.
  - **Why**: Metadata fetched shortly before a restart is lost and must be re-fetched from Koios on the next cold start. With the disk cache meant to be permanent for immutable on-chain data, this causes unnecessary Koios load and slower startup.

---

## 4. Hooks & Lifecycle

> Key files: `fe/src/hooks/useUpdateCheck.ts`

- [ ] 🟢 **Fix event listener leak in useUpdateCheck on fast unmount**
  - **How**: In `useUpdateCheck.ts` lines 37–52, the `listen()` call returns a Promise. If the component unmounts before the promise resolves, `unlisten` is still `undefined` in the cleanup function, and the listener is never removed. Fix by tracking a `mounted` flag: `let mounted = true; listen(...).then(fn => { if (mounted) unlisten = fn; else fn() }); return () => { mounted = false; unlisten?.() }`.
  - **Why**: If the Settings page or Dashboard mounts and unmounts quickly (e.g., during rapid navigation), the Tauri event listener for `update-download-progress` is orphaned and continues receiving events with no cleanup path.

---

## Priority Guide

### Must-Have (blocks production readiness)
- Don't persist empty metadata to disk cache (S3) — permanently corrupts listing/bid display data

### Should-Have (significant UX/reliability improvement)
- Fix PKH substring matching (S3) — defense-in-depth against data leakage
- Flush metadata caches on shutdown (S3) — prevents data loss on restart
- Fix useUpdateCheck listener leak (S4) — memory leak on fast navigation
- SnarkProvingModal cancellation guard (S1) — prevents orphaned state updates

### Craft (the details that make users say "this is well built")
- PriceRangeSlider role="group" (S2) — screen reader semantics
- Badge dot aria-hidden (S2) — reduces screen reader noise
