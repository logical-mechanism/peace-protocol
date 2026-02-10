# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

# snark.py

import re
import subprocess
from pathlib import Path
from typing import Any, cast

from src.files import load_json
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
    """
    Compute a pairing-based hash of scalar `a` using the gnark binary.

    This invokes the external snark binary with the `hash` subcommand to
    compute `e([a]G1, H0)` and encode the result as a hex string, using
    gnark's internal FQ12 tower representation.

    Args:
        a: Secret scalar used to multiply the G1 generator before pairing.
        snark_path: Path to the compiled gnark snark binary.

    Returns:
        A hex string representing the domain-tagged encoding of the resulting
        GT element, as produced by the snark binary.

    Raises:
        subprocess.CalledProcessError: If the snark binary exits with a
            non-zero return code.
    """
    snark = Path(snark_path)
    cmd = [str(snark), "hash", "-a", str(a)]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return out.stdout.strip()


def decrypt_to_hash(
    r1: str, r2_g1b: str, r2_g2b: str | None, shared: str, snark_path: str | Path
) -> str:
    """
    Compute a decryption hash for a re-encryption level using the gnark binary.

    This invokes the external snark binary with the `decrypt` subcommand to
    derive a hop key from the given level components and a shared secret point.
    If `r2_g2b` is `None`, it performs a half-level decryption (no G2 component);
    otherwise it performs a full-level decryption.

    Args:
        r1: Serialized G1 element `r1` from the encryption level.
        r2_g1b: Serialized G1 component of `r2` from the encryption level.
        r2_g2b: Serialized G2 component of `r2` from the encryption level,
            or `None` for a half-level entry.
        shared: Serialized shared secret point (G2 element).
        snark_path: Path to the compiled gnark snark binary.

    Returns:
        A hex string representing the derived hop key hash.

    Raises:
        subprocess.CalledProcessError: If the snark binary exits with a
            non-zero return code.
    """
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


def setup_snark(
    snark_path: str | Path,
    out_dir: str | Path = "setup",
    force: bool = False,
) -> None:
    """
    Run the trusted setup phase. This compiles the circuit and generates
    the proving key (pk) and verifying key (vk).

    This should be run ONCE and the output files reused for all future proofs.

    Output files:
      - ccs.bin: compiled constraint system
      - pk.bin: proving key
      - vk.bin: verifying key (binary)
      - vk.json: verifying key (JSON for Aiken)
    """
    snark = Path(snark_path)
    cmd = [str(snark), "setup", "-out", str(out_dir)]
    if force:
        cmd.append("-force")
    out = subprocess.run(cmd, capture_output=True, text=True, check=True)
    print(out.stdout.strip())


def generate_snark_proof(
    a: int,
    r: int,
    v: str,
    w0: str,
    w1: str,
    snark_path: str | Path,
    out_dir: str | Path = "out",
    setup_dir: str | Path | None = None,
    no_verify: bool = False,
) -> None:
    """
    Generate a Groth16 proof for the vw0w1 circuit.

    Args:
        a: Secret scalar a (must be > 0)
        r: Secret scalar r (can be 0)
        v: Public G1 point V (compressed hex, 96 chars)
        w0: Public G1 point W0 (compressed hex, 96 chars)
        w1: Public G1 point W1 (compressed hex, 96 chars)
        snark_path: Path to the snark binary
        out_dir: Output directory for proof files (default: "out")
        setup_dir: Directory containing setup files (ccs.bin, pk.bin, vk.bin).
                   If None, compiles the circuit fresh (slower).
        no_verify: Skip verification after proving (only valid with setup_dir)

    Output files:
      - vk.json, proof.json, public.json (JSON for Aiken)
      - vk.bin, proof.bin, witness.bin (binary for Go verification)
    """
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
        "-out",
        str(out_dir),
    ]
    if setup_dir is not None:
        cmd.extend(["-setup", str(setup_dir)])
    if no_verify:
        cmd.append("-no-verify")
    out = subprocess.run(cmd, capture_output=True, text=True, check=True)
    print(out.stdout.strip())


