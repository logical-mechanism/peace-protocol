import subprocess
from typing import cast
from src.files import load_json
from pathlib import Path
from py_ecc.optimized_bls12_381 import (
    add,
    multiply,
    pairing,
    final_exponentiate,
)
from eth_typing import BLSPubkey, BLSSignature
from py_ecc.bls.g2_primitives import pubkey_to_G1, signature_to_G2, G1_to_pubkey
import re
from py_ecc.fields import optimized_bls12_381_FQ as FQ
from py_ecc.optimized_bls12_381 import field_modulus


def gt_to_hash(a: int, snark_path: str | Path) -> str:
    snark = Path(snark_path)

    cmd = [
        str(snark),
        "hash",
        "-a",
        str(a),
    ]

    # Run and capture output for debugging; raise if non-zero exit.
    output = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return output.stdout.strip()


def decrypt_to_hash(
    r1: str, r2_g1b: str, r2_g2b: str | None, shared: str, snark_path: str | Path
) -> str:
    snark = Path(snark_path)

    if r2_g2b is None:
        # half level
        cmd = [str(snark), "decrypt", "-r1", r1, "-g1b", r2_g1b, "-shared", shared]
    else:
        # full level
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
    # Run and capture output for debugging; raise if non-zero exit.
    output = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return output.stdout.strip()


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

    output = subprocess.run(cmd, capture_output=True, text=True, check=True)
    print(output.stdout.strip())


def _hex_to_bytes(h: str) -> bytes:
    h = h.strip().lower()
    if h.startswith("0x"):
        h = h[2:]
    return bytes.fromhex(h)


def _g1_from_compressed_hex(h: str):
    raw = _hex_to_bytes(h)
    if len(raw) != 48:
        raise ValueError(f"G1 compressed must be 48 bytes, got {len(raw)}")
    return pubkey_to_G1(cast(BLSPubkey, raw))


def _g2_from_compressed_hex(h: str):
    raw = _hex_to_bytes(h)
    if len(raw) != 96:
        raise ValueError(f"G2 compressed must be 96 bytes, got {len(raw)}")
    return signature_to_G2(cast(BLSSignature, raw))


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

    vk_x = IC[0]
    for i, s in enumerate(inputs):
        vk_x = add(vk_x, multiply(IC[i + 1], int(s)))

    # print(G1_to_pubkey(vk_x).hex())

    left = pairing(B, A, final_exponentiate=False)
    right = pairing(beta, alpha, final_exponentiate=False)
    right *= pairing(gamma, vk_x, final_exponentiate=False)
    right *= pairing(delta, C, final_exponentiate=False)

    return final_exponentiate(left) == final_exponentiate(right)


def _strip0x(h: str) -> str:
    h = h.strip().lower()
    return h[2:] if h.startswith("0x") else h


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
    # Avoid py_ecc's recursive __pow__ path on negative exponents.
    zi = int(z) % field_modulus
    if zi == 0:
        raise ZeroDivisionError("inverse of zero in Fp")
    return FQ(pow(zi, field_modulus - 2, field_modulus))


def _g1_jacobian_to_affine_xy_ints(p) -> tuple[int, int]:
    # p is typically (X, Y, Z) in Jacobian over FQ
    if len(p) == 2:
        # already affine
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
    p = pubkey_to_G1(BLSPubkey(bytes.fromhex(g1_hex)))
    return _g1_jacobian_to_affine_xy_ints(p)


def _fp_to_limbs_le(x: int) -> list[int]:
    # 6 limbs × 64-bit, little-endian (least-significant limb first)
    limbs = []
    for _ in range(_NB_LIMBS_FP):
        limbs.append(x & _LIMB_MASK)
        x >>= _LIMB_BITS
    return limbs


def public_inputs_from_w0_w1_hex(w0_hex: str, w1_hex: str, v_hex: str) -> list[str]:
    """
    Mimic gnark v0.14.0 public witness layout when exposing three G1 points
    (v, w0, w1) as public inputs using emulated BLS12381Fp coordinates.

    Output order (36 decimals):
      v.X limbs(6), v.Y limbs(6),
      w0.X limbs(6), w0.Y limbs(6),
      w1.X limbs(6), w1.Y limbs(6)
    """
    vx, vy = _g1_uncompress_to_xy_ints(v_hex)
    w0x, w0y = _g1_uncompress_to_xy_ints(w0_hex)
    w1x, w1y = _g1_uncompress_to_xy_ints(w1_hex)

    out_ints = []
    out_ints += _fp_to_limbs_le(vx)
    out_ints += _fp_to_limbs_le(vy)
    out_ints += _fp_to_limbs_le(w0x)
    out_ints += _fp_to_limbs_le(w0y)
    out_ints += _fp_to_limbs_le(w1x)
    out_ints += _fp_to_limbs_le(w1y)

    # decimal strings, exactly what your Go exporter emits
    return [str(i) for i in out_ints]
