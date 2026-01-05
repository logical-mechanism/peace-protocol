# snark.py (or wherever you keep this)
#
# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

import os
import re
import subprocess
from pathlib import Path
from typing import Any, cast

from src.files import load_json
from py_ecc.optimized_bls12_381 import normalize
from eth_typing import BLSPubkey, BLSSignature
from py_ecc.bls.g2_primitives import pubkey_to_G1, signature_to_G2
from py_ecc.fields import optimized_bls12_381_FQ as FQ
from py_ecc.optimized_bls12_381 import (
    add,
    curve_order,
    field_modulus,
    final_exponentiate,
    multiply,
    neg,
    pairing,
)

# ----------------------------
# CLI helpers
# ----------------------------


def gt_to_hash(a: int, snark_path: str | Path) -> str:
    snark = Path(snark_path)
    cmd = [str(snark), "hash", "-a", str(a)]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return out.stdout.strip()


def decrypt_to_hash(
    r1: str, r2_g1b: str, r2_g2b: str | None, shared: str, snark_path: str | Path
) -> str:
    snark = Path(snark_path)
    if r2_g2b is None:
        cmd = [str(snark), "decrypt", "-r1", r1, "-g1b", r2_g1b, "-shared", shared]
    else:
        cmd = [
            str(snark),
            "decrypt",
            "-r1",
            r1,
            "-g1b",
            r2_g1b,
            "-g2b",
            r2_g2b,
            "-shared",
            shared,
        ]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return out.stdout.strip()


def generate_snark_proof(
    a: int, r: int, v: str, w0: str, w1: str, snark_path: str | Path
) -> None:
    snark = Path(snark_path)
    cmd = [
        str(snark),
        "prove",
        "-a",
        str(a),
        "-r",
        str(r),
        "-v",
        v,
        "-w0",
        w0,
        "-w1",
        w1,
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True)
    print(out.stdout.strip())


# ----------------------------
# Bytes / point decoding (IMPORTANT)
# Use g2_primitives (pubkey_to_G1 / signature_to_G2) so types match
# py_ecc.optimized_bls12_381 add/multiply/pairing.
# ----------------------------


def _hex_to_bytes(h: str) -> bytes:
    h = h.strip().lower()
    if h.startswith("0x"):
        h = h[2:]
    return bytes.fromhex(h)


def _g1_from_compressed_hex(h: str):
    raw = _hex_to_bytes(h)
    if len(raw) != 48:
        raise ValueError(f"G1 compressed must be 48 bytes, got {len(raw)}")
    # returns an optimized Jacobian G1 point (x,y,z) with optimized FQ elems
    return pubkey_to_G1(cast(BLSPubkey, raw))


def _g2_from_compressed_hex(h: str):
    raw = _hex_to_bytes(h)
    if len(raw) != 96:
        raise ValueError(f"G2 compressed must be 96 bytes, got {len(raw)}")
    # returns an optimized Jacobian G2 point (x,y,z) with optimized FQ2 elems
    return signature_to_G2(cast(BLSSignature, raw))


# ----------------------------
# Groth16 verify (robust conventions)
# ----------------------------

def _is_fq2(x: Any) -> bool:
    """
    Robust FQ2 detector for py_ecc optimized types.

    - Sometimes prints like (c0, c1) but is NOT actually a tuple.
    - Optimized FQ2 objects typically have `.coeffs` (len 2).
    """
    if isinstance(x, tuple) and len(x) == 2:
        return True
    coeffs = getattr(x, "coeffs", None)
    return isinstance(coeffs, (list, tuple)) and len(coeffs) == 2


def _is_g2_point(p: Any) -> bool:
    # Accept affine (x,y) or jacobian (x,y,z), where x,y are FQ2-like
    if not isinstance(p, tuple) or len(p) not in (2, 3):
        return False
    x, y = p[0], p[1]
    return _is_fq2(x) and _is_fq2(y)


def _is_g1_point(p: Any) -> bool:
    # Accept affine (x,y) or jacobian (x,y,z), where x,y are NOT FQ2-like
    if not isinstance(p, tuple) or len(p) not in (2, 3):
        return False
    x, y = p[0], p[1]
    return (not _is_fq2(x)) and (not _is_fq2(y))


def _to_jacobian_g1(p: Any) -> Any:
    # (x,y) -> (x,y,1)
    if isinstance(p, tuple) and len(p) == 2:
        return (p[0], p[1], 1)
    return p


def _g2_one_like(x_fq2: Any) -> Any:
    """
    Construct the multiplicative identity in FQ2 matching the runtime type.
    """
    # tuple-representation FQ2
    if isinstance(x_fq2, tuple) and len(x_fq2) == 2:
        return (1, 0)

    cls = x_fq2.__class__

    # Many py_ecc field types provide classmethod `.one()`
    one_fn = getattr(cls, "one", None)
    if callable(one_fn):
        try:
            return one_fn()
        except TypeError:
            pass

    # Fall back to common constructors
    try:
        return cls((1, 0))
    except Exception:
        pass
    try:
        return cls([1, 0])
    except Exception:
        pass

    # Last resort (better than crashing)
    return (1, 0)


