# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

# tests/test_binding.py

import pytest

from src.register import Register
from src.bls12381 import (
    to_int,
    scale,
    g1_point,
    combine,
    rng,
    curve_order,
)
import src.binding as binding_mod
from src.binding import binding_proof, fiat_shamir_heuristic, binding_to_file


@pytest.mark.parametrize(
    "token_name",
    ["acab", "token-1".encode().hex(), "🔥".encode().hex(), ""],
)
def test_fiat_shamir_is_deterministic(token_name: str):
    user = Register(x=1234567890)
    a = rng()
    r = rng()
    assert user.x is not None
    assert user.u is not None

    x = (a + user.x * r) % curve_order
    r1b = scale(g1_point(1), r)
    r2b = scale(g1_point(1), x)

    # Fixed transcript pieces
    t1b = scale(g1_point(1), 42)
    t2b = combine(scale(g1_point(1), 7), scale(user.u, 42))

    h1 = fiat_shamir_heuristic(user, t1b, t2b, r1b, r2b, token_name)
    h2 = fiat_shamir_heuristic(user, t1b, t2b, r1b, r2b, token_name)

    assert isinstance(h1, str)
    assert h1 == h2


def test_fiat_shamir_changes_with_transcript_fields():
    user = Register(x=1234567890)
    assert user.u is not None

    r1a = scale(g1_point(1), 5)
    r1b = scale(g1_point(1), 6)  # differs
    r2 = scale(g1_point(1), 777)

    t1 = scale(g1_point(1), 42)
    t2 = combine(scale(g1_point(1), 7), scale(user.u, 42))

    token = "acab"

    h_a = fiat_shamir_heuristic(user, t1, t2, r1a, r2, token)
    h_b = fiat_shamir_heuristic(user, t1, t2, r1b, r2, token)

    assert h_a != h_b

    # token_name binds context too
    h_c = fiat_shamir_heuristic(user, t1, t2, r1a, r2, token + "ab")
    assert h_a != h_c


def test_fiat_shamir_none_g_u_equivalent_to_empty_string_transcript():
    """
    fiat_shamir_heuristic treats register.g/u == None as "".

    Because Register(x=...) always derives non-None g/u, we simulate the None/empty
    cases by mutating after construction (Register is not frozen).
    """
    reg_none = Register(x=1)
    reg_none.g = None
    reg_none.u = None

    reg_empty = Register(x=1)
    reg_empty.g = ""
    reg_empty.u = ""

    t1 = "ab01"
    t2 = "ab02"
    r1 = "bc01"
    r2 = "bc02"
    token = "acab"

    h_none = fiat_shamir_heuristic(reg_none, t1, t2, r1, r2, token)
    h_empty = fiat_shamir_heuristic(reg_empty, t1, t2, r1, r2, token)

    assert h_none == h_empty


@pytest.mark.parametrize(
    "token_name",
    ["acab", "context-A".encode().hex(), "context-B".encode().hex()],
)
def test_binding_proof_schnorr_equations_hold(token_name: str):
    a = rng()
    r = rng()

    user = Register(x=1234567890)
    assert user.x is not None
    assert user.u is not None

    # x = a + x_user * r (mod q)
    x = (a + user.x * r) % curve_order
    r1b = scale(g1_point(1), r)
    r2b = scale(g1_point(1), x)

    zab, zrb, t1b, t2b = binding_proof(a, r, r1b, r2b, user, token_name)

    # basic type sanity
    assert all(isinstance(v, str) for v in (zab, zrb, t1b, t2b))

    zab_i = to_int(zab)
    zrb_i = to_int(zrb)
    assert 0 <= zab_i < curve_order
    assert 0 <= zrb_i < curve_order

    c = to_int(fiat_shamir_heuristic(user, t1b, t2b, r1b, r2b, token_name))

    # Verify Schnorr-style relations:
    # [zr]G == t1 + [c]r1
    assert scale(g1_point(1), zrb_i) == combine(t1b, scale(r1b, c))

    # [za]G + [zr]u == t2 + [c]r2
    assert combine(scale(g1_point(1), zab_i), scale(user.u, zrb_i)) == combine(
        t2b, scale(r2b, c)
    )


