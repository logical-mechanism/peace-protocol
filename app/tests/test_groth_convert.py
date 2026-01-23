# test_groth_convert.py
#
# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

import json
from pathlib import Path


from src.groth_convert import (
    convert_all,
    convert_commitment_wires_file,
    convert_proof_file,
    convert_public_file,
    gnark_commitment_wires_to_aiken,
    gnark_proof_to_aiken,
    gnark_public_to_aiken,
)


# Sample gnark proof output (from actual proof generation)
SAMPLE_GNARK_PROOF = {
    "piA": "a707314c25618d7d44096f4e22bc2f1921f1e5c958246197b85a05ac4a5bae8da4e6b1957867a2035f165b56a30e19bd",
    "piB": "8810dd770f207aa911c7943b5790950dd0907996a0a69a4f4df6dde835ce387be256a66cdf7ebbc7815790aafabe894d1265649d01dca7c5a96268e1bd39f60d032c75532b2da48cd43c329c8c17cde01cf15e6588aef3716d85f4207e70c39b",
    "piC": "90d50a4b5dabd6b076d55ca725446e77ac1470d869f865d2a068efe6a60e0113782b6680cb9a3f3610278a4be491da8c",
    "commitments": [
        "a214703fd7a36dec1492c017b6c2d1cbe82cbc53eb996339c56a4471dd89a57ba36e356beddd47047b521ddf8ccdcc8b"
    ],
    "commitmentPok": "a748defb97467c65d35dc1f36f5095c1da5b01434351c7456406b5dd21d832f0d34b7b55769612daa73092e8c95f6388",
}

# Sample gnark public output (37 inputs + commitmentWire)
SAMPLE_GNARK_PUBLIC = {
    "inputs": [
        "1",
        "17500288565172873801",
        "9411633287470898589",
        "11539752139897092681",
        "14117566851138557178",
        "11732854847018214359",
        "149328769413022752",
        "12743184510663640417",
        "3586972869393599483",
        "1162853564816257447",
        "13963573845061158233",
        "8519358064772266323",
        "300849905542043934",
        "7122734010029193537",
        "14091438530330602714",
        "18437455730936055131",
        "1270115798220374375",
        "3523544288121143632",
        "1409434267968882308",
        "7685756809009194907",
        "3596529320966201100",
        "6136440426073328453",
        "7222376003872321934",
        "9282423828667808000",
        "1484539344460549012",
        "7138643491626859436",
        "5505419637978662744",
        "7017732200911399991",
        "6377522435931897794",
        "18011877622578215533",
        "776479359663048414",
        "10288726997180865397",
        "18352781759426245713",
        "17860951621094200122",
        "3645999937606863567",
        "7588265706522355601",
        "337242724379907695",
    ],
    "commitmentWire": "46473273883613853202488237750876267588406575077896285481293454362212862940972",
}


class TestGnarkProofToAiken:
    """Test gnark proof to Aiken/Cardano format conversion."""

    def test_basic_conversion(self):
        """Test basic proof conversion produces correct structure."""
        result = gnark_proof_to_aiken(SAMPLE_GNARK_PROOF)

        assert result["constructor"] == 0
        assert len(result["fields"]) == 5

        # Check piA
        assert result["fields"][0] == {"bytes": SAMPLE_GNARK_PROOF["piA"]}

        # Check piB
        assert result["fields"][1] == {"bytes": SAMPLE_GNARK_PROOF["piB"]}

        # Check piC
        assert result["fields"][2] == {"bytes": SAMPLE_GNARK_PROOF["piC"]}

        # Check commitments (list)
        assert result["fields"][3] == {
            "list": [{"bytes": SAMPLE_GNARK_PROOF["commitments"][0]}]
        }

        # Check commitmentPok
        assert result["fields"][4] == {"bytes": SAMPLE_GNARK_PROOF["commitmentPok"]}

    def test_empty_commitments(self):
        """Test proof with empty commitments list."""
        proof = {
            "piA": "abc123",
            "piB": "def456",
            "piC": "789ghi",
            "commitments": [],
            "commitmentPok": "",
        }
        result = gnark_proof_to_aiken(proof)

        assert result["fields"][3] == {"list": []}
        assert result["fields"][4] == {"bytes": ""}

    def test_multiple_commitments(self):
        """Test proof with multiple commitments."""
        proof = {
            "piA": "abc",
            "piB": "def",
            "piC": "ghi",
            "commitments": ["commit1", "commit2", "commit3"],
            "commitmentPok": "pok",
        }
        result = gnark_proof_to_aiken(proof)

        assert result["fields"][3] == {
            "list": [
                {"bytes": "commit1"},
                {"bytes": "commit2"},
                {"bytes": "commit3"},
            ]
        }


class TestGnarkPublicToAiken:
    """Test gnark public inputs to Aiken/Cardano format conversion."""

    def test_basic_conversion(self):
        """Test basic public inputs conversion."""
        result = gnark_public_to_aiken(SAMPLE_GNARK_PUBLIC)

        # Should be a list
        assert "list" in result

        # Should have 36 elements (inputs[1:], without the leading "1")
        assert len(result["list"]) == 36

        # Check first element (inputs[1])
        assert result["list"][0] == {"int": 17500288565172873801}

        # Check last element (inputs[36])
        assert result["list"][35] == {"int": 337242724379907695}

    def test_skips_leading_one(self):
        """Test that the leading '1' is skipped."""
        public = {"inputs": ["1", "123", "456"]}
        result = gnark_public_to_aiken(public)

        assert len(result["list"]) == 2
        assert result["list"][0] == {"int": 123}
        assert result["list"][1] == {"int": 456}

    def test_empty_inputs(self):
        """Test with empty inputs."""
        result = gnark_public_to_aiken({"inputs": []})
        assert result == {"list": []}

    def test_only_one(self):
        """Test with only the leading '1'."""
        result = gnark_public_to_aiken({"inputs": ["1"]})
        assert result == {"list": []}


