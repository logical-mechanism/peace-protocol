# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

# tests/test_commands.py


import src.commands as commands_mod


class DummyRegister:
    def __init__(self, x=None, g=None, u=None):
        self.x = x
        self.g = g
        self.u = u

    def to_file(self) -> None:
        return None

    @classmethod
    def from_public(cls, g: str, u: str) -> "DummyRegister":
        return cls(x=None, g=g, u=u)


def _setup_common_mocks(monkeypatch):
    """
    Patch crypto + filesystem heavy deps inside src.commands to lightweight stubs.
    Returns (calls, set_to_int_mapping) where calls is a list of call tuples.
    """
    calls = []

    # ---- light stubs for algebra / encoding
    def fake_g1_point(n: int) -> str:
        return f"G1({n})"

    def fake_g2_point(n: int) -> str:
        return f"G2({n})"

    def fake_scale(elem: str, scalar: int) -> str:
        out = f"scale({elem},{scalar})"
        calls.append(("scale", elem, scalar, out))
        return out

    def fake_combine(a: str, b: str) -> str:
        out = f"combine({a},{b})"
        calls.append(("combine", a, b, out))
        return out

    def fake_invert(elem: str) -> str:
        out = f"invert({elem})"
        calls.append(("invert", elem, out))
        return out

    # ---- deterministic "hash" and "to_int" mapping
    to_int_map = {}

    def set_to_int_mapping(value: str, integer: int) -> None:
        to_int_map[value] = integer

    def fake_generate(msg: str) -> str:
        out = f"hash({msg})"
        calls.append(("generate", msg, out))
        return out

    def fake_to_int(digest: str) -> int:
        calls.append(("to_int", digest))
        if digest in to_int_map:
            return to_int_map[digest]
        # deterministic fallback
        return sum(digest.encode("utf-8")) % 97

    # ---- rng: deterministic sequence
    rng_seq = {"vals": [11, 22, 33, 44], "i": 0}

    def fake_rng() -> int:
        v = rng_seq["vals"][rng_seq["i"] % len(rng_seq["vals"])]
        rng_seq["i"] += 1
        calls.append(("rng", v))
        return v

    # ---- external plumbing (wallet keys, snark, file IO, proofs, enc/dec)
    def fake_extract_key(wallet_path: str) -> str:
        calls.append(("extract_key", wallet_path))
        return "WALLET_KEY"

    def fake_gt_to_hash(a: int, snark_path) -> str:
        calls.append(("gt_to_hash", a, str(snark_path)))
        return f"GT({a})"

    def fake_decrypt_to_hash(r1b, r2_g1b, r2_g2b, shared, snark_path) -> str:
        calls.append(("decrypt_to_hash", r1b, r2_g1b, r2_g2b, shared, str(snark_path)))
        return f"KEY({r1b}|{r2_g1b}|{r2_g2b}|{shared})"

    def fake_schnorr_proof(user) -> tuple[str, str]:
        calls.append(("schnorr_proof", user))
        return ("zb", "grb")

    def fake_schnorr_to_file(zb: str, grb: str) -> None:
        calls.append(("schnorr_to_file", zb, grb))

    def fake_half_level_to_file(r1b: str, r2_g1b: str, r4b: str) -> None:
        calls.append(("half_level_to_file", r1b, r2_g1b, r4b))

    def fake_full_level_to_file(
        old_r1b: str, old_r2_g1b: str, r5b: str, old_r4b: str
    ) -> None:
        calls.append(("full_level_to_file", old_r1b, old_r2_g1b, r5b, old_r4b))

    def fake_encrypt(r1b: str, m0: str, plaintext: str) -> tuple[str, str, str]:
        calls.append(("encrypt", r1b, m0, plaintext))
        return ("nonce", "aad", "ct")

    def fake_capsule_to_file(nonce: str, aad: str, ct: str) -> None:
        calls.append(("capsule_to_file", nonce, aad, ct))

    def fake_binding_proof(
        a: int, r: int, r1b: str, r2b: str, register, token_name: str
    ):
        calls.append(("binding_proof", a, r, r1b, r2b, register, token_name))
        return ("zab", "zrb", "t1b", "t2b")

    def fake_binding_to_file(zab: str, zrb: str, t1b: str, t2b: str) -> None:
        calls.append(("binding_to_file", zab, zrb, t1b, t2b))

    def fake_save_string(path: str, value: str) -> None:
        calls.append(("save_string", path, value))

    def fake_load_json(path: str):
        calls.append(("load_json", path))
        return {}

    def fake_decrypt(r1: str, key: str, nonce: str, ct: str, aad: str) -> str:
        calls.append(("decrypt", r1, key, nonce, ct, aad))
        return "PLAINTEXT"

    # ---- patch into src.commands module namespace
    monkeypatch.setattr(commands_mod, "Register", DummyRegister)

    monkeypatch.setattr(commands_mod, "g1_point", fake_g1_point)
    monkeypatch.setattr(commands_mod, "g2_point", fake_g2_point)
    monkeypatch.setattr(commands_mod, "scale", fake_scale)
    monkeypatch.setattr(commands_mod, "combine", fake_combine)
    monkeypatch.setattr(commands_mod, "invert", fake_invert)

    monkeypatch.setattr(commands_mod, "generate", fake_generate)
    monkeypatch.setattr(commands_mod, "to_int", fake_to_int)
    monkeypatch.setattr(commands_mod, "rng", fake_rng)

    monkeypatch.setattr(commands_mod, "extract_key", fake_extract_key)
    monkeypatch.setattr(commands_mod, "gt_to_hash", fake_gt_to_hash)
    monkeypatch.setattr(commands_mod, "decrypt_to_hash", fake_decrypt_to_hash)

    monkeypatch.setattr(commands_mod, "schnorr_proof", fake_schnorr_proof)
    monkeypatch.setattr(commands_mod, "schnorr_to_file", fake_schnorr_to_file)

    monkeypatch.setattr(commands_mod, "half_level_to_file", fake_half_level_to_file)
    monkeypatch.setattr(commands_mod, "full_level_to_file", fake_full_level_to_file)

    monkeypatch.setattr(commands_mod, "encrypt", fake_encrypt)
    monkeypatch.setattr(commands_mod, "capsule_to_file", fake_capsule_to_file)
    monkeypatch.setattr(commands_mod, "decrypt", fake_decrypt)

    monkeypatch.setattr(commands_mod, "binding_proof", fake_binding_proof)
    monkeypatch.setattr(commands_mod, "binding_to_file", fake_binding_to_file)

    monkeypatch.setattr(commands_mod, "save_string", fake_save_string)
    monkeypatch.setattr(commands_mod, "load_json", fake_load_json)

    # keep arithmetic small and predictable
    monkeypatch.setattr(commands_mod, "curve_order", 97)

    return calls, set_to_int_mapping


