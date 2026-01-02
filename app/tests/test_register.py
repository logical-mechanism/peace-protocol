# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

# tests/test_register.py

import pytest

import src.register as register_mod
from src.register import Register


@pytest.fixture()
def stub_group_ops(monkeypatch):
    """
    Make Register tests independent of real BLS math by stubbing g1_point/scale.
    """
    calls = []

    def fake_g1_point(scalar: int) -> str:
        out = f"G1({scalar})"
        calls.append(("g1_point", scalar, out))
        return out

    def fake_scale(element: str, scalar: int) -> str:
        out = f"scale({element},{scalar})"
        calls.append(("scale", element, scalar, out))
        return out

    monkeypatch.setattr(register_mod, "g1_point", fake_g1_point)
    monkeypatch.setattr(register_mod, "scale", fake_scale)
    return calls


def test_secret_known_construction_derives_g_and_u(stub_group_ops):
    alice = Register(x=123)

    assert alice.g == "G1(1)"
    assert alice.u == "G1(123)"

    # Verify helper calls
    assert ("g1_point", 1, "G1(1)") in stub_group_ops
    assert ("g1_point", 123, "G1(123)") in stub_group_ops


def test_public_only_construction_requires_g_and_u():
    with pytest.raises(ValueError, match=r"Must provide \(g, u\) if x is not known"):
        Register(x=None, g=None, u="U")

    with pytest.raises(ValueError, match=r"Must provide \(g, u\) if x is not known"):
        Register(x=None, g="G", u=None)

    # Works when both provided
    r = Register(x=None, g="G", u="U")
    assert r.x is None
    assert r.g == "G"
    assert r.u == "U"


def test_from_public_constructs_public_only_register():
    r = Register.from_public("G", "U")
    assert r == Register(x=None, g="G", u="U")


def test_equality_and_notimplemented(stub_group_ops):
    a1 = Register(x=5)
    a2 = Register(x=5)
    b = Register(x=6)

    assert a1 == a2
    assert a1 != b

    # __eq__ should return NotImplemented for non-Register
    assert Register.__eq__(a1, object()) is NotImplemented


def test_mul_and_rmul_use_scale_and_handle_types(stub_group_ops):
    alice = Register(x=7)

    # reg * k
    out1 = alice * 3
    assert out1 == "scale(G1(7),3)"
    assert ("scale", "G1(7)", 3, "scale(G1(7),3)") in stub_group_ops

    # k * reg
    out2 = 3 * alice
    assert out2 == out1

    # Non-int -> NotImplemented, which should become a TypeError at runtime
    with pytest.raises(TypeError):
        _ = alice * "nope"  # type: ignore[arg-type]


def test_mul_returns_notimplemented_if_u_is_none(stub_group_ops):
    r = Register(x=None, g="G", u="U")
    # This line would raise in __post_init__, so we build a valid one then override u
    r = Register.from_public("G", "U")
    r.u = None
    assert Register.__mul__(r, 5) is NotImplemented


def test_to_file_writes_expected_schema(monkeypatch, stub_group_ops):
    captured = {}

    def fake_save_json(path, data):
        captured["path"] = path
        captured["data"] = data

    monkeypatch.setattr(register_mod, "save_json", fake_save_json)

    r = Register(x=9)
    r.to_file()

    assert captured["path"] == "../data/register.json"
    assert captured["data"] == {
        "constructor": 0,
        "fields": [
            {"bytes": "G1(1)"},
            {"bytes": "G1(9)"},
        ],
    }


def test_to_file_propagates_save_json_errors(monkeypatch, stub_group_ops):
    def boom(*_args, **_kwargs):
        raise RuntimeError("disk full")

    monkeypatch.setattr(register_mod, "save_json", boom)

    r = Register(x=1)
    with pytest.raises(RuntimeError, match="disk full"):
        r.to_file()


def test_shared_secret_commutes_under_stub_scale(stub_group_ops):
    """
    Under the stub model:
      shared_alice = scale(bob.u, alice.x)
      shared_bob   = scale(alice.u, bob.x)
    They should be equal when the algebra is "commutative" in the stub,
    but our stub isn't a group: it's just string formatting.

    So we *don't* assert equality of those strings; instead we assert that the
    API uses scale(u, scalar) as intended on both sides.
    """
    alice = Register(x=123)
    bob = Register(x=456)

    shared_alice = bob * alice.x
    shared_bob = alice * bob.x

    assert shared_alice == "scale(G1(456),123)"
    assert shared_bob == "scale(G1(123),456)"
