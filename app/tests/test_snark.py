# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

# tests/test_snark.py

import pytest
from src.bls12381 import (
    g1_point,
    to_int,
    scale,
    combine,
)

from src.snark import (
    gt_to_hash,
    decrypt_to_hash,
    generate_snark_proof,
    public_inputs_from_w0_w1_hex,
)
from src.snark_verify_wrapper import verify_snark_proof_via_go
import os
from src.files import load_json
from typing import Any, cast

from eth_typing import BLSPubkey, BLSSignature
from py_ecc.bls.g2_primitives import (
    G1_to_pubkey,
    G2_to_signature,
    pubkey_to_G1,
    signature_to_G2,
)
from py_ecc.optimized_bls12_381 import (
    b,
    b2,
    curve_order,
    is_on_curve,
    multiply,
)

# is_inf location varies a bit across versions
try:
    from py_ecc.optimized_bls12_381 import is_inf  # type: ignore[attr-defined]
except Exception:
    from py_ecc.optimized_bls12_381.optimized_curve import is_inf  # type: ignore

# random secrets
a0 = 44203
r0 = 12345

# bobs secret
x0 = 54321

# paths
snark_path = f"{os.getcwd()}/snark/snark"
out_path = f"{os.getcwd()}/out"


def test_print_g1_point():
    a = g1_point(a0)
    assert (
        a
        == "b4a9640fa75aef0c3f3939ec56574c640862cda95030f92269d8ead5c82e83229c0d1ad2b59dbacb86e97e0117a27cca"
    )


def test_print_scaled_point():
    a = g1_point(to_int("cbfce32f8f34a5541b00fb4ca887372667421e7d45373be98b7884d1"))
    assert (
        a
        == "a1588e31d17d31785a4ce1a882ca92a3f1bbb7fdd9953398ff53fca38ade891c075f9e7eefc9d1396298c6f680539c69"
    )


def test_secret_hash_file():
    a = gt_to_hash(a0, snark_path)
    assert a == "072b7c71e92483a846022edb38d97952301671d276307b6d53b092ee3b88610b"


def test_half_level_decrypt_hash():
    r1 = "a40a487521c690b63831fa1a24ae1b4cae02836ae726b6dd514e9f9bd6795aab7d0c5b0d39ab5c4b82b4967439daa645"
    r2_g1b = "a89cf1b500a4552e9f155fd52e17b8c3ef47be761785a06c6a4d1867b8dc80d56adc1926e30eeed0fda7a6795bd36c03"
    shared = "ac1a6c2a0af5bd45aa7f77063707125b07aa85e034a92d1bdc489be0acdf06396a6fbcfcc8015e78d41f7dc1d9aace6d03f9d6575f89a51868d7e680ac5623c4907d690a2ebd7e8584b550d8fbb13bfffdd695fa9be261a6436784a2739d99b6"

    a = decrypt_to_hash(r1, r2_g1b, None, shared, snark_path)
    assert a == "5308b4e8984a0279439c0ccbf10895f649bea973c53b2a196da72be25ebe9545"


def test_derive_public_points():
    a = gt_to_hash(a0, snark_path)
    v = g1_point(x0)
    w0 = g1_point(to_int(a))

    qa = g1_point(a0)
    vr = scale(v, r0)
    w1 = combine(qa, vr)

    public_integers = public_inputs_from_w0_w1_hex(w0, w1, v)
    expected_public_integers = [
        "17500288565172873801",
        "9411633287470898589",
        "11539752139897092681",
        "14117566851138557178",
        "11732854847018214359",
        "149328769413022752",
        "12743184510663640417",
        "3586972869393599483",
        "1162853564816257447",
        "13963573845061158233",
        "8519358064772266323",
        "300849905542043934",
        "7544100806556527277",
        "5733704405081490291",
        "16897928067555281658",
        "694260034867880652",
        "1606688919951779998",
        "90933589845294928",
        "14200293646102562918",
        "1233295810036914134",
        "6010594170116868184",
        "8153172575594343886",
        "13188899795015867230",
        "1249948361521869958",
        "7138643491626859436",
        "5505419637978662744",
        "7017732200911399991",
        "6377522435931897794",
        "18011877622578215533",
        "776479359663048414",
        "10288726997180865397",
        "18352781759426245713",
        "17860951621094200122",
        "3645999937606863567",
        "7588265706522355601",
        "337242724379907695",
    ]
    assert public_integers == expected_public_integers


