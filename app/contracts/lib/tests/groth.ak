use types/groth.{GrothProof, SnarkVerificationKey}

test point_to_hash_to_int_list() {
  let w: ByteArray =
    #"a1588e31d17d31785a4ce1a882ca92a3f1bbb7fdd9953398ff53fca38ade891c075f9e7eefc9d1396298c6f680539c69"
  let public_ints: List<Int> = groth.public_inputs_from_w(w)
  public_ints == [
    86721980652443005217719496642694247237,
    158132697557323219579992358050637845714,
  ]
}

/// This is failing. Need to investigate groth proofs more.
test valid_groth_proof() fail {
  let vk: SnarkVerificationKey =
    SnarkVerificationKey {
      nPublic: 2,
      vkAlpha: #"a096f5643b2685d5fccf45278ce8a1a50caddf9de45b5da1c7cd08452b21eb1ed0ab5932e679ddc63f22f52ad301b7b5",
      vkBeta: #"b5f00083826c3a5e8b5c9a5a14a9cf0fa414b0aa8551eaafd42ab39c54d5ccef3dfe32e0fd27f43c2e05705ea77522500ac149566a7f6aee1e4747c6fb162509777d598ee6968df2942845e424fa200766d91f2abd857aa2d9eb3729471b5e83",
      vkGamma: #"a2e1bf70280041d0367d0eb0a902343559e9e8a27d1c5c26a17f314d4b9da88ebb57560efe41630a16f56c5e3c5448ce0dc16731ca13a8aab6e76994f20e6129cbbc69d8dcd71d9dcfc2eb4acebf12488c224ed1f68129d624c05a6f77ed16dc",
      vkDelta: #"88c39b7ea8af4fffc562c038023fcce386057383cdbe01ab9dbe13b7f60eaf5aadfb1cf45e7ea56a5f919cf8545d6cd40cd47b991da3b16c36a545a3059e084fe9b3c04e6a8e80c019ed0c5d7e5674304e31d2e6f6ed1b9453d62cec84f8b55d",
      vkIC: [
        #"8c61ffb1b4a1e81eb7f344a8b8cc8e1d68da3101b8ed66eda37433b97a1fa97a1fd4d1b293dc3256e0d56fc2486b5fac",
        #"84df5251d0f8803913216116cf3e2d02c24868e8940cc8060aced966253052e1947b13318ef80c8a33f46d68e69c7985",
        #"a1a5c63e4290e5b28b112fbf6e2d3caca435a969f415bf93fb538636b9f3dacba7bdcc9dafd94678ba914b4e44feed91",
      ],
    }

  let pk: GrothProof =
    GrothProof {
      piA: #"a23e55176bd908b2c2c9da958e5c5ab752a6f6e668d47a7fd9f9d0d012747f2cbdcaa1832c1c888d032c3f833a7434a4",
      piB: #"8cbde958e5973bbe4860035ac1027e543bc4113d7ece6d4d6ceb7c77ff262b27c109160516694fc5e7a454808adfa06f0ef497c5ccb307d631cac268b04b1b63f56308924ad35c6cfd101df971fc465079d01d2c45d144e32deb95495bd28700",
      piC: #"82d831097b284252e77c3cb56c6d20df5634f2adc725eb53022421b228d47335020b810db7c2c1eccab6c30272b9f313",
    }

  let public_values: List<Int> =
    [
      86721980652443005217719496642694247237,
      158132697557323219579992358050637845714,
    ]
  groth.verify_groth16(vk, pk, public_values)
}
