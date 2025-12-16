from src.constants import KEY_DOMAIN_TAG, H0, H1, H2, H3
from src.files import extract_key
from src.bls12381 import to_int, rng, random_fq12, scale, g1_point, combine, curve_order, g2_point, invert
from src.hashing import generate
from src.register import Register
from src.ecies import encrypt, capsule_to_file
from src.level import half_level_to_file, full_level_to_file
from src.schnorr import schnorr_proof, schnorr_to_file
from src.binding import binding_proof, binding_to_file
from src.files import save_string, load_json

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

    c = combine(combine(scale(H1, a), scale(H2, b)), H3)
    r4b = scale(c, r0)

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

def create_reencryption_tx(alice_wallet_path: str, bob_public_value: str, token_name: str) -> None:
    a1 = rng()
    r1 = rng()
    m1 = random_fq12(a1)

    hk = to_int(m1)

    key = extract_key(alice_wallet_path);
    sk = to_int(generate(KEY_DOMAIN_TAG + key))

    r1b = scale(g1_point(1), r1)
    r2_g1b = combine(scale(g1_point(1), a1), scale(bob_public_value, r1))
    
    a = to_int(generate(r1b))
    b = to_int(generate(r1b + r2_g1b + token_name))
    c = combine(scale(H1, a), scale(H2, b))
    r4b = scale(c, r1)

    half_level_to_file(r1b, r2_g1b, r4b)

    r5b = combine(scale(g2_point(1), hk), scale(invert(H0), sk))
    save_string("../data/r5.point", r5b)
    witness = scale(g1_point(1), hk)
    save_string("../data/witness.point", witness)

    user = Register.from_public(g1_point(1), bob_public_value)
    zab, zrb, t1b, t2b = binding_proof(a1, r1, r1b, r2_g1b, user, token_name)
    binding_to_file(zab, zrb, t1b, t2b)

    # update the last element
    encryption_datum = load_json("../data/encryption/encryption-datum.json")
    last_entry = encryption_datum[3]["list"][0]
    old_r1b = last_entry['fields'][0]["bytes"]
    old_r2_g1b = last_entry['fields'][1]["fields"][0]["bytes"]
    old_r4b = last_entry['fields'][2]["bytes"]

    full_level_to_file(old_r1b, old_r2_g1b, r5b, old_r4b)