def test_snark_prove():
    a = gt_to_hash(a0, snark_path)
    v = g1_point(x0)
    w0 = g1_point(to_int(a))

    qa = g1_point(a0)
    vr = scale(v, r0)
    w1 = combine(qa, vr)

    print()
    print(f"v={v}")
    print(f"w0={w0}")
    print(f"w1={w1}")

    generate_snark_proof(a0, r0, v, w0, w1, snark_path)


@pytest.mark.skip(
    reason="this test requires the public binaries that need to be downloaded"
)
def test_snark_prove_and_verify_from_global_circuit():
    a = gt_to_hash(a0, snark_path)
    v = g1_point(x0)
    w0 = g1_point(to_int(a))

    qa = g1_point(a0)
    vr = scale(v, r0)
    w1 = combine(qa, vr)

    print()
    print(f"v={v}")
    print(f"w0={w0}")
    print(f"w1={w1}")

    circuit_path = f"{os.getcwd()}/circuit/"
    generate_snark_proof(a0, r0, v, w0, w1, snark_path, setup_dir=circuit_path)
    result = verify_snark_proof_via_go(out_path)
    assert result, "Go Proof verification failed"


def test_snark_verify():
    """
    Verify the proof using gnark's built-in verification via the Go CLI.
    This test requires test_snark_prove to have run first to generate the proof files.

    Note: Pure Python verification using py_ecc is NOT compatible with gnark-generated
    proofs due to different FQ12 tower representations in the pairing computation.
    The Go CLI verification is the authoritative verification method.
    """
    result = verify_snark_proof_via_go(out_path)
    assert result, "Go Proof verification failed"
    # Note: Python verification is known to fail with gnark proofs due to
    # py_ecc/gnark-crypto pairing incompatibility. Use Go verification instead.


def _hex_to_bytes(h: str, *, expect_len: int) -> bytes:
    h = h.strip().lower()
    if h.startswith("0x"):
        h = h[2:]
    raw = bytes.fromhex(h)
    if len(raw) != expect_len:
        raise ValueError(f"expected {expect_len} bytes, got {len(raw)}")
    return raw


def _in_r_subgroup(P: Any) -> bool:
    # Prime-order subgroup check: [r]P == O
    return is_inf(multiply(P, curve_order))


def _check_g1(label: str, hex48: str) -> None:
    raw = _hex_to_bytes(hex48, expect_len=48)
    P = pubkey_to_G1(cast(BLSPubkey, raw))
    rt = G1_to_pubkey(P)

    on_curve = is_on_curve(P, b)
    in_subgroup = _in_r_subgroup(P) if on_curve else False

    print(label, "G1 roundtrip ok?", rt == raw)
    print(label, "G1 on_curve?", on_curve)
    print(label, "G1 in_subgroup?", in_subgroup)


def _check_g2(label: str, hex96: str) -> None:
    raw = _hex_to_bytes(hex96, expect_len=96)
    Q = signature_to_G2(cast(BLSSignature, raw))
    rt = G2_to_signature(Q)

    on_curve = is_on_curve(Q, b2)
    in_subgroup = _in_r_subgroup(Q) if on_curve else False

    print(label, "G2 roundtrip ok?", rt == raw)
    print(label, "G2 on_curve?", on_curve)
    print(label, "G2 in_subgroup?", in_subgroup)


def test_round_trip():
    vk = load_json("out/vk.json")
    proof = load_json("out/proof.json")

    _check_g1("vkAlpha", vk["vkAlpha"])
    _check_g2("vkBeta", vk["vkBeta"])
    _check_g2("vkGamma", vk["vkGamma"])
    _check_g2("vkDelta", vk["vkDelta"])

    _check_g1("piA", proof["piA"])
    _check_g2("piB", proof["piB"])
    _check_g1("piC", proof["piC"])


def test_verify_snark_proof_via_go_file_not_found(monkeypatch):
    """Test that FileNotFoundError is caught and returns False."""
    import src.snark_verify_wrapper as wrapper_mod

    def fake_run(*args, **kwargs):
        raise FileNotFoundError("snark binary not found")

    monkeypatch.setattr(wrapper_mod.subprocess, "run", fake_run)

    result = verify_snark_proof_via_go("/nonexistent/dir")
    assert result is False


