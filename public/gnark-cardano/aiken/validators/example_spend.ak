//// Copyright 2025-2026 Logical Mechanism LLC
//// SPDX-License-Identifier: Apache-2.0
////
//// Example Plutus V3 spend validator that consumes the gnark_cardano library
//// to verify a Groth16 proof on-chain.
////
//// This validator is intentionally kept simple — its only check is that the
//// redeemer carries a valid Groth16 proof for a known SnarkVerificationKey.
//// In a real contract you would combine this with application-specific
//// checks (signatures, value flow, datum updates, etc.).
////
//// ## Shape
////
//// - **Datum:** `SnarkVerificationKey` — the verifying key for the circuit
////   that this UTxO is locked under. Stored directly in the datum for
////   simplicity; production contracts often place it behind a reference
////   input keyed off a genesis token.
////
//// - **Redeemer:** `ExampleSpendRedeemer` (defined in
////   `lib/gnark_cardano/example.ak` so tests can import it), which bundles:
////   - `pk`, `them`, `shared` — the three public G1 points the proof
////      committed to, as 48-byte IETF-compressed bytes
////   - `groth_proof` — the Groth16 proof (piA, piB, piC + commitment fields)
////   - `groth_commitment_wire` — the commitment wire as 32 raw bytes
////   - `groth_public` — the gnark public-input limb list
////
//// ## Logic
////
//// 1. Decode the three public G1 points from the redeemer.
//// 2. Bind those raw points to the proof's public inputs by re-compressing
////    each 12-limb slice of `groth_public` and demanding it matches the
////    corresponding compressed point. This catches a malicious prover that
////    tries to swap which points the proof is "about".
//// 3. Verify the proof using `groth.verify_groth16`.
////
//// **Why this matters:** the on-chain redeemer can carry the *raw points*
//// the user is committing to (e.g. their public key, a counterparty key)
//// and the validator can bind those points to the proof in one shot. This
//// is the typical pattern for any contract where the proof is "about" some
//// data the contract already knows about.
////
//// This example targets the **diffie-hellman** circuit pattern (3 public
//// G1 inputs: pk, them, shared). For other circuit shapes, edit the
//// redeemer fields and the limb-binding logic — the rest stays the same.

use cardano/transaction.{OutputReference, Transaction}
use gnark_cardano/example.{ExampleSpendRedeemer}
use gnark_cardano/groth.{CommitmentKey, GrothProof, SnarkVerificationKey}
use gnark_cardano/limb_compression

validator example_spend {
  spend(
    maybe_datum: Option<SnarkVerificationKey>,
    redeemer: ExampleSpendRedeemer,
    _utxo: OutputReference,
    _self: Transaction,
  ) {
    expect Some(vk) = maybe_datum

    let ExampleSpendRedeemer {
      pk,
      them,
      shared,
      groth_proof,
      groth_commitment_wire,
      groth_public,
    } = redeemer

    // 1. Bind the on-chain G1 points to the proof's public inputs.
    //    If any limb-vs-point mismatch, the proof is for a *different*
    //    set of points than the redeemer claims and we reject.
    let limbs_match =
      limb_compression.verify_g1_list_against_compressed(
        [pk, them, shared],
        groth_public,
      )

    // 2. Convert the 32-byte commitment wire to an Int as verify_groth16
    //    expects. Helper lives in gnark_cardano/groth.
    let wire_int = groth.wire_to_int(groth_commitment_wire)

    // 3. Run the Groth16 pairing check.
    let proof_valid =
      groth.verify_groth16(vk, groth_proof, groth_public, [wire_int])

    limbs_match && proof_valid
  }

  else(_) {
    fail
  }
}

// ============================================================================
// Tests
// ============================================================================
//
// These tests use FROZEN proof data captured from running ./run with
// example/diffie-hellman.pattern (sk = 42, them = [123]g, so pk = [42]g and
// shared = [42*123]g = [5166]g). The bytes were copied verbatim from
// go/out/{vk,proof,public}.json after one successful pipeline run, and they
// will keep working as long as gnark-crypto's BLS12-381 serialization, IC
// ordering, and commitment-extension format don't change.

// pk = [42]g
const test_pk: ByteArray =
  #"8ce3b57b791798433fd323753489cac9bca43b98deaafaed91f4cb010730ae1e38b186ccd37a09b8aed62ce23b699c48"

// them = [123]g
const test_them: ByteArray =
  #"a0ec3e71a719a25208adc97106b122809210faf45a17db24f10ffb1ac014fac1ab95a4a1967e55b185d4df622685b9e8"

// shared = [5166]g
const test_shared: ByteArray =
  #"a0268a93d95daad864922e2e5fc35a320d6e6fc754690d591c86bd1c6cae8aff7d25660ba9de9decaaa9e0a849c2237a"

