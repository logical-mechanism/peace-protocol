# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

# vk_convert.py

"""
Convert gnark VK JSON to Cardano CLI JSON datum format for SnarkVerificationKey.

gnark outputs:
  - vk.json: {nPublic, vkAlpha, vkBeta, vkGamma, vkDelta, vkIC, commitmentKeys}

Aiken SnarkVerificationKey is constructor 0 with fields:
  [nPublic: Int, vkAlpha: ByteArray, vkBeta: ByteArray, vkGamma: ByteArray,
   vkDelta: ByteArray, vkIC: List<ByteArray>, commitmentKeys: List<CommitmentKey>]

CommitmentKey is constructor 0 with fields [g: ByteArray, gSigmaNeg: ByteArray]
"""

import json
import sys
from pathlib import Path
from typing import Any


def vk_to_datum(vk: dict[str, Any]) -> dict[str, Any]:
    """
    Convert gnark vk.json to Cardano CLI JSON datum format.

    Args:
        vk: Dict from gnark's vk.json

    Returns:
        Cardano CLI JSON representation of SnarkVerificationKey
    """
    return {
        "constructor": 0,
        "fields": [
            {"int": vk["nPublic"]},
            {"bytes": vk["vkAlpha"]},
            {"bytes": vk["vkBeta"]},
            {"bytes": vk["vkGamma"]},
            {"bytes": vk["vkDelta"]},
            {"list": [{"bytes": ic} for ic in vk["vkIC"]]},
            {
                "list": [
                    {
                        "constructor": 0,
                        "fields": [
                            {"bytes": ck["g"]},
                            {"bytes": ck["gSigmaNeg"]},
                        ],
                    }
                    for ck in vk["commitmentKeys"]
                ]
            },
        ],
    }


def convert_vk_file(
    input_path: str | Path,
    output_path: str | Path,
) -> None:
    """
    Read gnark vk.json and write Cardano CLI JSON datum file.

    Args:
        input_path: Path to gnark's vk.json
        output_path: Path to write Cardano CLI JSON
    """
    with open(input_path, "r") as f:
        vk = json.load(f)

    datum = vk_to_datum(vk)

    with open(output_path, "w") as f:
        json.dump(datum, f, indent=4)
        f.write("\n")


def main() -> None:
    """CLI: read vk.json from arg, write datum JSON to stdout or file."""
    if len(sys.argv) < 2:
        print(
            "Usage: python -m src.vk_convert <vk.json> [output.json]", file=sys.stderr
        )
        sys.exit(1)

    input_path = sys.argv[1]

    with open(input_path, "r") as f:
        vk = json.load(f)

    datum = vk_to_datum(vk)

    if len(sys.argv) >= 3:
        with open(sys.argv[2], "w") as f:
            json.dump(datum, f, indent=4)
            f.write("\n")
    else:
        json.dump(datum, sys.stdout, indent=4)
        print()


if __name__ == "__main__":
    main()
