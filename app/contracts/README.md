# PEACE Protocol Smart Contracts


## Testing

To run all tests, simply do:

```sh
aiken check
```

## Compiling

Set config:

```js
{
  "__comment1__": "One Shot UTxO For Genesis",
  "genesis_tx_id": "d4e4be345528b3f75720e0171a407ca97af274c3a9f761cde72a0a1860e2da5c",
  "genesis_tx_idx": 1,
  "__comment2__": "Change Address For Genesis",
  "change_address": "addr_test1qzwf0hkzux7e7elthk0lvqdjn87j93s0pjgchvkzus5fhxhlx372g08te2dtl7agwa95vjjkejjl5x8ka0rpeh8q5els8q02sp"
}
```

Compile code with:

```bash
./compile.sh
```