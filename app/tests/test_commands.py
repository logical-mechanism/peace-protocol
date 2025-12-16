import pytest
import os
from src.register import Register
from src.commands import recursive_decrypt


def test_recursive_decrypt():
    recursive_decrypt(f'{os.getcwd()}/wallets/alice/payment.skey')


if __name__ == "__main__":
    pytest.main()
