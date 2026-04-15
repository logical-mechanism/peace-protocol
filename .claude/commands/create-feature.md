---
name: create-feature
description: Create a feature draft on the Veiled Application project board
argument-hint: "<feature description>"
---

# Create Feature Draft

Create a draft item on the **Veiled Application** GitHub Project board (project 5, org `logical-mechanism`). Drafts keep the issue tracker clean — they convert to real issues only when picked up by `/work`.

## Project Board Constants

- **Project number:** 5
- **Owner:** logical-mechanism
- **Repo:** logical-mechanism/Peace-Protocol
- **Status field ID:** PVTSSF_lADOCrNGAc4BT-hVzhBJw4k
  - Todo: `f75ad846`
- **Priority field ID:** PVTSSF_lADOCrNGAc4BT-hVzhBJxOs
  - P0: `2a7e6f2d`, P1: `f5b2e4c5`, P2: `1b616789`
- **Size field ID:** PVTSSF_lADOCrNGAc4BT-hVzhBJxOw
  - XS: `65af3644`, S: `4758f904`, M: `20625371`, L: `195079c3`, XL: `387f171e`

## Process

### Step 1: Understand the Feature

If `$ARGUMENTS` is provided, use it as the starting point. If empty, ask the user what feature they want to create.

Discuss the feature with the user to understand:
- What problem does it solve?
- What's the user-facing behavior?
- What parts of the codebase are affected?
- Any edge cases or constraints?

Read relevant source files to understand the current state before designing tasks. Don't guess — look at the code.

### Step 2: Draft the Spec

Write a draft body with this structure:

```markdown
## Summary
1-3 sentences: what the feature does and why it matters.

## Tasks
Ordered checklist of implementation sub-tasks. Each task should be a single committable unit of work.
Keep tasks concrete and scoped — "Add X component" not "Build the UI".
Include test tasks where meaningful.

- [ ] Task 1 description
- [ ] Task 2 description
- [ ] ...

## Claude Prompt
The full implementation prompt that `/work` will execute. This should be a self-contained instruction set that includes:
- What to build and where
- Key files to read first
- Patterns to follow (reference existing code)
- What NOT to do (scope boundaries)
- Testing expectations

Write this as if briefing a developer who has access to CLAUDE.md but hasn't seen this conversation.

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] ...
```

### Step 3: Confirm with User

Show the complete draft body to the user and ask for approval. Do NOT create the draft until the user confirms. If they want changes, revise and show again.

### Step 4: Create the Draft

Once approved, create the draft on the project board:

```bash
gh project item-create 5 --owner logical-mechanism --title "<feature title>" --body "<body>" --format json
```

The title should be concise (under 70 chars), like a PR title. Use the feature name, not "Add feature for...".

### Step 5: Set Fields

Get the item ID from the creation response, then set Status to Todo:

```bash
gh project item-edit --project-id PVT_kwDOCrNGAc4BT-hV --id <ITEM_ID> --field-id PVTSSF_lADOCrNGAc4BT-hVzhBJw4k --single-select-option-id f75ad846
```

If the user specified priority or size during the conversation, set those too using the field IDs above.

### Step 6: Confirm

Report back: the draft title and that it's been added to the Todo column. Mention that `/work` can pick it up when ready.

## Rules

- Always confirm the draft body with the user before creating
- Keep the Claude Prompt section self-contained — it will be read in a fresh context
- Tasks should be ordered by dependency (do X before Y)
- Each task = one commit, so keep them atomic
- Reference existing patterns and file paths in the prompt
- Don't over-engineer the spec — match the complexity to the feature
- If the feature touches the GUI, note which files need visual review in the prompt
