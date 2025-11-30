<!-- 
Copyright (C) 2025 Logical Mechanism LLC
SPDX-License-Identifier: CC-BY-4.0
-->
---
title: "The PEACE Protocol\\thanks{This project was funded in Fund 14 of Project Catalyst.}"
subtitle: "A protocol for transferable encryption rights."
author: "Logical Mechanism LLC\\thanks{Contact: support@logicalmechanism.io}"
date: \today
lang: en-US
documentclass: article
classoption: titlepage
fontsize: 11pt
papersize: letter
geometry:
  - margin=1in
  - heightrounded
numbersections: true
secnumdepth: 3
toc: true
toc-depth: 2
toc-title: Contents
colorlinks: true
links-as-notes: false
link-citations: true
urlcolor: MidnightBlue
linkcolor: MidnightBlue
citecolor: MidnightBlue
bibliography: refs.bib
csl: ieee.csl
reference-section-title: Bibliography
keywords:
  - encryption
  - decentralized systems
  - re-encryption
  - ECIES
  - AES-GCM
rights: © 2025 Logical Mechanism LLC. All rights reserved.
header-includes:
  - \usepackage{fancyhdr}
  - \usepackage{amsmath,amssymb,amsthm}
  - \newtheorem{lemma}{Lemma}
  - \numberwithin{lemma}{section}
  - \numberwithin{equation}{section}
  - \usepackage{etoolbox}
  - \usepackage[dvipsnames]{xcolor}
  - \usepackage[ruled,vlined,linesnumbered]{algorithm2e}
  - \AtBeginDocument{\pagenumbering{gobble}}
  - \AtBeginDocument{\hypersetup{pdfinfo={/Copyright=(© 2025 Logical Mechanism LLC. All rights reserved.)}}}
---


\setlength{\parindent}{0pt}
\setlength{\parskip}{6pt}
\setlength{\emergencystretch}{3em}
\clubpenalty=10000
\widowpenalty=10000
\interfootnotelinepenalty=10000

\clearpage
\pagenumbering{arabic}
\pagestyle{fancy}
\fancyhf{}
\fancyfoot[C]{\footnotesize \today}


# Abstract

In this report, we introduce the PEACE protocol, an ECIES-based, multi-hop, unidirectional proxy re-encryption scheme for the Cardano blockchain. PEACE solves the encrypted-NFT problem by providing a decentralized, open-source protocol for transferable encryption rights, enabling creators, collectors, and developers to manage encrypted NFTs without relying on centralized decryption services. This work fills a significant gap in secure, private access to NFTs on Cardano. Project Catalyst[^fund] funded the PEACE protocol in round 14.

[^fund]: https://projectcatalyst.io/funds/14/cardano-use-cases-concepts/decentralized-on-chain-data-encryption

# Introduction

The encrypted NFT problem is one of the most significant issues with current NFT standards on the Cardano blockchain. Either the data is not encrypted, available to everyone who views the nft, or the data encryption requires some form of centralization, with some company doing the encryption on behalf of users. Current solutions [@stuffio-whitepaper] claim to offer decentralized encrypted assets (DEA), but lack a publicly available, verifiable cryptographic protocol or an open-source implementation. Most, if not all, of the mechanics behind current DEA solutions remain undisclosed. This report aims to fill that knowledge gap by providing an open-source implementation of a decentralized re-encryption protocol for encrypted assets on the Cardano blockchain.

Several mandatory requirements must be satisfied for the protocol to function as intended. The encryption protocol must allow tradability of both the NFT itself and the right to decrypt the NFT data, implying that the solution must involve smart contracts and a form of encryption that allows data access to be re-encrypted for another user without revealing the encrypted content in the process. The contract side of the protocol should be reasonably straightforward. It needs a way to trade a token that holds the encrypted data and allows other users to receive it. To ensure decryptability, the tokens will need to be soulbound. On the encryption side of the protocol is some form of encryption that enables the re-encryption process to function correctly. Luckily, this type of encryption has been in cryptography research for quite some time [@mambo-okamoto-1997] [@blaze-bleumer-strauss-1998] [@ateniese-et-al-ndss2005]. There are even patented cloud-based solutions already in existence [@ironcore-recrypt-rs]. There is no open-source, fully on-chain, decentralized re-encryption protocol for encrypting NFT data on the Cardano blockchain. The PEACE protocol aims to provide a proof-of-concept solution to this problem.

The PEACE protocol will implement an ambitious yet well-defined, unidirectional, multi-hop proxy re-encryption scheme that utilizes ECIES [@ieee-1363a-2004] and AES [@fips-197]. Unidirectionality means that Alice can re-encrypt for Bob, and Bob can then re-encrypt it back to Alice, using different encryption keys. Unidirectionality is important for tradability, as it defines the one-way flow of data and removes any restriction on who can purchase the NFT. Multi-hop means that the flow of encrypted data from Alice to Bob to Carol, and so on, does not end, in the sense that it cannot be re-encrypted for a new user. Multi-hopping is important for tradability, as a finitely tradable asset does not fit many use cases. Typically, an asset should always be tradable if the user wants to trade it. The encryption primitives used in the protocol are considered industry standards at the time of this report.