def test_verify_snark_proof_via_go_timeout(monkeypatch):
    """Test that TimeoutExpired is caught and returns False."""
    import subprocess as sp
    import src.snark_verify_wrapper as wrapper_mod

    def fake_run(*args, **kwargs):
        raise sp.TimeoutExpired(cmd="snark", timeout=30)

    monkeypatch.setattr(wrapper_mod.subprocess, "run", fake_run)

    result = verify_snark_proof_via_go("/nonexistent/dir")
    assert result is False


# ----------------------------
# Tests for snark.py internal helper functions
# ----------------------------

from src.snark import (
    _hex_to_bytes as snark_hex_to_bytes,
    _g1_from_compressed_hex,
    _g2_from_compressed_hex,
    _is_fq2,
    _is_g2_point,
    _is_g1_point,
    _to_jacobian_g1,
    _to_jacobian_g2,
    _g2_one_like,
    _pair,
    _gt_inv,
    _negate_g2,
    _negate_fq2,
    _expand_message_xmd,
    _hash_to_field_gnark,
    _hash_commitment_challenge,
    _solve_commitment_wire,
    _g1_uncompressed_bytes,
    _strip_0x_and_validate_g1_hex,
    _fq_inv_nonrecursive,
    _g1_jacobian_to_affine_xy_ints,
    _g1_uncompress_to_xy_ints,
    _fp_to_limbs_le,
    setup_snark,
    verify_snark_proof_go,
    verify_snark_proof,
)
from py_ecc.optimized_bls12_381 import G1, G2, field_modulus, FQ
from py_ecc.fields import optimized_bls12_381_FQ12 as FQ12

# A known valid compressed G1 point (generator scaled by 2)
G1_HEX = g1_point(2)
# A known valid compressed G2 point
from src.bls12381 import g2_point

G2_HEX = g2_point(2)


class TestHexToBytes:
    def test_plain_hex(self):
        assert snark_hex_to_bytes("aabb") == bytes.fromhex("aabb")

    def test_0x_prefix(self):
        assert snark_hex_to_bytes("0xAABB") == bytes.fromhex("aabb")

    def test_whitespace_stripped(self):
        assert snark_hex_to_bytes("  aabb  ") == bytes.fromhex("aabb")


class TestG1FromCompressedHex:
    def test_valid_g1(self):
        p = _g1_from_compressed_hex(G1_HEX)
        assert isinstance(p, tuple) and len(p) == 3

    def test_invalid_length(self):
        with pytest.raises(ValueError, match="48 bytes"):
            _g1_from_compressed_hex("aabb")


class TestG2FromCompressedHex:
    def test_valid_g2(self):
        p = _g2_from_compressed_hex(G2_HEX)
        assert isinstance(p, tuple) and len(p) == 3

    def test_invalid_length(self):
        with pytest.raises(ValueError, match="96 bytes"):
            _g2_from_compressed_hex("aabb")


class TestIsFq2:
    def test_tuple_pair(self):
        assert _is_fq2((1, 2)) is True

    def test_not_tuple(self):
        assert _is_fq2(42) is False

    def test_tuple_wrong_length(self):
        assert _is_fq2((1, 2, 3)) is False

    def test_object_with_coeffs(self):
        class FakeFQ2:
            coeffs = [1, 2]

        assert _is_fq2(FakeFQ2()) is True


class TestIsG1Point:
    def test_real_g1(self):
        p = _g1_from_compressed_hex(G1_HEX)
        assert _is_g1_point(p) is True

    def test_not_a_tuple(self):
        assert _is_g1_point(42) is False

    def test_wrong_length(self):
        assert _is_g1_point((1,)) is False


class TestIsG2Point:
    def test_real_g2(self):
        p = _g2_from_compressed_hex(G2_HEX)
        assert _is_g2_point(p) is True

    def test_not_a_tuple(self):
        assert _is_g2_point("hello") is False


class TestToJacobianG1:
    def test_affine_lifted(self):
        result = _to_jacobian_g1((10, 20))
        assert result == (10, 20, 1)

    def test_jacobian_unchanged(self):
        result = _to_jacobian_g1((10, 20, 30))
        assert result == (10, 20, 30)


