# The PEACE App

Happy path tested on Ubuntu 24.

## Testing

```bash
./run_tests.sh
```

## Formatting

```bash
./lint.sh
```

## Happy Path Setup

First, create the wallets and fund them with Lovelace.
```bash
./create_wallets.sh
```

```bash
wallets
├── alice   ← 50  ADA
├── bob     ← 50  ADA
├── collat  ← 5   ADA
├── genesis ← 5   ADA
└── holder  ← 150 ADA
```

Alice and Bob need enough Lovelace to interact with the contracts. 50 ADA is more than enough here. Collateral will be its own address with 5 ADA. Alice and Bob will share the collateral. Genesis needs 5 ADA to mint the reference token. The holder address needs enough ADA to hold all of the script references. The `config.json` file can now be filled out after the wallets are prepped with enough ADA.

```js
{
  "genesis_tx_id": "TxID_HERE",
  "genesis_tx_idx": 0,
  "genesis_change_address": "CHANGE_ADDRESS_HERE",
  "staking_credential": "STAKING_CREDENTIAL_HERE",
  "path_to_cardano_cli": "/path/to/cardano-cli",
  "path_to_node_socket": "/path/to/node.socket"
}
```

The genesis UTxO (Unspent Transaction Output) determines the `genesis_tx_id` and `genesis_tx_idx` fields. The change from the reference token mint will go to `genesis_change_address`. The `staking_credential` is the StakeKeyHash (a hash of a staking key) for an address. The path fields need to point to the cli and node socket.

The contracts can be set up after the `config.json` is filled out correctly.

```bash
./setup.sh
```

The happy path is ready after the contracts are set up. The happy path requires access to a fully synced Cardano node. All happy path interactions are in the commands folder.

## Happy Path Usage

The script references must be created upon first use of the happy path with `00_createScriptReferences.sh`. This will use the holder wallet to recursively store the contracts on-chain. These transactions must be on-chain before the reference token is minted. The reference token must be minted during the first happy-path run with `01_createGenesisTx.sh`. This action only happens once, similar to the script reference creation. This will mint the reference token into the reference contract. Since this is a proof-of-concept, the reference contract is not intended as permanent storage for the token. It's just a simple, always true. If the reference datum needs updating, use `02a_updateReferenceTx.sh`. If the reference datum needs to be removed, then use `02b_removeReferenceTx.sh`, removing the reference token from the reference contract will break the happy path, and the happy path setup will need to be restarted.

Alice may create or remove the encryption UTxO using `03_createEncryptionTx.sh` and `04_removeEncryptionTx.sh`, respectively. Bob may create or remove the bid UTxO using `05_createBidTx.sh` and `06_removeBidTx.sh`, respectively. After both UTxOs are created, Alice may use `07_createReEncryptionTx.sh` to re-encrypt the data for Bob, who can then decrypt it using `08_decryptMessage.sh`.

The roles of Alice and Bob can be swapped by changing the wallet paths in the happy path.

**Copyright (C) 2025 Logical Mechanism LLC**

**SPDX-License-Identifier: CC-BY-4.0**