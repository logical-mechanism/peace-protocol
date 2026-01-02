//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

pub type Register {
  // the generator
  generator: ByteArray,
  // the public value
  public_value: ByteArray,
}

const g1_generator: ByteArray =
  #"97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"

const g1_zero: ByteArray =
  #"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"

/// Check if a register is valid by making sure the generator is the default
/// g1 generator and that the public value is not the identity element.
///
/// ```aiken
/// register.is_register_valid(datum)
/// ```
pub fn is_register_valid(self: Register) -> Bool {
  and {
    // the generator must be the g1 generator
    self.generator == g1_generator,
    // public value must not be identity
    self.public_value != g1_zero,
    // generator must not be the public value
    self.generator != self.public_value,
  }
}
