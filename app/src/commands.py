# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

# src/commands.py

from src.constants import KEY_DOMAIN_TAG, H0, H1, H2, H3, H2I_DOMAIN_TAG
from src.files import extract_key
from src.bls12381 import (
    to_int,
    rng,
    scale,
    g1_point,
    combine,
    curve_order,
    g2_point,
    invert,
)
from src.hashing import generate
from src.register import Register
from src.ecies import encrypt, capsule_to_file, decrypt
from src.level import half_level_to_file, full_level_to_file, empty_full_level_to_file
from src.schnorr import schnorr_proof, schnorr_to_file
from src.binding import binding_proof, binding_to_file
from src.files import save_string, load_json
from src.snark import gt_to_hash, decrypt_to_hash
from pathlib import Path


def create_encryption_tx(
    alice_wallet_path: str, plaintext: str, token_name: str
) -> None:
    """
    Create the artifacts for an initial "encryption transaction" (entry encryption).

    This function samples fresh secrets, derives the encryption keying material,
    creates the initial "half-level" entry, encrypts the plaintext, and writes
    all required on-chain/off-chain artifacts to disk.

    High-level steps:
    1. Sample secrets `a0`, `r0` and derive an Fq12 value `m0 = e([a0]G1, H0)`.
    2. Derive Alice's scalar secret `sk` from her wallet key (domain separated
       using `KEY_DOMAIN_TAG`) and write her register to file.
    3. Produce a Schnorr proof of knowledge for the register and write it to file.
    4. Compute the entry points:
         r1b    = [r0]G1
         r2_g1b = [a0 + r0*sk]G1
       and compute the level commitment term `r4b` using transcript-derived
       scalars `a,b` (domain separated via `H2I_DOMAIN_TAG`).
    5. Write the half-level entry `(r1b, r2_g1b, r4b)` to disk.
    6. Encrypt `plaintext` under a key derived from `(r1b, m0)` and write the
       capsule (nonce/aad/ciphertext) to disk.
    7. Produce a binding proof tying `(a0, r0)` to the transcript and write it.

    Side effects (writes files):
    - User register via `Register.to_file()`
    - Schnorr proof via `schnorr_to_file(...)`
    - Half level via `half_level_to_file(...)`
    - Capsule via `capsule_to_file(...)`
    - Binding proof via `binding_to_file(...)`

    Args:
        alice_wallet_path: Path to Alice wallet material (as expected by `extract_key`).
        plaintext: Message to encrypt (string passed to `encrypt`).
        token_name: Additional transcript-binding value to prevent cross-context replay.

    Returns:
        None. This is a "builder" that emits artifacts to `../data/*`.

    Notes / assumptions:
        - `rng()` must be cryptographically secure.
        - `extract_key()` is expected to return a stable key string for hashing.
        - All point/scalar encodings are assumed to be the ones your `src.*`
          modules expect (hex strings / serialized points).
    """
    current = Path(__file__).resolve().parent.parent
    snark_path = current / "snark" / "snark"

    # these are secrets
    a0 = rng()
    r0 = rng()
    # use gnark encoding for gt
    m0 = gt_to_hash(a0, snark_path)

    key = extract_key(alice_wallet_path)
    sk = to_int(generate(KEY_DOMAIN_TAG + key))
    user = Register(x=sk)
    user.to_file()

    zb, grb = schnorr_proof(user)
    schnorr_to_file(zb, grb)

    r1b = scale(g1_point(1), r0)
    r2_g1b = scale(g1_point(1), (a0 + r0 * sk) % curve_order)

    a = to_int(generate(H2I_DOMAIN_TAG + r1b))
    b = to_int(generate(H2I_DOMAIN_TAG + r1b + r2_g1b + token_name))

    c = combine(combine(scale(H1, a), scale(H2, b)), H3)
    r4b = scale(c, r0)

    half_level_to_file(r1b, r2_g1b, r4b)
    empty_full_level_to_file()

    nonce, aad, ct = encrypt(r1b, m0, plaintext)
    capsule_to_file(nonce, aad, ct)

    zab, zrb, t1b, t2b = binding_proof(a0, r0, r1b, r2_g1b, user, token_name)
    binding_to_file(zab, zrb, t1b, t2b)


