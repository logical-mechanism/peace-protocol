# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only
import pytest
from src.constants import H0, F12_DOMAIN_TAG
from src.hashing import generate
from src.bls12381 import (
    g1_identity,
    g1_point,
    g2_identity,
    g2_point,
    compress,
    uncompress,
    combine,
    scale,
    pair,
    fq12_encoding,
    to_int,
    invert,
    rng,
    random_fq12,
)

from src.snark import gt_to_hash
import os


a0 = 44203

def test_print_g1_point():
    a = g1_point(a0)
    assert a == "b4a9640fa75aef0c3f3939ec56574c640862cda95030f92269d8ead5c82e83229c0d1ad2b59dbacb86e97e0117a27cca"


def test_print_scaled_point():
    a = g1_point(to_int("cbfce32f8f34a5541b00fb4ca887372667421e7d45373be98b7884d1"))
    assert a == "a1588e31d17d31785a4ce1a882ca92a3f1bbb7fdd9953398ff53fca38ade891c075f9e7eefc9d1396298c6f680539c69"


def test_secret_hash_file():
    a = gt_to_hash(a0, f"{os.getcwd()}/snark/snark")
    assert a == "cbfce32f8f34a5541b00fb4ca887372667421e7d45373be98b7884d1"

if __name__ == "__main__":
    pytest.main()