// Commitment wire as 32 big-endian bytes — this is the decimal value
// 647486121809050382348988374295122219538154271145154261943034103122427812593
// from go/out/public.json's commitmentWire field.
const test_commitment_wire: ByteArray =
  #"016e76d30e13be1230613e8820e8931a6e76020e46a2cd0492212aad86869af1"

fn test_vk() -> SnarkVerificationKey {
  SnarkVerificationKey {
    nPublic: 37,
    vkAlpha: #"855ea341c4ab4d915b0dae3c77f6db9677a44006cdf227b1fefa61b1cf6667da6db96fdc68f9b8648ff0b1767405a246",
    vkBeta: #"ad63fd9565b3115dd9b397812aa3a669a77807feb1c8208db121e5e43fa6a141a7606870e21e10ca83d340ecf735b36118aa08fdedb9764e6a009c81bd111f2a224c0e756c6cf6aa138f2e7b00a8c842db917a347ce4d31fd9070e2aa246c7b2",
    vkGamma: #"94d31f3794b27368e9d6e4f46c29ab6be577627add9e97acd0f47c05d9ede1b8bd50ffd7f79b9bbdd13b5779c2349b8a0198302793c377a27bedb8bc428da1039f4e730fd3a312f1250591f7c72b77e5d0314a333d0e62161bc2f871329997e3",
    vkDelta: #"87afb0925f3e309950f4a63c0331a8a604b94ca721252c0c6497cf8e9c71c867797dba2bd0b9839f227f7b744dedafc1086043dafe135c59cff0ca4547f23745b26447d3e2ed457a2577d618d6e47e27b08183c8b1b276fbe4a1ff57cad41adc",
    vkIC: [
      #"93477616afc5a0ce77ab4b8835da33cf3891ef49c1ab0dfa6408b9c0912d8b296ca530bd74559d7426c4ef104ddee73a",
      #"90406fc4643a0745386e9d8eed0c932b8945d43e3f8e066635d0e3ecc70e1376df093b7c95c2c77e6ac3e46e49ee9b11",
      #"a4d222fb1a574e07fc9560cf51484472b4717bba27343884b8a0d85ae17822a48774d5f11cc673ea4ac80b19a18d262d",
      #"ad6b287f075a9ab64c4538bbd6acf8e0669b07eb45954acac88abd70c7fc06646fed586923f9708bd93aacdf39f5e66d",
      #"8b319fae001641255e3dc04bd306398853467cad765ecbbbc32475d826487fec74c910e94144a99394265632e6ebfdf2",
      #"a9c1ad7bd5b9dd896cb26e15cd54b5469cc2cef2c62025ff5bd5c511fc36899f4323f68e00f5911f9153078d286e60ee",
      #"a5fa90f8ccc611f24d888e81c976e575c4b8d93a4cb88989e293a36df4d874ac8d3b7a5e3451567cc5fc345610637711",
      #"8957331ab73f139ae5496da851dc482449de1cb73469a7a3ce2a2e2aba13ca0bc0515b8371b0708fc5ef8cbd7a6bff95",
      #"b8be0534c187da3bd85383b64dccdd1da73e6c816ea6221d67c5baf689779fa38fe245b46cb3aa50ad8c10ec3935a922",
      #"8072cc127a1ae8b1a91a23e068a1e0e21cc2d01ea092ae5b78f32a19fd8eee2e1e34be82e84f1767e50b11162b0f9678",
      #"a85dfdfe9129d856e0ac8e6b09a217ef9ba485cd54a5e8079a9043ca199be5bd5d1a32ae4b620f5e542ccbeff15858f2",
      #"86d3b863a575f27b765649337188a551aa2bdb2a58e933649e6c12f466bf64f5a46c93dcc690fc0ae97764c848cdb516",
      #"a05e02d0f0a796eaa47ba3f23fb6c9365e65254e673e95273ab986acb5d70311ff651c2d703fa8a358c7676a914ca637",
      #"ac9435ed1d82bcc296338c7e3f9d3ef9f1f6967430144c5c9f086629f7490b92de73fb122370ccda1394c8defd246f1a",
      #"a1129e3c0ec7a9c5df2a27c2b4816cf7f10b41f7762a156bc432a52cc0bac94fc5af7b2634c2bb2b506224021a916ce0",
      #"8b83f449664eaa6cc8b413d222ca316e610c69e726cf7a9b3ee6a9aae1e8564aac56828d49b8cb06a0c4af3a59eb6d04",
      #"ab767bfa9b0380e9d72835eea3e931deee569ce22658f1905edf5c7515e23c301d6d5e6053965761b52371b80fa4b75f",
      #"a9606b2b657b73377e75de861d486eab33e7694f7981e8d9d03b2c6fe61ad70b2984a5b901a38072431a6c247c60c817",
      #"8fbcb3ed425e431f53ff8beb454b6a702a7678681b177c3b121cf7ec3993848cd1dfe9e69fd423cebeca17559341d648",
      #"a0df459aef5c783104bdb461f2e826f583cfeae0deb29d2aa6c1dc6fc773efc5ddd533dd21534414ae31d362f9f81650",
      #"a840f505cf04985578d6d2bb3fb506e078e7bf508dcf80ad50a109110a3cb82fb0f6b67a53bfe13df3533182c3ddfe36",
      #"862da34df0cb8ef171039a228baad32ac0989ae6b9d0edf581bcf193beebcafdfbf78f08029dbaa7ca4f539feb78090f",
      #"adbb42739f6423f6e3a6678b19b858c1efed97b4d48cc4bf9193138891af2b5f2e36cf84c1a5446de8f5ba43af23f924",
      #"b95804a81c5559a2f636606d5f88ade6a2391905182e290f0d8a4076399f0363fba63d13a309ede0ee6cb478ebb59209",
      #"a1aa42a56bac9eeffcef2645bd1c51138a807367f44aff02942044decbc250620129fff1901e4263c7629f2ef529461e",
      #"966a43fd2914f1d01905d5225d71ce75036306e8837309f1afd5d35641e4d352316394565ba9dee61a13a3e372b0bb85",
      #"a90d447f03814d0ff5bd0c8fb9a5a191b09b7f7699fad06665f794623f115e8d15d95deb38e2c2575d2a3d494fa6d4b7",
      #"8212ecc82b93c6acfdf7b9dff1e1cd820188be5f3149f81a0afc23e11544080eacaa9cda2e8c9dc4d2e7f428a9509916",
      #"8e9764d7a6d8292909f187ec10f85b2ac64b9a179e4b208eb61ba1233c0d8272127a098d5ba5b8435b1c1bec5303777f",
      #"8419a47a4dd44758ba3a1ef031b85aac6b02d06d8c26cf8c8dcbf7fcaa1b07894c1600c30163e2f7b41bd83ffe4a610a",
      #"93afb781ea6449c7ab7d0e635d6102ee9ac8f0c3be028beb2537b190d0be9b71d6de8b4d1ee83f167e8f2abbc7a6d422",
      #"8a2b87d4b20043d40858dbcdfa12863756d0bb9b41ef63f534500d7c0b8a056454a5c0f5d1b1c0e83bda53b983bcf823",
      #"9444bd1ef403e29c642399b8d941944f1f996bdcbcba91dbb8563266b2c01a9426e999cb57dcd997845b53da4f8f174a",
      #"90c0edb269f17efa740f9d9f0368c685438341815ccd598547f1c1d6c7a4c489a1a217c2551140bf03b14cead8b9cbf9",
      #"85723059dcb459db3a4a8b8a4316d9962659653e58b9cb9a39a77c1b6a1d05168e5afc1d5aaecb1f468a268b10123c5d",
      #"8569ecf7926b3019a0b19b9f90253a306892f22de8865c5a5051f860d060dcebfd5e61b7242afa3f855d13d01cde830d",
      #"a05ca1bdbebf77de3e6cdb2ea832e9db23e1ac3b269ed6a3ecc8047ca58b69e154ba12dfb9f91f7d2c477ea17eea900c",
      #"8b6e5daf3b29273102fc4908cdb23dd5afa88a1015c1407128f0b5b5e8d360123f79a97a2f25e42800a928220c95e88f",
    ],
    commitmentKeys: [
      CommitmentKey {
        g: #"a6d44b6191565576ffd5459838701441b80c7bd31e5c3a0ee6545589187c3068f45c78ef892a48487f10320b017e9bf818484631af9b3f06e0eff0467918025b65d2c04f36472605b00597f168652df09a7cb330cddbf6e22cac0a5b64d9c1d0",
        gSigmaNeg: #"b0d62a873bf8f2e33c12c5d10426478840a68a736f16d02538a9ce8259ec1774f965199211931ac029de38e3ec63b10201bb8b27c84e994a4a8794b3c40b6af7bf1a447fb3f524709712114fc0a1d4671f80a06ac7d073c5940eb3327e3260e6",
      },
    ],
  }
}

