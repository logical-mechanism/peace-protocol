# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

# tests/test_schnorr.py

import pytest

import src.schnorr as schnorr_mod
from src.schnorr import fiat_shamir_heuristic, schnorr_proof, schnorr_to_file


def test_schnorr_proof_equation_holds_with_real_ops():
    """
    Keep the original end-to-end check using the real BLS helpers.
    """
    from src.register import Register
    from src.bls12381 import to_int, scale, g1_point, combine

    user = Register(x=1234567890)
    z, gr = schnorr_proof(user)
    c = to_int(fiat_shamir_heuristic(user.g, gr, user.u))

    assert scale(g1_point(1), to_int(z)) == combine(gr, scale(user.u, c))


def test_real_case_vector_still_verifies():
    """
    Keep your known-good vector test.
    """
    from src.bls12381 import to_int, scale, g1_point, combine

    g = "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"
    u = "8a3396e314bc2754efea28d34e74a38b4006991bd68c8705d455a624b7721905a95969f704681b4d0e3a9716fb1a0963"

    z = "1cc6b340d9e8c3c2e68c7d275f4af1e33f645734861ec8fcc59ecca5e9bc1e4e"
    gr = "8ccf013066fc698eda661481b6a200692a6015269d3974f4eed4b7e0b32ecacfcaf692fa5ec75a594c98a513133b9799"

    c = to_int(fiat_shamir_heuristic(g, gr, u))
    assert scale(g1_point(1), to_int(z)) == combine(gr, scale(u, c))


def test_fiat_shamir_known_vector_and_to_int():
    """
    Keep your known hash vector test.
    """
    from src.bls12381 import to_int

    g = "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"
    u = "8d6af734d26f38f603cb3030ed71075d8f23e6c798ddc4897d08d7e2fce68fe37080cb671b3668dcac63dff778dc7dd8"
    gr = "8dd9e8affcd88844e190397d0746b4ed973504d2002c200790516f798b165f8632fa03901fdc4cc9368f46bae78eba04"

    assert (
        fiat_shamir_heuristic(g, gr, u)
        == "ace9c7140e074ae54571dc5707ba6d16287d7ae883bd6062957f04bb"
    )
    assert (
        to_int(fiat_shamir_heuristic(g, gr, u))
        == 18209884714012616100516315861408918984119144601440871754214320047291
    )


def test_fiat_shamir_is_deterministic():
    g = "G".encode().hex()
    gr = "GR".encode().hex()
    u = "U".encode().hex()
    h1 = fiat_shamir_heuristic(g, gr, u)
    h2 = fiat_shamir_heuristic(g, gr, u)
    assert h1 == h2
    assert isinstance(h1, str)


def test_fiat_shamir_changes_when_any_field_changes():
    g = "G".encode().hex()
    gr = "GR".encode().hex()
    u = "U".encode().hex()
    h = fiat_shamir_heuristic(g, gr, u)

    assert h != fiat_shamir_heuristic("G2".encode().hex(), gr, u)
    assert h != fiat_shamir_heuristic(g, "GR2".encode().hex(), u)
    assert h != fiat_shamir_heuristic(g, gr, "U2".encode().hex())


def test_schnorr_proof_uses_rng_once_and_is_deterministic_with_fixed_rng(monkeypatch):
    """
    Patch schnorr_mod.rng so we can:
    - verify it is called exactly once
    - make output deterministic
    """
    calls = {"n": 0}

    def fake_rng():
        calls["n"] += 1
        return 42

    monkeypatch.setattr(schnorr_mod, "rng", fake_rng)

    # Also patch group ops to avoid heavy crypto in this unit-level behavior test.
    monkeypatch.setattr(schnorr_mod, "g1_point", lambda n: f"G1({n})")
    monkeypatch.setattr(schnorr_mod, "scale", lambda e, s: f"scale({e},{s})")
    monkeypatch.setattr(schnorr_mod, "to_int", lambda _h: 7)
    monkeypatch.setattr(schnorr_mod, "from_int", lambda n: f"hex({n})")
    monkeypatch.setattr(schnorr_mod, "curve_order", 97)
    monkeypatch.setattr(
        schnorr_mod, "fiat_shamir_heuristic", lambda g, gr, u: f"H({g}|{gr}|{u})"
    )

    # Minimal register-shaped object (avoid importing Register here)
    class R:
        def __init__(self, x=None, g=None, u=None):
            self.x = x
            self.g = g
            self.u = u

    reg = R(x=3, g="G", u="U")

    out1 = schnorr_proof(reg)  # type: ignore[arg-type]
    out2 = schnorr_proof(reg)  # type: ignore[arg-type]

    assert calls["n"] == 2  # one rng per proof
    assert out1 == out2

    z_hex, grb = out1
    assert grb == "scale(G1(1),42)"
    # z = (r + c*x) % q = (42 + 7*3) % 97 = 63
    assert z_hex == "hex(63)"


