---
name: update-gui-goals
description: Regenerate app/gui/goals.md with a fresh comprehensive analysis of the entire Veiled Desktop App
---

# Update GUI Goals

Delete `goals.md` and regenerate it from scratch with a comprehensive analysis of every possible improvement across the Veiled Desktop App. Do not carry over completed items from the previous round — this is a fresh audit.

## Process

1. **Read CLAUDE.md** to understand the current architecture, conventions, and gotchas
2. **Read the current goals.md** (if it exists) to understand what was previously identified — but do NOT preserve it. The output is a clean slate.
3. **Launch three parallel Explore subagents** (all "very thorough") to audit the codebase:

   **Agent 1 — Frontend UI/UX:**
   - Read every page component (WalletSetup, WalletUnlock, NodeSync, Dashboard, Settings)
   - Read every component, modal, card, tab, and viewer
   - Read index.css, fonts.css for design system gaps
   - Read all services, hooks, contexts, utils, config
   - Identify: missing loading states, missing error handling, accessibility gaps, missing animations, inconsistent styling, missing search/filter/sort, missing keyboard navigation, missing tooltips, responsive issues, missing empty states, missing confirmations

   **Agent 2 — Backend + Rust Core:**
   - Read all Express routes, services, middleware, types, config
   - Read all Tauri commands, process managers, crypto modules, config
   - Read tauri.conf.json, capabilities, resources/config.json
   - Identify: missing validation, missing error codes, missing pagination, missing caching, missing circuit breakers, missing health checks, security issues, missing timeouts, missing graceful shutdown, missing audit logging

   **Agent 3 — Testing + Build + CI/CD + DevEx:**
   - List all test files, identify what's NOT tested (components, pages, contexts, routes)
   - Read build.sh, run.sh, lint.sh, test.sh, check-prereqs.sh
   - Read CI pipeline (.github/workflows/ci.yml)
   - Read package.json files, tsconfig, eslint configs, Cargo.toml
   - Read CHANGELOG.md, CONTRIBUTING.md
   - Identify: test coverage gaps, missing CI jobs, missing documentation, missing developer tooling (prettier, pre-commit hooks, hot-reload), missing automation

4. **Synthesize findings** from all three agents into a single goals.md file

## Output Format

Write `goals.md` with this structure:

```markdown
# Veiled Desktop App — Goals & Improvements

A comprehensive backlog for making Veiled exceptional. Pick any item, implement it, check it off, and submit a PR.

Each item has:
- **What**: A brief description of the feature or improvement
- **How**: Implementation ideas and key files involved
- **Why**: The value it provides

---

## Table of Contents
[numbered list of all sections]

---

## N. Section Name

> Key files: `relevant/file/paths`

- [ ] **Feature or improvement title**
  - **How**: Concrete implementation approach with file paths, function names, patterns to follow. Should be detailed enough that a developer can start coding without further research.
  - **Why**: 1-2 sentences explaining the user-facing or developer-facing value.

---

## Priority Guide

### Must-Have (blocks production readiness)
### Should-Have (significant UX/reliability improvement)
### Nice-to-Have (polish and delight)
### Infrastructure (developer productivity)
```

## Section Categories

Organize items into these approximate sections (merge or split as the findings dictate):

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
- **Range from small to large** — include quick wins (add an aria-label) alongside big features (light theme, auto-updater)
- **No duplicates** — each improvement appears exactly once in the most relevant section
- **Priority guide** selects the ~6 most important items per tier from across all sections

## Rules

- Delete the existing goals.md before writing — this is always a fresh analysis
- Do NOT carry over checked items from the previous goals.md
- Do NOT add items that are already implemented in the codebase — verify by reading the actual code
- Match the terse, reference-style tone of CLAUDE.md
- Aim for 80-130 items total — be comprehensive but not padded
- Run the three Explore agents in parallel to minimize wall-clock time
- After writing, count the total items with `grep -c '^\- \[ \]'` and report the count
