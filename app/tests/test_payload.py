# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

# tests/test_payload.py

import json
from pathlib import Path

import cbor2
import pytest

from src.payload import build_payload, parse_payload

VECTORS_PATH = (
    Path(__file__).resolve().parent.parent / "test-vectors" / "payload-vectors.json"
)


@pytest.fixture()
def vectors() -> list[dict]:
    return json.loads(VECTORS_PATH.read_text())


class TestBuildPayload:
    def test_locator_only(self):
        result = build_payload(b"\xde\xad\xbe\xef")
        m = cbor2.loads(result)
        assert m == {0: b"\xde\xad\xbe\xef"}

    def test_all_three_fields(self):
        result = build_payload(b"\xaa", secret=b"\xbb", digest=b"\xcc")
        m = cbor2.loads(result)
        assert m == {0: b"\xaa", 1: b"\xbb", 2: b"\xcc"}

    def test_locator_and_digest_no_secret(self):
        result = build_payload(b"\xaa", digest=b"\xcc")
        m = cbor2.loads(result)
        assert m == {0: b"\xaa", 2: b"\xcc"}
        assert 1 not in m

    def test_locator_and_secret_no_digest(self):
        result = build_payload(b"\xaa", secret=b"\xbb")
        m = cbor2.loads(result)
        assert m == {0: b"\xaa", 1: b"\xbb"}
        assert 2 not in m

    def test_empty_locator(self):
        result = build_payload(b"")
        m = cbor2.loads(result)
        assert m == {0: b""}

    def test_extra_fields(self):
        result = build_payload(b"\xaa", extra={3: b"\xdd", 4: b"\xee"})
        m = cbor2.loads(result)
        assert m == {0: b"\xaa", 3: b"\xdd", 4: b"\xee"}

    def test_extra_rejects_reserved_key_0(self):
        with pytest.raises(ValueError, match="reserved"):
            build_payload(b"\xaa", extra={0: b"\xff"})

    def test_extra_rejects_reserved_key_1(self):
        with pytest.raises(ValueError, match="reserved"):
            build_payload(b"\xaa", extra={1: b"\xff"})

    def test_extra_rejects_reserved_key_2(self):
        with pytest.raises(ValueError, match="reserved"):
            build_payload(b"\xaa", extra={2: b"\xff"})

    def test_canonical_encoding_is_deterministic(self):
        a = build_payload(b"\xaa", secret=b"\xbb", digest=b"\xcc")
        b = build_payload(b"\xaa", secret=b"\xbb", digest=b"\xcc")
        assert a == b


class TestParsePayload:
    def test_roundtrip(self):
        original = build_payload(b"\xaa", secret=b"\xbb", digest=b"\xcc")
        m = parse_payload(original)
        assert m[0] == b"\xaa"
        assert m[1] == b"\xbb"
        assert m[2] == b"\xcc"

    def test_roundtrip_locator_only(self):
        original = build_payload(b"\xde\xad")
        m = parse_payload(original)
        assert m == {0: b"\xde\xad"}

    def test_roundtrip_with_extra(self):
        original = build_payload(b"\xaa", extra={5: b"\xff"})
        m = parse_payload(original)
        assert m[0] == b"\xaa"
        assert m[5] == b"\xff"

    def test_rejects_non_map(self):
        data = cbor2.dumps([1, 2, 3])
        with pytest.raises(ValueError, match="Expected CBOR map"):
            parse_payload(data)

    def test_rejects_missing_locator(self):
        data = cbor2.dumps({1: b"\xaa"})
        with pytest.raises(ValueError, match="Missing required field 0"):
            parse_payload(data)

    def test_rejects_string_keys(self):
        data = cbor2.dumps({"a": b"\xaa", 0: b"\xbb"})
        with pytest.raises(ValueError, match="All keys must be int"):
            parse_payload(data)

    def test_rejects_non_bytes_values(self):
        data = cbor2.dumps({0: "text"})
        with pytest.raises(ValueError, match="All values must be bytes"):
            parse_payload(data)

    def test_rejects_int_values(self):
        data = cbor2.dumps({0: 42})
        with pytest.raises(ValueError, match="All values must be bytes"):
            parse_payload(data)


class TestCrossPlatformVectors:
    def test_vectors_file_exists(self):
        assert VECTORS_PATH.exists(), f"Missing {VECTORS_PATH}"

    def test_all_vectors_match(self, vectors):
        for vec in vectors:
            fields = vec["fields"]
            locator = bytes.fromhex(fields["0"])
            secret = bytes.fromhex(fields["1"]) if "1" in fields else None
            digest = bytes.fromhex(fields["2"]) if "2" in fields else None

            extra = {}
            for k, v in fields.items():
                ki = int(k)
                if ki >= 3:
                    extra[ki] = bytes.fromhex(v)
            extra = extra or None

            result = build_payload(locator, secret, digest, extra)
            assert result.hex() == vec["cbor_hex"], (
                f"Vector '{vec['name']}' mismatch: "
                f"got {result.hex()}, expected {vec['cbor_hex']}"
            )

    def test_all_vectors_roundtrip(self, vectors):
        for vec in vectors:
            data = bytes.fromhex(vec["cbor_hex"])
            m = parse_payload(data)
            assert 0 in m
            for k, v in vec["fields"].items():
                assert m[int(k)] == bytes.fromhex(v), (
                    f"Vector '{vec['name']}' roundtrip failed for key {k}"
                )
