# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only
from src.bls12381 import rng, scale, g1_point, to_int, from_int, curve_order
from src.constants import SCH_DOMAIN_TAG
from src.hashing import generate
from src.register import Register
from src.files import save_json


def fiat_shamir_heuristic(gb: str, grb: str, ub: str) -> str:
    """
    Compute the Fiat–Shamir challenge material for the Schnorr proof.

    The challenge is derived by hashing a domain-separated transcript:

        SCH_DOMAIN_TAG || gb || grb || ub

    where:
    - `gb` is the public generator (serialized G1 element),
    - `grb` is the commitment `g^r` (serialized G1 element),
    - `ub` is the public value `u` (serialized G1 element).

    Args:
        gb: Serialized generator `g` (G1 element encoding).
        grb: Serialized commitment point `g^r` (G1 element encoding).
        ub: Serialized public value `u` (G1 element encoding).

    Returns:
        A hex string digest (as returned by `generate`) that is typically mapped
        to a scalar via `to_int(...)`.
    """
    return generate(SCH_DOMAIN_TAG + gb + grb + ub)


def schnorr_proof(register: Register) -> tuple[str, str]:
    """
    Generate a non-interactive Schnorr proof of knowledge of `x` for `u = [x]g`.

    This implements the Fiat–Shamir transform over a standard Schnorr protocol:

    Commit:
        r  <-$ Z_q
        gr = [r]G

    Challenge:
        c = H(SCH_DOMAIN_TAG || g || gr || u) mod q

    Response:
        z = r + c*x mod q

    The verifier checks that:
        [z]G == gr + [c]u
    (or the equivalent form used in your on-chain verifier).

    Args:
        register: A `Register` containing:
            - `x`: the secret scalar witness (required for a meaningful proof),
            - `g`: generator encoding,
            - `u`: public value encoding.

    Returns:
        A tuple `(z_hex, grb)` where:
            z_hex: Response scalar `z` encoded as a minimal big-endian hex string
                via `from_int`.
            grb: Commitment point `[r]G` in the serialized format produced by `scale`.

    Notes / assumptions:
        - This function treats missing fields defensively:
            - If `register.g` or `register.u` is `None`, it substitutes `""` into
              the transcript, which changes the derived challenge.
            - If `register.x` is `None`, it substitutes `x = 1`, which produces a
              proof but *not* a proof of knowledge of the actual secret.
          In normal usage, `register` should be secret-known (i.e., `x` set).
        - `rng()` must be cryptographically secure and sample from the scalar field.
    """
    g = register.g if register.g is not None else ""
    u = register.u if register.u is not None else ""
    x = register.x if register.x is not None else 1
    r = rng()
    grb = scale(g1_point(1), r)
    c = to_int(fiat_shamir_heuristic(g, grb, u))
    z = (r + c * x) % curve_order
    return from_int(z), grb


def schnorr_to_file(z: str, grb: str) -> None:
    """
    Serialize a Schnorr proof `(z, g^r)` to a JSON file.

    The output schema matches a Plutus/Aiken constructor encoding:
        {
          "constructor": 0,
          "fields": [
            {"bytes": z},
            {"bytes": grb}
          ]
        }

    Output path (fixed):
        ../data/schnorr.json

    Args:
        z: Hex string encoding of the response scalar `z`.
        grb: Serialized commitment point `g^r` (G1 element encoding).

    Returns:
        None. Writes the JSON artifact via `save_json`.

    Raises:
        Any exceptions raised by `save_json` (e.g., invalid path or permissions)
        will propagate.
    """
    path = "../data/schnorr.json"
    data = {
        "constructor": 0,
        "fields": [
            {"bytes": z},
            {"bytes": grb},
        ],
    }
    save_json(path, data)
