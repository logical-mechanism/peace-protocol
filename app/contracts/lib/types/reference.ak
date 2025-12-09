use aiken/crypto.{ScriptHash}

pub type ReferenceDatum {
  reference: ScriptHash,
  encryption: ScriptHash,
  bid: ScriptHash,
}
