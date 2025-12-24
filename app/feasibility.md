# Demonstration of on-chain feasibility

Below is an end-to-end execution of the happy path on the pre-production environment. Each step will have transaction id and a link to view it using cardanoscan.

1. Funding the genesis wallet:

`8333c28724f4ec353f022f2a3f71d4e2b4c84ba0f940a35d1b2265dfc6f3107d`

[View Transaction](https://preprod.cardanoscan.io/transaction/8333c28724f4ec353f022f2a3f71d4e2b4c84ba0f940a35d1b2265dfc6f3107d)

2. Creating script reference UTxOs:

Bidding Contract: `84f11a48dfea7d3d9193dbdd3b87e41c92970a1d301f33bffb1e3163696a602f`

[View Transaction](https://preprod.cardanoscan.io/transaction/84f11a48dfea7d3d9193dbdd3b87e41c92970a1d301f33bffb1e3163696a602f)

Encryption Contract: `6f145c14884bab32a05c3cfb45829589f72cd5e7e390bde5a11b8d36c787044d`

[View Transaction](https://preprod.cardanoscan.io/transaction/6f145c14884bab32a05c3cfb45829589f72cd5e7e390bde5a11b8d36c787044d)

Genesis Contract: `dcf3bf1211d01b275f225f35cf8ca7510fc12d6106b1b9ab51c5e82346c50be4`

[View Transaction](https://preprod.cardanoscan.io/transaction/dcf3bf1211d01b275f225f35cf8ca7510fc12d6106b1b9ab51c5e82346c50be4)

Reference Contract: `d02b470e19955334d8732a89263c956599146217365b30a8f2c617c6abc1eda9`

[View Transaction](https://preprod.cardanoscan.io/transaction/d02b470e19955334d8732a89263c956599146217365b30a8f2c617c6abc1eda9)

3. Minting the reference token:

`8e9ece904257a47e6d6260cd4aa2a061e36c2c563e2a1f45dc3511c180d5d6f3`

[View Transaction](https://preprod.cardanoscan.io/transaction/8e9ece904257a47e6d6260cd4aa2a061e36c2c563e2a1f45dc3511c180d5d6f3)

4. Creating Alice's encryption UTxO:

`2d20a9e47ebbd4f337e9e76841199b3dc586448e48c87fb54f1eefe860c5960e`

[View Transaction](https://preprod.cardanoscan.io/transaction/2d20a9e47ebbd4f337e9e76841199b3dc586448e48c87fb54f1eefe860c5960e)

5. Creating Bob's bid UTxO:

`b41f59b5d77156460c3ba6d8bdcd1a201775e6bed503c80afed5fc77e8eeae62`

[View Transaction](https://preprod.cardanoscan.io/transaction/b41f59b5d77156460c3ba6d8bdcd1a201775e6bed503c80afed5fc77e8eeae62)

6. Alice re-encrypting to Bob:

`15f6cd4e0781ed8bf4b20d2507bb0bd2d051d3d110ebe8c23f4e0293ed8fddb2`

[View Transaction](https://preprod.cardanoscan.io/transaction/15f6cd4e0781ed8bf4b20d2507bb0bd2d051d3d110ebe8c23f4e0293ed8fddb2)

7. Bob decrypting the message:

Bob can decrypt the secret message.

```py
b'This is a secret message.'
```

8. Alice decrypting the message:

Alice can not decrypt the secret message and gets an invalid tag error.

```
cryptography.exceptions.InvalidTag
```

9. Bob removing the encryption UTxO:

`1f8c6883def08ca107ad089a2af93b2450e7dba1aef044e553bfe5bf0cd0f8b9`

[View Transaction](https://preprod.cardanoscan.io/transaction/1f8c6883def08ca107ad089a2af93b2450e7dba1aef044e553bfe5bf0cd0f8b9)