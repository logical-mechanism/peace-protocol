//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use digest

test hash_of_empty_bytearray() {
  let h = digest.hash(#"")
  h == #"836cc68931c2e4e3e838602eca1902591d216837bafddfe6f0c8cb07"
}

test hash_of_a_string() {
  let h = digest.hash("Hello, World!")
  h == #"7db3b749fd88a0b5da07c12a5f7fbb21794480b268fa66af7915acb6"
}

test hash_of_a_long_bytearray() {
  let h =
    digest.hash(
      #"3d01e8992cc004c0a400e2b300159800cc00404e031016404514a315330234913a6173736574732e6861735f6e66745f737472696374286d696e742c20706f6c6963795f69642c20746f6b656e5f6e616d6529203f2046616c73650014a08112",
    )
  h == #"0d4f6b2f334dde9673a876ffe34e76ae01d836efaea13211ec3f8741"
}
