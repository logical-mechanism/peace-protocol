---
name: update-gui-goals
description: Regenerate app/gui/goals.md with a fresh comprehensive analysis of the Veiled desktop app (excluding AudioPlayer and VideoPlayer internals)
---

# Update GUI Goals

Delete `goals.md` and regenerate it from scratch with a comprehensive analysis of every possible improvement across the Veiled desktop app. Do not carry over completed items or skipped items from the previous round — this is a fresh audit against the current state of the code.

**Design intent:** Veiled is a three-layer Tauri v2 desktop app for the PEACE Protocol encrypted data marketplace. The frontend uses React 19 + Vite + Tailwind v4. The backend is Express v5. The core is Rust (Tauri). Suggestions should feel native to a polished desktop application — not a web-first SPA.

**Scope:** Everything EXCEPT AudioPlayer.tsx and VideoPlayer.tsx component internals — those have dedicated skills (`update-audio-goals`, `update-video-goals`). Integration points with media players ARE in scope (e.g., how LibraryContentModal launches them, how data is passed to them, format detection).

## Process

1. **Read CLAUDE.md** to understand the current architecture, conventions, and gotchas
2. **Read the current goals.md** (if it exists) to understand what was previously identified — but do NOT preserve it. The output is a clean slate. Note any items marked `[s]` (skipped) — these were intentionally declined and must NOT be re-suggested in the new goals.
3. **Launch parallel Explore subagents** (all "very thorough") to audit the app:

   **Agent 1 — Frontend UX (tabs, modals, cards, overlays, pages):**
   - Read all tab components: `MarketplaceTab.tsx`, `MySalesTab.tsx`, `MyPurchasesTab.tsx`, `HistoryTab.tsx`, `LibraryTab.tsx`
   - Read all modal components: `CreateListingModal.tsx`, `PlaceBidModal.tsx`, `BidsModal.tsx`, `DecryptModal.tsx`, `SnarkProvingModal.tsx`, `SnarkDownloadModal.tsx`, `LibraryContentModal.tsx`, `ConfirmModal.tsx`, `DescriptionModal.tsx`
   - Read all card components: `EncryptionCard.tsx`, `SalesListingCard.tsx`, `MyPurchaseBidCard.tsx`, `LibraryCard.tsx`, `ListingImage.tsx`
   - Read overlays and banners: `OnboardingOverlay.tsx`, `KeyboardShortcutsOverlay.tsx`, `ShutdownOverlay.tsx`, `OfflineBanner.tsx`, `SessionWarningBanner.tsx`
   - Read `Toast.tsx`, `ErrorBoundary.tsx`
   - Read all pages: `Dashboard.tsx`, `Settings.tsx`, `WalletSetup.tsx`, `WalletUnlock.tsx`, `NodeSync.tsx`
   - Read Dashboard extracted hooks: `useBuyerActions.ts`, `useSellerActions.ts`, `useDashboardEffects.ts`
   - Do NOT read AudioPlayer.tsx or VideoPlayer.tsx internals
   - Identify gaps using this checklist:
     - **Marketplace**: Search/filter UX, sorting, pagination, empty states, loading states, error recovery, card interaction patterns, favorite toggling, refresh behavior
     - **Modals**: Form validation quality, error display, unsaved-changes handling, loading/submitting states, keyboard accessibility (Escape, Tab trapping), visual consistency across all modals
     - **Cards**: Information density, truncation handling, hover states, action affordances, grid/compact mode consistency
     - **History**: Transaction status display, confirmation tracking, stale data handling, clear history flow
     - **Library**: File management UX, select mode, delete confirmation, export flow, content modal integration (how it opens players/viewers)
     - **Create listing**: Multi-step flow, draft recovery, file upload progress, validation feedback, Iagon auth flow
     - **Settings**: Section organization, search/filter, toggle behaviors, destructive action confirmations
     - **Pages**: Wallet setup/unlock flow, node sync progress display, dashboard layout, routing guards
     - **Overlays/Banners**: Onboarding flow, offline detection, session warnings, shutdown UX
     - **Toast**: Consistency of usage across the app, duration appropriateness, action buttons

   **Agent 2 — Backend + Rust Core:**
   - Read all routes: `encryptions.ts`, `bids.ts`, `protocol.ts`, `chain.ts`, and the routes `index.ts`
   - Read all services: `encryptions.ts`, `bids.ts`, `kupo.ts`, `koios.ts`, `parsers.ts`, `cache.ts`, `circuitBreaker.ts`, `fetchWithRetry.ts`, `health.ts`, `logger.ts`, `cbor.ts`, `metadataDiskCache.ts`
   - Read all middleware: `validate.ts`, `pagination.ts`, `requestLogger.ts`, `timeout.ts`
   - Read `app.ts` and `be/src/index.ts`
   - Read Tauri core: `lib.rs`, `config.rs`
   - Read process management: `manager.rs`, `cardano.rs`, `ogmios.rs`, `kupo.rs`, `express.rs`, `mithril.rs`, `cardano_cli.rs`
   - Read commands: `secrets.rs`, `wallet.rs`, `node.rs`, `snark.rs`, `media.rs`, `iagon.rs`, `kupo_proxy.rs`, `chain.rs`
   - Read crypto: `wallet.rs`, `secrets.rs`, `audit.rs`, `migration.rs`
   - Identify gaps using this checklist:
     - **API routes**: Response consistency, error shapes, missing validation, edge cases in datum parsing, pagination correctness, stub/production alignment
     - **Resilience**: Circuit breaker tuning, cache TTLs, retry behavior, stale data transparency to frontend
     - **Process management**: Restart reliability, orphan cleanup, health checks for all processes, log buffer overflow, shutdown ordering
     - **Security**: Secret lifecycle (creation, access, deletion, zeroization), IPC command input validation, file path traversal protections, env var handling
     - **Config**: Consistency between stub and production modes, environment variable validation
     - **Media server**: Range request edge cases, MIME type coverage, directory traversal prevention

   **Agent 3 — Design System, Accessibility, Testing, CI/CD:**
   - Read `fe/src/index.css` (CSS variables, theme tokens, animations)
   - Read `fe/src/fonts.css`
   - Read UI primitives: `InfoTooltip.tsx`, `Badge.tsx`, `LoadingSpinner.tsx`, `DelayedSpinner.tsx`, `EmptyState.tsx`, `EmptyStateIllustrations.tsx`, `SkeletonCard.tsx`, `ScrollToTop.tsx`, `HighlightText.tsx`, `TransactionLink.tsx`, `MnemonicInput.tsx`, `PasswordStrengthIndicator.tsx`, `PriceRangeSlider.tsx`, `RefreshIndicator.tsx`, `BidTimeline.tsx`
   - Read hooks: `useFocusTrap.ts`, `useModalStack.ts`, `useAsyncAction.ts`, `useDataRefresh.ts`, `useTabFilterState.ts`, `useWalletHealth.ts`
   - Read `errorMessages.ts`, `themeStorage.ts`
   - Read `.github/workflows/` (all CI files)
   - Read `app/gui/test.sh`, `app/gui/lint.sh`
   - Read `fe/vite.config.ts` and `be/vitest.config.ts` (coverage configs)
   - Spot-check 3-4 test files from `fe/src/components/__tests__/` to assess test quality patterns
   - Identify gaps using this checklist:
     - **Design system**: CSS variable completeness (dark + light), token naming consistency, spacing/radius/shadow tokens used consistently, animation patterns, font usage
     - **Accessibility**: Focus management across modals, ARIA attributes on interactive elements, screen reader announcements, keyboard navigation completeness, color contrast, focus indicators
     - **Testing**: Coverage gaps (untested components/services/hooks), test quality (behavioral vs trivial render-only tests), mock patterns, factory completeness
     - **CI/CD**: Workflow correctness (paths, steps), coverage enforcement, lint enforcement, build validation

