# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

import hashlib

def generate(input_string: str) -> str:
    """
    Calculates the blake2b_256 hash digest of the input string.

    Args:
        input_string (str): The string to be hashed.

    Returns:
        str: The blake2b_256 hash digest of the input string.
    """
    # Encode the input string to bytes before hashing
    encoded_string = input_string.encode("utf-8")

    # Calculate the hash digest using blake2b_224
    hash_digest = hashlib.blake2b(encoded_string, digest_size=32).hexdigest()

    return hash_digest

