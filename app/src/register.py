# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

# src/register.py

from dataclasses import dataclass
from src.bls12381 import g1_point, scale
from src.files import save_json


@dataclass
class Register:
    """
    Public register for Schnorr-style proofs and transcript binding.

    The register conceptually represents a discrete-log style public key pair
    over BLS12-381 G1:

        g : generator (G1 element)
        u : public value (G1 element), typically u = [x]g
        x : secret scalar (optional)

    Construction modes:
    - Secret-known: provide `x`; the register derives:
        g = g1_point(1)
        u = g1_point(x)
      (i.e., u is the canonical generator scaled by `x` using the helper.)
    - Public-only: provide both `g` and `u` with `x=None`.

    This type is used both as:
    - A carrier for public parameters included in transcripts (Fiat–Shamir),
    - A source of group elements when generating proofs,
    - A convenient wrapper to serialize `(g, u)` to the JSON format expected
      by downstream tooling / on-chain data.
    """

    x: int | None = None
    g: str | None = None
    u: str | None = None

    def __post_init__(self) -> None:
        """
        Validate and complete initialization after dataclass construction.

        If `x` is provided, the instance is treated as a secret-known register,
        and `(g, u)` are derived deterministically.

        If `x` is not provided, the instance must be constructed with both
        `g` and `u` present; otherwise a `ValueError` is raised.
        """
        # Secret-known construction
        if self.x is not None:
            self.g = g1_point(1)
            self.u = g1_point(self.x)
            return

        # Public-only construction
        if self.g is None or self.u is None:
            raise ValueError("Must provide (g, u) if x is not known")

    def __eq__(self, other: object) -> bool:
        """
        Compare two registers for structural equality.

        Equality checks all three fields `(x, g, u)` exactly. If `other` is not
        a `Register`, returns `NotImplemented` to allow Python to fall back to
        alternative comparisons.
        """
        if not isinstance(other, Register):
            return NotImplemented
        return self.x == other.x and self.g == other.g and self.u == other.u

    def __mul__(self, other: object) -> str:
        """
        Right-multiply the register's public value `u` by an integer scalar.

        This provides a convenience operation:

            reg * k  ==  scale(reg.u, k)

        Args:
            other: Integer scalar multiplier.

        Returns:
            The serialized group element resulting from scaling `u` by `other`.

        Raises:
            TypeError: If `other` is not an integer (via returning `NotImplemented`).
        """
        if not isinstance(other, int):
            return NotImplemented
        if self.u is None:
            return NotImplemented
        return scale(self.u, other)

    def __rmul__(self, other: object) -> str:
        """
        Left-multiply support for integer scalars.

        Enables:

            k * reg  ==  reg * k
        """
        return self.__mul__(other)

    @classmethod
    def from_public(cls, g: str, u: str) -> "Register":
        """
        Construct a public-only register from explicit `(g, u)` values.

        Args:
            g: Serialized G1 generator value.
            u: Serialized G1 public value.

        Returns:
            A `Register` instance with `x=None` and the provided `(g, u)`.
        """
        return cls(x=None, g=g, u=u)

    def to_file(self) -> None:
        """
        Serialize the public components `(g, u)` to a JSON artifact on disk.

        The output schema matches a Plutus/Aiken constructor encoding:
            {
              "constructor": 0,
              "fields": [
                {"bytes": g},
                {"bytes": u}
              ]
            }

        Output path (fixed):
            ../data/register.json

        Returns:
            None. Writes the JSON artifact via `save_json`.

        Raises:
            Any exceptions raised by `save_json` (e.g., invalid path or permissions)
            will propagate.

        Notes:
            This method writes `g` and `u` only. The secret `x` is never written.
        """
        path = "../data/register.json"
        data = {
            "constructor": 0,
            "fields": [
                {"bytes": self.g},
                {"bytes": self.u},
            ],
        }
        save_json(path, data)
