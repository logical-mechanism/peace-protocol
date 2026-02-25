---
name: implement
description: Implement improvements from goals.md by section number or name
argument-hint: <section-number-or-name>
---

# Implement Goals

Read `goals.md` and find the section matching "$ARGUMENTS" (by number, title, or keyword).

## Process

1. **Read goals.md** and extract all unchecked items (`- [ ]`) from the matching section
2. **Read CLAUDE.md** to refresh on architecture, conventions, and gotchas (modal two-effect pattern, 127.0.0.1 not localhost, WebKitGTK limitations, etc.)
3. **Decide on planning**: If the section has items that involve architectural changes, new state management, or multi-file coordination — enter plan mode. If the items are self-contained and well-defined (add a button, add a keyboard shortcut, write a test), skip planning and implement directly.
4. **Implement** each item one at a time:
   a. **Read first**: Before writing any code, read the target file AND any similar existing implementations in the codebase. If goals.md says "add zoom like PdfViewer", read PdfViewer first. Match existing patterns rather than inventing new ones.
   b. Implement the change
   c. If the change involves new logic (helper functions, utilities, state transitions, parsing, etc.), write meaningful tests for it. Do not write tests that just assert the component renders — write tests that verify behavior and catch regressions.
   d. Run `bash test.sh 2>&1` and `bash lint.sh 2>&1` — fix any failures before proceeding
   e. **Flag visual changes**: If the change affects UI (new buttons, layout changes, styling), explicitly tell the user "this needs visual review" with a description of what to look for. You cannot see the screen.
   f. Check off the item in goals.md (`- [x]`)
   g. Stage the relevant files and commit with a descriptive message summarizing what was implemented
5. Repeat step 4 for each item in the section
6. After all items are done, show a summary of what was implemented and list any items that need visual review

## Commit Discipline

- Commit after each completed sub-task, not at the end
- Stage specific files (not `git add -A`)
- Write descriptive commit messages that explain the "why"
- This gives a clean git history where any change can be reverted independently

## Rules

- Only implement unchecked items — skip anything already marked `- [x]`
- Follow existing code patterns and conventions from CLAUDE.md
- Do not refactor unrelated code
- If a single item is too large, break it into sub-tasks and track with TodoWrite
- If an item is ambiguous, ask for clarification before implementing
- Always pipe test and lint scripts through `2>&1` so all output is captured
- Tests should be meaningful — verify actual behavior, edge cases, and error paths. Do not write trivial tests just to increase coverage.
- Always look for existing implementations of similar features before writing new code. Reuse patterns, don't reinvent them.
