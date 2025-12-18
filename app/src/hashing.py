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
    hash_digest = hashlib.blake2b(binascii.unhexlify(input_string), digest_size=28).hexdigest()

    return hash_digest

