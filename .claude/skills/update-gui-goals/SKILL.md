---
name: update-gui-goals
description: Regenerate app/gui/goals.md with a fresh comprehensive analysis of the entire Veiled Desktop App
---

# Update GUI Goals

Delete `goals.md` and regenerate it from scratch with a comprehensive analysis of every possible improvement across the Veiled Desktop App. Do not carry over completed items or skipped items from the previous round — this is a fresh audit.

## Process

1. **Read CLAUDE.md** to understand the current architecture, conventions, and gotchas
2. **Read the current goals.md** (if it exists) to understand what was previously identified — but do NOT preserve it. The output is a clean slate. Note any items marked `[s]` (skipped) — these were intentionally declined and must NOT be re-suggested in the new goals.
3. **Launch four parallel Explore subagents** (all "very thorough") to audit the codebase:

   **Agent 1 — Frontend UI/UX:**
   - Read every page component (WalletSetup, WalletUnlock, NodeSync, Dashboard, Settings)
   - Read every component, modal, card, tab, and viewer
   - Read index.css, fonts.css for design system gaps
   - Read all services, hooks, contexts, utils, config
   - Identify gaps using this checklist:
     - **State completeness**: Every async operation must have 4 states — loading, success, error, empty. Check every fetch call, every invoke(), every form submission. Flag any that are missing states.
     - **Interaction feedback**: Every clickable element needs hover, active, focus, and disabled visual states. Check buttons, cards, links, tabs, icons. Flag flat/dead-feeling interactions.
     - **Visual hierarchy**: Each view should have clear primary action, secondary actions, and tertiary actions distinguished by size, color, and weight. Flag views where everything has equal visual weight.
     - **Form UX**: Inline validation on blur (not just on submit), helpful placeholder text, clear error placement next to the field, proper tab order, auto-focus on first field when modal opens. Check every form and modal.
     - **Empty states**: Every list/grid must handle zero items with helpful guidance (illustration + explanation + CTA). Check Marketplace, My Sales, My Purchases, History, Library when empty.
     - **Loading states**: Prefer skeleton screens over spinners for content areas. Spinners acceptable only for actions (button loading). Check every data-loading view.
     - **Confirmation dialogs**: Every destructive action (delete, cancel, remove) needs confirmation with clear consequence description. Check all delete/cancel/remove flows.
     - **Truncation & overflow**: Long text (addresses, descriptions, filenames) must truncate gracefully with tooltip showing full value. Check every place user-generated or on-chain text is displayed.
     - **Keyboard navigation**: Tab order follows visual layout. Enter activates focused element. Escape closes modals/menus. Arrow keys navigate lists. Check every interactive view.
     - **Responsive layout**: Window resize from 1280x800 down to 1024x600 should remain usable. Check for overflow, text wrapping, and layout breakage at smaller sizes.
     - **Content tone**: Headings, labels, empty states, and error messages should use consistent voice — concise, helpful, never blaming the user. Flag any "Error occurred" or "Something went wrong" without next-step guidance.
     - **Contextual help**: Complex features (SNARK proving, BLS crypto, Iagon storage) should have inline explanations or info tooltips for non-expert users. Check if domain-specific terms are explained anywhere.
     - **Input constraints**: Number inputs should have min/max, text inputs should have maxLength where appropriate, file inputs should validate size/type before upload. Check every input.

   **Agent 2 — Backend + Rust Core:**
   - Read all Express routes, services, middleware, types, config
   - Read all Tauri commands, process managers, crypto modules, config
   - Read tauri.conf.json, capabilities, resources/config.json
   - Identify gaps using this checklist:
     - **Validation coverage**: Every route param, query param, and request body field must be validated. Check for missing validators beyond pkh/tokenName/txHash. Flag any raw `req.params` or `req.query` usage without validation.
     - **Error response consistency**: Every error response must use `{ error: { code, message } }` format. Check all catch blocks and error paths for responses that don't match this shape.
     - **API design**: Response shapes should be consistent across similar endpoints. Pagination applied uniformly. Sorting options documented. Check for inconsistencies between route groups.
     - **Tauri command safety**: All `invoke` handlers must validate inputs before processing. Check for path traversal in file operations, injection in shell commands, integer overflow in numeric params.
     - **Resource cleanup**: Check for file handles, temp files, and child processes that could leak on error paths. Every `tempfile::NamedTempFile` and `tokio::process::Command` should have cleanup on all code paths.
     - **Atomic operations**: Multi-step operations (write secret + delete old) should be atomic or have recovery. Check for partial-failure scenarios that could leave inconsistent state.
     - **Race conditions**: Concurrent requests to the same resource (e.g., two tabs placing bids simultaneously) should be handled. Check for TOCTOU issues in file operations and state mutations.
     - **Graceful degradation**: When Kupo, Koios, or Iagon are unreachable, the app should clearly communicate what's unavailable rather than showing cryptic errors. Check error propagation from services to UI.
     - **Secret handling**: Secrets in memory should have defined lifetimes. Check for secrets lingering in log output, error messages, or debug strings. Verify zeroization on lock.

   **Agent 3 — Testing + Build + CI/CD + DevEx:**
   - List all test files, identify what's NOT tested (components, pages, contexts, routes)
   - Read build.sh, run.sh, lint.sh, test.sh, check-prereqs.sh
   - Read CI pipeline (.github/workflows/ci.yml)
   - Read package.json files, tsconfig, eslint configs, Cargo.toml
   - Read CHANGELOG.md, CONTRIBUTING.md
   - Identify gaps using this checklist:
     - **Untested components**: Cross-reference `fe/src/components/` against `fe/src/components/__tests__/`. Every user-facing component should have at least a render test. Flag all untested components by name.
     - **Untested pages**: Check coverage for WalletSetup, WalletUnlock, NodeSync, Dashboard, Settings page components.
     - **Untested services**: Cross-reference `fe/src/services/` against `fe/src/services/__tests__/`. Flag all untested services.
     - **Error path testing**: Tests should cover error/failure scenarios, not just happy paths. Check for tests that mock network failures, invalid inputs, timeout scenarios.
     - **Integration test gaps**: Check for end-to-end flow tests (create listing → place bid → accept → decrypt). Flag missing multi-step workflow tests.
     - **Build reliability**: Check for flaky tests, missing test isolation, shared mutable state between tests.
     - **CI pipeline**: Check for missing steps — type checking, linting, test coverage reporting, build verification, Rust clippy/fmt.
     - **Developer onboarding**: Could a new developer run the app from a fresh clone? Check for missing setup documentation, undocumented prerequisites, unclear error messages from check-prereqs.sh.

   **Agent 4 — Professional Polish & Craft:**
   - Read the app from a user's perspective: page by page, flow by flow
   - Read index.css for design token completeness and consistency
   - Read every component's styling for visual consistency
   - Read all user-facing text strings across the app
   - Audit against these professional quality signals:
     - **Typography hierarchy**: Is there a clear and consistent scale? Headings (h1-h4), body, caption, label, monospace — each with defined size, weight, line-height. Check if components follow the scale or use arbitrary values.
     - **Spacing consistency**: Are margins and paddings using the `--space-*` tokens consistently? Flag any hardcoded px/rem values that should use tokens.
     - **Color contrast**: Do all text/background combinations meet WCAG AA (4.5:1 for body, 3:1 for large text)? Check both dark and light themes. Pay special attention to muted/secondary text colors.
     - **Focus indicators**: Are focus rings visible on all interactive elements? Are they styled consistently? Do they work in both themes? Flag any `:focus` without a visible indicator.
     - **Transition consistency**: Are hover/active/open transitions using the `--transition-*` tokens? Flag any abrupt state changes that should animate, and any inconsistent durations.
     - **Icon and visual consistency**: Are all icons from the same family/style? Are icon sizes consistent for similar contexts? Are illustrations consistent in style?
     - **Copy quality**: Are labels, headings, and messages concise and consistent in tone? Do CTAs use action verbs? Are technical terms explained? Flag any jargon, passive voice in actions, or inconsistent capitalization.
     - **Number and data formatting**: Are ADA amounts formatted consistently (decimal places, units)? Are dates relative ("2 hours ago") for recent and absolute for old? Are large numbers formatted with separators? Are byte sizes human-readable?
     - **Progressive disclosure**: Is complex information revealed in layers (summary → details → raw data)? Check transaction details, encryption info, SNARK proof output.
     - **Perceived performance**: Are there optimistic updates where safe? Do skeleton screens match the final layout shape? Is there a stale-while-revalidate pattern for cached data?
     - **Delight details**: Subtle touches that signal craft — smooth page transitions, meaningful loading animations, satisfying button feedback, well-timed toast notifications, thoughtful empty states with personality.

