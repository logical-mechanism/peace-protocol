//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

pub type Register {
  // the generator, #<Bls12_381, G1> or #<Bls12_381, G2> 
  generator: ByteArray,
  // the public value, #<Bls12_381, G1> or #<Bls12_381, G2> 
  public_value: ByteArray,
}

const g1_generator: ByteArray =
  #"97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"

const g1_zero: ByteArray =
  #"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"

pub fn is_register_valid(self: Register) -> Bool {
  and {
    self.generator == g1_generator,
    self.public_value != g1_zero,
  }
}