class TestGnarkCommitmentWiresToAiken:
    """Test gnark commitment wires extraction."""

    def test_basic_extraction(self):
        """Test basic commitment wire extraction."""
        result = gnark_commitment_wires_to_aiken(SAMPLE_GNARK_PUBLIC)

        assert "list" in result
        assert len(result["list"]) == 1
        assert result["list"][0] == {
            "int": 46473273883613853202488237750876267588406575077896285481293454362212862940972
        }

    def test_missing_commitment_wire(self):
        """Test with missing commitmentWire."""
        result = gnark_commitment_wires_to_aiken({"inputs": ["1", "2"]})
        assert result == {"list": []}

    def test_empty_commitment_wire(self):
        """Test with empty commitmentWire."""
        result = gnark_commitment_wires_to_aiken({"commitmentWire": ""})
        assert result == {"list": []}


class TestFileConversion:
    """Test file-based conversion functions."""

    def test_convert_proof_file(self, tmp_path: Path):
        """Test converting proof file."""
        # Write sample gnark proof
        input_path = tmp_path / "proof.json"
        with open(input_path, "w") as f:
            json.dump(SAMPLE_GNARK_PROOF, f)

        # Convert
        output_path = tmp_path / "groth-proof.json"
        convert_proof_file(input_path, output_path)

        # Verify output
        with open(output_path, "r") as f:
            result = json.load(f)

        assert result["constructor"] == 0
        assert len(result["fields"]) == 5
        assert result["fields"][0]["bytes"] == SAMPLE_GNARK_PROOF["piA"]

    def test_convert_public_file(self, tmp_path: Path):
        """Test converting public inputs file."""
        # Write sample gnark public
        input_path = tmp_path / "public.json"
        with open(input_path, "w") as f:
            json.dump(SAMPLE_GNARK_PUBLIC, f)

        # Convert
        output_path = tmp_path / "groth-public.json"
        convert_public_file(input_path, output_path)

        # Verify output
        with open(output_path, "r") as f:
            result = json.load(f)

        assert "list" in result
        assert len(result["list"]) == 36

    def test_convert_commitment_wires_file(self, tmp_path: Path):
        """Test converting commitment wires file."""
        # Write sample gnark public
        input_path = tmp_path / "public.json"
        with open(input_path, "w") as f:
            json.dump(SAMPLE_GNARK_PUBLIC, f)

        # Convert
        output_path = tmp_path / "groth-commitment-wires.json"
        convert_commitment_wires_file(input_path, output_path)

        # Verify output
        with open(output_path, "r") as f:
            result = json.load(f)

        assert "list" in result
        assert len(result["list"]) == 1

    def test_convert_all(self, tmp_path: Path):
        """Test converting all files at once."""
        # Write sample files
        proof_path = tmp_path / "proof.json"
        public_path = tmp_path / "public.json"
        output_dir = tmp_path / "output"

        with open(proof_path, "w") as f:
            json.dump(SAMPLE_GNARK_PROOF, f)
        with open(public_path, "w") as f:
            json.dump(SAMPLE_GNARK_PUBLIC, f)

        # Convert all
        convert_all(proof_path, public_path, output_dir)

        # Verify all output files exist
        assert (output_dir / "groth-proof.json").exists()
        assert (output_dir / "groth-public.json").exists()
        assert (output_dir / "groth-commitment-wires.json").exists()

        # Verify content
        with open(output_dir / "groth-proof.json", "r") as f:
            proof_result = json.load(f)
        assert proof_result["constructor"] == 0

        with open(output_dir / "groth-public.json", "r") as f:
            public_result = json.load(f)
        assert len(public_result["list"]) == 36

        with open(output_dir / "groth-commitment-wires.json", "r") as f:
            wires_result = json.load(f)
        assert len(wires_result["list"]) == 1


class TestRoundTrip:
    """Test that converted output matches expected Aiken format."""

    def test_proof_json_format_matches_aiken_type(self):
        """Verify output format matches Aiken GrothProof type structure."""
        result = gnark_proof_to_aiken(SAMPLE_GNARK_PROOF)

        # GrothProof is:
        # pub type GrothProof {
        #   piA: ByteArray,           // field 0
        #   piB: ByteArray,           // field 1
        #   piC: ByteArray,           // field 2
        #   commitments: List<ByteArray>,  // field 3
        #   commitmentPok: ByteArray, // field 4
        # }

        # Verify structure
        assert isinstance(result, dict)
        assert result.get("constructor") == 0
        fields = result.get("fields", [])
        assert len(fields) == 5

        # Each ByteArray field should be {"bytes": "..."}
        for i in [0, 1, 2, 4]:
            assert "bytes" in fields[i]
            assert isinstance(fields[i]["bytes"], str)

        # List<ByteArray> field should be {"list": [{"bytes": "..."}, ...]}
        assert "list" in fields[3]
        assert isinstance(fields[3]["list"], list)
        for item in fields[3]["list"]:
            assert "bytes" in item

    def test_public_json_format_matches_aiken_type(self):
        """Verify output format matches Aiken GrothPublic type (List<Int>)."""
        result = gnark_public_to_aiken(SAMPLE_GNARK_PUBLIC)

        # GrothPublic = List<Int>
        # Cardano format: {"list": [{"int": ...}, ...]}

        assert isinstance(result, dict)
        assert "list" in result
        assert isinstance(result["list"], list)

        for item in result["list"]:
            assert "int" in item
            assert isinstance(item["int"], int)