4. **Synthesize findings** from all four agents into a single goals.md file. Cross-reference between agents to eliminate duplicates. If an agent finds nothing meaningful for a section, that section is healthy — do not pad it with filler items.

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
[numbered list of all sections]

---

## N. Section Name

> Key files: `relevant/file/paths`

- [ ] 🟢 **Feature or improvement title**
  - **How**: Concrete implementation approach with file paths, function names, patterns to follow. Should be detailed enough that a developer can start coding without further research.
  - **Why**: 1-2 sentences explaining the user-facing or developer-facing value.

---

## Priority Guide

### Must-Have (blocks production readiness)
### Should-Have (significant UX/reliability improvement)
### Nice-to-Have (polish and delight)
### Craft (the details that make users say "this is well built")
### Infrastructure (developer productivity)
```

## Section Categories

Organize items into these approximate sections (merge or split as the findings dictate). If thorough auditing reveals nothing meaningful for a section, omit it — an empty section signals health, not a gap to fill.

1. Onboarding & First-Run Experience
2. Wallet & Authentication
3. Node Sync & Process Management
4. Dashboard & Navigation
5. Marketplace Tab
6. My Sales Tab
7. My Purchases Tab
8. History Tab
9. Library Tab
10. Create Listing Modal
11. Place Bid Modal
12. Media Viewers (PDF, Image, Audio, Video)
13. Settings Page
14. Notifications & Alerts
15. Design System & Styling
16. Animations & Micro-Interactions
17. Accessibility
18. Error Handling & User Feedback
19. Performance
20. Backend API
21. Rust Core & Security
22. Testing
23. Developer Experience & Tooling
24. Documentation & CI/CD

## Quality Standards

- **Every item must reference specific files** — no vague "improve the UI" items
- **How sections must be actionable** — describe the approach concretely enough that a developer can start implementing without ambiguity
- **Range from small to large** — include quick wins (add an aria-label) alongside big features (auto-updater). Tag each item with a difficulty rating: 🟢 Small, 🟡 Medium, or 🔴 Large
- **No duplicates** — each improvement appears exactly once in the most relevant section
- **Verify before suggesting** — read the actual code to confirm something is missing before adding it as a goal. Do not guess based on file names alone. If a component already handles loading/error/empty states, do not suggest adding them
- **Specific over generic** — "Add `aria-label` to the copy-address button in `WalletUnlock.tsx:42`" is better than "Improve accessibility". Name the file, the line range, the component, the prop
- **User-observable value** — every item should describe a change that a user or developer would notice. Internal refactors must explain the observable benefit (faster load, fewer bugs, better errors)
- **Priority guide** selects the ~6 most important items per tier from across all sections. The new "Craft" tier captures polish items that separate a good app from a great one — subtle transitions, satisfying feedback, thoughtful copy, consistent formatting

## Rules

- Delete the existing goals.md before writing — this is always a fresh analysis
- Do NOT carry over checked items (`[x]`) from the previous goals.md
- Do NOT carry over skipped items (`[s]`) from the previous goals.md — these were intentionally declined and must not reappear
- Do NOT add items that are already implemented in the codebase — verify by reading the actual code
- Do NOT pad sections — if a section has no real issues, omit it or include only 1-2 genuine items. Quality over quantity
- Match the terse, reference-style tone of CLAUDE.md
- Aim for 80-130 items total — be comprehensive but not padded
- Run the four Explore agents in parallel to minimize wall-clock time
- After writing, count the total items with `grep -c '^\- \[ \]'` and report the count
- Report per-difficulty breakdown: `grep -c '🟢'`, `grep -c '🟡'`, `grep -c '🔴'` — aim for roughly 40% small, 40% medium, 20% large
