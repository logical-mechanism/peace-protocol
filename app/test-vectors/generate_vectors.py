#!/usr/bin/env python3

# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

"""
Generate payload-vectors.json for cross-platform CBOR mirror tests.

Run from the app/ directory:
    PYTHONPATH=. python test-vectors/generate_vectors.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.payload import build_payload


def make_vector(
    name: str,
    locator_hex: str,
    secret_hex: str | None = None,
    digest_hex: str | None = None,
    extra: dict[int, str] | None = None,
) -> dict:
    locator = bytes.fromhex(locator_hex)
    secret = bytes.fromhex(secret_hex) if secret_hex else None
    digest = bytes.fromhex(digest_hex) if digest_hex else None
    extra_bytes = {k: bytes.fromhex(v) for k, v in extra.items()} if extra else None

    cbor_bytes = build_payload(locator, secret, digest, extra_bytes)

    fields: dict[str, str] = {"0": locator_hex}
    if secret_hex is not None:
        fields["1"] = secret_hex
    if digest_hex is not None:
        fields["2"] = digest_hex
    if extra:
        for k, v in extra.items():
            fields[str(k)] = v

    return {
        "name": name,
        "fields": fields,
        "cbor_hex": cbor_bytes.hex(),
    }


vectors = [
    make_vector("locator-only-short", "deadbeef"),
    make_vector("locator-only-empty", ""),
    make_vector(
        "all-three-short",
        "aabbccdd",
        "11223344",
        "55667788",
    ),
    make_vector(
        "all-three-32byte",
        "66141dbbc84e7d5454685ab85f72492489b35ae020f4b444348e73c46ff9b009",
        "8a6bed6b72cfe64fb8e9531badf2cd6d199a2fcd9120057d29711fcf5f8fab15",
        "0f009e94729eff9859b40fcef993144b6087a0ca8523e4681b0c8ac71833e6b7",
    ),
    make_vector(
        "locator-and-digest-no-secret",
        "aabbccdd",
        None,
        "11223344",
    ),
    make_vector(
        "locator-and-secret-no-digest",
        "aabbccdd",
        "11223344",
    ),
    make_vector(
        "with-extra-field",
        "aabbccdd",
        "11223344",
        "55667788",
        {3: "99aabbcc"},
    ),
    make_vector(
        "single-byte-locator",
        "ff",
    ),
    make_vector(
        "large-locator-64byte",
        "00" * 64,
    ),
]

out_path = Path(__file__).resolve().parent / "payload-vectors.json"
out_path.write_text(json.dumps(vectors, indent=2) + "\n")
print(f"Wrote {len(vectors)} vectors to {out_path}")
