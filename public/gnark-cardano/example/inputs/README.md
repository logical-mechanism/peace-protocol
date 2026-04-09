# Example circuit input files

Each `.json` file in this directory matches the corresponding `*.pattern`
file by name, and provides the JSON shape that pattern's generated
`circuit.go` expects when you run:

```bash
./snark prove -input example/inputs/<pattern>.json
```

vs. the `--test` mode which uses hardcoded values inside `CircuitProve`.

## Convention

The JSON keys must match the JSON tags on the generated `circuitInputs`
struct in `go/circuit.go`, which Claude generates from the pattern. The
shapes follow these rules:

| Pattern field type   | JSON value type        | Notes                                           |
|----------------------|------------------------|-------------------------------------------------|
| `Secret Int`         | decimal string         | Use a string, not a JSON number — Fr elements can exceed `2^53` |
| `Public Int`         | decimal string         | Public Ints that are *user-supplied* (e.g. range bounds) appear in the input JSON. Public values *derived from secrets* (e.g. `y = H(x)`) are computed by `CircuitProve` and do NOT appear here. |
| `Secret G1`          | 96 hex chars           | 48 bytes IETF compressed (no `0x` prefix, no `#"..."` wrapper) |
| `Public G1`          | 96 hex chars           | Only when user-supplied (e.g. counterparty key); points derived from secrets are computed by `CircuitProve` |
| `Public G2`          | 192 hex chars          | 96 bytes IETF compressed                        |
| `Constants`          | (not in JSON)          | Constants are baked into the circuit at compile time and never appear in inputs |

The `_comment` and `_warning` keys are ignored by Go's `json.Unmarshal`
(unknown fields are silently dropped). They're there as inline documentation
so users don't need to read the Go source to understand each input file.

## Why decimal strings for integers?

BLS12-381's Fr scalar field is 254 bits — far beyond JSON's safe integer
range of `2^53 - 1`. Using strings keeps the format precise and avoids
silent precision loss in JSON parsers (especially in JavaScript).

## What if my JSON doesn't match the generated circuit?

`./snark prove -input file.json` will fail with `parse input JSON: ...`
or `invalid sk: "..."` and so on. Compare your JSON keys to the
`circuitInputs` struct definition near the top of `go/circuit.go`. If
you regenerated `circuit.go` from a different pattern, the struct shape
likely changed and you need a different inputs file too.