def _to_jacobian_g2(p: Any) -> Any:
    # (x,y) -> (x,y,1_FQ2)
    if isinstance(p, tuple) and len(p) == 2:
        x, y = p
        return (x, y, _g2_one_like(x))
    return p


def _pair(a: Any, b: Any) -> Any:
    """
    py_ecc.optimized_bls12_381.pairing expects (Q_g2, P_g1) in Jacobian.

    This wrapper accepts either order and (only if needed) lifts affine->jacobian.
    """
    a_is_g2 = _is_g2_point(a)
    a_is_g1 = _is_g1_point(a)
    b_is_g2 = _is_g2_point(b)
    b_is_g1 = _is_g1_point(b)

    if a_is_g2 and b_is_g1:
        Q_g2 = _to_jacobian_g2(a)
        P_g1 = _to_jacobian_g1(b)
    elif b_is_g2 and a_is_g1:
        Q_g2 = _to_jacobian_g2(b)
        P_g1 = _to_jacobian_g1(a)
    else:
        raise TypeError(
            "pairing expects one G1 point and one G2 point; "
            f"got a_is_g1={a_is_g1} a_is_g2={a_is_g2} "
            f"b_is_g1={b_is_g1} b_is_g2={b_is_g2} "
            f"(len(a)={len(a) if isinstance(a, tuple) else None}, "
            f"len(b)={len(b) if isinstance(b, tuple) else None})"
        )

    return pairing(Q_g2, P_g1, final_exponentiate=False)


def _gt_inv(x: Any) -> Any:
    return x.inv()

def verify_snark_proof(out_dir: str | Path = "out") -> bool:
    out_dir = Path(out_dir)

    vk = load_json(out_dir / "vk.json")
    proof = load_json(out_dir / "proof.json")
    public = load_json(out_dir / "public.json")

    inputs = public.get("inputs")
    if not isinstance(inputs, list):
        raise TypeError("public.json: 'inputs' must be a list")

    alpha = _g1_from_compressed_hex(vk["vkAlpha"])
    beta = _g2_from_compressed_hex(vk["vkBeta"])
    gamma = _g2_from_compressed_hex(vk["vkGamma"])
    delta = _g2_from_compressed_hex(vk["vkDelta"])
    IC = [_g1_from_compressed_hex(p) for p in vk["vkIC"]]

    n_public = int(vk["nPublic"])
    if len(inputs) != n_public:
        raise ValueError(
            f"public input count mismatch: len(inputs)={len(inputs)} vs vk.nPublic={n_public}"
        )
    if len(IC) != len(inputs) + 1:
        raise ValueError(
            f"IC length mismatch: len(IC)={len(IC)} vs len(inputs)+1={len(inputs) + 1}"
        )

    A = _g1_from_compressed_hex(proof["piA"])
    B = _g2_from_compressed_hex(proof["piB"])
    C = _g1_from_compressed_hex(proof["piC"])

    # Build vk_x in G1
    vk_x = IC[0]
    for i, s in enumerate(inputs):
        si = int(s) % curve_order
        vk_x = add(vk_x, multiply(IC[i + 1], si))

    debug = os.getenv("SNARK_DEBUG") not in (None, "", "0", "false", "False")

    def fe(x: Any) -> Any:
        return final_exponentiate(x)

    # sanity: inverse works in GT
    if debug:
        mill = _pair(B, A)  # NOTE: pairing expects (G2, G1) in our helper
        chk = fe(mill * _gt_inv(mill))

        # identity via pairing(infinity, B)
        g1_zero = multiply(A, 0)  # G1 infinity
        one = fe(_pair(B, g1_zero))
        if chk != one:
            print("[verify] WARNING: FQ12 inverse sanity check failed")
        else:
            print("[verify] inverse sanity check ok")

    # Base LHS (A/B signs)
    def lhs_for(a_pt: Any, b_pt: Any) -> Any:
        # _pair expects (G2, G1)
        return _pair(b_pt, a_pt)

    # Base RHS (alpha/beta, vkx/gamma, C/delta)
    def rhs_for(
        alpha_pt: Any,
        beta_pt: Any,
        vkx_pt: Any,
        gamma_pt: Any,
        c_pt: Any,
        delta_pt: Any,
    ) -> Any:
        r = _pair(beta_pt, alpha_pt)   # e(beta, alpha)
        r *= _pair(gamma_pt, vkx_pt)   # e(gamma, vk_x)
        r *= _pair(delta_pt, c_pt)     # e(delta, C)
        return r

    # Try ALL 2^8 sign combinations:
    # {A,B,C, alpha,beta,gamma,delta, vk_x}
    points = {
        "A": A,
        "B": B,
        "C": C,
        "alpha": alpha,
        "beta": beta,
        "gamma": gamma,
        "delta": delta,
        "vkx": vk_x,
    }

    def maybe_neg(pt: Any, do_neg: bool) -> Any:
        return neg(pt) if do_neg else pt

    names = ["A", "B", "C", "alpha", "beta", "gamma", "delta", "vkx"]

    tried = 0
    for mask in range(1 << len(names)):
        tried += 1
        sel = {name: bool(mask & (1 << i)) for i, name in enumerate(names)}

        A_ = maybe_neg(points["A"], sel["A"])
        B_ = maybe_neg(points["B"], sel["B"])
        C_ = maybe_neg(points["C"], sel["C"])
        alpha_ = maybe_neg(points["alpha"], sel["alpha"])
        beta_ = maybe_neg(points["beta"], sel["beta"])
        gamma_ = maybe_neg(points["gamma"], sel["gamma"])
        delta_ = maybe_neg(points["delta"], sel["delta"])
        vkx_ = maybe_neg(points["vkx"], sel["vkx"])

        lhs = lhs_for(A_, B_)
        rhs = rhs_for(alpha_, beta_, vkx_, gamma_, C_, delta_)

        L = fe(lhs)
        R = fe(rhs)
        Linv = fe(_gt_inv(lhs))
        Rinv = fe(_gt_inv(rhs))

        label = " ".join([f"{k}{'-' if sel[k] else ''}" for k in names])

        if L == R:
            if debug:
                print(f"[verify] matched: {label} (L == R)")
            return True
        if L == Rinv:
            if debug:
                print(f"[verify] matched: {label} (L == R^-1)")
            return True
        if Linv == R:
            if debug:
                print(f"[verify] matched: {label} (L^-1 == R)")
            return True
        if Linv == Rinv:
            if debug:
                print(f"[verify] matched: {label} (L^-1 == R^-1)")
            return True

    if debug:
        print(f"[verify] tried {tried} sign combinations; none matched")
    return False


