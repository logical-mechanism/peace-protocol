import pytest
import json

from src.files import extract_key


def test_cbor_strip():
    cbor_hex = "5820c26ab1dfd790169240824cf9b70be778f42b0287f28e16a528384cbaf4045acb"
    assert cbor_hex[4:] == "c26ab1dfd790169240824cf9b70be778f42b0287f28e16a528384cbaf4045acb"


def test_extract_key(tmp_path):
    data = {
        "type": "PaymentSigningKeyShelley_ed25519",
        "description": "Payment Signing Key",
        "cborHex": "5820c26ab1dfd790169240824cf9b70be778f42b0287f28e16a528384cbaf4045acb",
    }

    key_file = tmp_path / "payment.skey"
    key_file.write_text(json.dumps(data))

    key = extract_key(str(key_file))

    assert key == "c26ab1dfd790169240824cf9b70be778f42b0287f28e16a528384cbaf4045acb"


if __name__ == "__main__":
    pytest.main()