def _calls_of(calls, name: str):
    return [c for c in calls if isinstance(c, tuple) and len(c) >= 1 and c[0] == name]


def test_create_encryption_tx_happy_path(monkeypatch):
    calls, set_to_int = _setup_common_mocks(monkeypatch)

    sk_digest = f"hash({commands_mod.KEY_DOMAIN_TAG}WALLET_KEY)"
    set_to_int(sk_digest, 7)

    # rng: a0=11, r0=22
    expected_r1b = "scale(G1(1),22)"

    a_digest = f"hash({commands_mod.H2I_DOMAIN_TAG}{expected_r1b})"
    set_to_int(a_digest, 3)

    # r2 = scale(G1(1), (11 + 22*7) % 97) = 68
    expected_r2 = "scale(G1(1),68)"
    b_digest = f"hash({commands_mod.H2I_DOMAIN_TAG}{expected_r1b}{expected_r2}TOKEN)"
    set_to_int(b_digest, 5)

    commands_mod.create_encryption_tx("alice_wallet", "hello", "TOKEN")

    # gt_to_hash called with (a0=11, snark_path)
    gt_calls = _calls_of(calls, "gt_to_hash")
    assert len(gt_calls) == 1
    _, a, p = gt_calls[0]
    assert a == 11
    assert str(p).endswith("/snark/snark")

    assert ("extract_key", "alice_wallet") in calls
    assert ("schnorr_to_file", "zb", "grb") in calls

    half_calls = _calls_of(calls, "half_level_to_file")
    assert len(half_calls) == 1
    _, r1b, r2b, r4b = half_calls[0]
    assert r1b == expected_r1b
    assert r2b == expected_r2
    assert isinstance(r4b, str) and r4b.startswith("scale(")

    assert ("encrypt", expected_r1b, "GT(11)", "hello") in calls
    assert ("capsule_to_file", "nonce", "aad", "ct") in calls

    proof_calls = _calls_of(calls, "binding_proof")
    assert len(proof_calls) == 1
    _, a0, r0, r1b, r2b, reg, token = proof_calls[0]
    assert (a0, r0, r1b, r2b, token) == (11, 22, expected_r1b, expected_r2, "TOKEN")
    assert isinstance(reg, DummyRegister)

    assert ("binding_to_file", "zab", "zrb", "t1b", "t2b") in calls


