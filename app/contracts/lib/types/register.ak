use aiken/crypto/bitwise.{State}
use aiken/crypto/bls12_381/g1
use aiken/crypto/bls12_381/g2
use aiken/crypto/bls12_381/scalar.{Scalar}

pub type Register {
  // the generator, #<Bls12_381, G1> or #<Bls12_381, G2> 
  generator: ByteArray,
  // the public value, #<Bls12_381, G1> or #<Bls12_381, G2> 
  public_value: ByteArray,
}

pub fn g1_randomize(datum: Register, s: State<Scalar>) -> Register {
  // decompress the generator and public value
  let g: G1Element = g1.decompress(datum.generator)
  let u: G1Element = g1.decompress(datum.public_value)
  // now randomize the register elements
  let g_s: G1Element = g1.scale(g, s)
  let u_s: G1Element = g1.scale(u, s)
  // recompress the new randomized elements
  Register { generator: g_s |> g1.compress, public_value: u_s |> g1.compress }
}

pub fn g2_randomize(datum: Register, s: State<Scalar>) -> Register {
  // decompress the generator and public value
  let g: G2Element = g2.decompress(datum.generator)
  let u: G2Element = g2.decompress(datum.public_value)
  // now randomize the register elements
  let g_s: G2Element = g2.scale(g, s)
  let u_s: G2Element = g2.scale(u, s)
  // recompress the new randomized elements
  Register { generator: g_s |> g2.compress, public_value: u_s |> g2.compress }
}