The remainder of this report is as follows. Section 4 discusses the preliminaries and background required for this project. Section 5 will be a brief overview of the required cryptographic primitives. Section 6 will be a detailed description of the protocol. Sections 7, 8, and 9 will delve into security and threat analysis, the limitations of the protocol, and related topics, respectively. The goal of this report is to serve as a comprehensive reference and description of the PEACE protocol.

# Background And Preliminaries

Understanding the protocol will require some technical knowledge of modern cryptographic methods, a basic understanding of elliptic curve arithmetic, and a general understanding of smart contracts on the Cardano blockchain. Anyone comfortable with these topics will find this report very useful and easy to follow. The report will attempt to use research standards for terminology and notation. The elliptic curve used in this protocol will be BLS12-381 [@bowe-bls12-381-2017]. Aiken is used to write all required smart contracts for the protocol.

Table: Symbol Description [@elmrabet-joye-2017]

| Symbol | Description |
|:-----:|-------------|
| $p$ | A prime number |
| $\mathbb{F}_{p}$ | The finite field with characteristic $p$ |
| $E(\mathbb{F}_{p})$ | An elliptic curve $E$ defined over $\mathbb{F}_{p}$ |
| $E'$ | A twisted elliptic curve |
| $\#E(\mathbb{F}_{p})$ | The order of $E(\mathbb{F}_{p})$ (also denoted $n$) |
| $r$ | A prime number dividing $\#E(\mathbb{F}_{p})$ |
| $\delta$ | A non-zero integer in $\mathbb{Z}_{n}$ |
| $\mathcal{O}$ | The point at infinity of an elliptic curve $E$ |
| $\mathbb{G}_{1}$ | A subgroup of order $r$ of $E(\mathbb{F}_{p})$ |
| $\mathbb{G}_{2}$ | A subgroup of order $r$ of the twist $E'(\mathbb{F}_{p^{2}})$ |
| $\mathbb{G}_{T}$ | The multiplicative target group of the pairing: $\mu_r \subset \mathbb{F}_{p^{12}}^{\*}$ |
| $e: \mathbb{G}_{1} \times \mathbb{G}_{2} \to \mathbb{G}_{T}$ | A type-3 bilinear pairing |
| $g: A fixed generator in \mathbb{G}_{1}$ |
| $q: A fixed generator in \mathbb{G}_{2}$ |
| $R$ | The Fiat-Shamir transformer |
| $H_{\kappa}$ | A hash to group function for $\mathbb{G}_{\kappa}$ |
| $m$ | The order of Ed25519 |
| $\gamma$ | A non-zero integer in $\mathbb{Z}_{m}$ |

The protocol, including both on-chain and off-chain components, will heavily utilize the \texttt{Register} type. The \texttt{Register} stores a generator, $g \in \mathbb{G}_{\kappa}$ and the corresponding public value $u = [\delta]g$ where $\delta \in \mathbb{Z}_{n}$ is a secret. We shall assume that the hardness of ECDLP and CDH in $\mathbb{G}_{1}$ and $\mathbb{G}_{2}$ will result in the inability to recover the secret $\delta \in \mathbb{Z}_{n}$. When using a pairing, we additionally rely on the standard bilinear Diffie-Hellman assumptions over subgroups, $( \ \mathbb{G}_{1}, \mathbb{G}_{2}, \mathbb{G}_{T}\ )$. We will represent the groups $\mathbb{G}_{1}$ and $\mathbb{G}_{2}$ with additive notation and $\mathbb{G}_{T}$ with multiplicative notation.

The \texttt{Register} type in Aiken:

```rust
pub type Register {
  // the generator, #<Bls12_381, G1> or #<Bls12_381, G2> 
  generator: ByteArray,
  // the public value, #<Bls12_381, G1> or #<Bls12_381, G2> 
  public_value: ByteArray,
}
```

Where required, we will verify Ed25519 signatures [@rfc8032] as a cost-minimization approach; relying solely on pure BLS12-381 for simple signatures becomes costly on-chain. There will be instances where the Fiat-Shamir transform [@fiat-shamir-1986] will be applied to a $\Sigma$-protocol for non-interactive purposes. In these cases, the hash function will be Blake2b-256 [@rfc7693].

# Cryptographic Primitives Overview

This section provides brief explanations of the cryptographic primitives required by the protocol. If a primitive has an algorithmic description, then it should be included in the respective section. The \texttt{Register} type will be a tuple, $\ ($ $g, u\ )$, for simplicity inside the algorithms. We shall assume that the decompression of the elliptic curve points are a given. Correctness proofs for many algorithms are in Appendix A. In any algorithm, $\mathbb{G}_{1}$ may be switched with $\mathbb{G}_{2}$ without any required changes.

## Register-based

