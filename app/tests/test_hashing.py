import pytest

from src.hashing import generate


def test_empty_string_hash():
    h = generate("")
    assert h == "836cc68931c2e4e3e838602eca1902591d216837bafddfe6f0c8cb07"


def test_hash():
    h = generate("acab")
    assert h == "09c4a38a350818fcabc9eba223519d9539f072185bb6e7c0e29ea392"


if __name__ == "__main__":
    pytest.main()
