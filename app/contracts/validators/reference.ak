//// Copyright (C) 2025-2026 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use cardano/transaction.{TransactionId}

// Parameterised by the bootstrap (tx_id, tx_idx) — same ones threaded
// into the genesis policy. The params are unused in the validator body
// (reference is always-fail) and serve only to give each deployment a
// unique reference address. Re-keying from (genesis_pid, genesis_tkn)
// to (tx_id, tx_idx) breaks the bootstrap cycle introduced by M-01:
// genesis.ak now takes reference_hash as a parameter, so reference.ak
// must be buildable BEFORE genesis_pid is known.
validator contract(_tx_id: TransactionId, _tx_idx: Int) {
  //
  // (\(\
  // ( -.-)
  // o_(")(")
  else(_) {
    fail @"I always fail :/"
  }
}
