# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

# src/payload.py

import cbor2


def build_payload(
    locator: bytes,
    secret: bytes | None = None,
    digest: bytes | None = None,
    extra: dict[int, bytes] | None = None,
) -> bytes:
    """
    Build a canonical CBOR-encoded peace-payload map.

    The payload follows the peace-payload CDDL schema:
        { 0 => bstr, ? 1 => bstr, ? 2 => bstr, * int => bstr }

    Uses canonical CBOR encoding (RFC 8949 §4.2) for deterministic output
    across Python (cbor2) and TypeScript (cborg).

    Args:
        locator: Content address — IPFS CID, Arweave TX ID, URL, or inline data.
        secret: Optional access/decryption key for off-chain content.
        digest: Optional integrity hash of the underlying content.
        extra: Optional dict of extension fields (keys must be >= 3).

    Returns:
        Canonical CBOR-encoded bytes.

    Raises:
        ValueError: If extra contains reserved keys (0, 1, 2) or non-int keys.
    """
    m: dict[int, bytes] = {0: locator}
    if secret is not None:
        m[1] = secret
    if digest is not None:
        m[2] = digest
    if extra:
        for k, v in extra.items():
            if k in (0, 1, 2):
                raise ValueError(f"Extra key {k} conflicts with reserved keys (0, 1, 2)")
            m[k] = v
    return cbor2.dumps(m, canonical=True)


def parse_payload(data: bytes) -> dict[int, bytes]:
    """
    Parse a CBOR-encoded peace-payload map.

    Validates that the decoded value is a map with integer keys and
    byte string values, and that the required field 0 (locator) is present.

    Args:
        data: Raw CBOR bytes to decode.

    Returns:
        Dict mapping integer keys to byte string values.

    Raises:
        ValueError: If the CBOR structure does not match the peace-payload schema.
    """
    m = cbor2.loads(data)
    if not isinstance(m, dict):
        raise ValueError(f"Expected CBOR map, got {type(m).__name__}")
    if 0 not in m:
        raise ValueError("Missing required field 0 (locator)")
    for k, v in m.items():
        if not isinstance(k, int):
            raise ValueError(f"All keys must be int, got {type(k).__name__}")
        if not isinstance(v, bytes):
            raise ValueError(f"All values must be bytes, got {type(v).__name__} for key {k}")
    return m
