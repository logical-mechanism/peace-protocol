from src.files import save_json

def full_level_to_file(r1b: str, r2_g1b: str, r2_g2b: str, r4b: str):
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
                        "fields": [
                            {"bytes": r2_g2b}
                        ],
                    },
                ],
            },
            {"bytes": r4b},
        ],
    }
    save_json(path, data)


def half_level_to_file(r1b: str, r2_g1b: str, r4b: str) -> None:
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