def test_create_bidding_tx_happy_path(monkeypatch):
    calls, set_to_int = _setup_common_mocks(monkeypatch)

    sk_digest = f"hash({commands_mod.KEY_DOMAIN_TAG}WALLET_KEY)"
    set_to_int(sk_digest, 42)

    commands_mod.create_bidding_tx("bob_wallet")

    assert ("extract_key", "bob_wallet") in calls
    assert ("schnorr_to_file", "zb", "grb") in calls

    assert not _calls_of(calls, "half_level_to_file")
    assert not _calls_of(calls, "capsule_to_file")
    assert not _calls_of(calls, "binding_to_file")


def test_create_reencryption_tx_happy_path(monkeypatch):
    calls, set_to_int = _setup_common_mocks(monkeypatch)

    # rng: a1=11, r1=22
    set_to_int("GT(11)", 9)  # hk
    sk_digest = f"hash({commands_mod.KEY_DOMAIN_TAG}WALLET_KEY)"
    set_to_int(sk_digest, 13)

    bob_u = "BOB_U"

    expected_r1b = "scale(G1(1),22)"
    expected_r2 = "combine(scale(G1(1),11),scale(BOB_U,22))"

    a_digest = f"hash({commands_mod.H2I_DOMAIN_TAG}{expected_r1b})"
    set_to_int(a_digest, 4)
    b_digest = f"hash({commands_mod.H2I_DOMAIN_TAG}{expected_r1b}{expected_r2}TOKEN)"
    set_to_int(b_digest, 6)

    def fake_load_json(path: str):
        calls.append(("load_json", path))
        return {
            "fields": [
                None,
                None,
                None,
                {
                    "constructor": 0,
                    "fields": [
                        {"bytes": "OLD_R1"},
                        {"bytes": "OLD_R2_G1"},
                        {"bytes": "OLD_R4"},
                    ],
                },
                None,
                {
                    "constructor": 0,
                    "fields": [{"bytes": "N"}, {"bytes": "A"}, {"bytes": "C"}],
                },
            ]
        }

    monkeypatch.setattr(commands_mod, "load_json", fake_load_json)

    commands_mod.create_reencryption_tx("alice_wallet", bob_u, "TOKEN")

    gt_calls = _calls_of(calls, "gt_to_hash")
    assert len(gt_calls) == 1
    _, a, p = gt_calls[0]
    assert a == 11
    assert str(p).endswith("/snark/snark")

    half_calls = _calls_of(calls, "half_level_to_file")
    assert len(half_calls) == 1
    _, r1b, r2b, r4b = half_calls[0]
    assert r1b == expected_r1b
    assert r2b == expected_r2
    assert isinstance(r4b, str) and r4b.startswith("scale(")

    assert any(c[0] == "save_string" and c[1] == "../data/r5.point" for c in calls)
    assert any(
        c[0] == "save_string"
        and c[1] == "../data/witness.point"
        and c[2] == "scale(G1(1),9)"
        for c in calls
    )

    proof_calls = _calls_of(calls, "binding_proof")
    assert len(proof_calls) == 1
    _, a1, r1, r1b, r2b, reg, token = proof_calls[0]
    assert (a1, r1, r1b, r2b, token) == (11, 22, expected_r1b, expected_r2, "TOKEN")
    assert isinstance(reg, DummyRegister)
    assert reg.g == "G1(1)"
    assert reg.u == bob_u

    full_calls = _calls_of(calls, "full_level_to_file")
    assert len(full_calls) == 1
    _, old_r1, old_r2, r5b, old_r4 = full_calls[0]
    assert old_r1 == "OLD_R1"
    assert old_r2 == "OLD_R2_G1"
    assert old_r4 == "OLD_R4"
    assert isinstance(r5b, str) and r5b.startswith("combine(")