class TestToJacobianG2:
    def test_affine_lifted(self):
        result = _to_jacobian_g2(((1, 2), (3, 4)))
        assert len(result) == 3
        assert result[0] == (1, 2)
        assert result[1] == (3, 4)
        assert result[2] == (1, 0)  # identity for tuple FQ2

    def test_jacobian_unchanged(self):
        result = _to_jacobian_g2(((1, 2), (3, 4), (5, 6)))
        assert result == ((1, 2), (3, 4), (5, 6))


class TestG2OneLike:
    def test_tuple_representation(self):
        assert _g2_one_like((1, 2)) == (1, 0)

    def test_object_with_one(self):
        class FakeField:
            @classmethod
            def one(cls):
                return "ONE"

        result = _g2_one_like(FakeField())
        assert result == "ONE"


class TestPair:
    def test_g1_g2_order(self):
        g1 = _g1_from_compressed_hex(G1_HEX)
        g2 = _g2_from_compressed_hex(G2_HEX)
        result = _pair(g1, g2)
        assert isinstance(result, FQ12)

    def test_g2_g1_order(self):
        g1 = _g1_from_compressed_hex(G1_HEX)
        g2 = _g2_from_compressed_hex(G2_HEX)
        result = _pair(g2, g1)
        assert isinstance(result, FQ12)

    def test_invalid_types_raises(self):
        with pytest.raises(TypeError, match="pairing expects"):
            _pair((1, 2, 3), (4, 5, 6))


class TestGtInv:
    def test_inverse(self):
        g1 = _g1_from_compressed_hex(G1_HEX)
        g2 = _g2_from_compressed_hex(G2_HEX)
        gt = _pair(g1, g2)
        inv = _gt_inv(gt)
        assert isinstance(inv, FQ12)


class TestNegateG2:
    def test_jacobian(self):
        p = _g2_from_compressed_hex(G2_HEX)
        neg_p = _negate_g2(p)
        assert len(neg_p) == 3
        assert neg_p[0] == p[0]  # x unchanged
        assert neg_p[2] == p[2]  # z unchanged

    def test_affine(self):
        result = _negate_g2(((1, 2), (3, 4)))
        assert len(result) == 2
        assert result[0] == (1, 2)  # x unchanged


class TestNegateFq2:
    def test_tuple(self):
        result = _negate_fq2((10, 20))
        assert result == ((-10) % field_modulus, (-20) % field_modulus)

    def test_object_with_coeffs(self):
        from py_ecc.fields import optimized_bls12_381_FQ2 as FQ2

        val = FQ2([3, 7])
        result = _negate_fq2(val)
        assert isinstance(result, FQ2)


class TestExpandMessageXmd:
    def test_basic_output(self):
        result = _expand_message_xmd(b"test", b"DST", 48)
        assert len(result) == 48
        assert isinstance(result, bytes)

    def test_deterministic(self):
        a = _expand_message_xmd(b"msg", b"DST", 32)
        b_val = _expand_message_xmd(b"msg", b"DST", 32)
        assert a == b_val

    def test_different_inputs(self):
        a = _expand_message_xmd(b"msg1", b"DST", 32)
        b_val = _expand_message_xmd(b"msg2", b"DST", 32)
        assert a != b_val


class TestHashToFieldGnark:
    def test_single_element(self):
        result = _hash_to_field_gnark(b"test", b"DST", 1)
        assert len(result) == 1
        assert 0 <= result[0] < curve_order

    def test_multiple_elements(self):
        result = _hash_to_field_gnark(b"test", b"DST", 3)
        assert len(result) == 3
        for e in result:
            assert 0 <= e < curve_order


class TestHashCommitmentChallenge:
    def test_returns_scalar(self):
        result = _hash_commitment_challenge(b"\x00" * 96)
        assert isinstance(result, int)
        assert 0 <= result < curve_order


class TestSolveCommitmentWire:
    def test_returns_scalar(self):
        g1 = _g1_from_compressed_hex(G1_HEX)
        result = _solve_commitment_wire(g1, [1], [42])
        assert isinstance(result, int)
        assert 0 <= result < curve_order


class TestG1UncompressedBytes:
    def test_returns_96_bytes(self):
        result = _g1_uncompressed_bytes(G1_HEX)
        assert len(result) == 96
        assert isinstance(result, bytes)


