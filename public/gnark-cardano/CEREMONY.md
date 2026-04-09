# Trusted Setup Ceremony

This document describes how to run a multi-party computation (MPC) ceremony for
the Groth16 trusted setup. A ceremony is **only required for production**
deployments — for development and testing, the single-party `./snark setup`
command is fine.

## Why a Ceremony?

Groth16 requires a per-circuit "trusted setup" that produces a proving key (PK)
and a verifying key (VK). The setup uses random "toxic waste" — anyone who
knows it can forge proofs that the on-chain verifier will accept.

A single-party setup means **one machine** generated the toxic waste. If that
machine was compromised (or the operator is dishonest), every proof for that
circuit is potentially forgeable.

An **MPC ceremony** lets multiple parties contribute randomness sequentially.
The toxic waste is the product of every contributor's secret. The setup is
secure as long as **at least one honest participant** properly destroys their
contribution after the ceremony — no party ever sees the combined secret.

## Two Phases

The ceremony has two phases:

| Phase | Purpose | Reusable? |
|---|---|---|
| **Phase 1** ("Powers of Tau") | Universal setup, independent of any specific circuit | Yes — across all circuits up to a maximum size |
| **Phase 2** | Circuit-specific setup, applied to your compiled circuit | No — must be redone for each circuit |

In practice, large public Phase 1 ceremonies (Filecoin, Zcash, Aztec, perpetual
powers of tau) already exist. You could reuse one of those, but for now this
toolkit runs both phases from scratch.

## Roles

- **Coordinator** — runs `init` once, distributes files between contributors,
  runs `verify` and `finalize`. Holds no secrets.
- **Contributors** — each runs `contribute` exactly once per phase, on a
  trusted machine they control. They generate fresh randomness, mix it into
  the state, and pass the result to the next contributor.

The coordinator can also be a contributor.

## Before You Start

1. **Generate your circuit.** Write `proof.pattern`, prompt Claude to generate
   `go/circuit.go`, and verify it works locally with `./run`. Once you're
   confident the circuit does what you want, delete the development setup:
   ```
   rm -rf go/setup
   ```

2. **Build the CLI.**
   ```
   cd go && go build -o snark
   ```

3. **Pick a list of contributors.** Decide who is participating. More
   contributors = stronger security guarantee. Three to five is reasonable
   for most projects.

