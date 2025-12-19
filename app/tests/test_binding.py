import pytest
from src.register import Register
from src.bls12381 import to_int, scale, g1_point, combine, rng, curve_order
from src.binding import binding_proof, fiat_shamir_heuristic


def test_binding_proof():
    a = rng()
    r = rng()

    user = Register(x=1234567890)
    token_name = "acab"
    x = (a + user.x * r) % curve_order
    r1b = scale(g1_point(1), r)
    r2b = scale(g1_point(1), x)
    zab, zrb, t1b, t2b = binding_proof(a, r, r1b, r2b, user, token_name)

    c = to_int(fiat_shamir_heuristic(user, t1b, t2b, r1b, r2b, token_name))

    assert scale(g1_point(1), to_int(zrb)) == combine(t1b, scale(r1b, c))
    assert combine(
        scale(g1_point(1), to_int(zab)), scale(user.u, to_int(zrb))
    ) == combine(t2b, scale(r2b, c))


if __name__ == "__main__":
    pytest.main()
