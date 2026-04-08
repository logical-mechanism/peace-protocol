---
name: Project board workflow
description: Board items move Todo → In Progress → Next Release only; Done is reserved for main merge
type: feedback
---

Never move project board items to "Done". Items go Todo → In Progress → Next Release via the `/work` command. The user moves items to Done manually when merging `dev` into `main`.

**Why:** The user's release workflow treats "Next release" as staged features on `dev`. "Done" means shipped to `main`. Auto-closing issues or moving to Done prematurely breaks this flow.

**How to apply:** The `/work` command's final step is "Next release" — never go further. Don't create GitHub issues from drafts (they don't auto-close when PRs merge to `dev`, which is annoying). Work directly with project board draft items.
