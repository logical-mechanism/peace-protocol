import pytest

from src.register import Register


def test_alice_is_not_bob():
    alice = Register(x=1234567890)
    bob = Register(x=987654321)

    alice.to_file()
    assert alice != bob


def test_shared_secret():
    alice = Register(x=1234567890)
    bob = Register(x=987654321)

    shared_alice = bob * alice.x
    shared_bob = alice * bob.x
    assert shared_alice == shared_bob


if __name__ == "__main__":
    pytest.main()
