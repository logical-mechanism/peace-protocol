# The PEACE Protocol MVP

The MVP runs on Ubuntu 24 and requires a fully synced Cardano node on the pre-production network.

## Virtual Environment

Activate the virtual environment before starting the happy path.

```bash
python3 -m venv venv
source venv/bin/activate
```

## Happy Path Setup

Create wallets and fund them with Lovelace.

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

Alice and Bob must hold at least 50 ADA to interact with the protocol. The Collat wallet requires 5 ADA. Genesis needs 5 ADA to mint the reference token. Holder needs 150 ADA for script references. Fill out config.json after funding wallets.

```js
{
  "genesis_tx_id": "TxID_HERE",
  "genesis_tx_idx": 0,
  "genesis_change_address": "CHANGE_ADDRESS_HERE",
  "staking_credential": "STAKING_CREDENTIAL_HERE",
  'path_to_cardano_cli': '/path/to/cardano-cli' (location of Cardano CLI tool to interact with the blockchain),
  'path_to_node_socket': '/path/to/node.socket' (file used by Cardano node for communication)
}
```

The genesis wallet UTxO sets the `genesis_tx_id` and `genesis_tx_idx` fields. Leftover Lovelace from minting goes to the address defined in the `genesis_change_address` field. The `staking_credential` field is the `StakeKeyHash` of an address. Path fields must point to the cli and node socket.

Proceed to set up the contracts next.

```bash
./setup.sh
```

Start the happy path after contracts are set up. Access a fully synced Cardano node. Locate all happy path commands in the commands folder.

## Happy Path Usage

All of the happy path commands are located in [commands](/commands).

The script references must be created upon first use of the happy path with `00_createScriptReferences.sh`. This will use the Holder wallet to recursively store the contracts on-chain. These transactions must be on-chain before the reference token is minted. The reference token must be minted during the first happy-path run with `01_createGenesisTx.sh`. This will mint the reference token into the reference contract. Script reference creation and reference token minting actions only happen once. Since this is a proof-of-concept, the reference contract is not intended as permanent storage for the token. It's just a simple, always true contract. If the reference datum needs updating, use `02a_updateReferenceTx.sh`. If the reference datum needs to be removed, use `02b_removeReferenceTx.sh`. Removing the reference token from the reference contract will break the happy path, and the happy path setup flow will need to be restarted.

Alice creates or removes the encryption UTxO with `03_createEncryptionTx.sh` or `04_removeEncryptionTx.sh`. Bob creates or removes the bid UTxO with `05_createBidTx.sh` or `06_removeBidTx.sh`. When an encryption and a bid UTxO exist on-chain, Alice can then perform the re-encryption step using `07_createReEncryptionTx.sh`. Bob may then decrypt with `08_decryptMessage.sh`.

Swap Alice and Bob's roles by updating wallet paths in the happy path to re-encrypt messages back to Alice.

## Testing

```bash
./run_tests.sh
```

## Formatting

```bash
./lint.sh
```

**Copyright (C) 2025 Logical Mechanism LLC**

**SPDX-License-Identifier: CC-BY-4.0**