from src.hashing import generate
from src.constants import SLT_DOMAIN_TAG, KEM_DOMAIN_TAG, AAD_DOMAIN_TAG, MSG_DOMAIN_TAG
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes
from os import urandom
from src.files import save_json

def encrypt(context: str, kem: str, msg: str) -> tuple[str, str, str]:
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
    ct = AESGCM(aes_key).encrypt(nonce, msg.encode("utf-8"), bytes.fromhex(aad))
    return nonce.hex(), aad, ct.hex()

def decrypt(context: str, kem: str, nonce: str, ct: str, aad: str) -> str:
    salt = generate(SLT_DOMAIN_TAG + context + KEM_DOMAIN_TAG)
    hkdf = HKDF(
        algorithm=hashes.SHA3_256(),
        length=32,
        salt=salt.encode("utf-8"),
        info=KEM_DOMAIN_TAG.encode("utf-8"),
    )
    aes_key = hkdf.derive(bytes.fromhex(kem))
    return AESGCM(aes_key).decrypt(bytes.fromhex(nonce), bytes.fromhex(ct), bytes.fromhex(aad))

def capsule_to_file(nonce: str, aad: str, ct: str) -> None:
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