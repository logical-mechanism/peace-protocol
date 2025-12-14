import pytest

from src.hashing import generate


def test_empty_string_hash():
    h = generate("")
    assert h == "0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8"


def test_hello_world_hash():
    h = generate("Hello, world!")
    assert h == "b5da441cfe72ae042ef4d2b17742907f675de4da57462d4c3609c2e2ed755970"

if __name__ == "__main__":
    pytest.main()
