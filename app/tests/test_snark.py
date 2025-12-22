# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only
import pytest
from src.bls12381 import (
    g1_point,
    to_int,
)

from src.snark import gt_to_hash, decrypt_to_hash
import os


a0 = 44203
snark_path = f"{os.getcwd()}/snark/snark"


def test_print_g1_point():
    a = g1_point(a0)
    assert (
        a
        == "b4a9640fa75aef0c3f3939ec56574c640862cda95030f92269d8ead5c82e83229c0d1ad2b59dbacb86e97e0117a27cca"
    )


def test_print_scaled_point():
    a = g1_point(to_int("cbfce32f8f34a5541b00fb4ca887372667421e7d45373be98b7884d1"))
    assert (
        a
        == "a1588e31d17d31785a4ce1a882ca92a3f1bbb7fdd9953398ff53fca38ade891c075f9e7eefc9d1396298c6f680539c69"
    )


def test_secret_hash_file():
    a = gt_to_hash(a0, snark_path)
    assert a == "cbfce32f8f34a5541b00fb4ca887372667421e7d45373be98b7884d1"


def test_half_level_decrypt_hash():
    r1 = "a40a487521c690b63831fa1a24ae1b4cae02836ae726b6dd514e9f9bd6795aab7d0c5b0d39ab5c4b82b4967439daa645"
    r2_g1b = "a89cf1b500a4552e9f155fd52e17b8c3ef47be761785a06c6a4d1867b8dc80d56adc1926e30eeed0fda7a6795bd36c03"
    shared = "ac1a6c2a0af5bd45aa7f77063707125b07aa85e034a92d1bdc489be0acdf06396a6fbcfcc8015e78d41f7dc1d9aace6d03f9d6575f89a51868d7e680ac5623c4907d690a2ebd7e8584b550d8fbb13bfffdd695fa9be261a6436784a2739d99b6"

    a = decrypt_to_hash(r1, r2_g1b, None, shared, snark_path)
    assert a == "4493d2fcf250e229a5cc2c46189e0b97d9501a0d5128178253c1ade2"


if __name__ == "__main__":
    pytest.main()
