# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

# tests/test_vk_convert.py

import json
from pathlib import Path

from src.vk_convert import convert_vk_file, vk_to_datum

# Sample VK from circuit/vk.json (the production VK)
SAMPLE_VK = {
    "nPublic": 37,
    "vkAlpha": "8090277f0799825fe8f38d6f184daf36736c6cb4303fadbc87fb06f0e7fab461cd7b8ff013b306e81a9262a8b95a4532",
    "vkBeta": "ad19afaed44bb018d32d26134cb7dd54a3e0981fc7a63e7b73f217bde5f249c3abbf356765800adba8732c3ab815704f0bf3dad720c75505bb4aff8a4ca27778ef5aa9317e8b8c5a29f2e0c14eb99a3f8b9a292548b605bbfe6b3636873b13a1",
    "vkGamma": "829f91a476f004c06dcfc6af740e1d6676be15662c87e368552a363504dc43d715c787122f164fae1bf4ac14280796ef031fad18de3c8d934282016a1dd1ba7d476ee33a67aa194a5140dac80aee14ae2ef39b33f3259ea13620baca19f71088",
    "vkDelta": "b3065359df4da47465b272745905537c76939190cd81d16e7cb457f54ddb70e4e7eaab3478c6fedccd277ea4007c7ee207425ae618161f9ba9c6f2492addd3b4e2dd1f40419d3d1d5b3904c9e4e718ad9aa644c30281268a790640e97377ec10",
    "vkIC": [
        "af0b33b15bb9bb7aaa3eb688794bb2b7f011205b385deb8377510e422d709a32bc27255341abd6746934ada898f6a0f9",
        "aea388ab0da4aa765be75123b6523777cd06e9c1996e0e27b39bb2a49e39eb12979dfb41da9b1d495c8e5e87c0deec49",
        "8ac518584be522b4b93668ed68ad14044557e63f8b5a308414e6b08fcf1b2c331e360c397b44b519b500001ee4d66d4f",
    ],
    "commitmentKeys": [
        {
            "g": "a1442831bc1a1b2717976d84b5b285cb817898871b50fd8cbb32c8d3bae6cd73bdc521b4c3f8f67c6888e985cd0fa8fd07da7e63a2fe6e5a6ebdf7af9b1a41ee84c9be53c6e351bd1dc40d7fb8c865eaa61d20eb4e7d91a78518eac75ad0cebd",
            "gSigmaNeg": "a1b3e5cba77bba832026984adb01bcf0514208325895b659eb6dfe2962e1ae3f3dec387edba635781aa4d74ffa1482f014a110fcb1a4242358eb6ede5b3d8e146e374df7fee8bcd66b59fb70c8804fa8329af2854bf2383ee6eec16bb7b4aa71",
        }
    ],
    "publicAndCommitmentCommitted": [[1, 2, 3]],
}