def create_bidding_tx(bob_wallet_path: str) -> None:
    """
    Create the artifacts for a "bidding transaction" (Bob register + proof).

    This is the minimal setup for a bidder: derive Bob's scalar secret `sk` from
    his wallet key (domain separated by `KEY_DOMAIN_TAG`), create his register,
    and produce a Schnorr proof of knowledge for that register.

    Side effects (writes files):
    - User register via `Register.to_file()`
    - Schnorr proof via `schnorr_to_file(...)`

    Args:
        bob_wallet_path: Path to Bob wallet material (as expected by `extract_key`).

    Returns:
        None. Writes artifacts to `../data/*`.
    """
    key = extract_key(bob_wallet_path)
    sk = to_int(generate(KEY_DOMAIN_TAG + key))
    user = Register(x=sk)
    user.to_file()

    zb, grb = schnorr_proof(user)
    schnorr_to_file(zb, grb)


def create_reencryption_tx(
    alice_wallet_path: str, bob_public_value: str, token_name: str
) -> None:
    """
    Create the artifacts for a re-encryption hop.

    Conceptually, this produces a new half-level entry that targets Bob's public
    value, plus auxiliary witness data used to link the hop to the previous entry.

    High-level steps:
    1. Sample hop secrets `a1`, `r1` and derive a fresh Fq12 value `m1`.
    2. Derive `hk` as an integer scalar from `m1` (reduced modulo `curve_order`).
       (This is used as a hop-specific scalar witness.)
    3. Derive Alice's secret `sk` from her wallet key.
    4. Compute the new entry:
         r1b    = [r1]G1
         r2_g1b = [a1]G1 + [r1] * bob_public_value
       then compute `r4b` similarly to the encryption step and write the half-level.
    5. Compute:
         r5b     = [hk]G2 + [sk] * (-H0)   (implemented as [hk]G2 + [sk]*invert(H0))
         witness = [hk]G1
       and write them to disk.
    6. Produce a binding proof for this hop against Bob's public register context.
    7. Load the existing encryption datum and write a "full-level" object that
       updates the last entry using the newly produced `r5b`.

    Side effects (writes files):
    - Half level via `half_level_to_file(...)`
    - r5 witness points via `save_string(...)` to:
        - ../data/r5.point
        - ../data/witness.point
    - Binding proof via `binding_to_file(...)`
    - Full level via `full_level_to_file(...)`
    - Reads ../data/encryption/encryption-datum.json

    Args:
        alice_wallet_path: Path to Alice wallet material (as expected by `extract_key`).
        bob_public_value: Serialized public value for Bob (a G1 element encoding as
            expected by `scale(...)` and `Register.from_public(...)`).
        token_name: Transcript-binding value to prevent cross-context replay.

    Returns:
        None. Emits hop artifacts to disk.

    Notes / assumptions:
        - The JSON structure in encryption-datum.json is assumed to match the
          shape accessed by the indexing code in this function.
        - `invert(H0)` is assumed to represent the group inverse of `H0` in the
          representation expected by your BLS helpers.
    """
    current = Path(__file__).resolve().parent.parent
    snark_path = current / "snark" / "snark"

    a1 = rng()
    r1 = rng()
    # m1 = random_fq12(a1)
    m1 = gt_to_hash(a1, snark_path)

    hk = to_int(m1)

    key = extract_key(alice_wallet_path)
    sk = to_int(generate(KEY_DOMAIN_TAG + key))

    r1b = scale(g1_point(1), r1)
    r2_g1b = combine(scale(g1_point(1), a1), scale(bob_public_value, r1))

    a = to_int(generate(H2I_DOMAIN_TAG + r1b))
    b = to_int(generate(H2I_DOMAIN_TAG + r1b + r2_g1b + token_name))
    c = combine(scale(H1, a), scale(H2, b))
    r4b = scale(c, r1)

    half_level_to_file(r1b, r2_g1b, r4b)

    r5b = combine(scale(g2_point(1), hk), scale(invert(H0), sk))
    save_string("../data/r5.point", r5b)
    witness = scale(g1_point(1), hk)
    save_string("../data/witness.point", witness)

    user = Register.from_public(g1_point(1), bob_public_value)
    zab, zrb, t1b, t2b = binding_proof(a1, r1, r1b, r2_g1b, user, token_name)
    binding_to_file(zab, zrb, t1b, t2b)

    # update the last element
    encryption_datum = load_json("../data/encryption/encryption-datum.json")
    last_entry = encryption_datum["fields"][3]
    old_r1b = last_entry["fields"][0]["bytes"]
    old_r2_g1b = last_entry["fields"][1]["bytes"]
    old_r4b = last_entry["fields"][2]["bytes"]

    full_level_to_file(old_r1b, old_r2_g1b, r5b, old_r4b)


