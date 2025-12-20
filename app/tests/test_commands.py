# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only
import pytest
import os
from src.commands import recursive_decrypt


def test_recursive_decrypt():
    recursive_decrypt(
        f"{os.getcwd()}/wallets/alice/payment.skey",
        f"{os.getcwd()}/data/encryption/encryption-datum.json",
    )


if __name__ == "__main__":
    pytest.main()
