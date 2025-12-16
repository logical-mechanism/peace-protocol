# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

from dataclasses import dataclass, field
from src.bls12381 import g1_point, rng, scale
from src.files import save_json
from pathlib import Path

@dataclass
class Register:
    x: int | None = None
    g: str = field(init=False)
    u: str = field(init=False)

    def __post_init__(self):
        if self.x is None:
            self.x = rng()
        self.g = g1_point(1)
        self.u = g1_point(self.x)
    
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