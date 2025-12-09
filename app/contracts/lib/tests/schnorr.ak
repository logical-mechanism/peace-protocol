use aiken/crypto/bitwise.{State}
use aiken/crypto/bls12_381/g1
use aiken/crypto/bls12_381/scalar.{Scalar}
use types/register.{Register}
use types/schnorr.{BindingProof, SchnorrProof}

// shows how it is constant time
test simple_schnorr_proof() {
  // some secret x 
  let x: State<Scalar> = scalar.from_int(44203)
  // the datum register using the g1 generator and the public value for x
  let datum: Register =
    Register {
      generator: g1.generator |> g1.compress,
      public_value: g1.generator |> g1.scale(x) |> g1.compress,
    }
  // a random number
  let r: State<Scalar> = scalar.from_int(1337)
  // calculate the g^r term
  let g: G1Element = g1.generator
  let g_r: G1Element = g1.scale(g, r)
  let g_r_b: ByteArray = g_r |> g1.compress
  // the challenge number using a fiat shamir transform
  let c: State<Scalar> =
    schnorr.fiat_shamir_heuristic(datum.generator, g_r_b, datum.public_value)
      |> scalar.from_bytes
  // the z value
  let z: State<Scalar> = scalar.mul(c, x) |> scalar.add(r)
  let z_b: ByteArray = scalar.to_bytes(z)
  let proof = SchnorrProof { z_b, g_r_b }
  schnorr.verify(datum, proof)
}

test simple_binding_proof() {
  let token_name = #"acab"
  // set up the user
  let x: State<Scalar> = scalar.from_int(44203)
  let user: Register =
    Register {
      generator: g1.generator |> g1.compress,
      public_value: g1.generator |> g1.scale(x) |> g1.compress,
    }
  // set up the r terms
  let a: State<Scalar> = scalar.from_int(1337)
  let r: State<Scalar> = scalar.from_int(67)
  let r1_b: ByteArray = g1.generator |> g1.scale(r) |> g1.compress
  let r2_b: ByteArray =
    g1.generator |> g1.scale(scalar.add(a, scalar.mul(x, r))) |> g1.compress
  // set up the proof
  let alpha: State<Scalar> = scalar.from_int(3456)
  let rho: State<Scalar> = scalar.from_int(5678)
  let t1: ByteArray = g1.generator |> g1.scale(rho) |> g1.compress
  let t2: ByteArray =
    g1.add(
      g1.generator |> g1.scale(alpha),
      g1.generator |> g1.scale(scalar.mul(x, rho)),
    )
      |> g1.compress
  let half_proof = BindingProof { z_a_b: #"", z_r_b: #"", t_1_b: t1, t_2_b: t2 }
  let c: State<Scalar> =
    schnorr.binding_fiat_shamir_heuristic(
      user,
      half_proof,
      r1_b,
      r2_b,
      token_name,
    )
      |> scalar.from_bytes
  let z_a: ByteArray = scalar.mul(c, a) |> scalar.add(alpha) |> scalar.to_bytes
  let z_r: ByteArray = scalar.mul(c, r) |> scalar.add(rho) |> scalar.to_bytes
  let proof = BindingProof { z_a_b: z_a, z_r_b: z_r, t_1_b: t1, t_2_b: t2 }
  schnorr.binding_verify(user, proof, r1_b, r2_b, token_name)
}
