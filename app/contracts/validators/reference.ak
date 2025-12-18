////
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
