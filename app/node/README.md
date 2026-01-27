# Local Custom Cardano Testnet

This folder contains scripts and configuration for running a local Cardano testnet with modified protocol parameters (increased max transaction size) for testing the peace-protocol SNARK verification.

## Goal

Run a local single-node Cardano testnet where:
- Max transaction size is doubled from 16KB to 32KB
- Network starts in Conway era immediately
- Wallets are auto-created and funded on startup
- All data is cleaned up on shutdown for easy restart
- Existing commands in `/commands/` work by pointing to the local socket

## Directory Structure

```
node/
├── README.md                 # This file
├── start.sh                  # Start the local testnet
├── stop.sh                   # Stop and clean up
├── templates/
│   └── byron-protocol-params.json  # Byron protocol parameters template
├── config/
│   ├── node-config.json      # Node configuration
│   ├── topology.json         # Network topology (local only)
│   ├── byron-genesis.json    # Byron era genesis (generated at startup)
│   ├── shelley-genesis.json  # Shelley era genesis (maxTxSize here)
│   ├── alonzo-genesis.json   # Alonzo era genesis
│   └── conway-genesis.json   # Conway era genesis
├── data/                     # Runtime data (auto-cleaned)
│   ├── db/                   # Node database
│   ├── node.socket           # Node socket
│   ├── node.log              # Node log output
│   └── node.pid              # PID file for cleanup
└── keys/                     # Generated keys (auto-cleaned)
    ├── genesis/              # Genesis keys
    ├── delegate/             # Delegate keys for block production
    └── utxo/                 # UTXO keys for fund distribution
```

## Protocol Parameter Changes

The key change in `shelley-genesis.json`:

```json
{
  "protocolParams": {
    "maxTxSize": 32768,  // Doubled from 16384
    ...
  }
}
```

## Implementation Plan

### Phase 1: Genesis Configuration

1. **Create Byron Genesis**
   - Use `cardano-cli byron genesis genesis` to create initial byron genesis
   - Set start time to current time
   - Minimal configuration (we transition immediately)

2. **Create Shelley Genesis**
   - Use `cardano-cli genesis create` for base template
   - Modify `maxTxSize` to 32768 (doubled)
   - Set `epochLength` to small value (e.g., 500 slots) for fast testing
   - Set `slotLength` to 0.1s for fast block production
   - Set initial funds for test wallets (alice, bob, holder, collat, genesis)
   - Configure single genesis key for block production

3. **Create Alonzo Genesis**
   - Copy from official Alonzo genesis template
   - Contains cost models for Plutus scripts

4. **Create Conway Genesis**
   - Copy from official Conway genesis template
   - Contains governance parameters

### Phase 2: Node Configuration

1. **node-config.json**
   - Start directly in Conway era (bypass testnet hard forks)
   - Point to all genesis files
   - Enable block production (single node acts as stake pool)
   - Set appropriate logging level

2. **topology.json**
   - Empty producers list (local only, no peers)

### Phase 3: Startup Script (start.sh)

```
1. Check if already running (PID file exists)
2. Clean any stale data from previous run
3. Create data/ and keys/ directories
4. Generate genesis keys and delegate keys
5. Create genesis files with current timestamp
6. Configure initial fund distribution to wallets
7. Start cardano-node in background
8. Wait for socket to be available
9. Create/fund wallets if they don't have keys
10. Display connection info
```

### Phase 4: Shutdown Script (stop.sh)

```
1. Read PID from node.pid
2. Send SIGTERM to cardano-node
3. Wait for graceful shutdown (with timeout)
4. Remove data/ directory (db, socket, pid)
5. Optionally remove keys/ (flag to preserve)
6. Display cleanup confirmation
```

### Phase 5: Integration with Existing Commands

To use the local testnet with existing commands:

1. **Modify config.json** (or use environment override):
   ```json
   {
     "path_to_node_socket": "/path/to/peace-protocol/app/node/data/node.socket"
   }
   ```

2. **Modify .env** network magic:
   ```bash
   network="--testnet-magic 42"  # Our custom magic number
   ```

Or use the provided `.env.local` (already created in app/):
```bash
# In commands/ directory:
source ../.env.local
```

This file sets:
- `network="--testnet-magic 42"`
- `CARDANO_NODE_SOCKET_PATH` pointing to the local node socket

## Key Configuration Values

| Parameter | Standard Testnet | Local Testnet | Reason |
|-----------|-----------------|---------------|--------|
| maxTxSize | 16384 | 32768 | Allow larger SNARK verification tx |
| epochLength | 432000 | 500 | Fast epoch transitions |
| slotLength | 1.0 | 0.1 | Fast block production |
| testnetMagic | 1 (preprod) | 42 | Distinguish from real testnets |

## Wallet Funding

On startup, fund each wallet with 1,000,000,000 lovelace (1000 ADA) from genesis:

| Wallet | Initial Funding | Purpose |
|--------|----------------|---------|
| alice | 1,000,000,000 lovelace | Test user 1 |
| bob | 1,000,000,000 lovelace | Test user 2 |
| holder | 1,000,000,000 lovelace | Script references, main operations |
| collat | 1,000,000,000 lovelace | Collateral for script execution |
| genesis | 1,000,000,000 lovelace | Genesis operations |

## Dependencies

- `cardano-node` (on PATH) - v10.x or later for Conway support
- `cardano-cli` (on PATH) - matching version
- `jq` - JSON processing
- `bash` - Script execution

## Usage

### Start the testnet:
```bash
cd node/
./start.sh
```

### Check status:
```bash
cardano-cli query tip --testnet-magic 42
```

### Run existing commands:
```bash
cd ../commands/
source ../.env.local  # or modify .env
./99_displayAllBalances.sh
```

### Stop and clean up:
```bash
cd node/
./stop.sh
```

### Stop but preserve keys:
```bash
./stop.sh --keep-keys
```

## Troubleshooting

### Node won't start
- Check if port 3001 is in use
- Check cardano-node version: `cardano-node --version`
- Check logs in data/node.log

### Socket not available
- Wait a few seconds after start
- Check node is running: `ps aux | grep cardano-node`

### Transactions failing
- Ensure wallets are funded: `./99_displayAllBalances.sh`
- Check protocol parameters: `cardano-cli query protocol-parameters --testnet-magic 42`

## Notes

- This is for development/testing only
- All data is ephemeral by design
- Block production is centralized (single node)
- No security considerations (test keys are generated fresh each run)

## Next Steps After Plan Approval

1. Create the genesis file templates
2. Write start.sh with proper genesis creation
3. Write stop.sh with cleanup logic
4. Test with existing commands
5. Document any issues or adjustments needed
