import subprocess

from src.files import load_json
from pathlib import Path
from py_ecc.optimized_bls12_381 import (
    FQ,
    FQ2,
    add,
    multiply,
    pairing,
    final_exponentiate,
)


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
        "-a", str(a),
        "-w", w,
    ]

    output = subprocess.run(cmd, capture_output=True, text=True, check=True)
    print(output.stderr.strip())
    print(output.stdout.strip())

def _g1_from_xy_dec(xy: list[str] | tuple[str, str]):
    """
    xy: ["x_dec", "y_dec"]
    returns Jacobian (x,y,z) with z=1
    """
    x = FQ(int(xy[0]))
    y = FQ(int(xy[1]))
    return (x, y, FQ.one())


def _g2_from_xy_dec(xy: list[list[str]] | tuple[tuple[str, str], tuple[str, str]]):
    """
    xy: [[x0_dec, x1_dec], [y0_dec, y1_dec]]
    where Fp2 = c0 + c1*u (py_ecc uses [c0, c1])
    returns Jacobian (x,y,z) with z=1
    """
    x = FQ2([int(xy[0][0]), int(xy[0][1])])
    y = FQ2([int(xy[1][0]), int(xy[1][1])])
    return (x, y, FQ2.one())


def verify_snark_proof(out_dir: str | Path = "out") -> bool:
    """
    Verify Groth16 proof exported by your Go ExportAll().

    Expects:
      - out/vk.json     (alpha_g1, beta_g2, gamma_g2, delta_g2, ic[])
      - out/proof.json  (a, b, c)
      - out/public.json (inputs[])

    Returns:
      True if valid, False otherwise.
    """
    out_dir = Path(out_dir)

    vk = load_json(out_dir / "vk.json")
    proof = load_json(out_dir / "proof.json")
    public = load_json(out_dir / "public.json")

    # --- parse vk ---
    alpha = _g1_from_xy_dec(vk["alpha_g1"])
    beta = _g2_from_xy_dec(vk["beta_g2"])
    gamma = _g2_from_xy_dec(vk["gamma_g2"])
    delta = _g2_from_xy_dec(vk["delta_g2"])
    IC = [_g1_from_xy_dec(p) for p in vk["ic"]]

    # --- parse proof ---
    A = _g1_from_xy_dec(proof["a"])
    B = _g2_from_xy_dec(proof["b"])
    C = _g1_from_xy_dec(proof["c"])

    # --- public inputs (already Fr elements as decimal strings) ---
    inputs = public["inputs"]
    if not isinstance(inputs, list):
        raise TypeError("public.json: 'inputs' must be a list")
    
    if len(IC) != len(inputs) + 1:
        # Must match groth16: IC[0] + sum(inputs[i] * IC[i+1])
        raise ValueError(f"IC length mismatch: len(IC)={len(IC)} vs len(inputs)+1={len(inputs)+1}")

    # Compute vk_x in G1
    vk_x = IC[0]
    for i, s in enumerate(inputs):
        vk_x = add(vk_x, multiply(IC[i + 1], int(s)))

    # Groth16 check (pairing wants (Q in G2, P in G1))
    # We compute:
    #   e(B, A) ?= e(beta, alpha) * e(gamma, vk_x) * e(delta, C)
    #
    # Do pairings without final exponentiation, then final-exponentiate once.
    left = pairing(B, A, final_exponentiate=False)
    right = pairing(beta, alpha, final_exponentiate=False)
    right *= pairing(gamma, vk_x, final_exponentiate=False)
    right *= pairing(delta, C, final_exponentiate=False)

    return final_exponentiate(left) == final_exponentiate(right)