---
name: update-claude-gui
description: Update app/gui/CLAUDE.md to match the current codebase state
---

# Update CLAUDE.md for GUI

Review `app/gui/CLAUDE.md` against the actual current state of the `app/gui/` codebase and update the file to be accurate.

## Process

1. **Read CLAUDE.md** in full — understand every section and claim it makes
2. **Explore the codebase** in parallel using Explore subagents to audit each layer:
   - **Frontend (fe/)**: Glob all files under `fe/src/` — check every directory (services/, components/, hooks/, contexts/, pages/, utils/, config/, test/). Compare file lists against what CLAUDE.md documents. Read `main.tsx` for provider nesting, `App.tsx` for routing, `package.json` for versions/deps.
   - **Backend (be/)**: Glob all files under `be/src/` — check routes/, services/, middleware/, types/, stubs/. Read `app.ts` for middleware chain, `routes/index.ts` for route registration, `package.json` for versions.
   - **Tauri (src-tauri/)**: Read `src/lib.rs` for registered commands (count `commands::` lines in `generate_handler!`), `commands/mod.rs` for modules, `Cargo.toml` for version, `tauri.conf.json` for app config. Check `src/commands/` and `src/process/` for any new files.
   - **Root level**: Check for new/changed shell scripts (build.sh, run.sh, lint.sh, test.sh, check-prereqs.sh, etc.) and root package.json scripts.
3. **Diff against CLAUDE.md** — identify every discrepancy:
   - **Factually wrong statements** (e.g., wrong counts, "No X" when X now exists, outdated descriptions)
   - **Missing files/directories** not listed in the Directory Structure tree
   - **Missing services, hooks, components, utils** not mentioned anywhere
   - **Outdated section content** (stale line counts, old provider nesting, missing contexts)
   - **Missing test locations** in the Development Workflow section
   - **Missing gotchas** in the Conventions & Gotchas section
4. **Apply all edits** to CLAUDE.md section by section using the Edit tool. Use TodoWrite to track progress through sections:
   - Directory Structure
   - Frontend Patterns
   - Backend Patterns
   - Iagon Decentralized Storage
   - Tauri/Rust Core
   - Key Types
   - API Surface
   - Development Workflow
   - Common Modification Patterns
   - Conventions & Gotchas
5. **Verify** — re-read the updated file to confirm consistency

## What to check in each section

**Directory Structure:**
- Every file listed actually exists; no files listed that were deleted
- New files/directories are included with accurate one-line descriptions
- Comments on directory lines match current contents (context names, hook names, util names)
- Line counts on large files (e.g., transactionBuilder.ts) are current — run `wc -l` to verify

**Frontend Patterns:**
- Context count and descriptions match actual `contexts/` directory
- Provider nesting in main.tsx matches the documented order
- Component hierarchy lists all component categories
- Local storage list includes all *Storage.ts files and autolock.ts
- Styling description mentions all CSS files and token categories
- Hook names listed match actual `hooks/` directory

**Backend Patterns:**
- Route groups list all endpoints (check each route file)
- Health endpoint description matches actual response shape
- Error handling description is accurate (middleware, resilience, retry)
- Middleware section lists all middleware files

**Tauri/Rust Core:**
- Process shutdown timeouts are accurate per process
- Plugin list matches `lib.rs` setup

**API Surface:**
- Command count matches actual `commands::` lines in `generate_handler!` — recount, don't guess
- All command groups are listed with correct command names
- Tauri events list is complete

**Development Workflow:**
- Dev start command reflects current `run.sh` behavior
- Test locations list every `__tests__/` directory with file counts
- Build/lint/test script descriptions match actual script contents

**Common Modification Patterns:**
- Code examples use correct import paths and patterns from the actual codebase
- No outdated API references

**Conventions & Gotchas:**
- No statements that contradict the current code (e.g., "No X" when X exists)
- New patterns/gotchas discovered during exploration are added

## Rules

- Do NOT add speculative content — only document what verifiably exists in code
- Do NOT change the overall structure/ordering of CLAUDE.md sections
- Do NOT add prose or commentary — match the terse, reference-style tone
- Keep descriptions to one line where possible
- Use `wc -l` for line counts, `grep | wc -l` for command counts — don't estimate
- If something was removed from the codebase, remove it from CLAUDE.md
- Run parallel Explore agents to minimize wall-clock time
- After all edits, read the final file to catch inconsistencies
