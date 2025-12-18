import pytest

from src.register import Register
from src.ecies import encrypt, decrypt

def test_e2e():
    msg = "This is a secret message that only Alice knows."
    ctx = "acab"
    kem = "cafe"

    nonce, aad, ct = encrypt(ctx, kem, msg)
    # print(nonce, aad, ct)
    message = decrypt(ctx, kem, nonce, ct, aad)
    assert msg.encode("utf-8") == message


if __name__ == "__main__":
    pytest.main()