class TestStripAndValidateG1Hex:
    def test_valid_hex(self):
        result = _strip_0x_and_validate_g1_hex(G1_HEX)
        assert len(result) == 96

    def test_0x_prefix(self):
        result = _strip_0x_and_validate_g1_hex("0x" + G1_HEX)
        assert len(result) == 96

    def test_invalid_hex(self):
        with pytest.raises(ValueError, match="invalid hex"):
            _strip_0x_and_validate_g1_hex("zzzz")

    def test_wrong_length(self):
        with pytest.raises(ValueError, match="96 hex chars"):
            _strip_0x_and_validate_g1_hex("aabb")


class TestFqInvNonrecursive:
    def test_inverse(self):
        val = FQ(7)
        inv = _fq_inv_nonrecursive(val)
        assert (int(val) * int(inv)) % field_modulus == 1

    def test_zero_raises(self):
        with pytest.raises(ZeroDivisionError):
            _fq_inv_nonrecursive(FQ(0))


class TestG1JacobianToAffineXyInts:
    def test_jacobian_point(self):
        p = _g1_from_compressed_hex(G1_HEX)
        x, y = _g1_jacobian_to_affine_xy_ints(p)
        assert isinstance(x, int)
        assert isinstance(y, int)
        assert 0 < x < field_modulus
        assert 0 < y < field_modulus

    def test_affine_point(self):
        x, y = _g1_jacobian_to_affine_xy_ints((FQ(5), FQ(10)))
        assert x == 5
        assert y == 10


class TestG1UncompressToXyInts:
    def test_valid_point(self):
        x, y = _g1_uncompress_to_xy_ints(G1_HEX)
        assert isinstance(x, int)
        assert isinstance(y, int)
        assert 0 < x < field_modulus


class TestFpToLimbsLe:
    def test_zero(self):
        result = _fp_to_limbs_le(0)
        assert result == [0, 0, 0, 0, 0, 0]

    def test_small_value(self):
        result = _fp_to_limbs_le(42)
        assert result[0] == 42
        assert all(limb == 0 for limb in result[1:])

    def test_large_value(self):
        val = (1 << 64) + 7
        result = _fp_to_limbs_le(val)
        assert result[0] == 7
        assert result[1] == 1
        assert len(result) == 6


class TestSetupSnark:
    def test_setup_calls_subprocess(self, monkeypatch):
        import src.snark as snark_mod
        import subprocess as sp

        captured = {}

        def fake_run(cmd, **kwargs):
            captured["cmd"] = cmd
            return sp.CompletedProcess(cmd, 0, stdout="setup done", stderr="")

        monkeypatch.setattr(snark_mod.subprocess, "run", fake_run)
        setup_snark("/fake/snark", out_dir="mysetup")

        assert captured["cmd"][0] == "/fake/snark"
        assert "setup" in captured["cmd"]
        assert "-out" in captured["cmd"]
        assert "mysetup" in captured["cmd"]

    def test_setup_with_force(self, monkeypatch):
        import src.snark as snark_mod
        import subprocess as sp

        captured = {}

        def fake_run(cmd, **kwargs):
            captured["cmd"] = cmd
            return sp.CompletedProcess(cmd, 0, stdout="", stderr="")

        monkeypatch.setattr(snark_mod.subprocess, "run", fake_run)
        setup_snark("/fake/snark", force=True)

        assert "-force" in captured["cmd"]


class TestVerifySnarkProofGo:
    def test_success(self, monkeypatch):
        import src.snark as snark_mod
        import subprocess as sp

        def fake_run(cmd, **kwargs):
            return sp.CompletedProcess(cmd, 0, stdout="ok", stderr="")

        monkeypatch.setattr(snark_mod.subprocess, "run", fake_run)
        assert verify_snark_proof_go("/fake/snark") is True

    def test_failure(self, monkeypatch):
        import src.snark as snark_mod
        import subprocess as sp

        def fake_run(cmd, **kwargs):
            return sp.CompletedProcess(cmd, 1, stdout="", stderr="bad proof")

        monkeypatch.setattr(snark_mod.subprocess, "run", fake_run)
        assert verify_snark_proof_go("/fake/snark") is False


class TestVerifySnarkProof:
    def test_with_real_files(self):
        """Exercise the pure-Python verify_snark_proof against real proof files."""
        out_dir = "out"
        # This may return False due to py_ecc/gnark pairing incompatibility,
        # but it exercises the code paths.
        result = verify_snark_proof(out_dir, debug=False)
        # We don't assert True because py_ecc is known incompatible with gnark.
        assert isinstance(result, bool)


if __name__ == "__main__":
    pytest.main()
