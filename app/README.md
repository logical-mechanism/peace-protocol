# Application

Application tested on Ubuntu 24.

## Testing

The Python code has tests ran from the app folder.

```bash
pytest -s -vv
```

The Aiken code has tests ran from the contracts folder.

```bash
aiken check
```

## Formatting

```bash
./lint.sh
```

## Happy Path Setup

First, create the wallets and fund with Lovelace.

```bash
./create_wallets.sh
```

```bash
wallets
├── alice ← 50 ADA
├── bob ← 50 ADA
├── collat ← 5 ADA
├── genesis ← 5 ADA
└── holder ← 150 ADA
```

Alice and Bob need enough lovelace to interact with the contracts. 50 ADA is more than enough here. Collateral will be its own address with 5 ADA in it. Alice and Bob will share the collateral. Genesis needs 5 ADA to mint the reference token. The holder address needs enough ADA to hold all of the script references. The `confile.json` file can now be filled out after the wallets are prepped with enough ADA.

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

The UTxO holding the 5 ADA determines the `genesis_tx_id` and `genesis_tx_idx` fields. The change from the reference token mint will go to `genesis_change_address`. The staking credential is the StakeKeyHash of an address. The path fields need to point to the cli and node socket.

The contracts can be setup after the `config.json` is filled out correctly.

```bash
./setup.sh
```

The happy path is ready after the contracts are setup. The happy path requires access to a fully sync'd cardano node. All happy path interactions are in the `commands` folder.

The script references must be created upon first use of the happy path with `00_createScriptReferences.sh`. This will use the `holder` wallet to recursive store the contracts on-chain. These transactions must be on-chain before the reference token is minted. The reference token must be minted upon first use of the happy path with `01_createGenesisTx.sh`. This action only happens once, similar to the script reference creation. This will mint the reference token into the reference contract. Since this is a proof of concept, the reference contract is not permanent storage for the token. Its just a simple always true. If the reference datum needs updating use `02a_updateReferenceTx.sh`. If the reference datum needs to be removed then use `02b_removeReferenceTx.sh`, removing the reference token from the reference contract will break the happy path and the happy path setup will need to be restarted.

Alice may create the encryption UTxO with `03_createEncryptionTx.sh` and may remove it with `04_removeEncryptionTx.sh`. Bob may create the bid UTxO with `05_createBidTx.sh` and may remove it with `06_removeBidTx.sh`. Using the encryption UTxO and bid UTxO, alice may use `07_createReEncryptionTx.sh` to re-encrypt the data to Bob. Bob can decrypt the data using `08_decryptMessage.sh`.

The roles for Alice and Bob can be switched by changing the wallet paths inside the happy path.

**Copyright (C) 2025 Logical Mechanism LLC**

**SPDX-License-Identifier: CC-BY-4.0**