fn test_proof() -> GrothProof {
  GrothProof {
    piA: #"b03adb5881727d652a729094791d9ad8c99b74cd342c2cfd2216515b6df44f2de23556c6cd43687a04b3c1f7be964448",
    piB: #"8b326980f70d9b41487103afb8c1792027ecec88ca9c2cc9e86aed53f20d02fbd8e70214a09cbb90c4b2c8c7d7bcc4460d7cafa7e08eda43a2cf128adc1a4b6d75cb8caec30ee586610eec8aeb7946fe93b9981453f1d0e236e36375b899a271",
    piC: #"82f3e23325b4f44da3d0c2e7a84cec561ac5d704a98350ca5361dc8a380d8d5a97a148b192c154176a31451fdc03aeab",
    commitments: [
      #"abd3a63428c21002ba1b9b376f99aa198cd3effc43beb412e82b7c570f7bd868cdc989e650de8ed772ba3d834cd0f1f5",
    ],
    commitmentPok: #"812073089b4e43baf731af17d30e03126c0d0dcd684471095a7cb96920a3f4cbf4eebf34f22d4e2bb3b6fe0a9715c759",
  }
}

// 36 limbs for the 3 G1 public points (12 limbs per point), in the order
// gnark emits them: pk_x, pk_y, them_x, them_y, shared_x, shared_y.
// Sourced verbatim from go/out/public.json (with the leading "1" stripped).
fn test_public_limbs() -> List<Int> {
  [
    12598306357786549320, 4085194551281191352, 10517254235092987422,
    13593055103067814637, 4599058630774999753, 928785490085648451,
    7411352777206463921, 10034680065331085853, 12211414129573853851,
    17002152489223265035, 13982036336566271604, 39464092936980526,
    9643578314753161704, 12363969365937116593, 17370378380101614273,
    10525188256555326244, 625377410555126400, 66496752359416402,
    14097362883115178599, 4719704059972866972, 12159781565021343405,
    7445108436173696372, 13521676165100239295, 1162691588775989932,
    12297607270908437370, 9017726029159898604, 2055538209721322239,
    967833871836581209, 7246905527102560818, 10848416726624984,
    15041024901994083739, 4453972931196379432, 8712060758806063687,
    13251991425830955601, 11937984713422909011, 1077626641602103725,
  ]
}

