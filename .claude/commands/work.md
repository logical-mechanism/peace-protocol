---
name: work
description: Pick up a feature from the project board and implement it
argument-hint: "[keyword or draft title]"
---

# Work on a Feature

Pick up a draft from the **Veiled Application** GitHub Project board and implement it following the embedded Claude Prompt. Work directly with project board drafts — no GitHub issues.

## Project Board Constants

- **Project number:** 5
- **Owner:** logical-mechanism
- **Repo:** logical-mechanism/Peace-Protocol
- **Project node ID:** PVT_kwDOCrNGAc4BT-hV
- **Status field ID:** PVTSSF_lADOCrNGAc4BT-hVzhBJw4k
  - Todo: `f75ad846`
  - In progress: `47fc9ee4`
  - Next release: `c44a314e`
  - Done: `98236657`

## Phase 1: Select a Draft

List all Todo items from the board:

```bash
gh project item-list 5 --owner logical-mechanism --format json -L 999
```

Filter the results to items with Status = "Todo".

- If `$ARGUMENTS` is provided, match it against draft titles (case-insensitive substring match). If exactly one match, use it. If multiple matches, show them and ask the user to pick.
- If `$ARGUMENTS` is empty, show all Todo items as a numbered list and ask the user to pick one.

If there are no Todo items, tell the user and suggest running `/create-feature`.

## Phase 2: Move to In Progress

Set the selected draft item to "In Progress":

```bash
gh project item-edit --project-id PVT_kwDOCrNGAc4BT-hV --id <DRAFT_ITEM_ID> --field-id PVTSSF_lADOCrNGAc4BT-hVzhBJw4k --single-select-option-id 47fc9ee4
```

Extract the title and body from the selected draft item for use in later phases.

## Phase 3: Branch Setup

Create and checkout a feature branch from `dev`:

```bash
git checkout dev
git pull origin dev
git checkout -b feature/<short-kebab-name>
```

The short kebab name should be derived from the draft title (e.g., "Subcategories with NSFW filtering" → `feature/subcategory-nsfw-filtering`). Keep it under 50 chars.

## Phase 4: Extract and Execute the Prompt

Read the draft body and extract the content between `## Claude Prompt` and the next `##` heading (or end of body).

Before executing:
1. Read `app/gui/CLAUDE.md` to refresh on project conventions
2. Read any files mentioned in the prompt to understand current state

Then execute the prompt, working through the `## Tasks` checklist in order.

### For Each Task

1. **Implement** the task
2. **Test** — run only tests for files you changed:
   ```bash
   cd app/gui/fe && npx vitest run src/path/to/__tests__/YourFile.test.ts 2>&1 | tail -n 30
   ```
   ```bash
   cd app/gui/be && npx vitest run src/path/to/__tests__/YourFile.test.ts 2>&1 | tail -n 30
   ```
3. **Lint** — only files you touched:
   ```bash
   cd app/gui/fe && npx eslint src/path/to/YourFile.tsx 2>&1 | tail -n 30
   ```
4. **Commit** — stage only files you changed:
   ```bash
   git add <file1> <file2> ...
   git commit -m "$(cat <<'EOF'
   feat: description of what this task accomplished

   Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

### Task Failure

If a test or lint fails:
- Re-run with full output (no tail) to see the complete error
- Fix the issue
- Re-run tests to confirm
- Include the fix in the same commit as the task

If a task is blocked or ambiguous, ask the user before proceeding.

## Phase 5: Completion

When all tasks are done:

1. **Push the branch:**
   ```bash
   git push -u origin feature/<short-name>
   ```

2. **Create a PR:**
   ```bash
   gh pr create --repo logical-mechanism/Peace-Protocol --base dev --title "<draft title>" --body "$(cat <<'EOF'
   ## Summary
   <bullet points summarizing what was implemented>

   ## Test plan
   - [ ] Visual review of UI changes (if applicable)
   - [ ] Run `bash test.sh` for full suite
   - [ ] Manual testing in dev mode

   Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )"
   ```

3. **Move board item to "Next release":**
   ```bash
   gh project item-edit --project-id PVT_kwDOCrNGAc4BT-hV --id <ITEM_ID> --field-id PVTSSF_lADOCrNGAc4BT-hVzhBJw4k --single-select-option-id c44a314e
   ```

4. **Report** the PR URL and a summary of what was implemented.

## Rules

- Never run `git add -A` or `git add .` — stage explicit files only
- Never run the full test suite (`bash test.sh`) — test only changed files
- Never skip tests with `--no-verify`
- Commit after each task, not in batches
- Follow all conventions from `CLAUDE.md` (127.0.0.1 not localhost, modal two-effect pattern, etc.)
- If a task says "needs visual review", flag it to the user
- Don't refactor code outside the scope of the tasks
- If the prompt references files, read them before implementing — don't guess at current state
- The `## Claude Prompt` is your primary instruction set — follow it faithfully
- Ask the user if anything is unclear rather than making assumptions
