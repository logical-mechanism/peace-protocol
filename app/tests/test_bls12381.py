# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only
import pytest
from src.constants import H0, F12_DOMAIN_TAG
from src.hashing import generate
from src.bls12381 import (
    g1_identity,
    g1_point,
    g2_identity,
    g2_point,
    compress,
    uncompress,
    combine,
    scale,
    pair,
    fq12_encoding,
    to_int,
    invert,
    rng,
    random_fq12,
)


def test_g1_identity():
    g0 = g1_point(0)
    assert g0 == g1_identity


def test_g2_identity():
    g0 = g2_point(0)
    assert g0 == g2_identity


def test_g1_compress_is_uncompressed():
    scalar = 123456789  # Example scalar value
    compressed_g1_point = g1_point(scalar)
    uncompressed_g1_point = uncompress(compressed_g1_point)
    recompressed_g1_point = compress(uncompressed_g1_point)
    assert recompressed_g1_point == compressed_g1_point


def test_uncompress_and_scale():
    scalar = 123456789  # Example scalar value
    compressed_g1_point = scale(H0, scalar)
    assert (
        compressed_g1_point
        == "b6081e4d6b7de4b0683efb76a6383212e811d455a28174cd2da6ee665b77d8e5367a7a46507287b1f9585dfdb7ca27ca07765a8e778e6c4a3923e74432e6060578d2f4afabaf30ccece9ddcac9ff1c09da189974656c0ccc7b8f10b20b1bf288"
    )


def test_g2_compress_is_uncompressed():
    scalar = 123456789  # Example scalar value
    compressed_g2_point = g2_point(scalar)
    uncompressed_g2_point = uncompress(compressed_g2_point)
    recompressed_g2_point = compress(uncompressed_g2_point)
    assert recompressed_g2_point == compressed_g2_point


def test_g1_one_plus_one_equals_two():
    g1 = g1_point(1)
    added_g1 = combine(g1, g1)
    assert added_g1 == g1_point(2)


def test_g2_one_plus_one_equals_two():
    g2 = g2_point(1)
    added_g2 = combine(g2, g2)
    assert added_g2 == g2_point(2)


def test_printing_fq12():
    u1g1 = g1_point(1)
    v1g2 = g2_point(1)

    kappa = pair(scale(u1g1, 31), scale(v1g2, 7))
    assert (
        fq12_encoding(kappa, F12_DOMAIN_TAG)
        == "f057b04a6426f94e73ecc34ed81c604a259bddcd556a047fdb1986d7"
    )


def test_dividing_pairing():
    u1g1 = g1_point(1)
    v1g2 = g2_point(1)

    a = pair(scale(u1g1, 31), scale(v1g2, 7))
    b = pair(scale(u1g1, 7), scale(v1g2, 7))
    c = pair(scale(u1g1, 168), scale(v1g2, 1))
    d = a / b

    assert c == d


def test_hash_to_int():
    h = generate("acab")
    n = to_int(h)
    assert n == 1028703146767339290293633951186123731886171864122866591065320629138


def test_g1_invert_of_an_invert_is_equal():
    g1 = g1_point(1)
    gi = invert(g1)
    g = invert(gi)
    assert uncompress(g1) == uncompress(g)


def test_g2_invert_of_an_invert_is_equal():
    g2 = g2_point(1)
    gi = invert(g2)
    g = invert(gi)
    assert uncompress(g2) == uncompress(g)


def test_pairing_division():
    a0 = rng()
    r0 = rng()
    m0 = random_fq12(a0)
    print(f"SECRET: {m0}")

    sk = 123456789
    h0x = scale(H0, sk)

    r1b = scale(g1_point(1), r0)
    r2_g1b = scale(g1_point(1), a0 + r0 * sk)

    r2 = pair(r2_g1b, H0)
    b = pair(r1b, h0x)

    key = fq12_encoding(r2 / b, F12_DOMAIN_TAG)
    print(key)

    kappa = pair(scale(g1_point(1), a0), H0)
    m = fq12_encoding(kappa, F12_DOMAIN_TAG)
    assert m0 == m


if __name__ == "__main__":
    pytest.main()
