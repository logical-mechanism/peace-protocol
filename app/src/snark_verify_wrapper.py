# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

# snark_verify_wrapper.py

"""
Wrapper to verify Groth16 proofs using gnark's built-in verification.

This is more reliable than manual pairing computation because gnark uses
internal optimizations that may not match the textbook Groth16 equation.
"""

import os
import subprocess
from pathlib import Path


def verify_snark_proof_via_go(out_dir: str | Path = "out") -> bool:
    """
    Verify a Groth16 proof using gnark's built-in verification.

    Args:
        out_dir: Directory containing vk.json, proof.json, and public.json

    Returns:
        True if proof is valid, False otherwise
    """
    out_dir = Path(out_dir)
    snark_path = Path(os.getcwd()) / "snark" / "snark"

    try:
        result = subprocess.run(
            [str(snark_path), "verify", "-out", str(out_dir)],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        print(f"Error calling snark verify: {e}")
        return False
