# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

# src/binding.py

from src.register import Register
from src.constants import BND_DOMAIN_TAG
from src.hashing import generate
from src.bls12381 import rng, scale, g1_point, to_int, from_int, curve_order, combine
from src.files import save_json


def fiat_shamir_heuristic(
    register: Register,
    t1b: str,
    t2b: str,
    r1b: str,
    r2b: str,
    token_name: str,
) -> str:
    """
    Compute the Fiat–Shamir challenge for the binding proof.

    This function deterministically hashes the transcript to produce the
    challenge scalar `c` (as a hex string), using domain separation via
    `BND_DOMAIN_TAG`.

    Transcript layout (concatenated as strings, in order):
        BND_DOMAIN_TAG || g || u || t1b || t2b || r1b || r2b || token_name

    Notes:
    - `register.g` and `register.u` are expected to be the (serialized) public
      group elements used by the protocol. If either is `None`, it is treated
      as the empty string, which changes the transcript and therefore the
      challenge.
    - This function returns the hash output as produced by `generate(...)`.
      Converting it to an integer challenge modulo the curve order is done
      by `to_int(...)` at the call site.

    Args:
        register: Public register containing group parameters (e.g., generator
            `g` and public value `u`) required for domain-separated hashing.
        t1b: Serialized commitment term 1 (typically a G1 element encoding).
        t2b: Serialized commitment term 2 (typically a G1 element encoding).
        r1b: Serialized statement/public term included in the transcript.
        r2b: Serialized statement/public term included in the transcript.
        token_name: Additional transcript-binding string (e.g., asset name)
            to prevent proof replay across different contexts.

    Returns:
        A hex string hash digest representing the Fiat–Shamir challenge material.
        (Commonly interpreted as an integer scalar via `to_int`.)
    """
    g = register.g if register.g is not None else ""
    u = register.u if register.u is not None else ""

    return generate(BND_DOMAIN_TAG + g + u + t1b + t2b + r1b + r2b + token_name)


def binding_proof(
    a: int, r: int, r1b: str, r2b: str, register: Register, token_name: str
) -> tuple[str, str, str, str]:
    """
    Generate a Schnorr-style binding proof transcript for secrets `(a, r)`.

    High-level idea:
    - Sample fresh randomness `rho` and `alpha`.
    - Compute commitment points:
        t1 = [rho] * G
        t2 = [alpha] * G + [rho] * u
      where `G` is the canonical G1 generator and `u` is taken from `register`.
    - Derive Fiat–Shamir challenge `c = H(transcript)` using `fiat_shamir_heuristic`.
    - Produce responses (mod curve order):
        zr = rho   + c * r
        za = alpha + c * a

    Output format:
    - `za` and `zr` are returned as hex strings via `from_int`.
    - `t1b` and `t2b` are returned in the same serialized form produced by
      `scale/combine` (typically a G1 encoding).

    Args:
        a: Secret scalar (integer) being proven bound into the statement.
        r: Secret scalar (integer) being proven bound into the statement.
        r1b: Serialized public/statement component included in the transcript.
        r2b: Serialized public/statement component included in the transcript.
        register: Public register containing `u` (and optionally `g`) used
            for transcript binding and commitment computation.
        token_name: Context-binding string included in the transcript (e.g.,
            asset/token name) to prevent cross-context proof reuse.

    Returns:
        A 4-tuple `(zab, zrb, t1b, t2b)` where:
            zab: Hex string encoding of `za mod curve_order`.
            zrb: Hex string encoding of `zr mod curve_order`.
            t1b: Serialized commitment point `t1`.
            t2b: Serialized commitment point `t2`.

    Security notes:
    - `rng()` must be cryptographically secure and must sample uniformly from
      the scalar field (or a distribution compatible with your security model).
    - Treating `register.u` as empty string when `None` will change `t2` (since
      `scale(u, rho)` will effectively use an empty input); ensure `u` is always
      set in normal operation.
    """
    rho = rng()
    alpha = rng()

    u = register.u if register.u is not None else ""

    t1b = scale(g1_point(1), rho)
    t2b = combine(scale(g1_point(1), alpha), scale(u, rho))

    c = to_int(fiat_shamir_heuristic(register, t1b, t2b, r1b, r2b, token_name))
    zrb = (rho + c * r) % curve_order
    zab = (alpha + c * a) % curve_order

    return from_int(zab), from_int(zrb), t1b, t2b


def binding_to_file(zab: str, zrb: str, t1b: str, t2b: str) -> None:
    """
    Serialize a binding proof into the expected JSON format and write it to disk.

    The JSON schema written matches a typical Plutus/Aiken constructor encoding:
        {
          "constructor": 0,
          "fields": [
            {"bytes": zab},
            {"bytes": zrb},
            {"bytes": t1b},
            {"bytes": t2b}
          ]
        }

    The output file path is fixed:
        ../data/binding.json

    Args:
        zab: Hex string encoding of the `za` response scalar.
        zrb: Hex string encoding of the `zr` response scalar.
        t1b: Serialized commitment point `t1` (bytes/hex string as expected).
        t2b: Serialized commitment point `t2` (bytes/hex string as expected).

    Returns:
        None. Writes the JSON artifact to disk via `save_json`.

    Raises:
        Any exceptions raised by `save_json` (e.g., due to invalid path,
        permissions, or serialization issues) will propagate.
    """
    path = "../data/binding.json"
    data = {
        "constructor": 0,
        "fields": [
            {"bytes": zab},
            {"bytes": zrb},
            {"bytes": t1b},
            {"bytes": t2b},
        ],
    }
    save_json(path, data)
