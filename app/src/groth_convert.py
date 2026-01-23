# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

# groth_convert.py

"""
Convert gnark Groth16 proof output to Aiken/Cardano CLI JSON format.

gnark outputs:
  - proof.json: {piA, piB, piC, commitments, commitmentPok}
  - public.json: {inputs: [...], commitmentWire: "..."}

Aiken/Cardano expects:
  - GrothProof: constructor 0 with fields [piA, piB, piC, commitments, commitmentPok]
  - GrothPublic: List<Int> (public inputs without leading "1")
  - commitment_wires: List<Int>
"""

import json
from pathlib import Path
from typing import Any


def gnark_proof_to_aiken(gnark_proof: dict[str, Any]) -> dict[str, Any]:
    """
    Convert gnark proof.json format to Aiken/Cardano GrothProof JSON.

    Args:
        gnark_proof: Dict with keys: piA, piB, piC, commitments, commitmentPok

    Returns:
        Cardano CLI JSON representation of GrothProof
    """
    # GrothProof is a record type with constructor 0
    # Fields order: piA, piB, piC, commitments, commitmentPok
    return {
        "constructor": 0,
        "fields": [
            {"bytes": gnark_proof["piA"]},
            {"bytes": gnark_proof["piB"]},
            {"bytes": gnark_proof["piC"]},
            {"list": [{"bytes": c} for c in gnark_proof.get("commitments", [])]},
            {"bytes": gnark_proof.get("commitmentPok", "")},
        ],
    }


def gnark_public_to_aiken(gnark_public: dict[str, Any]) -> dict[str, Any]:
    """
    Convert gnark public.json format to Aiken/Cardano GrothPublic JSON.

    gnark's public.json has:
      - inputs: ["1", "val1", "val2", ...] - 37 values, first is always "1"
      - commitmentWire: "..." - the commitment wire value

    Aiken expects:
      - public: List<Int> - 36 values (inputs[1:], without the leading "1")

    Args:
        gnark_public: Dict with keys: inputs, commitmentWire

    Returns:
        Cardano CLI JSON representation of List<Int>
    """
    inputs = gnark_public.get("inputs", [])

    # Skip the first "1" - gnark includes it but Aiken verifier doesn't expect it
    # (the constant term is handled separately via IC[0])
    public_inputs = inputs[1:] if inputs else []

    return {"list": [{"int": int(v)} for v in public_inputs]}


def gnark_commitment_wires_to_aiken(gnark_public: dict[str, Any]) -> dict[str, Any]:
    """
    Extract commitment wires from gnark public.json to Aiken/Cardano JSON.

    Args:
        gnark_public: Dict with key: commitmentWire

    Returns:
        Cardano CLI JSON representation of List<Int>
    """
    wire = gnark_public.get("commitmentWire")

    if wire:
        return {"list": [{"int": int(wire)}]}
    else:
        return {"list": []}


def convert_proof_file(
    gnark_proof_path: str | Path,
    output_path: str | Path,
) -> None:
    """
    Read gnark proof.json and write Aiken/Cardano groth-proof.json.

    Args:
        gnark_proof_path: Path to gnark's proof.json
        output_path: Path to write Aiken/Cardano JSON
    """
    with open(gnark_proof_path, "r") as f:
        gnark_proof = json.load(f)

    aiken_proof = gnark_proof_to_aiken(gnark_proof)

    with open(output_path, "w") as f:
        json.dump(aiken_proof, f, indent=4)


def convert_public_file(
    gnark_public_path: str | Path,
    output_path: str | Path,
) -> None:
    """
    Read gnark public.json and write Aiken/Cardano groth-public.json.

    Args:
        gnark_public_path: Path to gnark's public.json
        output_path: Path to write Aiken/Cardano JSON
    """
    with open(gnark_public_path, "r") as f:
        gnark_public = json.load(f)

    aiken_public = gnark_public_to_aiken(gnark_public)

    with open(output_path, "w") as f:
        json.dump(aiken_public, f, indent=4)


def convert_commitment_wires_file(
    gnark_public_path: str | Path,
    output_path: str | Path,
) -> None:
    """
    Read gnark public.json and write Aiken/Cardano groth-commitment-wires.json.

    Args:
        gnark_public_path: Path to gnark's public.json
        output_path: Path to write Aiken/Cardano JSON
    """
    with open(gnark_public_path, "r") as f:
        gnark_public = json.load(f)

    aiken_wires = gnark_commitment_wires_to_aiken(gnark_public)

    with open(output_path, "w") as f:
        json.dump(aiken_wires, f, indent=4)


def convert_all(
    gnark_proof_path: str | Path,
    gnark_public_path: str | Path,
    output_dir: str | Path,
    proof_filename: str = "groth-proof.json",
    public_filename: str = "groth-public.json",
    wires_filename: str = "groth-commitment-wires.json",
) -> None:
    """
    Convert all gnark output files to Aiken/Cardano format.

    Args:
        gnark_proof_path: Path to gnark's proof.json
        gnark_public_path: Path to gnark's public.json
        output_dir: Directory to write output files
        proof_filename: Name for proof output file
        public_filename: Name for public inputs output file
        wires_filename: Name for commitment wires output file
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    convert_proof_file(gnark_proof_path, output_dir / proof_filename)
    convert_public_file(gnark_public_path, output_dir / public_filename)
    convert_commitment_wires_file(gnark_public_path, output_dir / wires_filename)
