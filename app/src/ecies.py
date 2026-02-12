# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

# src/ecies.py

from src.hashing import generate
from src.constants import SLT_DOMAIN_TAG, KEM_DOMAIN_TAG, AAD_DOMAIN_TAG, MSG_DOMAIN_TAG
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes
from os import urandom
from src.files import save_json


def encrypt(context: str, kem: str, msg: bytes) -> tuple[str, str, str]:
    """
    Encrypt raw bytes using AES-256-GCM with a key derived from a KEM value.

    Key derivation:
        aes_key = HKDF-SHA3-256(
            salt = generate(SLT_DOMAIN_TAG || context || KEM_DOMAIN_TAG),
            info = KEM_DOMAIN_TAG,
            ikm  = bytes.fromhex(kem),
            length = 32
        )

    Associated data (AAD):
        aad = generate(AAD_DOMAIN_TAG || context || MSG_DOMAIN_TAG)

    Encryption:
        nonce = 12 random bytes (96-bit GCM nonce)
        ct = AESGCM(aes_key).encrypt(nonce, msg, aad_bytes)

    Args:
        context: Domain-separated context string that binds the derived key and
            AAD to a particular protocol transcript (e.g., r1 point encoding).
        kem: Hex string representing the key encapsulation material used as HKDF
            input keying material (IKM). Must be valid hex.
        msg: Plaintext bytes to encrypt (e.g., canonical CBOR payload).

    Returns:
        A tuple `(nonce_hex, aad_hex, ct_hex)` where:
            nonce_hex: 12-byte random nonce encoded as hex.
            aad_hex: Hex string (digest) used as AES-GCM associated data.
            ct_hex: Ciphertext (including the GCM tag) encoded as hex.

    Notes / assumptions:
        - `generate(...)` is expected to return a hex string digest.
        - `aad` is treated as hex and passed to AES-GCM as bytes via `fromhex`.
        - The random nonce is generated with `os.urandom(12)`; nonce reuse with
          the same derived key breaks AES-GCM security.
    """
    salt = generate(SLT_DOMAIN_TAG + context + KEM_DOMAIN_TAG)
    hkdf = HKDF(
        algorithm=hashes.SHA3_256(),
        length=32,
        salt=salt.encode("utf-8"),
        info=KEM_DOMAIN_TAG.encode("utf-8"),
    )
    aes_key = hkdf.derive(bytes.fromhex(kem))

    aad = generate(AAD_DOMAIN_TAG + context + MSG_DOMAIN_TAG)

    nonce = urandom(12)
    ct = AESGCM(aes_key).encrypt(nonce, msg, bytes.fromhex(aad))
    return nonce.hex(), aad, ct.hex()


def decrypt(context: str, kem: str, nonce: str, ct: str, aad: str) -> bytes:
    """
    Decrypt an AES-256-GCM ciphertext using a key derived from a KEM value.

    This mirrors `encrypt(...)` exactly:
    - Re-derives the AES key using HKDF-SHA3-256 with the same salt and info.
    - Uses AES-GCM to authenticate + decrypt the ciphertext.

    Args:
        context: Same context string used during encryption.
        kem: Hex string representing the HKDF input keying material (IKM),
            identical to the `kem` passed to `encrypt`.
        nonce: Hex-encoded 12-byte nonce produced by `encrypt`.
        ct: Hex-encoded ciphertext (including the GCM authentication tag).
        aad: Hex string used as AES-GCM associated data (must match encryption).

    Returns:
        The decrypted plaintext as raw bytes. (Call `.decode("utf-8")` if you
        expect UTF-8 text.)

    Raises:
        cryptography.exceptions.InvalidTag:
            If the ciphertext or AAD is invalid (authentication failure), or
            if the wrong key/nonce/AAD/context is provided.
        ValueError:
            If any hex inputs are malformed.
    """
    salt = generate(SLT_DOMAIN_TAG + context + KEM_DOMAIN_TAG)
    hkdf = HKDF(
        algorithm=hashes.SHA3_256(),
        length=32,
        salt=salt.encode("utf-8"),
        info=KEM_DOMAIN_TAG.encode("utf-8"),
    )
    aes_key = hkdf.derive(bytes.fromhex(kem))
    return AESGCM(aes_key).decrypt(
        bytes.fromhex(nonce), bytes.fromhex(ct), bytes.fromhex(aad)
    )


def capsule_to_file(nonce: str, aad: str, ct: str) -> None:
    """
    Write an encryption capsule (nonce, AAD, ciphertext) to a JSON file.

    The output schema matches a Plutus/Aiken constructor encoding:
        {
          "constructor": 0,
          "fields": [
            {"bytes": nonce},
            {"bytes": aad},
            {"bytes": ct}
          ]
        }

    The output file path is fixed:
        ../data/capsule.json

    Args:
        nonce: Hex-encoded AES-GCM nonce (expected 12 bytes / 24 hex chars).
        aad: Hex string used as associated data for AES-GCM.
        ct: Hex-encoded ciphertext (includes GCM tag).

    Returns:
        None. Writes the JSON artifact to disk via `save_json`.

    Raises:
        Any exceptions raised by `save_json` (e.g., invalid path or permissions)
        will propagate.
    """
    path = "../data/capsule.json"
    data = {
        "constructor": 0,
        "fields": [
            {"bytes": nonce},
            {"bytes": aad},
            {"bytes": ct},
        ],
    }
    save_json(path, data)