4. **Pick two beacons.** A "beacon" is a public source of randomness that no
   one could have predicted at the start of the ceremony. You need one for
   Phase 1 and one for Phase 2. Good sources:
   - [drand](https://drand.love/) public randomness beacon
   - The hash of a future Bitcoin block (e.g. block at height N+1000 from
     the start of the ceremony)
   - NIST Randomness Beacon

   Each beacon must be a hex-encoded byte string. Commit publicly to *which*
   beacon you'll use **before** the ceremony starts.

## Phase 1: Powers of Tau

### Step 1.1 — Coordinator initializes

```
./snark ceremony init -dir ceremony
```

This compiles the circuit, saves `ceremony/ccs.bin`, and creates the initial
Phase 1 state at `ceremony/phase1/0000.ph1`.

The coordinator publishes (or sends to the first contributor):
- `ceremony/ccs.bin`
- `ceremony/phase1/0000.ph1`

### Step 1.2 — Each contributor contributes

The first contributor downloads the files into their local
`ceremony/` directory and runs:

```
./snark ceremony contribute -dir ceremony -phase 1
```

This:
1. Loads the latest `phase1/NNNN.ph1` file
2. Generates fresh random secrets internally
3. Mixes them into the state
4. Saves the new state as `phase1/NNNN+1.ph1`

The contributor then:
1. **Securely destroys** any traces of the randomness on their machine
   (in practice this is handled inside the binary — the secrets never touch
   disk and are zeroed after use). For maximum paranoia, run the contribution
   on a fresh, disconnected machine and physically destroy the disk afterward.
2. Sends the new file (e.g. `phase1/0001.ph1`) to the next contributor or
   back to the coordinator for distribution.

The next contributor downloads `phase1/0001.ph1`, runs the same command (which
will produce `phase1/0002.ph1`), and so on.

### Step 1.3 — Anyone verifies the chain (optional)

At any point, anyone with the `phase1/` files can verify the contributions
are valid:

```
./snark ceremony verify -dir ceremony -phase 1
```

This checks that each contribution is a valid extension of the previous one.
It does **not** prove that contributors actually destroyed their secrets —
that's the trust assumption that makes the ceremony work.

### Step 1.4 — Coordinator finalizes Phase 1

Once all contributors are done, the coordinator publishes the beacon value
(e.g. "Phase 1 beacon: drand round 12345 = `abc123...`") and runs:

```
./snark ceremony finalize -dir ceremony -phase 1 -beacon abc123...
```

This:
1. Verifies the entire Phase 1 chain
2. Applies the beacon as a final non-malleable contribution
3. Writes `ceremony/srs.bin` (the finalized SRS)
4. Initializes Phase 2 at `ceremony/phase2/0000.ph2`

## Phase 2: Circuit-Specific Setup

Phase 2 follows the same pattern as Phase 1, but uses `.ph2` files and the
`-phase 2` flag.

### Step 2.1 — Distribute the initial Phase 2 state

The coordinator publishes `ceremony/phase2/0000.ph2` (along with the existing
`ccs.bin` and `srs.bin`) to the first contributor.

### Step 2.2 — Each contributor contributes

```
./snark ceremony contribute -dir ceremony -phase 2
```

Same workflow as Phase 1: each contributor produces the next `.ph2` file
and passes it on.

### Step 2.3 — Verify the Phase 2 chain (optional)

```
./snark ceremony verify -dir ceremony -phase 2
```

### Step 2.4 — Coordinator finalizes Phase 2

Pick a *second* beacon (different from the Phase 1 beacon — typically a later
drand round or block hash). Then:

```
./snark ceremony finalize -dir ceremony -phase 2 -beacon def456... -out setup
```

This:
1. Verifies the entire Phase 2 chain
2. Applies the beacon
3. Extracts the final proving key and verifying key
4. Writes them to `setup/` in the same format as the single-party `setup`
   command:
   - `setup/ccs.bin` (constraint system)
   - `setup/pk.bin` (proving key)
   - `setup/vk.bin` (verifying key)
   - `setup/vk.json` (Cardano-compatible JSON export of the VK)

## After the Ceremony

The `setup/` directory now contains a production-ready trusted setup. You can
use it exactly like a single-party setup:

```
./snark prove -setup setup -input my-secrets.json
```

Or run the standard pipeline (which uses `setup/` as its setup directory):

```
./scripts/prove
./scripts/test
```

You should also:

1. **Publish all ceremony files.** The full transcript (`ccs.bin`, all
   `phase1/*.ph1`, `srs.bin`, all `phase2/*.ph2`, both beacon values) should
   be made public so anyone can independently verify the setup.

2. **Publish `vk.bin` / `vk.json`.** Users of your circuit need the VK to
   verify proofs. The VK is non-secret.

3. **Distribute `pk.bin` to provers.** Anyone generating proofs needs the
   proving key. It's also non-secret but is much larger than the VK.

4. **Discard all intermediate files** that are not part of the published
   transcript. The `phase1/` and `phase2/` files are not needed for proving
   or verification — they only exist so others can verify the ceremony.

## File Layout Reference

After a complete ceremony, your `ceremony/` directory looks like:

```
ceremony/
  ccs.bin                  # Compiled constraint system
  phase1/
    0000.ph1               # Initial state (from `init`)
    0001.ph1               # After contributor 1
    0002.ph1               # After contributor 2
    ...
  srs.bin                  # Phase 1 finalized output
  phase2/
    0000.ph2               # Initial state (from `finalize -phase 1`)
    0001.ph2               # After contributor 1
    0002.ph2               # After contributor 2
    ...

setup/                     # Final keys (from `finalize -phase 2`)
  ccs.bin
  pk.bin
  vk.bin
  vk.json
```

## Security Notes

- The ceremony binary uses randomness from the OS CSPRNG (`crypto/rand`).
  Contributions cannot be made deterministic.
- The "1-of-N" trust assumption requires that **at least one** contributor
  honestly destroys their secret randomness. If all contributors collude or
  are compromised, the toxic waste can be reconstructed.
- The beacon ensures the final output cannot be retroactively biased: even
  if every contributor colluded, they could not have predicted the beacon
  value, so the final state has at least the entropy of the beacon.
- The on-chain verifier does **not** know or care whether the keys came from
  a single-party setup or an MPC ceremony — they're indistinguishable in
  format. This means **you can swap** a development single-party setup for
  a production ceremony output without changing any other code or contracts.