class TestVkToDatum:
    """Test VK to Cardano datum format conversion."""

    def test_basic_structure(self):
        """Test that output has constructor 0 with 7 fields."""
        result = vk_to_datum(SAMPLE_VK)

        assert result["constructor"] == 0
        assert len(result["fields"]) == 7

    def test_npublic_is_int(self):
        """Test nPublic field is encoded as int."""
        result = vk_to_datum(SAMPLE_VK)

        assert result["fields"][0] == {"int": 37}

    def test_g1_points_are_bytes(self):
        """Test vkAlpha (G1 compressed) is encoded as bytes."""
        result = vk_to_datum(SAMPLE_VK)

        assert result["fields"][1] == {"bytes": SAMPLE_VK["vkAlpha"]}

    def test_g2_points_are_bytes(self):
        """Test vkBeta, vkGamma, vkDelta (G2 compressed) are encoded as bytes."""
        result = vk_to_datum(SAMPLE_VK)

        assert result["fields"][2] == {"bytes": SAMPLE_VK["vkBeta"]}
        assert result["fields"][3] == {"bytes": SAMPLE_VK["vkGamma"]}
        assert result["fields"][4] == {"bytes": SAMPLE_VK["vkDelta"]}

    def test_vkic_is_list_of_bytes(self):
        """Test vkIC is encoded as list of bytes objects."""
        result = vk_to_datum(SAMPLE_VK)

        ic_field = result["fields"][5]
        assert "list" in ic_field
        assert len(ic_field["list"]) == 3

        for i, ic in enumerate(ic_field["list"]):
            assert ic == {"bytes": SAMPLE_VK["vkIC"][i]}

    def test_commitment_keys_are_constructors(self):
        """Test commitmentKeys is a list of constructor 0 objects."""
        result = vk_to_datum(SAMPLE_VK)

        ck_field = result["fields"][6]
        assert "list" in ck_field
        assert len(ck_field["list"]) == 1

        ck = ck_field["list"][0]
        assert ck["constructor"] == 0
        assert len(ck["fields"]) == 2
        assert ck["fields"][0] == {"bytes": SAMPLE_VK["commitmentKeys"][0]["g"]}
        assert ck["fields"][1] == {"bytes": SAMPLE_VK["commitmentKeys"][0]["gSigmaNeg"]}

    def test_ignores_extra_fields(self):
        """Test that publicAndCommitmentCommitted is not in the output."""
        result = vk_to_datum(SAMPLE_VK)

        # Only 7 fields in SnarkVerificationKey
        assert len(result["fields"]) == 7

    def test_empty_ic_list(self):
        """Test VK with empty IC list."""
        vk = {**SAMPLE_VK, "vkIC": []}
        result = vk_to_datum(vk)

        assert result["fields"][5] == {"list": []}

    def test_empty_commitment_keys(self):
        """Test VK with empty commitment keys."""
        vk = {**SAMPLE_VK, "commitmentKeys": []}
        result = vk_to_datum(vk)

        assert result["fields"][6] == {"list": []}

    def test_multiple_commitment_keys(self):
        """Test VK with multiple commitment keys."""
        vk = {
            **SAMPLE_VK,
            "commitmentKeys": [
                {"g": "aabb", "gSigmaNeg": "ccdd"},
                {"g": "eeff", "gSigmaNeg": "0011"},
            ],
        }
        result = vk_to_datum(vk)

        ck_list = result["fields"][6]["list"]
        assert len(ck_list) == 2
        assert ck_list[0]["fields"][0] == {"bytes": "aabb"}
        assert ck_list[1]["fields"][0] == {"bytes": "eeff"}


class TestFieldOrder:
    """Test that field order matches Aiken SnarkVerificationKey type."""

    def test_field_order_matches_aiken_type(self):
        """
        Verify field order matches:
          0: nPublic (Int)
          1: vkAlpha (ByteArray)
          2: vkBeta (ByteArray)
          3: vkGamma (ByteArray)
          4: vkDelta (ByteArray)
          5: vkIC (List<ByteArray>)
          6: commitmentKeys (List<CommitmentKey>)
        """
        result = vk_to_datum(SAMPLE_VK)
        fields = result["fields"]

        # Int field
        assert "int" in fields[0]

        # ByteArray fields
        for i in [1, 2, 3, 4]:
            assert "bytes" in fields[i]

        # List fields
        assert "list" in fields[5]
        assert "list" in fields[6]

        # IC list contains bytes
        for item in fields[5]["list"]:
            assert "bytes" in item

        # CommitmentKeys list contains constructors
        for item in fields[6]["list"]:
            assert item["constructor"] == 0
            assert len(item["fields"]) == 2


class TestFileConversion:
    """Test file-based conversion."""

    def test_convert_vk_file(self, tmp_path: Path):
        """Test converting VK file to datum file."""
        input_path = tmp_path / "vk.json"
        output_path = tmp_path / "snark-vk-datum.json"

        with open(input_path, "w") as f:
            json.dump(SAMPLE_VK, f)

        convert_vk_file(input_path, output_path)

        with open(output_path, "r") as f:
            result = json.load(f)

        assert result["constructor"] == 0
        assert len(result["fields"]) == 7
        assert result["fields"][0] == {"int": 37}

    def test_convert_real_vk_file(self):
        """Test converting the actual circuit/vk.json if it exists."""
        vk_path = Path("circuit/vk.json")
        if not vk_path.exists():
            return

        with open(vk_path, "r") as f:
            vk = json.load(f)

        result = vk_to_datum(vk)

        assert result["constructor"] == 0
        assert result["fields"][0] == {"int": 37}
        assert len(result["fields"][5]["list"]) == 38  # 37 + 1 commitment wire IC
        assert len(result["fields"][6]["list"]) == 1  # 1 commitment key

    def test_output_is_valid_json(self, tmp_path: Path):
        """Test that output file is valid JSON."""
        input_path = tmp_path / "vk.json"
        output_path = tmp_path / "out.json"

        with open(input_path, "w") as f:
            json.dump(SAMPLE_VK, f)

        convert_vk_file(input_path, output_path)

        # Should not raise
        with open(output_path, "r") as f:
            result = json.load(f)

        # Should round-trip cleanly
        assert json.dumps(result) == json.dumps(vk_to_datum(SAMPLE_VK))
