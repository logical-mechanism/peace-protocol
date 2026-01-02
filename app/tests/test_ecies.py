# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

# tests/test_ecies.py

import binascii
import hashlib

import pytest
from cryptography.exceptions import InvalidTag

import src.ecies as ecies_mod
from src.ecies import capsule_to_file, decrypt, encrypt


@pytest.fixture(autouse=True)
def patch_generate_to_even_hex(monkeypatch):
    """
    The ECIES implementation assumes `generate(...)` returns a *hex* string,
    and `aad` is passed through `bytes.fromhex(aad)`.

    If your real generate() can return odd-length hex, tests that exercise
    encrypt/decrypt should patch it to a deterministic even-length hex
    function that still depends on the input (so context differences matter).
    """

    def gen(s: str) -> str:
        # 64 hex chars (even length), depends on input
        return hashlib.sha256(s.encode("utf-8")).hexdigest()

    monkeypatch.setattr(ecies_mod, "generate", gen)


@pytest.fixture()
def fixed_urandom(monkeypatch):
    """
    Make encrypt() deterministic by forcing a fixed 12-byte nonce.
    """
    nonce_bytes = b"\x01" * 12

    def fake_urandom(n: int) -> bytes:
        assert n == 12
        return nonce_bytes

    monkeypatch.setattr(ecies_mod, "urandom", fake_urandom)
    return nonce_bytes


def test_encrypt_decrypt_roundtrip_utf8(fixed_urandom):
    msg = "This is a secret message that only Alice knows."
    ctx = "acab"
    kem = "cafe" * 16  # 32 bytes IKM

    nonce, aad, ct = encrypt(ctx, kem, msg)
    pt = decrypt(ctx, kem, nonce, ct, aad)

    assert nonce == fixed_urandom.hex()
    assert isinstance(aad, str) and len(aad) % 2 == 0
    assert isinstance(ct, str) and len(ct) > 0
    assert pt == msg.encode("utf-8")


def test_encrypt_decrypt_roundtrip_empty_message(fixed_urandom):
    msg = ""
    ctx = "ctx"
    kem = "00" * 32

    nonce, aad, ct = encrypt(ctx, kem, msg)
    pt = decrypt(ctx, kem, nonce, ct, aad)
    assert pt == b""


def test_encrypt_is_deterministic_with_fixed_nonce_and_inputs(
    monkeypatch, fixed_urandom
):
    """
    With fixed urandom(12) and fixed generate(), encrypt() should be deterministic.
    """
    monkeypatch.setattr(
        ecies_mod, "generate", lambda _s: ("ab" * 32)
    )  # even-length hex

    ctx = "same"
    kem = "11" * 32
    msg = "hi"

    out1 = encrypt(ctx, kem, msg)
    out2 = encrypt(ctx, kem, msg)
    assert out1 == out2

    nonce, aad, _ct = out1
    assert nonce == fixed_urandom.hex()
    assert aad == ("ab" * 32)


def test_decrypt_fails_if_aad_is_modified(fixed_urandom):
    msg = "hello"
    ctx = "acab"
    kem = "cafe" * 16

    nonce, aad, ct = encrypt(ctx, kem, msg)

    # flip one nibble in aad (keep valid hex)
    bad_aad = ("0" if aad[0] != "0" else "1") + aad[1:]

    with pytest.raises(InvalidTag):
        decrypt(ctx, kem, nonce, ct, bad_aad)


def test_decrypt_fails_if_ciphertext_is_modified(fixed_urandom):
    msg = "hello"
    ctx = "acab"
    kem = "cafe" * 16

    nonce, aad, ct = encrypt(ctx, kem, msg)

    # flip one nibble in ct (keep valid hex)
    bad_ct = ("0" if ct[0] != "0" else "1") + ct[1:]

    with pytest.raises(InvalidTag):
        decrypt(ctx, kem, nonce, bad_ct, aad)


def test_decrypt_fails_with_wrong_context(fixed_urandom):
    msg = "hello"
    kem = "cafe" * 16

    nonce, aad, ct = encrypt("ctx-A", kem, msg)

    with pytest.raises(InvalidTag):
        decrypt("ctx-B", kem, nonce, ct, aad)


def test_decrypt_fails_with_wrong_kem(fixed_urandom):
    msg = "hello"
    ctx = "acab"

    nonce, aad, ct = encrypt(ctx, ("cafe" * 16), msg)

    with pytest.raises(InvalidTag):
        decrypt(ctx, ("babe" * 16), nonce, ct, aad)


@pytest.mark.parametrize(
    "kem,should_error",
    [
        ("cafe", False),  # valid hex (even length)
        ("zzzz", True),  # invalid hex
        ("0", True),  # odd-length hex
        ("", False),  # empty hex is valid for bytes.fromhex("")
    ],
)
def test_encrypt_kem_hex_validation(kem, should_error, fixed_urandom):
    msg = "m"
    ctx = "c"

    if should_error:
        with pytest.raises((ValueError, binascii.Error)):
            encrypt(ctx, kem, msg)
    else:
        nonce, aad, ct = encrypt(ctx, kem, msg)
        assert nonce == fixed_urandom.hex()
        assert isinstance(aad, str) and len(aad) % 2 == 0
        assert isinstance(ct, str) and len(ct) > 0


@pytest.mark.parametrize(
    "nonce,ct,aad,exc",
    [
        ("0", "aa", "aa", (ValueError, binascii.Error)),  # odd length nonce
        ("00" * 12, "z1", "aa", (ValueError, binascii.Error)),  # invalid hex ct
        ("00" * 12, "aa", "zz", (ValueError, binascii.Error)),  # invalid hex aad
    ],
)
def test_decrypt_hex_inputs_validation(nonce, ct, aad, exc):
    ctx = "acab"
    kem = "11" * 32
    with pytest.raises(exc):
        decrypt(ctx, kem, nonce, ct, aad)


def test_encrypt_raises_if_generate_returns_odd_length_aad(monkeypatch, fixed_urandom):
    """
    If generate(...) returns odd-length hex for AAD, encrypt should fail when
    calling bytes.fromhex(aad). This matches the real behavior you saw.
    """

    def bad_generate(s: str) -> str:
        # Make only the AAD derivation odd-length; salt can be anything.
        if ecies_mod.AAD_DOMAIN_TAG in s:
            return "abc"  # odd length
        return "00" * 32

    monkeypatch.setattr(ecies_mod, "generate", bad_generate)

    with pytest.raises((ValueError, binascii.Error)):
        encrypt("ctx", "cafe", "hi")


def test_capsule_to_file_writes_expected_schema(monkeypatch):
    captured = {}

    def fake_save_json(path, data):
        captured["path"] = path
        captured["data"] = data

    monkeypatch.setattr(ecies_mod, "save_json", fake_save_json)

    nonce = "00" * 12
    aad = "aa" * 16
    ct = "bb" * 24

    capsule_to_file(nonce, aad, ct)

    assert captured["path"] == "../data/capsule.json"
    assert captured["data"] == {
        "constructor": 0,
        "fields": [
            {"bytes": nonce},
            {"bytes": aad},
            {"bytes": ct},
        ],
    }


def test_capsule_to_file_propagates_save_json_errors(monkeypatch):
    def boom(*_args, **_kwargs):
        raise RuntimeError("no perms")

    monkeypatch.setattr(ecies_mod, "save_json", boom)

    with pytest.raises(RuntimeError, match="no perms"):
        capsule_to_file("00" * 12, "aa", "bb")