def recursive_decrypt(
    alice_wallet_path: str,
    encryption_levels: list,
    encryption_datum_path: str = "../data/encryption/encryption-datum.json",
) -> None:
    """
    Decrypt the final capsule by iteratively walking re-encryption hops in the datum.

    This function loads an "encryption datum" JSON object, iterates over its list
    of entries, and repeatedly derives a hop key via pairings. It maintains a
    running "shared" G2 value that evolves per hop, and for each entry computes:

        b   = e(r1, shared)
        key = encode( r2 / b )

    It then updates:
        shared = [k]G2
    where `k = to_int(key)`.

    At the end, it extracts the capsule (nonce/aad/ct) from the datum and calls
    `decrypt(...)`, printing the recovered plaintext.

    Side effects:
    - Reads `encryption_datum_path` JSON.
    - Prints the decrypted plaintext to stdout.

    Args:
        alice_wallet_path: Path to Alice wallet material (as expected by `extract_key`).
        encryption_datum_path: Path to the JSON datum containing all hop entries
            and the final capsule.

    Returns:
        None. Prints the decrypted message.

    Notes / assumptions:
        - The datum JSON schema is assumed to match the nested indexing used
          in this function.
        - The branch on `constructor` is treated as selecting between two
          entry shapes for computing `r2`. In both branches, `pair(..., H0)`
          appears, and in the "else" branch an additional multiplicative term
          is included. (This is protocol-specific; the docstring describes
          the control flow but does not validate the schema.)
        - `fq12_encoding` is assumed to be deterministic and compatible with
          the key derivation expected by `decrypt`.
    """
    current = Path(__file__).resolve().parent.parent
    snark_path = current / "snark" / "snark"

    key = extract_key(alice_wallet_path)
    sk = to_int(generate(KEY_DOMAIN_TAG + key))

    # if we can reproduce this with koios then this function can remain the same.
    encryption_datum = load_json(encryption_datum_path)
    all_entries = encryption_levels

    shared = scale(H0, sk)

    half_level = all_entries[0]

    r1 = half_level["fields"][0]["bytes"]
    r2_g1b = half_level["fields"][1]["bytes"]
    key = decrypt_to_hash(r1, r2_g1b, None, shared, snark_path)
    k = to_int(key)
    shared = scale(g2_point(1), k)

    full_levels = all_entries[1:]
    for entry in full_levels:
        entry = entry['fields'][0]
        r1 = entry["fields"][0]["bytes"]
        r2_g1b = entry["fields"][1]["bytes"]
        r2_g2b = entry["fields"][2]["bytes"]
        key = decrypt_to_hash(r1, r2_g1b, r2_g2b, shared, snark_path)

        # print(key)
        k = to_int(key)
        shared = scale(g2_point(1), k)
    capsule = encryption_datum["fields"][5]

    nonce = capsule["fields"][0]["bytes"]
    aad = capsule["fields"][1]["bytes"]
    ct = capsule["fields"][2]["bytes"]
    message = decrypt(r1, key, nonce, ct, aad)
    print(message)
