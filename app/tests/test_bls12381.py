# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

# tests/test_bls12381.py

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
    from_int,
    invert,
    rng,
    random_fq12,
    curve_order,
)


def test_rng_range_and_nonzero():
    for _ in range(25):
        x = rng()
        assert 1 <= x < curve_order


def test_g1_identity():
    g0 = g1_point(0)
    assert g0 == g1_identity


def test_g2_identity():
    g0 = g2_point(0)
    assert g0 == g2_identity


def test_uncompress_branch_selection_by_length():
    g1 = g1_point(1)
    g2 = g2_point(1)
    assert len(g1) == 96  # G1 compressed pubkey hex length
    assert len(g2) != 96  # G2 compressed signature hex length (typically 192)

    # Should not raise
    uncompress(g1)
    uncompress(g2)


def test_g1_compress_is_uncompressed_roundtrip():
    scalar = 123456789
    compressed_g1_point = g1_point(scalar)
    uncompressed_g1_point = uncompress(compressed_g1_point)
    recompressed_g1_point = compress(uncompressed_g1_point)
    assert recompressed_g1_point == compressed_g1_point


def test_g2_compress_is_uncompressed_roundtrip():
    scalar = 123456789
    compressed_g2_point = g2_point(scalar)
    uncompressed_g2_point = uncompress(compressed_g2_point)
    recompressed_g2_point = compress(uncompressed_g2_point)
    assert recompressed_g2_point == compressed_g2_point


def test_scale_zero_is_identity_for_g1_and_g2():
    assert scale(g1_point(1), 0) == g1_identity
    assert scale(g2_point(1), 0) == g2_identity


def test_scale_identity_is_identity_for_g1_and_g2():
    assert scale(g1_identity, 123) == g1_identity
    assert scale(g2_identity, 123) == g2_identity


def test_combine_identity_is_noop_for_g1_and_g2():
    p1 = g1_point(42)
    q1 = g2_point(42)

    assert combine(p1, g1_identity) == p1
    assert combine(g1_identity, p1) == p1

    assert combine(q1, g2_identity) == q1
    assert combine(g2_identity, q1) == q1


def test_combine_commutative_for_g1_and_g2():
    a1 = g1_point(5)
    b1 = g1_point(9)
    assert combine(a1, b1) == combine(b1, a1)

    a2 = g2_point(5)
    b2 = g2_point(9)
    assert combine(a2, b2) == combine(b2, a2)


def test_g1_one_plus_one_equals_two():
    g1 = g1_point(1)
    added_g1 = combine(g1, g1)
    assert added_g1 == g1_point(2)


def test_g2_one_plus_one_equals_two():
    g2 = g2_point(1)
    added_g2 = combine(g2, g2)
    assert added_g2 == g2_point(2)


def test_invert_properties_g1():
    p = g1_point(123)
    n = invert(p)

    # invert(invert(P)) == P
    assert uncompress(invert(n)) == uncompress(p)

    # P + (-P) == identity
    assert combine(p, n) == g1_identity


def test_invert_properties_g2():
    p = g2_point(123)
    n = invert(p)

    # invert(invert(P)) == P
    assert uncompress(invert(n)) == uncompress(p)

    # P + (-P) == identity
    assert combine(p, n) == g2_identity


def test_invert_identity_is_identity():
    assert invert(g1_identity) == g1_identity
    assert invert(g2_identity) == g2_identity


def test_uncompress_invalid_hex_raises():
    with pytest.raises(ValueError):
        uncompress("zz")  # not hex

    with pytest.raises(ValueError):
        uncompress("ab")  # too short, will hit G2 branch and fail in py_ecc


def test_printing_fq12_regression_vector():
    # Regression vector test from your original suite
    u1g1 = g1_point(1)
    v1g2 = g2_point(1)

    kappa = pair(scale(u1g1, 31), scale(v1g2, 7))
    assert (
        fq12_encoding(kappa, F12_DOMAIN_TAG)
        == "f057b04a6426f94e73ecc34ed81c604a259bddcd556a047fdb1986d7"
    )


def test_pair_final_exponentiate_flag_does_not_break_type_or_determinism():
    g1 = g1_point(3)
    g2 = g2_point(11)

    a = pair(g1, g2, final_exponentiate=True)
    b = pair(g1, g2, final_exponentiate=True)
    assert a == b

    c = pair(g1, g2, final_exponentiate=False)
    d = pair(g1, g2, final_exponentiate=False)
    assert c == d

    # Typically these differ (miller loop vs final exponentiation), but at least ensure no crash
    assert a is not None
    assert c is not None


def test_dividing_pairing():
    u1g1 = g1_point(1)
    v1g2 = g2_point(1)

    a = pair(scale(u1g1, 31), scale(v1g2, 7))
    b = pair(scale(u1g1, 7), scale(v1g2, 7))
    c = pair(scale(u1g1, 168), scale(v1g2, 1))
    d = a / b

    assert c == d


def test_fq12_encoding_domain_tag_changes_output():
    u1g1 = g1_point(1)
    v1g2 = g2_point(1)
    kappa = pair(scale(u1g1, 31), scale(v1g2, 7))

    e1 = fq12_encoding(kappa, F12_DOMAIN_TAG)
    e2 = fq12_encoding(kappa, F12_DOMAIN_TAG + "_DIFF")

    assert isinstance(e1, str)
    assert isinstance(e2, str)
    assert e1 != e2


def test_hash_to_int():
    h = generate("acab")
    n = to_int(h)
    assert n == 1028703146767339290293633951186123731886171864122866591065320629138


def test_to_int_accepts_uppercase_hex():
    assert to_int("FF") == (255 % curve_order)
    assert to_int("0A") == (10 % curve_order)


def test_from_int_encodes_minimal_and_zero_special_case():
    assert from_int(0) == "00"
    assert from_int(1) == "01"
    assert from_int(255) == "ff"
    assert from_int(256) == "0100"  # minimal big-endian

    # Roundtrip: int(hex,16) yields original
    for v in [0, 1, 2, 15, 16, 255, 256, 257, 2**64 + 12345]:
        assert int(from_int(v), 16) == v


def test_random_fq12_is_deterministic_given_scalar():
    a = 424242
    assert random_fq12(a) == random_fq12(a)


def test_random_fq12_matches_direct_construction():
    # random_fq12(a) is fq12_encoding(pair([a]G1, H0), F12_DOMAIN_TAG)
    a = 123456
    direct = fq12_encoding(pair(scale(g1_point(1), a), H0), F12_DOMAIN_TAG)
    assert random_fq12(a) == direct


def test_pairing_division_protocol_style_deterministic():
    # Deterministic variant of your original test (no rng() / no prints)
    a0 = 111111
    r0 = 222222
    m0 = random_fq12(a0)

    sk = 123456789
    h0x = scale(H0, sk)

    r1b = scale(g1_point(1), r0)
    r2_g1b = scale(g1_point(1), a0 + r0 * sk)

    r2 = pair(r2_g1b, H0)
    b = pair(r1b, h0x)

    key = fq12_encoding(r2 / b, F12_DOMAIN_TAG)

    kappa = pair(scale(g1_point(1), a0), H0)
    m = fq12_encoding(kappa, F12_DOMAIN_TAG)

    assert m0 == m
    assert isinstance(key, str)


if __name__ == "__main__":
    pytest.main()
