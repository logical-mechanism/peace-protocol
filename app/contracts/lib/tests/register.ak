use aiken/crypto/bitwise.{State}
use aiken/crypto/bls12_381/g1
use aiken/crypto/bls12_381/scalar.{Scalar}
use types/register.{Register}

test a_valid_register() {
  let x: State<Scalar> = scalar.from_int(44203)
  // the datum register using the g1 generator and the public value for x
  let datum: Register =
    Register {
      generator: g1.generator |> g1.compress,
      public_value: g1.generator |> g1.scale(x) |> g1.compress,
    }
  register.is_register_valid(datum)
}

test an_invalid_register1() fail {
  let x: State<Scalar> = scalar.from_int(0)
  // the datum register using the g1 generator and the public value for x
  let datum: Register =
    Register {
      generator: g1.generator |> g1.compress,
      public_value: g1.generator |> g1.scale(x) |> g1.compress,
    }
  register.is_register_valid(datum)
}

test an_invalid_register2() fail {
  let x: State<Scalar> = scalar.from_int(44203)
  let r: State<Scalar> = scalar.from_int(67)
  // the datum register using the g1 generator and the public value for x
  let datum: Register =
    Register {
      generator: g1.generator |> g1.scale(r) |> g1.compress,
      public_value: g1.generator |> g1.scale(x) |> g1.scale(r) |> g1.compress,
    }
  register.is_register_valid(datum)
}
