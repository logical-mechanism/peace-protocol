# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

from dataclasses import dataclass
from src.bls12381 import g1_point, scale
from src.files import save_json


@dataclass
class Register:
    x: int | None = None
    g: str | None = None
    u: str | None = None

    def __post_init__(self):
        # Secret-known construction
        if self.x is not None:
            self.g = g1_point(1)
            self.u = g1_point(self.x)
            return

        # Public-only construction
        if self.g is None or self.u is None:
            raise ValueError("Must provide (g, u) if x is not known")

    def __eq__(self, other):
        if not isinstance(other, Register):
            return NotImplemented
        return self.x == other.x and self.g == other.g and self.u == other.u

    def __mul__(self, other):
        if not isinstance(other, int):
            return NotImplemented
        return scale(self.u, other)

    def __rmul__(self, other):
        return self.__mul__(other)

    @classmethod
    def from_public(cls, g: str, u: str) -> "Register":
        return cls(x=None, g=g, u=u)

    def to_file(self) -> None:
        path = "../data/register.json"
        data = {
            "constructor": 0,
            "fields": [
                {"bytes": self.g},
                {"bytes": self.u},
            ],
        }
        save_json(path, data)
