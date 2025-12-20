# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only
from src.register import Register
from src.constants import BND_DOMAIN_TAG
from src.hashing import generate
from src.bls12381 import rng, scale, g1_point, to_int, from_int, curve_order, combine
from src.files import save_json


def fiat_shamir_heuristic(
    register: Register,
    t1b: str,
    t2b: str,
    r1b: str,
    r2b: str,
    token_name: str,
) -> str:
    g = register.g if register.g is not None else ""
    u = register.u if register.u is not None else ""

    return generate(BND_DOMAIN_TAG + g + u + t1b + t2b + r1b + r2b + token_name)


def binding_proof(
    a: int, r: int, r1b: str, r2b: str, register: Register, token_name: str
) -> tuple[str, str, str, str]:
    rho = rng()
    alpha = rng()

    u = register.u if register.u is not None else ""

    t1b = scale(g1_point(1), rho)
    t2b = combine(scale(g1_point(1), alpha), scale(u, rho))

    c = to_int(fiat_shamir_heuristic(register, t1b, t2b, r1b, r2b, token_name))
    zrb = (rho + c * r) % curve_order
    zab = (alpha + c * a) % curve_order

    return from_int(zab), from_int(zrb), t1b, t2b


def binding_to_file(zab: str, zrb: str, t1b: str, t2b: str):
    path = "../data/binding.json"
    data = {
        "constructor": 0,
        "fields": [
            {"bytes": zab},
            {"bytes": zrb},
            {"bytes": t1b},
            {"bytes": t2b},
        ],
    }
    save_json(path, data)
