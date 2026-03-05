---
name: implement
description: Implement improvements from video_goals.md by section number or name
argument-hint: <section-number-or-name>
---

# Implement Goals

Read `video_goals.md` and find the section matching "$ARGUMENTS" (by number, title, or keyword).

This skill is designed to be **resumable across context windows**. The checked/unchecked state of items in `video_goals.md` is the persistence mechanism — always read it fresh at the start of each session.

## Process

1. **Read video_goals.md** and extract all unchecked items (`- [ ]`) from the matching section. Skip any items already marked `- [x]` — those were completed in a previous session.
2. **Read CLAUDE.md** to refresh on architecture, conventions, and gotchas (modal two-effect pattern, 127.0.0.1 not localhost, WebKitGTK limitations, etc.)
3. **Decide on planning**: If the section has items that involve architectural changes, new state management, or multi-file coordination — enter plan mode. If the items are self-contained and well-defined (add a button, add a keyboard shortcut, write a test), skip planning and implement directly.
4. **Track your files**: Before you start implementing, initialize an empty list of files you have edited or created in this session. Every time you use the Edit or Write tool, add that file path to the list. This list determines what gets staged, tested, and committed.
5. **Implement** each item one at a time:
   a. **Read first**: Before writing any code, read the target file AND any similar existing implementations in the codebase. If video_goals.md says "add zoom like PdfViewer", read PdfViewer first. Match existing patterns rather than inventing new ones.
   b. Implement the change
   c. If the change involves new logic (helper functions, utilities, state transitions, parsing, etc.), write meaningful tests for it. Do not write tests that just assert the component renders — write tests that verify behavior and catch regressions.
   d. **Test only your files** — see Testing section below
   e. **Flag visual changes**: If the change affects UI (new buttons, layout changes, styling), explicitly tell the user "this needs visual review" with a description of what to look for. You cannot see the screen.
   f. Check off the item in video_goals.md (`- [x]`)
   g. **Commit only your files** — see Commit Discipline section below
6. Repeat step 5 for each item in the section
7. After all items are done, show a summary of what was implemented and list any items that need visual review

## Testing (Parallel-Agent Safe)

Multiple implement agents may run concurrently on different sections. **Never run `bash test.sh`** (full suite) or do git stash/pop — these interfere with parallel agents.

Instead, run tests **only for the files you changed**:

- For each test file that corresponds to a file you edited, run it individually with tail to capture the summary:
  ```
  cd fe && npx vitest run src/path/to/__tests__/YourFile.test.ts 2>&1 | tail -n 30
  ```
  ```
  cd be && npx vitest run src/path/to/__tests__/YourFile.test.ts 2>&1 | tail -n 30
  ```
- If you created a new test file, run that specific file.
- If you edited a service/component that has an existing test file, run that test file.
- For lint, run only on files you touched with tail for summary:
  ```
  cd fe && npx eslint src/path/to/YourFile.tsx 2>&1 | tail -n 30
  ```
  ```
  cd be && npx eslint src/path/to/YourFile.ts 2>&1 | tail -n 30
  ```
- Fix any failures in your specific files before proceeding.
- **Do not** run the full test suite, full lint, or any command that touches files outside your working set.
- If a test fails, re-run with full output (without tail) to see the complete error, then fix and re-run with tail to confirm the fix.

## Commit Discipline

- Commit after each completed sub-task, not at the end
- **Only stage files you edited or created in this session** — use `git add <file1> <file2> ...` with explicit paths from your tracked file list. Never use `git add -A`, `git add .`, or stage files you did not touch.
- Include `video_goals.md` in the commit (since you checked off items)
- Write descriptive commit messages that explain the "why"
- This gives a clean git history where any change can be reverted independently
- If `git status` shows other modified files you did not touch, **leave them alone** — another agent or the user is working on them

### Handling video_goals.md Conflicts

`video_goals.md` is the one file every implement agent modifies. If your commit fails because another agent changed `video_goals.md` since you last read it:

1. Re-read `video_goals.md` to get the latest version
2. Re-apply only your checkbox change (`- [ ]` → `- [x]` for the item you just completed)
3. Stage `video_goals.md` and retry the commit
4. Do not revert or overwrite another agent's checkbox changes

## Multi-Context-Window Resumability

This skill is designed to be invoked repeatedly with the same section argument across multiple context windows:

- **On start**: Read `video_goals.md` fresh. All `- [x]` items were completed previously — skip them. Pick up from the first unchecked `- [ ]` item.
- **On finish**: If you run out of context or the session ends, any unchecked items remain for the next invocation to pick up.
- **No external state needed**: `video_goals.md` checkboxes are the only coordination mechanism between sessions.

## Rules

- Only implement unchecked items — skip anything already marked `- [x]`
- Follow existing code patterns and conventions from CLAUDE.md
- Do not refactor unrelated code
- If a single item is too large, break it into sub-tasks and track with TodoWrite
- If an item is ambiguous, ask for clarification before implementing
- Always pipe test and lint output through `2>&1 | tail -n 30` so output is captured concisely
- Tests should be meaningful — verify actual behavior, edge cases, and error paths. Do not write trivial tests just to increase coverage.
- Always look for existing implementations of similar features before writing new code. Reuse patterns, don't reinvent them.
- Never run commands that affect the entire working tree (full test suite, git stash, git add -A) — other agents may be working in parallel
