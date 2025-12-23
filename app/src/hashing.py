# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

import hashlib
import binascii


def generate(input_string: str) -> str:
    """
    Calculates the blake2b_224 hash digest of the input string.

    Args:
        input_string (str): The string to be hashed.

    Returns:
        str: The blake2b_224 hash digest of the input string.
    """
    # Calculate the hash digest using blake2b_224
    hash_digest = hashlib.blake2b(
        binascii.unhexlify(input_string), digest_size=28
    ).hexdigest()

    return hash_digest


def public_inputs_from_w_hex(w_hex: str) -> list[str]:
    """
    Mimic gnark's public input derivation from compressed W.

    Steps:
      1) w_bytes = bytes.fromhex(w_hex)              # 48 bytes expected
      2) d = sha256(w_bytes).digest()                # 32 bytes
      3) i0 = int.from_bytes(d[0:16], "big")
         i1 = int.from_bytes(d[16:32], "big")
      4) inputs = [str(i0), str(i1), "0"]            # trailing 0 matches your export
    """
    w_hex = w_hex.strip().lower()
    if w_hex.startswith("0x"):
        w_hex = w_hex[2:]

    w_bytes = bytes.fromhex(w_hex)
    if len(w_bytes) != 48:
        raise ValueError(f"compressed W must be 48 bytes (96 hex chars), got {len(w_bytes)} bytes")

    d = hashlib.sha256(w_bytes).digest()
    i0 = int.from_bytes(d[:16], "big")
    i1 = int.from_bytes(d[16:], "big")
    return [str(i0), str(i1), "0"]