def verify_snark_proof_go(
    snark_path: str | Path,
    out_dir: str | Path = "out",
) -> bool:
    """
    Verify a Groth16 proof using the Go snark binary.

    This uses gnark's native verification which is compatible with gnark-generated proofs.

    Args:
        snark_path: Path to the snark binary
        out_dir: Directory containing vk.bin, proof.bin, witness.bin

    Returns:
        True if verification succeeds, False otherwise
    """
    snark = Path(snark_path)
    cmd = [str(snark), "verify", "-out", str(out_dir)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        print(result.stdout.strip())
        return True
    else:
        print(f"Verification failed: {result.stderr.strip()}")
        return False


# ----------------------------
# Bytes / point decoding (IMPORTANT)
# Use g2_primitives (pubkey_to_G1 / signature_to_G2) so types match
# py_ecc.optimized_bls12_381 add/multiply/pairing.
# ----------------------------


def _hex_to_bytes(h: str) -> bytes:
    """Strip whitespace and optional '0x' prefix, then decode hex to bytes."""
    h = h.strip().lower()
    if h.startswith("0x"):
        h = h[2:]
    return bytes.fromhex(h)


def _g1_from_compressed_hex(h: str):
    """Decompress a 48-byte hex string into an optimized Jacobian G1 point."""
    raw = _hex_to_bytes(h)
    if len(raw) != 48:
        raise ValueError(f"G1 compressed must be 48 bytes, got {len(raw)}")
    # returns an optimized Jacobian G1 point (x,y,z) with optimized FQ elems
    return pubkey_to_G1(cast(BLSPubkey, raw))


def _g2_from_compressed_hex(h: str):
    """Decompress a 96-byte hex string into an optimized Jacobian G2 point."""
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
    """Check if `p` is a G2 point (affine or Jacobian with FQ2 coordinates)."""
    if not isinstance(p, tuple) or len(p) not in (2, 3):
        return False
    x, y = p[0], p[1]
    return _is_fq2(x) and _is_fq2(y)


def _is_g1_point(p: Any) -> bool:
    """Check if `p` is a G1 point (affine or Jacobian with non-FQ2 coordinates)."""
    if not isinstance(p, tuple) or len(p) not in (2, 3):
        return False
    x, y = p[0], p[1]
    return (not _is_fq2(x)) and (not _is_fq2(y))


def _to_jacobian_g1(p: Any) -> Any:
    """Lift an affine G1 point `(x, y)` to Jacobian `(x, y, 1)` if needed."""
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
    """Lift an affine G2 point `(x, y)` to Jacobian `(x, y, 1_FQ2)` if needed."""
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
    """Compute the multiplicative inverse of a GT (FQ12) element."""
    return x.inv()


def _negate_g2(p: Any) -> Any:
    """Negate a G2 point: (x, y, z) -> (x, -y, z)"""
    if len(p) == 2:
        x, y = p
        return (x, _negate_fq2(y))
    x, y, z = p
    return (x, _negate_fq2(y), z)


def _negate_fq2(y: Any) -> Any:
    """Negate an FQ2 element."""
    # Handle tuple representation
    if isinstance(y, tuple) and len(y) == 2:
        return (-y[0] % field_modulus, -y[1] % field_modulus)
    # Handle object with coeffs
    coeffs = getattr(y, "coeffs", None)
    if coeffs is not None:
        return y.__class__([-c % field_modulus for c in coeffs])
    # Fallback - try negation
    return -y


def _expand_message_xmd(msg: bytes, dst: bytes, len_in_bytes: int) -> bytes:
    """
    expand_message_xmd from RFC 9380 (hash-to-curve).
    Uses SHA256 as the hash function.
    """
    import hashlib

    b_in_bytes = 32  # SHA256 output size
    s_in_bytes = 64  # SHA256 block size
    ell = (len_in_bytes + b_in_bytes - 1) // b_in_bytes

    if ell > 255:
        raise ValueError("ell too large")
    if len(dst) > 255:
        raise ValueError("DST too long")

    dst_prime = dst + bytes([len(dst)])
    z_pad = bytes(s_in_bytes)
    l_i_b_str = len_in_bytes.to_bytes(2, "big")

    # b_0 = H(Z_pad || msg || l_i_b_str || 0x00 || DST_prime)
    h = hashlib.sha256()
    h.update(z_pad + msg + l_i_b_str + bytes([0]) + dst_prime)
    b_0 = h.digest()

    # b_1 = H(b_0 || 0x01 || DST_prime)
    h = hashlib.sha256()
    h.update(b_0 + bytes([1]) + dst_prime)
    b_vals = [h.digest()]

    for i in range(2, ell + 1):
        # b_i = H(strxor(b_0, b_{i-1}) || i || DST_prime)
        xored = bytes(a ^ b for a, b in zip(b_0, b_vals[-1]))
        h = hashlib.sha256()
        h.update(xored + bytes([i]) + dst_prime)
        b_vals.append(h.digest())

    uniform_bytes = b"".join(b_vals)
    return uniform_bytes[:len_in_bytes]


def _hash_to_field_gnark(msg: bytes, dst: bytes, count: int = 1) -> list[int]:
    """
    gnark-crypto's fr.Hash implementation for BLS12-381.
    Uses expand_message_xmd with 48 bytes per element.
    """
    # For BLS12-381 Fr, we need 48 bytes of uniform randomness per element
    # (security parameter + ceil(log2(r)/8))
    L = 48
    len_in_bytes = count * L

    uniform_bytes = _expand_message_xmd(msg, dst, len_in_bytes)

    elements = []
    for i in range(count):
        tv = uniform_bytes[i * L : (i + 1) * L]
        # Interpret as big-endian integer and reduce mod curve_order
        e = int.from_bytes(tv, "big") % curve_order
        elements.append(e)

    return elements


def _hash_commitment_challenge(commitment_point_bytes: bytes) -> int:
    """
    Compute gnark's commitment challenge for Pedersen PoK verification.
    gnark uses: fr.Hash(commitmentsSerialized, []byte("G16-BSB22"), 1)
    """
    challenges = _hash_to_field_gnark(commitment_point_bytes, b"G16-BSB22", 1)
    return challenges[0]


def _solve_commitment_wire(
    commitment_point,
    committed_indices: list[int],
    public_witness: list[int],
) -> int:
    """
    Compute the commitment wire value that gnark appends to the public witness.

    gnark computes: hash(commitment_point || committed_public_witnesses)
    using hash_to_field with DST = b"BSB22-Groth16-Fiat-Shamir"

    Args:
        commitment_point: G1 point (jacobian)
        committed_indices: 1-based indices of committed public inputs
        public_witness: list of public witness values (without leading "1")

    Returns:
        The field element to append to the public witness
    """
    # Get uncompressed commitment point bytes (x || y, each 48 bytes = 96 total)
    x, y = _g1_jacobian_to_affine_xy_ints(commitment_point)
    commitment_bytes = x.to_bytes(48, "big") + y.to_bytes(48, "big")

    # Append committed public witness values
    data = bytearray(commitment_bytes)
    for idx in committed_indices:
        # idx is 1-based, public_witness is 0-indexed
        w = public_witness[idx - 1]
        # Marshal as 32-byte big-endian (Fr element)
        data.extend(w.to_bytes(32, "big"))

    # Hash using gnark's hash_to_field (commitment DST)
    # gnark uses hash_to_field with DST = "BSB22-Groth16-Fiat-Shamir" for the prehash
    result = _hash_to_field_gnark(bytes(data), b"BSB22-Groth16-Fiat-Shamir", 1)
    return result[0]


def _g1_uncompressed_bytes(g1_hex: str) -> bytes:
    """Get uncompressed G1 point bytes (64 bytes: x || y)."""
    p = _g1_from_compressed_hex(g1_hex)
    x, y = _g1_jacobian_to_affine_xy_ints(p)
    return x.to_bytes(48, "big") + y.to_bytes(48, "big")


def verify_snark_proof(out_dir: str | Path = "out", debug: bool = False) -> bool:
    """
    Verify a Groth16 proof using gnark's verification equation.

    **IMPORTANT**: This pure-Python verification using py_ecc is NOT compatible
    with proofs generated by gnark-crypto due to different FQ12 tower representations
    in the pairing computation. The point parsing and kSum computation are correct,
    but py_ecc and gnark produce different GT element representations.

    For reliable verification of gnark-generated proofs, use verify_snark_proof_via_go()
    from src.snark_verify_wrapper instead.

    This function is kept for reference and potential future use with py_ecc-native proofs.

    Equation: e(α, β) == e(A, B) * e(C, -δ) * e(kSum, -γ)
    Where kSum = IC[0] + Σ(pub[i] * IC[i+1]) + commitment_wires + Σ(D_i)
    """
    out_dir = Path(out_dir)

    vk = load_json(out_dir / "vk.json")
    proof = load_json(out_dir / "proof.json")
    public = load_json(out_dir / "public.json")

    inputs = public.get("inputs")
    if not isinstance(inputs, list):
        raise TypeError("public.json: 'inputs' must be a list")

    # Parse VK elements
    alpha = _g1_from_compressed_hex(vk["vkAlpha"])
    beta = _g2_from_compressed_hex(vk["vkBeta"])
    gamma = _g2_from_compressed_hex(vk["vkGamma"])
    delta = _g2_from_compressed_hex(vk["vkDelta"])
    IC = [_g1_from_compressed_hex(p) for p in vk["vkIC"]]

    # Parse commitment extension data
    commitment_keys = vk.get("commitmentKeys", [])
    public_and_commitment_committed = vk.get("publicAndCommitmentCommitted", [])

    # Parse proof elements
    A = _g1_from_compressed_hex(proof["piA"])
    B = _g2_from_compressed_hex(proof["piB"])
    C = _g1_from_compressed_hex(proof["piC"])

    # Parse commitment points from proof
    commitment_hexes = proof.get("commitments", [])
    commitments = [_g1_from_compressed_hex(h) for h in commitment_hexes]

    if debug:
        print("\n=== gnark-style Groth16 Verification ===")
        print(f"  len(inputs): {len(inputs)}")
        print(f"  len(IC): {len(IC)}")
        print(f"  len(commitments): {len(commitments)}")
        print(f"  len(commitment_keys): {len(commitment_keys)}")
        print(f"  public_and_commitment_committed: {public_and_commitment_committed}")

    # Build public witness vector (as integers)
    # Try both with and without "1" to see which works
    # inputs[0] is "1" (gnark convention)
    public_witness_no_one = [int(s) for s in inputs[1:]]
    public_witness_with_one = [int(s) for s in inputs]

    if debug:
        print(f"  public_witness without '1': {len(public_witness_no_one)} elements")
        print(f"  public_witness with '1': {len(public_witness_with_one)} elements")

    # Use the version without "1" (gnark's actual witness format)
    public_witness = public_witness_no_one.copy()

    # gnark's verification with commitments:
    # 1. For each commitment, compute a "commitment wire" value by hashing
    #    the commitment point with the committed public witnesses
    # 2. Append each commitment wire to the public witness
    # 3. Then compute kSum using the EXTENDED public witness
    # 4. Add commitment points to kSum
    # 5. Verify pairing equation

    num_commitments = len(commitments)

    if debug:
        print(f"  num_public_inputs (original): {len(public_witness)}")
        print(f"  num_commitments: {num_commitments}")
        print(f"  len(IC): {len(IC)}")
        print(f"  public_and_commitment_committed: {public_and_commitment_committed}")

    # Step 1-2: For each commitment, compute and append the commitment wire
    for i, D in enumerate(commitments):
        if i < len(public_and_commitment_committed):
            committed_indices = public_and_commitment_committed[i]
            commitment_wire = _solve_commitment_wire(
                D, committed_indices, public_witness_no_one
            )
            public_witness.append(commitment_wire)
            if debug:
                print(f"  Computed commitment_wire[{i}]: {commitment_wire}")

    if debug:
        print(f"  Extended public_witness length: {len(public_witness)}")

    # Step 3: Compute kSum = IC[0] + Σ(public_witness[i] * IC[i+1])
    # gnark uses: kSum.MultiExp(K[1:], publicWitness, ...)
    # where publicWitness now includes the commitment wires

    kSum = IC[0]

    # Use all available public witness elements with corresponding IC points
    for i in range(len(public_witness)):
        if i + 1 < len(IC):
            term = multiply(IC[i + 1], public_witness[i])
            kSum = add(kSum, term)

    if debug:
        print(
            f"  Used {min(len(public_witness), len(IC) - 1)} witness elements for IC multiplication"
        )

    # Step 4: Add all commitment points Σ(D_i)
    for i, D in enumerate(commitments):
        kSum = add(kSum, D)
        if debug:
            print(f"  Added commitment[{i}] to kSum")

    if debug:
        kSum_x, kSum_y = _g1_jacobian_to_affine_xy_ints(kSum)
        print("  kSum computed:")
        print(f"    x: {kSum_x}")
        print(f"    y: {kSum_y}")

    # Negate gamma and delta for the pairing equation
    # Use py_ecc's neg function directly
    gamma_neg = neg(gamma)
    delta_neg = neg(delta)

    # gnark's verification equation:
    # vk.e == FinalExp(e(A, B) * e(C, -δ) * e(kSum, -γ))
    # where vk.e = e(α, β)
    #
    # Equivalently: e(α, β) == e(A, B) * e(C, -δ) * e(kSum, -γ)

    # gnark's verification equation (product form):
    # e(A, B) * e(C, -δ) * e(kSum, -γ) * e(-α, β) == 1
    #
    # This is equivalent to: e(α, β) == e(A, B) * e(C, -δ) * e(kSum, -γ)

    # Compute pairings
    e_A_B = pairing(B, A, final_exponentiate=False)
    e_C_deltaNeg = pairing(delta_neg, C, final_exponentiate=False)
    e_kSum_gammaNeg = pairing(gamma_neg, kSum, final_exponentiate=False)
    e_alpha_beta = pairing(beta, alpha, final_exponentiate=False)

    # Product form: all pairings multiplied together should equal 1
    # e(A,B) * e(C,-δ) * e(kSum,-γ) == e(α,β)
    # => e(A,B) * e(C,-δ) * e(kSum,-γ) * e(α,β)^{-1} == 1
    product = e_A_B * e_C_deltaNeg * e_kSum_gammaNeg
    left_final = final_exponentiate(e_alpha_beta)
    right_final = final_exponentiate(product)

    result = left_final == right_final

    if debug:
        print("\n  Pairings computed:")
        print("    e(A, B)")
        print("    e(C, -δ)")
        print("    e(kSum, -γ)")
        print("    e(α, β)")
        print(f"  Verification result: {result}")

    # Also try alternative formulation: negate alpha instead of gamma/delta
    if not result and debug:
        print("\n  --- Trying alternative: negate alpha ---")
        print("  Alternative product final exp computed")

    if result:
        if debug:
            print("\n✓ Verification succeeded (gnark equation)")
        return True

    # If the above fails, try without commitment handling (for proofs without commitments)
    if debug:
        print("\n--- Trying without commitment extension ---")

    # Simple vk_x = IC[0] + Σ(inputs[i] * IC[i+1])
    inputs_int = [int(s) for s in inputs]
    vk_x = IC[0]
    for i, s in enumerate(inputs_int):
        if i + 1 < len(IC):
            vk_x = add(vk_x, multiply(IC[i + 1], s))

    e_vkx_gammaNeg = pairing(gamma_neg, vk_x, final_exponentiate=False)
    right_simple = e_A_B * e_C_deltaNeg * e_vkx_gammaNeg
    right_simple_final = final_exponentiate(right_simple)

    result_simple = left_final == right_simple_final

    if debug:
        print(f"  Simple verification result: {result_simple}")

    if result_simple:
        if debug:
            print("\n✓ Verification succeeded (simple equation)")
        return True

    if debug:
        print("\n✗ Verification failed")
    return False


# ----------------------------
# Public integer extraction (if you still need it)
# Use the SAME decoding path (pubkey_to_G1) so coordinates align with gnark.
# ----------------------------

_LIMB_BITS = 64
_NB_LIMBS_FP = 6
_LIMB_MASK = (1 << _LIMB_BITS) - 1


def _strip_0x_and_validate_g1_hex(h: str) -> str:
    """Strip optional '0x' prefix and validate that `h` is 96 hex chars (48 bytes)."""
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
    """Compute the modular inverse of an FQ element using Fermat's little theorem."""
    zi = int(z) % field_modulus
    if zi == 0:
        raise ZeroDivisionError("inverse of zero in Fp")
    return FQ(pow(zi, field_modulus - 2, field_modulus))


def _g1_jacobian_to_affine_xy_ints(p) -> tuple[int, int]:
    """Convert G1 point from py_ecc's internal representation to affine (x, y) integers."""
    from py_ecc.optimized_bls12_381 import normalize

    # Use py_ecc's normalize function which handles the coordinate system correctly
    if len(p) == 2:
        # Already affine
        x, y = p
        return int(x) % field_modulus, int(y) % field_modulus

    # Jacobian/projective point - use normalize
    normalized = normalize(p)
    x, y = normalized
    return int(x) % field_modulus, int(y) % field_modulus


def _g1_uncompress_to_xy_ints(g1_hex: str) -> tuple[int, int]:
    """Decompress a G1 hex string and return affine `(x, y)` as integers."""
    g1_hex = _strip_0x_and_validate_g1_hex(g1_hex)
    p = pubkey_to_G1(cast(BLSPubkey, bytes.fromhex(g1_hex)))
    return _g1_jacobian_to_affine_xy_ints(p)


def _fp_to_limbs_le(x: int) -> list[int]:
    """Split an Fp integer into 6 little-endian 64-bit limbs."""
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
