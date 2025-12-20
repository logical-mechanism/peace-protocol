# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only
import json

from pathlib import Path
from typing import Any


def save_string(path: str | Path, string: str) -> None:
    """
    Write a UTF-8 string to a file, creating parent directories if needed.

    Args:
        path: Destination file path (string or `Path`).
        string: Text content to write.

    Returns:
        None.

    Side effects:
        - Creates `path.parent` directories if they do not exist.
        - Overwrites the file if it already exists.

    Raises:
        OSError: If the file cannot be created or written due to permissions,
            invalid paths, etc.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        f.write(string)


def save_json(path: str | Path, data: Any) -> None:
    """
    Serialize data as pretty-printed JSON and write it to a file.

    The JSON is written with:
    - `indent=2` for readability
    - `sort_keys=True` for deterministic output

    Args:
        path: Destination file path (string or `Path`).
        data: Any JSON-serializable Python object (dict/list/str/int/etc.).

    Returns:
        None.

    Side effects:
        - Creates `path.parent` directories if they do not exist.
        - Overwrites the file if it already exists.

    Raises:
        TypeError: If `data` contains non-JSON-serializable objects.
        OSError: If the file cannot be created or written.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)


def extract_key(file_path: str) -> str:
    """
    Extract the hex key material from a JSON file containing a `cborHex` field.

    This helper expects the file to be JSON with a top-level `"cborHex"` field
    and returns the substring starting at index 4:

        return data["cborHex"][4:]

    That `[4:]` trimming is protocol-specific (e.g., skipping a CBOR prefix /
    tag). The function does not validate the format beyond the presence of the
    key and the slice.

    Args:
        file_path: Path to a JSON file containing a `"cborHex"` field.

    Returns:
        A string containing the sliced hex payload from `"cborHex"`.

    Raises:
        FileNotFoundError: If `file_path` does not exist.
        json.JSONDecodeError: If the file is not valid JSON.
        KeyError: If `"cborHex"` is missing.
        TypeError: If `"cborHex"` is not a string/sliceable.
    """
    with open(file_path, "r") as file:
        data = json.load(file)
        return data["cborHex"][4:]


def load_json(path: str | Path) -> Any:
    """
    Load and parse a JSON file.

    Args:
        path: Path to the JSON file (string or `Path`).

    Returns:
        The parsed JSON value (commonly a dict or list), typed as `Any`.

    Raises:
        FileNotFoundError: If the file does not exist.
        json.JSONDecodeError: If the file is not valid JSON.
        OSError: If the file cannot be opened/read.
    """
    path = Path(path)
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)