There may be instances where we need to create a new \texttt{Register} from an existing \texttt{Register} via a re-randomization [@ergo-sigma-join]. The random integer $\delta'$ is considered toxic waste. Randomization allows a public register to remain stealthy, which can be beneficial for data privacy and ownership.

\begin{algorithm}[H]
\caption{Re-randomization of the Register type}
\label{alg:rerandom}

\KwIn{$\ ($ $g, u\ )$ where $g \in \mathbb{G}_{\kappa}$, $u=[\delta]g \in \mathbb{G}_{\kappa}$}
\KwOut{$\ ($ $g', u'\ )$}

select a random $\delta' \in \mathbb{Z}_{n}$

compute $g' = [\delta']g$ and $u' = [\delta']u$

output $\ ($ $g', u'\ )$
\end{algorithm}

The protocol may require proving knowledge of a user's secret using a Schnorr $\Sigma$-protocol [@thaler-pazk-2022] [@schnorr1991]. This algorithm is both complete and zero-knowledge, precisely what we need in this context. We can use simple Ed25519 signatures for spendability, and then utilize the Schnorr $\Sigma$-protocol for knowledge proofs related to encryption. We will make the protocol non-interacting via the Fiat-Shamir transform.

\begin{algorithm}[H]
\caption{Non-interactive Schnorr's $\Sigma$-protocol for the discrete logarithm relation}
\label{alg:schnorrsig}

\KwIn{$\ ($ $g, u\ )$ where $g \in \mathbb{G}_{\kappa}$, $u=[\delta]g \in \mathbb{G}_{\kappa}$}
\KwOut{\textsf{bool}}

select a random $\delta' \in \mathbb{Z}_{n}$

compute $a = [\delta']g$

calculate $c = R(g, u, a)$

compute $z = \delta*c + \delta'$

output $[z]g = a + [c]u$
\end{algorithm}

There will be times when the protocol requires proving some equality using a pairing. In these cases, we can use something akin to the BLS signature, allowing only someone with the knowledge of the secret to prove the pairing equivalence. BLS signatures are a straightforward yet important signature scheme for the protocol, as they enable public confirmation of knowledge of a complex relationship beyond the limitations of Schnorr's $\Sigma$-protocol. BLS signatures work because of the bilinearity of the pairing [@Menezes1993ECPKC].

\begin{algorithm}[H]
\caption{Boneh-Lynn-Shacham (BLS) signature method}
\label{alg:blssig}

\KwIn{$\ ($ $g, u, c, w, m\ )$ where $g \in \mathbb{G}_1$, $u=[\delta]g \in \mathbb{G}_1$, $c = H_{2}(m) \in \mathbb{G}_2$, $w = [\delta]c \in \mathbb{G}_2$, and $m\in\{0,1\}^{*}$}
\KwOut{\textsf{bool}}

$e(u, c) = e(g, w)$

$e(q^{\delta}, c) = e(q, c^{\delta}) = e(q, c)^{\delta}$

\end{algorithm}


## ECIES + AES-GCM

The Elliptic Curve Integrated Encryption Scheme (ECIES) is a hybrid protocol involving asymmetric cryptography with symmetric ciphers. The encryption used in ECIES is the Advanced Encryption Standard (AES). ECIES and AES, combined with a key derivation function (KDF) such as HKDF [@cryptoeprint:2010/264], form a complete encryption system.

\begin{algorithm}[H]
\caption{Encryption using ECIES + AES}
\label{alg:encrypt-eciesaes}

\KwIn{$\ ($ $g, u\ )$ where $g \in \mathbb{G}_{\kappa}$, $u=[\delta]g \in \mathbb{G}_{\kappa}$, m as the message}
\KwOut{$\ ($ $r, c, h\ )$ }

select a random $\delta' \in \mathbb{Z}_{n}$

compute $r = [\delta']g$

compute $s = [\delta']u$

generate $k = KDF(s | r)$

encrypt $c = AES(m, k)$

compute $h = BLAKE2B(m)$

output $\ ($ $r, c, h\ )$

\end{algorithm}

Decrypting the ciphertext requires rebuilding the data encryption key (DEK), $k$, from the KDF. The DEK is rebuildable because $r$ is public and the user knows the secret $\delta$, allowing them to decrypt the data.

\begin{algorithm}[H]
\caption{Decryption using ECIES + AES}
\label{alg:decrypt-eciesaes}

\KwIn{$\ ($ $g, u\ )$ where $g \in \mathbb{G}_1$, $u=[\delta]g \in \mathbb{G}_1$, $\ ($ $r, c, h\ )$ as the cypher text}
\KwOut{$\ ($ $\{0,1\}^{*}$,\textsf{bool} $\ )$ }

compute $s' = [\delta]r$

generate $k' = KDF(s' | r)$

compute $m' = AES(c, k')$

compute $h' = BLAKE2B(m')$

output $\ ($ $m'$, h' = h $\ )$

\end{algorithm}

Algorithm \ref{alg:encrypt-eciesaes} describes the case where a \texttt{Register} is used to generate the DEK, $k$, from the KDF function. Anyone with knowledge of $k$ may decrypt the ciphertext. The algorithm shown differs slightly from the PEACE protocol, as the protocol allows transferring $k$ to another \texttt{Register}; however, the general flow remains the same. The key takeaway here is that encrypting a message and decrypting the ciphertext requires a KDF to generate the DEK. Both algorithms \ref{alg:encrypt-eciesaes} and \ref{alg:decrypt-eciesaes} use a simple hash function for authentication. In the PEACE protocol, we will use AES-GCM with authenticated encryption with associated data (AEAD) for authentication.

## Re-Encryption

There are various types of re-encryption schemes, ranging from classical proxy re-encryption to hybrid methods. These re-encryption schemes involve a proxy, an entity that performs the re-encryption process and verification. The PRE used in the PEACE protocol is modeled as an interactive flow between the current owner and a prospective buyer, utilizing a smart contract as part of the proxy. We need an interactive scheme because in many real-world use cases, there are numerous off-chain checks, such as KYC/AML and various legal requirements, that must occur before transferring the decryption rights to the new owner. The PEACE protocol obtains interactivity via the owner agreeing to the exchange.

The method described below is a hybrid approach. The current owner's wallet performs the re-encryption of the symmetric content key for the buyer (decapsulation + re-wrapping). At the same time, the Cardano smart contract acts as a proxy, verifying BLS12-381 re-encryption keys, enforcing the correct binding between capsules and ciphertext, and updating the on-chain owner field. This design explicitly supports off-chain processes, such as KYC or contractual agreements, before delegation: the owner only submits the re-encryption transaction once these off-chain conditions are satisfied. This method will allow for the most use cases for real-world assets. This type of method is unidirectional, meaning the re-encryption flow is one-way: from the current owner to the next owner. If Alice delegates to Bob, Bob does not automatically gain the ability to 'go backwards' and create ciphertexts for Alice using the same re-encryption material. This flow differs from a bidirectional method, where the PRE is symmetric, enabling a two-way encryption relationship between the parties. So, Alice can transform a ciphertext into one for Bob, and Bob can transform a ciphertext into one for Alice, without either Alice or Bob having to re-run the entire encryption flow. That is not what we want for this implementation. Each direction is a separate, explicit delegation with its own re-encryption material, matching the tradability requirements.

Note that in the original Catalyst proposal, the protocol defines itself as a bidirectional, multi-hop PRE. However, during the design phase, it became clear that the actual Cardano use case requires a unidirectional, multi-hop PRE. This change is fully compatible with the original proposal's PRE goals (transfer of decryption rights without exposing plaintext or private keys), but reflects the reality of trading tokens via Cardano smart contracts within the PRE landscape.

\begin{algorithm}[H]
\caption{Owner-mediated re-encryption from Alice to Bob}
\label{alg:reencrypt-alice-bob}

\KwIn{
  $(g, u_A)$ where $g \in \mathbb{G}_1$, $u_A = [x_A]g \in \mathbb{G}_1$ (Alice's public key),\\
  $(u_B, v_B)$ where $u_B = [x_B]g \in \mathbb{G}_1$, $v_B = [x_B]h \in \mathbb{G}_2$ (Bob's public keys),\\
  $R_{\mathsf{msg}} = [s_{\mathsf{msg}}]g \in \mathbb{G}_1$ (fixed message capsule header),\\
  $k_{\mathsf{msg}} \in \{0,1\}^\lambda$ (symmetric message key already in use),\\
  $\mathsf{tag}_{\mathsf{key}}$ (domain separation tag for key capsules),\\
  Alice's secret key $x_A \in \mathbb{Z}_n$
}
\KwOut{
  Bob's key capsule $(R_{\mathsf{key}}, \mathsf{nonce}_{AB}, c_{AB}, \mathsf{aad}_{AB})$ and re-encryption key $\mathsf{rk}_{A \rightarrow B}$
}

\BlankLine

select a random $s_{\mathsf{key}} \xleftarrow{\$} \mathbb{Z}_n$\\
compute $R_{\mathsf{key}} = [s_{\mathsf{key}}] g$\\
compute $S_{AB} = [s_{\mathsf{key}}] u_B \in \mathbb{G}_1$\\
compute $\mathsf{kem\_key} = \mathsf{BLAKE2B}(\mathsf{enc}(S_{AB}))$\\[4pt]

compute $\mathsf{salt}_{AB} = \mathsf{BLAKE2B}(\mathsf{enc}(R_{\mathsf{key}}) \,\|\, \mathsf{enc}(R_{\mathsf{msg}}) \,\|\, \mathsf{tag}_{\mathsf{key}})$\\
derive $k_{AB} = \mathsf{HKDF}_{\mathsf{SHA3\mbox{-}256}}(\mathsf{kem\_key}, \mathsf{salt}_{AB}, \mathsf{tag}_{\mathsf{key}})$\\[4pt]

compute $\mathsf{h}_{\mathsf{key}} = \mathsf{BLAKE2B}(\mathsf{enc}(R_{\mathsf{key}}))$ and $\mathsf{h}_{\mathsf{msg}} = \mathsf{BLAKE2B}(\mathsf{enc}(R_{\mathsf{msg}}))$\\
set $\mathsf{aad}_{AB} = \mathsf{h}_{\mathsf{key}} \,\|\, \mathsf{h}_{\mathsf{msg}} \,\|\, \mathsf{tag}_{\mathsf{key}}$\\[4pt]

select a random $\mathsf{nonce}_{AB} \xleftarrow{\$} \{0,1\}^{96}$\\
encrypt $c_{AB} = \mathsf{AES\mbox{-}GCM}_{k_{AB}}(k_{\mathsf{msg}}, \mathsf{nonce}_{AB}, \mathsf{aad}_{AB})$\\[4pt]

compute $x_A^{-1} \gets x_A^{-1} \bmod n$\\
compute $\mathsf{rk}_{A \rightarrow B} = [x_A^{-1}] v_B \in \mathbb{G}_2$\\[4pt]

\KwRet{$(R_{\mathsf{key}}, \mathsf{nonce}_{AB}, c_{AB}, \mathsf{aad}_{AB}),\ \mathsf{rk}_{A \rightarrow B}$}

\end{algorithm}


Algorithm \ref{alg:reencrypt-alice-bob} describes the actual re-encryption process for Alice, giving the decryption rights to Bob.

# Protocol Overview

The PEACE protocol is an ECIES-based, multi-hop, unidirectional proxy re-encryption scheme for the Cardano blockchain, allowing creators, collectors, and developers to trade encrypted NFTs without relying on centralized decryption services. The protocol should be viewed as a proof of concept, as the data storage layer for the protocol is the Cardano blockchain; thus, ultimately, the storage limit, the maximum size of the encrypted data and required decryption data, is bound by the current parameters of the Cardano blockchain.

## Design Goals And Requirements

Two equally important areas, the on-chain and off-chain, define the protocol design. The on-chain design is everything related to smart contracts written in Aiken for the Cardano blockchain. The off-chain design includes transaction building, cryptographic proof generation, and the happy path flow. The design on both sides will focus on a two-party system: Alice and Bob, who want to trade encrypted data. Alice will be the original owner, and Bob will be the new owner. As this is a proof of concept, the protocol will not include the general n-party system, as that is future work for a real-world production setting.

The protocol must allow continuous trading via multi-hop trading, meaning that Alice will trade with Bob, who could then trade with Carol. In this setting, Alice will trade to Bob then Bob will trade back to Alice rather than to Carol without any loss of generality. Each hop will generate new owner and decryption data. The storage of previous hop data should not be required. Users will use a basic bid system for token trading. A user may choose not to trade their token by simply not selecting a bid.

The encryption direction needs to flow in one direction per hop. Alice trades with Bob, and that is the end of their transaction. Bob does not gain any ability to re-encrypt the data back to Alice without a new bid made by Alice, basically restarting the re-encryption process. Any bidirectionality here implies symmetry between Alice and Bob, thereby circumventing the re-encryption requirement via token trading. The unidirectional requirement forces tradability to follow the typical trading interactions currently found on the Cardano blockchain.

Each UTxO in this system must be uniquely identified via an NFT. The uniqueness requirement works well for the encryption side because the NFT could be a tokenized representation of the encrypted data, something akin to a CIP68 [@CIP-68] contract, but using a single token. The bid side does work, but the token becomes a pointer rather than having any real data attached, essentially a unique, one-time-use token. Together, they provide the correct uniqueness requirement. UTxOs may be remvoed from the contract at any time by the owner. After the trade, the user owns the encrypted data may do whatever they want with that data. The protocol does not require the re-encryption contract to store the encrypted data permanently.

The protocol will use an owner-mediated re-encryption flow (a hybrid PRE), which is UX-equivalent to a classical proxy re-encryption scheme in this setting, since smart contracts on Cardano are passive validators and do not initiate actions. Ultimately, a user must act as the proxy, the one doing the re-encryption, because the contract cannot do it on its own. The smart contract must act as the proxy's validator, not solely as the proxy itself. To simplify this proof of concept implementation, the owner will act as their own proxy in the protocol.

## On-Chain And Off-Chain Architecture

There will be two user-focused smart contracts: one for re-encryption and the other for bid management. Any UtxO inside the re-encryption contract is for sale via the bidding system. A user may place a bid into the bid contract, and the current owner of the encrypted data may select it as payment for re-encrypting the data to the new owner. To ensure functionality, a reference data contract must exist, as it resolves circular dependencies. The reference datum will contain the contract script hashes for the re-encryption and bid contracts.

The bid contract datum structure:
```rust
pub type BidDatum {
  owner_vkh: VerificationKeyHash,
  owner_g1: Register,
  owner_g2: Register,
  pointer: AssetName,
  token: AssetName,
}
```

The bid datum contains all of the required information for re-encryption. The owner of a bid UTxO will be type \texttt{Register} both in $\mathbb{G}_{1}$ and $\mathbb{G}_{2}$. The \texttt{pointer} is the NFT name on the bid UTxO, and \texttt{token} is the NFT name on the re-encryption UTxO. The \texttt{token} forces the bid to apply only to a specific token.

The bid contract redeemer structure:
```rust
pub type BidMintRedeemer {
  EntryBidMint(SchnorrProof)
  LeaveBidBurn(AssetName)
}
```
```rust
pub type BidSpendRedeemer {
  RemoveBid
  UseBid
}
```

Entering into the bid contract uses the \texttt{EntryBidMint} redeemer, triggering a \texttt{pointer} mint validation, a \texttt{token} existence check, a Ed25519 signature with \texttt{owner\_vkh}, a Schnorr $\Sigma$-protocol using \texttt{owner\_g1}, and a BLS-style proof using \texttt{owner\_g1} and \texttt{owner\_g2}. Leaving the bid contract requires using \texttt{RemoveBid} and \texttt{LeaveBidBurn} redeemers together, triggering a \texttt{pointer} burn validation and Ed25519 signature with \texttt{owner\_vkh}. When a user selects a bid, they will use \texttt{UseBid} and \texttt{LeaveBidBurn} together, triggering a \texttt{pointer} burn validation and the proxy re-encryption validation.

The re-encryption contract datum structure:
```rust
pub type EncryptionDatum {
  owner_vkh: VerificationKeyHash,
  owner_g1: Register,
  token: AssetName,
  ciphertext: Capsule,
  envelope: Capsule,
}
```
```rust
pub type Capsule {
  ct: ByteArray,
  nonce: ByteArray,
  aad: ByteArray,
  r_key: ByteArray,
}
```

The re-encryption datum contains all of the required information for decryption. The owner of an encrypted data UTxO will be type \texttt{Register} in $\mathbb{G}_{1}$. The \texttt{token} is the NFT name on the re-encryption UTxO. The \texttt{ciphertext} contains the encryption information and the \texttt{envelope} contains the decryption information. Inside the \texttt{envelope} is the encrypted DEK data, \texttt{ct}. The \texttt{nonce}, \texttt{aad}, and \texttt{r\_key} are required for decryption.

```rust
pub type EncryptionMintRedeemer {
  EntryEncryptionMint(SchnorrProof)
  LeaveEncryptionBurn(AssetName)
}
```

```rust
pub type ReputationSpendRedeemer {
  RemoveEncryption
  UseEncryption
}
```

Entering into the re-encryption contract uses the \texttt{EntryEncryptionMint} redeemer, triggering a \texttt{token} mint validation, a Ed25519 signature with \texttt{owner\_vkh}, and a Schnorr $\Sigma$-protocol using \texttt{owner\_g1}. Leaving the re-encryption contract requires using \texttt{RemoveEncryption} and \texttt{LeaveEncryptionBurn} redeemers together, triggering a \texttt{token} burn validation and a Ed25519 signature with \texttt{owner\_vkh}. When a user selects a bid, they will use \texttt{UseEncryption}, triggering the proxy re-encryption validation.

The redeemers \texttt{UseEncryption}, \texttt{UseBid}, and \texttt{LeaveBidBurn} must be used together during re-encryption.

## Key Management And Identity

Each user in the protocol has a long-term BLS12-381 keypair represented by \texttt{Register} values in both $\mathbb{G}{1}$ and $\mathbb{G}{2}$. The $\mathbb{G}{1}$ is used as the user's on-chain identity for encryption and signature verification. The $\mathbb{G}{2}$ is used for zero-knowledge and re-encryption-related checks. The corresponding secret scalar $x \in \mathbb{Z}_n$ is held off-chain by the user's wallet or client software and is never published on-chain. These long-term keys should be stable over many trades. A \texttt{Register} as an on-chain identity can be constant or randomized. If constant, a user and \texttt{Register} are linked; otherwise, the user is anonymous. The PEACE protocol allows for stealthy encryption.

The BLS12-381 keys used for encryption and re-encryption are logically separate from the Ed25519 keys used to sign Cardano transactions. A wallet must manage both: Ed25519 keys to authorize UTxO spending, and BLS12-381 scalars to obtain and delegate decryption rights. Losing the BLS12-381 secret key means losing the ability to decrypt any items associated with that identity, even if the Cardano spending keys are still available.

The proof-of-concept does not implement a full key rotation or revocation mechanism. If a user's long-term BLS12-381 secret key is compromised, an attacker can decrypt all current and future capsules addressed to that key, but cannot retroactively remove or alter on-chain history. Handling key rotation, partial recovery, and revocation across many encrypted positions is left as future work for a production deployment.

For each encrypted item, the protocol generates a fresh symmetric key $k_{msg}$ for AES-GCM encryption of the actual payload. This key is not stored on-chain; only its ciphertext and associated data are stored in the re-encryption datum. Each re-encryption hop (e.g., Alice $\rightarrow$ Bob) introduces a fresh ephemeral Diffie–Hellman secret and a derived wrapping key $k_{AB}$ that is used only to encrypt $k_{msg}$ for that specific hop. The on-chain capsule contains the public header $r_{key}$, the AES-GCM nonce, ciphertext, and associated data. These per-hop keys are never stored on-chain.

## Protocol Specification

The protocol flow starts with Alice selecting a secret $[\gamma] \in \mathbb{Z}_{m}$ and $[\delta] \in \mathbb{Z}_{n}$. The secret $\gamma$ will generate a Ed25519 keypair that will in turn generate the \texttt{VerificationKeyHash}, \texttt{vkh}, used on-chain in the Ed25519 signatures. The secret $\delta$ will generate the \texttt{Register} in both $\mathbb{G}{1}$ and $\mathbb{G}{2}$ using the fixed generators, $g$, and $q$ respectively. Alice will fund the address associated with \texttt{vkh} with enough Lovelace to pay for the minimum required Lovelace for both the change UTxO and the contract UTxO, and the transaction fee. Alice may then build the entry to the re-encryption contract transaction.

The re-encryption entry transaction will contain a single input and two outputs. The transaction will mint a \texttt{token} using the \texttt{EntryEncryptionMint} redeemer. The \texttt{token} name is generated by the concatentation of the input's output index and transaction id as shown in the code and example below. The specification for the protocol assumes a single input but in general many inputs may be used in this transaction. If more than one input exists then the first lexicographical sorted input will be used for the name generation.

```rust
pub fn generate_token_name(inputs: List<Input>) -> AssetName {
  let input: Input = builtin.head_list(inputs)
  let id: TransactionId = input.output_reference.transaction_id
  let idx: Int = input.output_reference.output_index
  id |> bytearray.push(idx) |> bytearray.slice(0, 31)
}
```

```bash
# the 24th output of the transaction 1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
input = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef#24"
# note: 24 is 18 in base 16
# concat the index and id then trim to 32 bytes.
token_name = "181234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd"
```

Alice may now finish building the \texttt{EncryptionDatum} by constructing the \texttt{ciphertext} and \texttt{envelope}. Since Alice is the first owner, she will encrypt to herself. This will force the required Lovelace for some given encrypted message to remain constant, meaning new owners do not have to contribute to the minimum required Lovelace for the encrypted data. 

Alice will encrypt the original data by generating a \texttt{Register} in $\mathbb{G}{1}$ and will produce a shared secret with her own public value. The shared secret will be used to derive the KEM used in the KDF to produce a valid AES key. Now the message may be encrypted use AESGCM. The resulting information is stored in the \texttt{Capsule} type for the \texttt{ciphertext} field. Below is a pythonic psuedocode for generating the original encrypted data.

```py
message = "This is a secret message."
r = random_register()
s = scale(alice.u, r.x)
kem = blake2b(s)
aes_key = hkdf.derive(kem)
nonce = urandom(12)
aad = blake2b(r.u) + domain_tag
aesgcm = AESGCM(aes_key)
ciphertext = aesgcm.encrypt(nonce, message, aad)
```

```rust
pub type Capsule {
  ct: ciphertext,
  nonce,
  aad,
  r_key: r.u,
}
```

Now that the original data is encrypted, alice can then re-encrypt the encrypted data to herself to generate the \texttt{envelope} field. Alice will generate a new random \texttt{Register} and will following the encryption pattern from the \texttt{ciphertext} field but instead of encrypting the message, she will encrypt the aes key. Below is a pythonic psuedocode for generating the decryption capsule data.

```py
r = random_register()
s = scale(alice.u, r.x)
kem = blake2b(s)
self_aes_key = hkdf.derive(kem)
self_nonce = urandom(12)
self_aad = blake2b(r.u) + ciphertext.r_key + domain_tag
aesgcm = AESGCM(self_aes_key)
# the original aes key is being encrypted
self_ct_key = aesgcm.encrypt(self_nonce, aes_key, self_aad)
```

```rust
pub type Capsule {
  ct: self_ct_key,
  nonce: self_nonce,
  aad: self_aad,
  r_key: r.u,
}
```

Alice can prove to herself that the encryption is valid by verifying the pairing below.

```py
inv = pow(alice.x, -1, curve_order)
rk = scale(alice_g2.u, inv)
pair(owner_g1.u, rk) == pair(owner_g1.g, alice_g2.u)
```

Alice may now construct the full \texttt{EncryptionDatum}.

```rust
pub type EncryptionDatum {
  owner_vkh,
  owner_g1,
  token: generate_token_name(inputs),
  ciphertext: Capsule {
    ct: ciphertext,
    nonce,
    aad,
    r_key: r.u,
  },
  capsule: Capsule {
    ct: self_ct_key,
    nonce: self_nonce,
    aad: self_aad,
    r_key: r.u,
  },
}
```

The entry redeemer verifies that Alice's verification key (Ed25519 key hash) is valid via a simple Ed25519 signature as Alice needs a valid \texttt{vkh} to be able to remove the entry. The entry redeemer also verifies a valid \texttt{Register} via a Schnorr $\Sigma$-protocol. Alice needs this to decrypt her own data. After successfully creating a valid entry transaction and submitting it to the Cardano blockchain the encrypted data is ready to be traded.

Bob may now place a bid into the bid contract in an attempt to purchase the encrypted data from Alice. First, Bob selects a secret $[\gamma] \in \mathbb{Z}_{m}$ and $[\delta] \in \mathbb{Z}_{n}$. Similarily to Alice, the secret $\gamma$ will generate a Ed25519 keypair that will in turn generate the \texttt{VerificationKeyHash}, \texttt{vkh}, used on-chain in the Ed25519 signatures. The secret $\delta$ will generate the \texttt{Register} in both $\mathbb{G}{1}$ and $\mathbb{G}{2}$ using the fixed generators, $g$, and $q$ respectively. Bob will fund the address associated with \texttt{vkh} with enough Lovelace to pay for the minimum required Lovelace for both the change UTxO and the contract UTxO, and the transaction fee. Bob may then build the entry to the bid contract transaction.

The structure of the bid entry transaction is similar to the re-encryption entry transaction but using \texttt{EntryBidMint} instead of \texttt{EntryEncryptionMint}. The \texttt{pointer} token name is generated in the exact some way as the \texttt{token} name.


Similar to the re-encryption contract, the entry redeemer will verify Bob's \texttt{vkh} but instead of just verifying the \texttt{Register} values in $\mathbb{G}{1}$, a BLS-style proof is used to verify both the \texttt{Register} values in $\mathbb{G}{1}$ and $\mathbb{G}{2}$. This is important as the validity of these points will determine if Bob can decrypt the data. The value of the UTxO is price Bob is willing to pay for Alice to re-encrypt the data to his \texttt{Register} data. There may be many bids but only one can be selected by Alice for the re-encryption transaction. For simplicity of the protocol, Bob will need to remove their old bids and recreate the bids for any nessecary price adjustments. Bob may remove his bid at any time.



Alice will select a bid UTxO from the bid contract and will do the re-encryption process using Bob's \texttt{Register} data. This step requires Alice to burn Bob's bid token, update the on-chain data to Bob's data, and create re-encryption proofs for the capsule hand off. This is the most important step as this is the tradability of both the token and the encrypted data. The re-encryption redeemer will provide all of the required proxy validation proofs. The PRE proofs are pairings between the original owner's \texttt{Register} values in $\mathbb{G}{1}$ and the new owner's \texttt{Register} values in $\mathbb{G}{2}$, proving that the new owner's \texttt{Register} was used during the re-encryption process, resulting in a transfer of ownership and decryption rights. Bob now owns the data and may remove his encrypted data at any time.

# Security Model

## Trust Model

### Assumptions

# Threat Analysis

## Metadata Leakage

# Limitations And Risks

## Performance And On-Chain Cost

# Conclusion

\clearpage
\appendix

# Appendix A - Proofs {#app:proofs}

\begin{lemma}\label{lem:correct-rerandom}
Algorithm~\ref{alg:rerandom} re-randomizes a \texttt{Register}.
\end{lemma}

\begin{proof}

We start with $\ ($ $g, u\ )$ where $g \in \mathbb{G}_1$ and $u=[\delta]g \in \mathbb{G}_1$ and we are given $\ ($ $g', u'\ )$. Let us assume that $k \in \mathbb{Z}_{n}$ is a random integer.

Let's assume $g' = [k]g$ and $u' = [k]u$. We know $u = [\delta]g$ so $u' = [k][\delta]g = [\delta][k]g = [\delta]g'$.

Thus the discrete-logrithm relation that binds $\ ($ $g, u\ )$, $u=[\delta]g$, is the same relationship between $\ ($ $g', u'\ )$, $u'=[\delta]g'$, showing that $\ ($ $g', u'\ )$ is just the re-randomization of $\ ($ $g, u\ )$.

\end{proof}

\begin{lemma}\label{lem:correct-schnorr}
Correctness for Algorithm~\ref{alg:schnorrsig}, a non-interactive Schnorr's $\Sigma$-protocol for the discrete logarithm relation.
\end{lemma}

\begin{proof}

We start with $\ ($ $g, u, a, z\ )$ where $g \in \mathbb{G}_1$, $u=[\delta]g \in \mathbb{G}_1$, $a \in \mathbb{G}_1$, and $z \in \mathbb{Z}_{n}$. Let us assume that $z = r + c * \delta$ and $a = [r]g$.

Use the Fiat-Shamir transform to generate a challenge value $c = R(g, u, a)$.

$[z]g = [r + c * x]g$

$[z]g = [r]g + [c][x]g$

$[z]g = a + [c]u$

An honest \texttt{Register} can produce an $a$ and $z$ that will satisfy $[z]g = a + [c]u$ proving knowledge of the secret $/delta$.

\end{proof}

<!-- Add a page between the appendix and the bib -->
\clearpage
