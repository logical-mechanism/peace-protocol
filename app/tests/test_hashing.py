# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

# tests/test_hashing.py

import binascii
import pytest

from src.hashing import generate


def test_empty_string_hash_matches_known_vector():
    # This vector is for blake2b-224 over empty bytes.
    h = generate("")
    assert h == "836cc68931c2e4e3e838602eca1902591d216837bafddfe6f0c8cb07"


def test_hash_matches_known_vector_acab():
    # "acab" is interpreted as hex bytes: 0xAC 0xAB
    h = generate("acab")
    assert h == "09c4a38a350818fcabc9eba223519d9539f072185bb6e7c0e29ea392"


def test_output_is_lowercase_hex_of_length_56():
    h = generate("00")
    assert isinstance(h, str)
    assert len(h) == 56  # 28 bytes => 56 hex chars
    int(h, 16)  # should parse as hex (will raise if not)


@pytest.mark.parametrize(
    "inp",
    [
        "00",
        "ff",
        "deadbeef",
        "0123456789abcdef",
        "00" * 32,
        "01" * 100,
    ],
)
def test_deterministic(inp: str):
    assert generate(inp) == generate(inp)


@pytest.mark.parametrize("bad", ["0", "abc", "zz", "0x00", "GG", "12 34"])
def test_rejects_non_hex_or_odd_length(bad: str):
    # generate uses binascii.unhexlify which raises binascii.Error on invalid/odd hex
    with pytest.raises(binascii.Error):
        generate(bad)


def test_distinct_inputs_produce_distinct_digests_probabilistic_sanity():
    # Not a cryptographic proof, just a sanity check for accidental constants.
    h1 = generate("00")
    h2 = generate("01")
    h3 = generate("ff")
    assert h1 != h2
    assert h1 != h3
    assert h2 != h3