def test_binding_proof_is_deterministic_given_fixed_rng(monkeypatch):
    """
    If we fix rho/alpha, then binding_proof should be deterministic for fixed inputs.
    """
    rho = 123
    alpha = 456
    calls = {"n": 0}

    def fake_rng():
        calls["n"] += 1
        return rho if calls["n"] == 1 else alpha

    monkeypatch.setattr(binding_mod, "rng", fake_rng)

    a = 999
    r = 111
    user = Register(x=222)
    token = "acab"
    assert user.x is not None
    assert user.u is not None

    x = (a + user.x * r) % curve_order
    r1b = scale(g1_point(1), r)
    r2b = scale(g1_point(1), x)

    out1 = binding_proof(a, r, r1b, r2b, user, token)
    calls["n"] = 0
    out2 = binding_proof(a, r, r1b, r2b, user, token)

    assert out1 == out2
    _zab, _zrb, t1b, t2b = out1

    # With fixed rho/alpha we can also check the commitments are exactly as expected
    assert t1b == scale(g1_point(1), rho)
    assert t2b == combine(scale(g1_point(1), alpha), scale(user.u, rho))

    # Ensure rng was used exactly twice per call (rho, alpha)
    assert calls["n"] == 2


def test_binding_proof_calls_rng_exactly_twice(monkeypatch):
    """
    Make sure binding_proof samples rho and alpha (two rng() calls).
    """
    seq = [10, 20]
    calls = {"n": 0}

    def fake_rng():
        calls["n"] += 1
        return seq[calls["n"] - 1]

    monkeypatch.setattr(binding_mod, "rng", fake_rng)

    a = 1
    r = 2
    user = Register(x=3)
    token = "ab"
    assert user.x is not None

    x = (a + user.x * r) % curve_order
    r1b = scale(g1_point(1), r)
    r2b = scale(g1_point(1), x)

    binding_proof(a, r, r1b, r2b, user, token)

    assert calls["n"] == 2


def test_binding_proof_outputs_are_mod_curve_order(monkeypatch):
    """
    Force a huge challenge scalar (c) in a robust way by patching
    fiat_shamir_heuristic, avoiding assumptions about generate() output format.
    """
    # Keep rho/alpha stable
    monkeypatch.setattr(binding_mod, "rng", lambda: 7)

    # Make FS output a sentinel; then force to_int(sentinel) to be huge.
    sentinel = "__FORCE_HUGE_C__"
    real_to_int = binding_mod.to_int

    def fake_fiat_shamir(_register, _t1b, _t2b, _r1b, _r2b, _token_name):
        return sentinel

    def fake_to_int(x):
        if x == sentinel:
            return curve_order * 123 + 999999
        return real_to_int(x)

    monkeypatch.setattr(binding_mod, "fiat_shamir_heuristic", fake_fiat_shamir)
    monkeypatch.setattr(binding_mod, "to_int", fake_to_int)

    a = curve_order * 9 + 12345
    r = curve_order * 8 + 54321
    user = Register(x=777)
    token = "acab"
    assert user.x is not None

    x = (a + user.x * r) % curve_order
    r1b = scale(g1_point(1), r % curve_order)
    r2b = scale(g1_point(1), x)

    zab, zrb, *_ = binding_proof(a, r, r1b, r2b, user, token)

    zab_i = to_int(zab)
    zrb_i = to_int(zrb)
    assert 0 <= zab_i < curve_order
    assert 0 <= zrb_i < curve_order


def test_binding_to_file_writes_expected_schema(monkeypatch):
    captured = {}

    def fake_save_json(path, data):
        captured["path"] = path
        captured["data"] = data

    monkeypatch.setattr(binding_mod, "save_json", fake_save_json)

    zab = "aa"
    zrb = "bb"
    t1b = "cc"
    t2b = "dd"

    binding_to_file(zab, zrb, t1b, t2b)

    assert captured["path"] == "../data/binding.json"
    assert captured["data"] == {
        "constructor": 0,
        "fields": [
            {"bytes": zab},
            {"bytes": zrb},
            {"bytes": t1b},
            {"bytes": t2b},
        ],
    }


def test_binding_to_file_propagates_save_json_errors(monkeypatch):
    def boom(*_args, **_kwargs):
        raise RuntimeError("disk full")

    monkeypatch.setattr(binding_mod, "save_json", boom)

    with pytest.raises(RuntimeError, match="disk full"):
        binding_to_file("aa", "bb", "cc", "dd")
