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
from py_ecc.bls.g2_primitives import pubkey_to_G1, signature_to_G2
from py_ecc.bls.g2_primitives import G1_to_pubkey


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


def generate_snark_proof(a: int, w: str, snark_path: str | Path) -> None:
    snark = Path(snark_path)

    cmd = [
        str(snark),
        "prove",
        "-a",
        str(a),
        "-w",
        w,
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

    print(G1_to_pubkey(vk_x).hex())

    left = pairing(B, A, final_exponentiate=False)
    right = pairing(beta, alpha, final_exponentiate=False)
    right *= pairing(gamma, vk_x, final_exponentiate=False)
    right *= pairing(delta, C, final_exponentiate=False)

    return final_exponentiate(left) == final_exponentiate(right)
