import pytest
from src.register import Register
from src.bls12381 import to_int, scale, g1_point, combine
from src.schnorr import schnorr_proof, fiat_shamir_heuristic


def test_schnorr_proof():
    user = Register(x=1234567890)
    z, gr = schnorr_proof(user)
    c = to_int(fiat_shamir_heuristic(user.g, gr, user.u))

    assert scale(g1_point(1), to_int(z)) == combine(gr, scale(user.u, c))


def test_real_case():
    g = "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"
    u = "8a3396e314bc2754efea28d34e74a38b4006991bd68c8705d455a624b7721905a95969f704681b4d0e3a9716fb1a0963"

    z = "1cc6b340d9e8c3c2e68c7d275f4af1e33f645734861ec8fcc59ecca5e9bc1e4e"
    gr = "8ccf013066fc698eda661481b6a200692a6015269d3974f4eed4b7e0b32ecacfcaf692fa5ec75a594c98a513133b9799"

    c = to_int(fiat_shamir_heuristic(g, gr, u))

    assert scale(g1_point(1), to_int(z)) == combine(gr, scale(u, c))


def test_fsh():
    g = "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"
    u = "8d6af734d26f38f603cb3030ed71075d8f23e6c798ddc4897d08d7e2fce68fe37080cb671b3668dcac63dff778dc7dd8"

    gr = "8dd9e8affcd88844e190397d0746b4ed973504d2002c200790516f798b165f8632fa03901fdc4cc9368f46bae78eba04"
    assert (
        fiat_shamir_heuristic(g, gr, u)
        == "ace9c7140e074ae54571dc5707ba6d16287d7ae883bd6062957f04bb"
    )
    assert (
        to_int(fiat_shamir_heuristic(g, gr, u))
        == 18209884714012616100516315861408918984119144601440871754214320047291
    )


if __name__ == "__main__":
    pytest.main()
