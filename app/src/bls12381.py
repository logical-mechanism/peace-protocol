# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only
import secrets
from eth_typing import BLSPubkey, BLSSignature
from src.hashing import generate
from src.constants import H0, F12_DOMAIN_TAG
from py_ecc.bls.g2_primitives import (
    G1_to_pubkey,
    G2_to_signature,
    pubkey_to_G1,
    signature_to_G2,
)
from py_ecc.fields import optimized_bls12_381_FQ as FQ
from py_ecc.fields import optimized_bls12_381_FQ12 as FQ12
from py_ecc.optimized_bls12_381 import (
    G1,
    G2,
    Z1,
    Z2,
    add,
    curve_order,
    multiply,
    neg,
    pairing,
)


def rng() -> int:
    """
    Generates a random hex string of the specified length using the secrets module.

    Returns:
        int: A random number below the field order.
    """
    # Generate a random byte string of the specified length
    return secrets.randbelow(curve_order - 1) + 1


def g1_point(scalar: int) -> str:
    """
    Generates a BLS12-381 point from the G1 generator using scalar multiplication
    and returns it in compressed format.

    Args:
        scalar (int): The scalar value for multiplication.

    Returns:
        bytes: The resulting BLS12-381 G1 point in compressed format.
    """
    return G1_to_pubkey(multiply(G1, scalar)).hex()


def g2_point(scalar: int) -> str:
    """
    Generates a BLS12-381 point from the G2 generator using scalar multiplication
    and returns it in compressed format.

    Args:
        scalar (int): The scalar value for multiplication.

    Returns:
        bytes: The resulting BLS12-381 G2 point in compressed format.
    """
    return G2_to_signature(multiply(G2, scalar)).hex()


def uncompress(element: str) -> tuple:
    """
    Uncompresses a hexadecimal string to a BLS12-381 point.

    Args:
        element (str): The compressed point as a hexadecimal string.

    Returns:
        tuple: The uncompressed point.
    """
    if len(element) == 96:
        return pubkey_to_G1(BLSPubkey(bytes.fromhex(element)))
    else:
        return signature_to_G2(BLSSignature(bytes.fromhex(element)))


def compress(element: tuple) -> str:
    """
    Compresses a BLS12-381 point to a hexadecimal string.

    Args:
        element (tuple): The point to be compressed.

    Returns:
        str: The compressed point as a hexadecimal string.
    """
    if isinstance(element[2], FQ):
        return G1_to_pubkey(element).hex()
    else:
        return G2_to_signature(element).hex()


def scale(element: str, scalar: int) -> str:
    """
    Scales a BLS12-381 point by a given scalar using scalar multiplication.

    Args:
        element (str): The compressed point to be scaled.
        scalar (int): The scalar value for multiplication.

    Returns:
        str: The resulting scaled point.
    """
    return compress(multiply(uncompress(element), scalar))


def invert(element: str) -> str:
    """
    Calculates the inverse of a BLS12-381 point.

    Args:
        element (str): A compressed point.

    Returns:
        str: The resulting combined point.
    """
    return compress(neg(uncompress(element)))


def combine(left_element: str, right_element: str) -> str:
    """
    Combines two BLS12-381 points using addition.

    Args:
        left_element (str): A compressed point.
        right_element (str): A compressed point.

    Returns:
        str: The resulting combined point.
    """
    return compress(add(uncompress(left_element), uncompress(right_element)))


def pair(g1_element: str, g2_element: str, final_exponentiate: bool = True) -> FQ12:
    """
    Compute the pairing operation on elliptic curve points represented as strings.

    Args:
        g2_element (str): A string representation of a point on G2 elliptic curve.
        g1_element (str): A string representation of a point on G1 elliptic curve.
        final_exponentiate (bool, optional): Whether to perform final exponentiation in the pairing computation. Defaults to True.

    Returns:
        FQ12: Result of the pairing operation as an element of the FQ12 field.
    """
    return pairing(uncompress(g2_element), uncompress(g1_element), final_exponentiate)


def fq12_encoding(value: FQ12, domain_tag: str) -> str:
    """
    Encode an FQ12 element into a hex string.

    The element is serialized as the concatenation of its coefficients,
    each written as a 48-byte big-endian integer, and returned as a
    lowercase hex string.

    Args:
        value: The FQ12 field element to encode.

    Returns:
        A hex string representing the byte encoding of the FQ12 element.
    """
    byte_data = b""
    for fq_component in value.coeffs:
        byte_data += int(fq_component).to_bytes(48, "big")
    return generate(byte_data.hex() + domain_tag.encode("utf-8").hex())


def random_fq12(a: int) -> str:
    """
    Derive a deterministic Fq12 element from a scalar and encode it as hex.

    This computes a pairing value:

        kappa = e([a]G1, H0)

    and then serializes/encodes that Fq12 element using `fq12_encoding` with
    the `F12_DOMAIN_TAG`.

    Despite the name, this is not random unless `a` is sampled randomly.

    Args:
        a: Scalar used to multiply the canonical G1 generator before pairing.

    Returns:
        A hex string representing the domain-tagged encoding of the resulting
        Fq12 element.
    """
    kappa = pair(scale(g1_point(1), a), H0)
    return fq12_encoding(kappa, F12_DOMAIN_TAG)


def to_int(hash_digest: str) -> int:
    """
    Interpret a hex digest as a scalar reduced modulo the curve order.

    This is typically used to map a hash output (produced as a hex string)
    into the scalar field used by the protocol:

        c = int(hash_digest, 16) mod curve_order

    Args:
        hash_digest: Hex-encoded digest string (no '0x' prefix expected).

    Returns:
        An integer scalar in the range [0, curve_order - 1].
    """
    return int(hash_digest, 16) % curve_order


def from_int(integer: int) -> str:
    """
    Encode a non-negative integer as a minimal-length big-endian hex string.

    - The encoding is *minimal* (no leading zero bytes).
    - The special case `0` is encoded as `"00"` to ensure a non-empty byte
      representation.

    This is useful for serializing scalars/integers into a compact hex form.

    Args:
        integer: Non-negative integer to encode.

    Returns:
        A hex string representing the integer in big-endian byte order.

    Notes:
        If callers require a fixed width (e.g., always 32 bytes / 64 hex chars),
        this function is intentionally not doing that.
    """
    if integer == 0:
        return "00"
    length = (integer.bit_length() + 7) // 8
    return integer.to_bytes(length, "big").hex()


# identity elements
g1_identity = compress(Z1)
g2_identity = compress(Z2)
gt_identity = FQ12.one()

# curve order
curve_order = curve_order
