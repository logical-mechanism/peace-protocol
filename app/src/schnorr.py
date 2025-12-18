from src.bls12381 import rng, scale, g1_point, to_int, from_int, curve_order
from src.constants import SCH_DOMAIN_TAG
from src.hashing import generate
from src.register import Register
from src.files import save_json

def fiat_shamir_heuristic(gb: str, grb: str, ub: str) -> str:
    return generate(SCH_DOMAIN_TAG + gb + grb + ub)

def schnorr_proof(register: Register) -> tuple[str, str]:
    r = rng()
    grb = scale(g1_point(1), r)
    c = to_int(fiat_shamir_heuristic(register.g, grb, register.u))
    z = (r + c*register.x) % curve_order
    return from_int(z), grb

def schnorr_to_file(z: str, grb: str):
    path = "../data/schnorr.json"
    data = {
        "constructor": 0,
        "fields": [
            {"bytes": z},
            {"bytes": grb},
        ],
    }
    save_json(path, data)