import subprocess

from pathlib import Path


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
    print(output.stdout.strip())

def verify_snark_proof():
    pass