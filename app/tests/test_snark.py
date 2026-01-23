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
    assert a == "2964c4b4af6f120f180e46467f169024de506efb3c73edf0f73a1208cf4e5cfd"


def test_half_level_decrypt_hash():
    r1 = "a40a487521c690b63831fa1a24ae1b4cae02836ae726b6dd514e9f9bd6795aab7d0c5b0d39ab5c4b82b4967439daa645"
    r2_g1b = "a89cf1b500a4552e9f155fd52e17b8c3ef47be761785a06c6a4d1867b8dc80d56adc1926e30eeed0fda7a6795bd36c03"
    shared = "ac1a6c2a0af5bd45aa7f77063707125b07aa85e034a92d1bdc489be0acdf06396a6fbcfcc8015e78d41f7dc1d9aace6d03f9d6575f89a51868d7e680ac5623c4907d690a2ebd7e8584b550d8fbb13bfffdd695fa9be261a6436784a2739d99b6"

    a = decrypt_to_hash(r1, r2_g1b, None, shared, snark_path)
    assert a == "f4336448801f7350116ef845a9556179f46ef31aef8e348cd45cebe60fa95a81"


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
        "7122734010029193537",
        "14091438530330602714",
        "18437455730936055131",
        "1270115798220374375",
        "3523544288121143632",
        "1409434267968882308",
        "7685756809009194907",
        "3596529320966201100",
        "6136440426073328453",
        "7222376003872321934",
        "9282423828667808000",
        "1484539344460549012",
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


if __name__ == "__main__":
    pytest.main()
