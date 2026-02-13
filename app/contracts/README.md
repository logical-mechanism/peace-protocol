# PEACE Protocol Smart Contracts

There are two user-focused smart contracts: one for re-encryption and the other for bid management. Any UTxO inside the re-encryption contract is for sale via the bidding system. A user may place a bid into the bid contract, and the current owner of the encrypted data may select it as payment for re-encrypting the data to the new owner. Payments on bid UTxOs will be Lovelace only. To ensure functionality, a reference data contract must exist, as it resolves circular dependencies. The protocol starts with the genesis mint.

## Testing

```sh
aiken check
```

## Compiling

```bash
./compile.sh
```

**Copyright (C) 2025 Logical Mechanism LLC**

**SPDX-License-Identifier: CC-BY-4.0**