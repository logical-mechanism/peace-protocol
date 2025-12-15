from src.constants import KEY_DOMAIN_TAG, H1, H2, H3
from src.files import extract_key
from src.bls12381 import to_int, rng, random_fq12, scale, g1_point, combine, curve_order
from src.hashing import generate
from src.register import Register
from src.ecies import encrypt, capsule_to_file
from src.level import half_level_to_file
from src.schnorr import schnorr_proof, schnorr_to_file
from src.binding import binding_proof, binding_to_file

def create_encryption_tx(alice_wallet_path: str, plaintext: str, token_name: str) -> None:

    # these are secrets
    a0 = rng()
    r0 = rng()
    m0 = random_fq12(a0)

    key = extract_key(alice_wallet_path);
    sk = to_int(generate(KEY_DOMAIN_TAG + key))
    user = Register(x=sk)
    user.to_file()

    zb, grb = schnorr_proof(user)
    schnorr_to_file(zb, grb)

    r1b = scale(g1_point(1), r0)
    r2_g1b = scale(g1_point(1), (a0 + r0*sk) % curve_order)

    a = to_int(generate(r1b))
    b = to_int(generate(r1b + r2_g1b + token_name))

    c0 = combine(combine(scale(H1, a), scale(H2, b)), H3)
    r4b = scale(c0, r0)

    half_level_to_file(r1b, r2_g1b, r4b)

    nonce, aad, ct = encrypt(r1b, m0, plaintext)
    capsule_to_file(nonce, aad, ct)
    
    zab, zrb, t1b, t2b = binding_proof(a0, r0, r1b, r2_g1b, user, token_name)
    binding_to_file(zab, zrb, t1b, t2b)

def create_bidding_tx(bob_wallet_path: str) -> None:
    key = extract_key(bob_wallet_path);
    sk = to_int(generate(KEY_DOMAIN_TAG + key))
    user = Register(x=sk)
    user.to_file()

    zb, grb = schnorr_proof(user)
    schnorr_to_file(zb, grb)