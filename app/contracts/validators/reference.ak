//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{OutputReference, Transaction}

validator contract(_genesis_pid: PolicyId, _genesis_tkn: AssetName) {
  spend(
    _maybe_datum: Option<Data>,
    _redeemer: Data,
    _utxo: OutputReference,
    _self: Transaction,
  ) {
    // Just have this as true for now
    True
  }

  else(_) {
    fail
  }
}
