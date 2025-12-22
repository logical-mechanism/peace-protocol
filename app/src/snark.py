import datetime
import json
import subprocess
import sys

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
