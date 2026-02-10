# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

# tests/test_level.py

import src.level as level_mod
from src.level import full_level_to_file, empty_full_level_to_file, half_level_to_file


def test_full_level_to_file_writes_correct_structure(monkeypatch):
    captured = {}

    def fake_save_json(path, data):
        captured["path"] = path
        captured["data"] = data

    monkeypatch.setattr(level_mod, "save_json", fake_save_json)

    full_level_to_file("r1_hex", "r2g1_hex", "r2g2_hex", "r4_hex")

    assert captured["path"] == "../data/full-level.json"
    data = captured["data"]
    assert data["constructor"] == 0
    assert len(data["fields"]) == 1

    inner = data["fields"][0]
    assert inner["constructor"] == 0
    assert len(inner["fields"]) == 4
    assert inner["fields"][0] == {"bytes": "r1_hex"}
    assert inner["fields"][1] == {"bytes": "r2g1_hex"}
    assert inner["fields"][2] == {"bytes": "r2g2_hex"}
    assert inner["fields"][3] == {"bytes": "r4_hex"}


def test_empty_full_level_to_file_writes_empty_variant(monkeypatch):
    captured = {}

    def fake_save_json(path, data):
        captured["path"] = path
        captured["data"] = data

    monkeypatch.setattr(level_mod, "save_json", fake_save_json)

    empty_full_level_to_file()

    assert captured["path"] == "../data/full-level.json"
    data = captured["data"]
    assert data["constructor"] == 1
    assert data["fields"] == []


def test_half_level_to_file_writes_correct_structure(monkeypatch):
    captured = {}

    def fake_save_json(path, data):
        captured["path"] = path
        captured["data"] = data

    monkeypatch.setattr(level_mod, "save_json", fake_save_json)

    half_level_to_file("r1_hex", "r2g1_hex", "r4_hex")

    assert captured["path"] == "../data/half-level.json"
    data = captured["data"]
    assert data["constructor"] == 0
    assert len(data["fields"]) == 3
    assert data["fields"][0] == {"bytes": "r1_hex"}
    assert data["fields"][1] == {"bytes": "r2g1_hex"}
    assert data["fields"][2] == {"bytes": "r4_hex"}