fn test_redeemer() -> ExampleSpendRedeemer {
  ExampleSpendRedeemer {
    pk: test_pk,
    them: test_them,
    shared: test_shared,
    groth_proof: test_proof(),
    groth_commitment_wire: test_commitment_wire,
    groth_public: test_public_limbs(),
  }
}

fn test_oref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000000",
    output_index: 0,
  }
}

test example_spend_valid_proof() {
  example_spend.spend(
    Some(test_vk()),
    test_redeemer(),
    test_oref(),
    transaction.placeholder,
  )
}

test example_spend_rejects_swapped_points() fail {
  // Swap pk and them in the redeemer. The proof was committed to a specific
  // ordered list of limbs, so swapping the bound points means the
  // limb-binding check (`verify_g1_list_against_compressed`) will fail.
  let bad =
    ExampleSpendRedeemer {
      pk: test_them,
      // ← swapped
      them: test_pk,
      // ← swapped
      shared: test_shared,
      groth_proof: test_proof(),
      groth_commitment_wire: test_commitment_wire,
      groth_public: test_public_limbs(),
    }
  example_spend.spend(
    Some(test_vk()),
    bad,
    test_oref(),
    transaction.placeholder,
  )
}

test example_spend_rejects_tampered_proof() fail {
  // Mutate piA — flip the first byte b0 → a0. The pairing check will fail.
  let tampered =
    GrothProof {
      piA: #"a03adb5881727d652a729094791d9ad8c99b74cd342c2cfd2216515b6df44f2de23556c6cd43687a04b3c1f7be964448",
      piB: #"8b326980f70d9b41487103afb8c1792027ecec88ca9c2cc9e86aed53f20d02fbd8e70214a09cbb90c4b2c8c7d7bcc4460d7cafa7e08eda43a2cf128adc1a4b6d75cb8caec30ee586610eec8aeb7946fe93b9981453f1d0e236e36375b899a271",
      piC: #"82f3e23325b4f44da3d0c2e7a84cec561ac5d704a98350ca5361dc8a380d8d5a97a148b192c154176a31451fdc03aeab",
      commitments: [
        #"abd3a63428c21002ba1b9b376f99aa198cd3effc43beb412e82b7c570f7bd868cdc989e650de8ed772ba3d834cd0f1f5",
      ],
      commitmentPok: #"812073089b4e43baf731af17d30e03126c0d0dcd684471095a7cb96920a3f4cbf4eebf34f22d4e2bb3b6fe0a9715c759",
    }
  let bad =
    ExampleSpendRedeemer { ..test_redeemer(), groth_proof: tampered }
  example_spend.spend(
    Some(test_vk()),
    bad,
    test_oref(),
    transaction.placeholder,
  )
}