def test_schnorr_proof_default_x_is_one_when_missing(monkeypatch):
    """
    If register.x is None, schnorr_proof uses x=1 (per implementation).
    """
    monkeypatch.setattr(schnorr_mod, "rng", lambda: 10)
    monkeypatch.setattr(schnorr_mod, "g1_point", lambda n: f"G1({n})")
    monkeypatch.setattr(schnorr_mod, "scale", lambda e, s: f"scale({e},{s})")
    monkeypatch.setattr(schnorr_mod, "to_int", lambda _h: 5)
    monkeypatch.setattr(schnorr_mod, "from_int", lambda n: f"hex({n})")
    monkeypatch.setattr(schnorr_mod, "curve_order", 97)
    monkeypatch.setattr(schnorr_mod, "fiat_shamir_heuristic", lambda g, gr, u: "H")

    class R:
        def __init__(self, x=None, g=None, u=None):
            self.x = x
            self.g = g
            self.u = u

    reg = R(x=None, g="G", u="U")
    z_hex, grb = schnorr_proof(reg)  # type: ignore[arg-type]

    assert grb == "scale(G1(1),10)"
    # z = (r + c*1) % 97 = 15
    assert z_hex == "hex(15)"


def test_schnorr_proof_substitutes_empty_string_for_missing_g_or_u(monkeypatch):
    """
    If g/u are None, schnorr_proof substitutes "" into the transcript.
    We check it by observing the arguments passed to fiat_shamir_heuristic.
    """
    seen = {}

    def fake_fsh(gb, grb, ub):
        seen["gb"] = gb
        seen["ub"] = ub
        return "H"

    monkeypatch.setattr(schnorr_mod, "rng", lambda: 1)
    monkeypatch.setattr(schnorr_mod, "g1_point", lambda n: "G1(1)")
    monkeypatch.setattr(schnorr_mod, "scale", lambda e, s: "GR")
    monkeypatch.setattr(schnorr_mod, "to_int", lambda _h: 0)
    monkeypatch.setattr(schnorr_mod, "from_int", lambda n: "00")
    monkeypatch.setattr(schnorr_mod, "curve_order", 97)
    monkeypatch.setattr(schnorr_mod, "fiat_shamir_heuristic", fake_fsh)

    class R:
        def __init__(self, x=None, g=None, u=None):
            self.x = x
            self.g = g
            self.u = u

    reg = R(x=9, g=None, u=None)
    schnorr_proof(reg)  # type: ignore[arg-type]

    assert seen["gb"] == ""
    assert seen["ub"] == ""


def test_schnorr_to_file_writes_expected_schema(monkeypatch):
    captured = {}

    def fake_save_json(path, data):
        captured["path"] = path
        captured["data"] = data

    monkeypatch.setattr(schnorr_mod, "save_json", fake_save_json)

    schnorr_to_file("aa", "bb")

    assert captured["path"] == "../data/schnorr.json"
    assert captured["data"] == {
        "constructor": 0,
        "fields": [
            {"bytes": "aa"},
            {"bytes": "bb"},
        ],
    }


def test_schnorr_to_file_propagates_save_json_errors(monkeypatch):
    def boom(*_args, **_kwargs):
        raise RuntimeError("disk full")

    monkeypatch.setattr(schnorr_mod, "save_json", boom)

    with pytest.raises(RuntimeError, match="disk full"):
        schnorr_to_file("aa", "bb")