def test_recursive_decrypt_walks_entries_and_prints(monkeypatch, capsys):
    calls, set_to_int = _setup_common_mocks(monkeypatch)

    sk_digest = f"hash({commands_mod.KEY_DOMAIN_TAG}WALLET_KEY)"
    set_to_int(sk_digest, 3)

    # encryption_levels is now a separate list parameter
    encryption_levels = [
        # Half level entry
        {
            "constructor": 0,
            "fields": [
                {"bytes": "R1_A"},
                {"bytes": "R2G1_A"},
                {"bytes": "R4_A"},
            ],
        },
        # Full level entry (wrapped in constructor 0)
        {
            "constructor": 0,
            "fields": [
                {
                    "constructor": 0,
                    "fields": [
                        {"bytes": "R1_B"},
                        {"bytes": "R2G1_B"},
                        {"bytes": "R2G2_B"},
                        {"bytes": "R4_B"},
                    ],
                }
            ],
        },
    ]

    # Datum now only needs the capsule at fields[5]
    datum = {
        "fields": [
            None,
            None,
            None,
            None,
            None,
            # Capsule at index 5
            {
                "constructor": 0,
                "fields": [{"bytes": "NONCE"}, {"bytes": "AAD"}, {"bytes": "CT"}],
            },
        ]
    }

    def fake_load_json(path: str):
        calls.append(("load_json", path))
        return datum

    monkeypatch.setattr(commands_mod, "load_json", fake_load_json)

    def fake_decrypt_to_hash(r1b, r2_g1b, r2_g2b, shared, snark_path):
        calls.append(("decrypt_to_hash", r1b, r2_g1b, r2_g2b, shared, str(snark_path)))
        return "K1" if r1b == "R1_A" else "K2"

    monkeypatch.setattr(commands_mod, "decrypt_to_hash", fake_decrypt_to_hash)
    set_to_int("K1", 5)
    set_to_int("K2", 7)

    def fake_decrypt(r1, key, nonce, ct, aad):
        calls.append(("decrypt", r1, key, nonce, ct, aad))
        return "OK"

    monkeypatch.setattr(commands_mod, "decrypt", fake_decrypt)

    commands_mod.recursive_decrypt("alice_wallet", encryption_levels, "datum.json")

    out = capsys.readouterr().out
    assert "OK" in out

    dt_calls = _calls_of(calls, "decrypt_to_hash")
    assert len(dt_calls) == 2
    assert dt_calls[0][1:4] == ("R1_A", "R2G1_A", None)
    assert dt_calls[1][1:4] == ("R1_B", "R2G1_B", "R2G2_B")

    assert ("decrypt", "R1_B", "K2", "NONCE", "CT", "AAD") in calls
