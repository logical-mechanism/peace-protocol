# PEACE Protocol Smart Contracts

There are two user-focused smart contracts: one for re-encryption and the other for bid management. Any UTxO inside the re-encryption contract is for sale via the bidding system. A user may place a bid into the bid contract, and the current owner of the encrypted data may select it as payment for re-encrypting the data to the new owner. Payments on bid UTxOs will be Lovelace only. To ensure functionality, a reference data contract must exist, as it resolves circular dependencies. The protocol starts with the genesis mint.

The five validators (`genesis`, `reference`, `encryption`, `bidding`, `groth`) and the v0.6.0 audit-fix changes are documented in [`audits/audit_report.md`](audits/audit_report.md). Recent contract-level changes worth knowing before deploying or integrating off-chain:

- **v0.6.0 (2026-05-07)** — audit-fix release. The genesis policy now takes a third compile-time parameter `reference_hash: ScriptHash` and asserts `ReferenceDatum.reference == reference_hash` at mint time (closes M-01). `reference.ak` is re-keyed from `(_genesis_pid, _genesis_tkn)` to `(_tx_id, _tx_idx)` so it can be built before genesis (the new compile.sh order). Every continuing protocol output now requires `stake_credential = None` AND `reference_script = None` (closes H-01 stake-credential hijack). `verify_groth16` rejects over-supplied public-input lists (closes M-03). All five validator hashes change as a result. See [`CHANGELOG.md`](../../CHANGELOG.md) for the full list.

## Testing

```sh
aiken check     # 95 tests (was 86 pre-v0.6.0)
aiken bench     # baseline benchmarks under lib/benchmarks/
```

## Compiling

```bash
./compile.sh
```

`compile.sh` builds `reference.ak` first (with `(tx_id, tx_idx)`), derives its hash, then threads it as the third parameter into the genesis policy build. Off-chain deployment scripts (see `app/commands/`, `app/setup.sh`) read the resulting hashes from `hashes/*.hash` at runtime. The off-chain genesis token-name builder mirrors `lib/util.construct_token_name` byte-for-byte (`bytes([tx_idx]) + tx_id`, truncated to 32 bytes); CBOR encoding diverged for `tx_idx >= 24` and was the root cause of finding I-08.

**Copyright (C) 2025-2026 Logical Mechanism LLC**

**SPDX-License-Identifier: CC-BY-4.0**