# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only
from src.files import save_json


def full_level_to_file(r1b: str, r2_g1b: str, r2_g2b: str, r4b: str) -> None:
    """
    Write a "full-level" entry JSON artifact to disk.

    A "full-level" entry includes:
    - `r1b`: a G1 element (bytes/hex string)
    - `r2`: a sum-type structure containing:
        - `r2_g1b`: the G1 component
        - `r2_g2b`: the G2 component (wrapped in a constructor)
    - `r4b`: an additional G1 element (bytes/hex string)

    The output schema matches a Plutus/Aiken constructor encoding. In particular,
    the nested structure corresponds to a variant where the second field has a
    populated G2 sub-field (i.e., not the "empty" constructor used by half-level).

    Output path (fixed):
        ../data/full-level.json

    Args:
        r1b: Hex/bytes string for the `r1` point (G1).
        r2_g1b: Hex/bytes string for the `r2` G1 component.
        r2_g2b: Hex/bytes string for the `r2` G2 component.
        r4b: Hex/bytes string for the `r4` point (G1).

    Returns:
        None. Writes the JSON artifact via `save_json`.

    Raises:
        Any exceptions raised by `save_json` (e.g., invalid path or permissions)
        will propagate.
    """
    path = "../data/full-level.json"
    data = {
        "constructor": 0,
        "fields": [
            {"bytes": r1b},
            {
                "constructor": 0,
                "fields": [
                    {"bytes": r2_g1b},
                    {
                        "constructor": 0,
                        "fields": [{"bytes": r2_g2b}],
                    },
                ],
            },
            {"bytes": r4b},
        ],
    }
    save_json(path, data)


def half_level_to_file(r1b: str, r2_g1b: str, r4b: str) -> None:
    """
    Write a "half-level" entry JSON artifact to disk.

    A "half-level" entry includes:
    - `r1b`: a G1 element (bytes/hex string)
    - `r2`: a sum-type structure containing:
        - `r2_g1b`: the G1 component
        - an *empty* alternative (constructor=1) indicating the G2 component
          is not present yet
    - `r4b`: an additional G1 element (bytes/hex string)

    This represents an entry before a subsequent hop fills in the G2 component
    (which is what `full_level_to_file` encodes).

    Output path (fixed):
        ../data/half-level.json

    Args:
        r1b: Hex/bytes string for the `r1` point (G1).
        r2_g1b: Hex/bytes string for the `r2` G1 component.
        r4b: Hex/bytes string for the `r4` point (G1).

    Returns:
        None. Writes the JSON artifact via `save_json`.

    Raises:
        Any exceptions raised by `save_json` (e.g., invalid path or permissions)
        will propagate.
    """
    path = "../data/half-level.json"
    data = {
        "constructor": 0,
        "fields": [
            {"bytes": r1b},
            {
                "constructor": 0,
                "fields": [
                    {"bytes": r2_g1b},
                    {
                        "constructor": 1,
                        "fields": [],
                    },
                ],
            },
            {"bytes": r4b},
        ],
    }
    save_json(path, data)
