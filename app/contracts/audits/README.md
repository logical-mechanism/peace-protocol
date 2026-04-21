# Smart Contract Audits

Chronological record of security audits on the Peace Protocol Aiken contracts in [app/contracts/](../). Newest first.

Each audit is authored by an AI model and should be read as a supplement to — not a replacement for — human cryptographic and economic review. Over time, as newer models come online, additional audits are added here so findings can be compared across audit dates.

## Audits

| Date | Model | Scope | Key takeaway |
|------|-------|-------|--------------|
| [2026-04-20](./2026-04-20-claude-opus-4-7.md) | claude-opus-4-7 | Full contracts folder incl. `validators/reference.ak` | Incremental review of price-in-datum and bidder time-lock changes. 1 new LOW finding; MED-2 from prior audit still open. |
| [2026-02-09](./2026-02-09-claude.md) | claude (Anthropic) | All contracts except `validators/reference.ak` | Baseline audit. 3 HIGH, 2 MED, 2 LOW, 9 CRYPTO; all HIGH findings acknowledged as intentional hyperstructure design. |

## How to read these

- Each audit is self-contained but builds on the prior one. Findings labelled `HIGH-N` / `MED-N` / `LOW-N` are stable across audits — a finding with the same label refers to the same issue.
- Cryptographic analysis (`CG-1…CG-9`) is done in depth in the 2026-02-09 baseline; subsequent audits only re-verify that the crypto code is unchanged rather than re-deriving.
- A "Status of prior findings" table in each new audit maps each prior finding to one of: unchanged, code-changed-still-applies, resolved, disputed, partially-mitigated.

## Adding a new audit

1. Name the file `YYYY-MM-DD-<model-id>.md` (e.g. `2026-07-01-claude-sonnet-4-8.md`).
2. Follow the structure established in the most recent audit: header, executive summary, findings, focus sections, positive properties, crypto section (summary if unchanged), test coverage, observations, status-of-prior-findings, recommendations, checklist.
3. Update this README's table with a new row at the top.