4. **Synthesize findings** from all agents into a single `goals.md` file. Cross-reference between agents to eliminate duplicates. If an area has no genuine issues, do not pad it with filler items.

## Output Format

Write `goals.md` with this structure:

```markdown
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

1. [Section Name](#1-section-name)
...

---

## N. Section Name

> Key files: `relevant/file/paths`

- [ ] 🟢 **Feature or improvement title**
  - **How**: Concrete implementation approach with file paths, function names, patterns to follow. Should be detailed enough that a developer can start coding without further research.
  - **Why**: 1-2 sentences explaining the user-facing or developer-facing value.

---

## Priority Guide

### Must-Have (blocks production readiness)
- ...

### Should-Have (significant UX/reliability improvement)
- ...

### Nice-to-Have (polish and delight)
- ...

### Craft (the details that make users say "this is well built")
- ...

### Infrastructure (developer productivity)
- ...
```

## Section Categories

Organize items into these sections (merge or split as findings dictate). If a section has no genuine issues, omit it entirely.

1. Marketplace
2. Modals & Forms
3. History & Transactions
4. Library
5. Settings
6. Error Handling & User Feedback
7. Design System & Styling
8. Accessibility
9. Backend API & Resilience
10. Rust Core & Security
11. Testing
12. CI/CD

## Quality Standards

- **Every item must reference specific files** — no vague "improve the app" items
- **How sections must be actionable** — describe the approach concretely enough that a developer can start implementing without ambiguity
- **No duplicates** — each improvement appears exactly once in the most relevant section
- **Verify before suggesting** — read the actual code to confirm something is missing before adding it as a goal. Do not guess based on file names alone. If the component already handles a state/feature, do not suggest adding it
- **Specific over generic** — "Add `title={encryption.tokenName}` to the `<span>` at line 261" is better than "Improve tooltips". Name the file, the line, the prop
- **User-observable value** — every item should describe a change that a user would notice. Internal refactors must explain the observable benefit
- **Meaningful and useful** — every item must make the application genuinely better. No padding, no filler. If you can't articulate why a user or developer would care, don't include it
- **Do NOT include AudioPlayer or VideoPlayer internals** — those have dedicated skills. Only include integration-boundary items (how the app launches/passes data to those components)

## Rules

- Delete the existing `goals.md` before writing — this is always a fresh analysis
- Do NOT carry over checked items (`[x]`) from the previous `goals.md`
- Do NOT carry over skipped items (`[s]`) from the previous `goals.md` — these were intentionally declined and must not reappear
- Do NOT add items that are already implemented in the codebase — verify by reading the actual code
- Do NOT pad sections — if a section has no real issues, omit it or include only 1-2 genuine items. Quality over quantity
- Match the terse, reference-style tone of CLAUDE.md
- Include every genuine finding — no artificial item count target. Let the findings emerge naturally from the current state of the code
- Run the Explore agents in parallel to minimize wall-clock time
- After writing, count the total items with `grep -c '^\- \[ \]'` and report the count
- Report per-difficulty breakdown: `grep -c '🟢'`, `grep -c '🟡'`, `grep -c '🔴'`
