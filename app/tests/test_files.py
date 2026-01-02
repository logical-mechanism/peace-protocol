# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

# tests/test_files.py

import json
from pathlib import Path

import pytest

from src.files import extract_key, load_json, save_json, save_string


def test_save_string_creates_parent_dirs_and_writes_utf8(tmp_path: Path):
    out = tmp_path / "a" / "b" / "c.txt"
    save_string(out, "hello ✓")

    assert out.exists()
    assert out.read_text(encoding="utf-8") == "hello ✓"


def test_save_string_overwrites_existing_file(tmp_path: Path):
    out = tmp_path / "x.txt"
    out.write_text("old", encoding="utf-8")

    save_string(out, "new")
    assert out.read_text(encoding="utf-8") == "new"


def test_save_json_writes_pretty_sorted_json(tmp_path: Path):
    out = tmp_path / "d" / "e" / "data.json"
    data = {"b": 2, "a": 1, "nested": {"z": 9, "y": 8}}

    save_json(out, data)

    raw = out.read_text(encoding="utf-8")

    # Deterministic sort_keys=True means "a" then "b" then "nested" at top-level.
    assert raw.startswith('{\n  "a": 1,\n  "b": 2,\n  "nested": {')
    # Indent=2 yields two-space indentation for nested keys
    assert '\n    "y": 8,\n    "z": 9\n' in raw

    # And it must be valid JSON equal to the original data
    assert json.loads(raw) == data


def test_save_json_overwrites_existing_file(tmp_path: Path):
    out = tmp_path / "data.json"
    out.write_text('{"x": 1}', encoding="utf-8")

    save_json(out, {"x": 2})
    assert json.loads(out.read_text(encoding="utf-8")) == {"x": 2}


def test_load_json_roundtrip_with_save_json(tmp_path: Path):
    out = tmp_path / "payload.json"
    payload = {"constructor": 0, "fields": [{"bytes": "aa"}]}

    save_json(out, payload)
    loaded = load_json(out)

    assert loaded == payload


def test_extract_key_happy_path(tmp_path: Path):
    data = {
        "type": "PaymentSigningKeyShelley_ed25519",
        "description": "Payment Signing Key",
        "cborHex": "5820c26ab1dfd790169240824cf9b70be778f42b0287f28e16a528384cbaf4045acb",
    }

    key_file = tmp_path / "payment.skey"
    key_file.write_text(json.dumps(data), encoding="utf-8")

    key = extract_key(str(key_file))

    assert key == "c26ab1dfd790169240824cf9b70be778f42b0287f28e16a528384cbaf4045acb"


def test_extract_key_returns_empty_string_when_cborhex_too_short(tmp_path: Path):
    # "cborHex"[4:] with len < 4 yields ""
    data = {"cborHex": "123"}  # shorter than 4 chars
    key_file = tmp_path / "k.json"
    key_file.write_text(json.dumps(data), encoding="utf-8")

    assert extract_key(str(key_file)) == ""


def test_extract_key_missing_file_raises(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        extract_key(str(tmp_path / "does_not_exist.json"))


def test_extract_key_invalid_json_raises(tmp_path: Path):
    key_file = tmp_path / "bad.json"
    key_file.write_text("{not json", encoding="utf-8")

    with pytest.raises(json.JSONDecodeError):
        extract_key(str(key_file))


def test_extract_key_missing_cborhex_key_raises(tmp_path: Path):
    key_file = tmp_path / "missing.json"
    key_file.write_text(json.dumps({"nope": "x"}), encoding="utf-8")

    with pytest.raises(KeyError):
        extract_key(str(key_file))


def test_extract_key_non_string_cborhex_raises_typeerror(tmp_path: Path):
    # Slicing an int triggers TypeError
    key_file = tmp_path / "badtype.json"
    key_file.write_text(json.dumps({"cborHex": 12345}), encoding="utf-8")

    with pytest.raises(TypeError):
        extract_key(str(key_file))


def test_load_json_missing_file_raises(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        load_json(tmp_path / "nope.json")


def test_load_json_invalid_json_raises(tmp_path: Path):
    p = tmp_path / "bad.json"
    p.write_text("{not json", encoding="utf-8")
    with pytest.raises(json.JSONDecodeError):
        load_json(p)


def test_cbor_strip_reference():
    cbor_hex = "5820c26ab1dfd790169240824cf9b70be778f42b0287f28e16a528384cbaf4045acb"
    assert (
        cbor_hex[4:]
        == "c26ab1dfd790169240824cf9b70be778f42b0287f28e16a528384cbaf4045acb"
    )