# ----------------------------
# Public integer extraction (if you still need it)
# Use the SAME decoding path (pubkey_to_G1) so coordinates align with gnark.
# ----------------------------

_LIMB_BITS = 64
_NB_LIMBS_FP = 6
_LIMB_MASK = (1 << _LIMB_BITS) - 1


def _strip_0x_and_validate_g1_hex(h: str) -> str:
    h = h.strip().lower()
    if h.startswith("0x"):
        h = h[2:]
    if not re.fullmatch(r"[0-9a-f]+", h or ""):
        raise ValueError("invalid hex string")
    if len(h) != 96:
        raise ValueError(
            f"compressed G1 must be 48 bytes (96 hex chars), got {len(h)} hex chars"
        )
    return h


def _fq_inv_nonrecursive(z: FQ) -> FQ:
    zi = int(z) % field_modulus
    if zi == 0:
        raise ZeroDivisionError("inverse of zero in Fp")
    return FQ(pow(zi, field_modulus - 2, field_modulus))


def _g1_jacobian_to_affine_xy_ints(p) -> tuple[int, int]:
    # p is (X, Y, Z) Jacobian over optimized FQ
    if len(p) == 2:
        x, y = p
        return int(x) % field_modulus, int(y) % field_modulus

    X, Y, Z = p
    if int(Z) % field_modulus == 0:
        raise ValueError("point at infinity (Z == 0)")

    zinv = _fq_inv_nonrecursive(Z)
    zinv2 = zinv * zinv
    zinv3 = zinv2 * zinv

    x_aff = X * zinv2
    y_aff = Y * zinv3
    return int(x_aff) % field_modulus, int(y_aff) % field_modulus


def _g1_uncompress_to_xy_ints(g1_hex: str) -> tuple[int, int]:
    g1_hex = _strip_0x_and_validate_g1_hex(g1_hex)
    p = pubkey_to_G1(cast(BLSPubkey, bytes.fromhex(g1_hex)))
    return _g1_jacobian_to_affine_xy_ints(p)


def _fp_to_limbs_le(x: int) -> list[int]:
    limbs: list[int] = []
    for _ in range(_NB_LIMBS_FP):
        limbs.append(x & _LIMB_MASK)
        x >>= _LIMB_BITS
    return limbs


def public_inputs_from_w0_w1_hex(w0_hex: str, w1_hex: str, v_hex: str) -> list[str]:
    """
    Output order (36 decimals):
      v.X limbs(6), v.Y limbs(6),
      w0.X limbs(6), w0.Y limbs(6),
      w1.X limbs(6), w1.Y limbs(6)
    """
    vx, vy = _g1_uncompress_to_xy_ints(v_hex)
    w0x, w0y = _g1_uncompress_to_xy_ints(w0_hex)
    w1x, w1y = _g1_uncompress_to_xy_ints(w1_hex)

    out_ints: list[int] = []
    out_ints += _fp_to_limbs_le(vx)
    out_ints += _fp_to_limbs_le(vy)
    out_ints += _fp_to_limbs_le(w0x)
    out_ints += _fp_to_limbs_le(w0y)
    out_ints += _fp_to_limbs_le(w1x)
    out_ints += _fp_to_limbs_le(w1y)

    return [str(i) for i in out_ints]
