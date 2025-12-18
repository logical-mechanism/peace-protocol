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
  - \usepackage{listings}
  - \usepackage{xcolor}
  - \usepackage{float}
  - |
    \lstdefinestyle{python}{
      language=Python,
      basicstyle=\ttfamily\small,
      keywordstyle=\color{MidnightBlue},
      commentstyle=\color{Gray},
      stringstyle=\color{OliveGreen},
      numbers=left,
      numberstyle=\tiny,
      breaklines=true,
      frame=single,
      captionpos=b
    }
  - |
    \lstdefinelanguage{Aiken}{
      keywords={pub,type,fn,let,expect, const},
      sensitive=true,
      comment=[l]{//},
      morestring=[b]",
    }
  - |
    \lstdefinestyle{rust}{
      language=Aiken,
      basicstyle=\ttfamily\small,
      keywordstyle=\color{MidnightBlue},
      commentstyle=\color{Gray},
      stringstyle=\color{OliveGreen},
      numbers=left,
      numberstyle=\tiny,
      stepnumber=1,
      breaklines=true,
      frame=single,
      tabsize=2,
      captionpos=b
    }
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

The encrypted NFT problem is one of the most significant issues with current NFT standards on Cardano. Either the data is not encrypted, available to everyone who views the NFT, or the data encryption requires some form of centralization, with some company doing the encryption on behalf of users. Current solutions [@stuffio-whitepaper] claim to offer decentralized encrypted assets (DEAs), but lack a publicly available, verifiable cryptographic protocol or an open-source implementation. Most, if not all, of the mechanics behind current DEA solutions remain undisclosed. This report aims to fill that knowledge gap by providing an open-source implementation of a decentralized re-encryption protocol for encrypted assets on Cardano.

Several mandatory requirements must be satisfied for the protocol to function as intended. The encryption protocol must allow tradability of both the NFT itself and the right to decrypt the NFT data, implying that the solution must involve smart contracts and a form of encryption that allows data access to be re-encrypted for another user without revealing the encrypted content in the process. The contract side of the protocol should be reasonably straightforward. It needs a way to trade a token that holds the encrypted data and allows other users to receive it. To ensure decryptability, the tokens will need to be soulbound. On the encryption side of the protocol is some form of encryption that enables the re-encryption process to function correctly. Luckily, this type of encryption has been in cryptography research for quite some time [@mambo-okamoto-1997] [@blaze-bleumer-strauss-1998] [@ateniese-et-al-ndss2005]. There are even patented cloud-based solutions already in existence [@ironcore-recrypt-rs]. Currently, there are no open-source, fully on-chain, decentralized re-encryption protocols for encrypting NFT data on Cardano. The PEACE protocol aims to provide a proof-of-concept solution to this problem.

The PEACE protocol will implement an ambitious yet well-defined, unidirectional, multi-hop proxy re-encryption (PRE) scheme [@WangCao2009PREPoster] that utilizes ECIES [@ieee-1363a-2004] and AES [@fips-197]. Unidirectionality means that Alice can re-encrypt for Bob, and Bob can then re-encrypt it back to Alice, using different encryption keys. Unidirectionality is important for tradability, as it defines the one-way flow of data and removes any restriction on who can purchase the NFT. Multi-hop means that the flow of encrypted data from Alice to Bob to Carol, and so on, does not end, in the sense that it cannot be re-encrypted for a new user. Multi-hopping is important for tradability, as a finitely tradable asset does not fit many use cases. Typically, an asset should always be tradable if the user wants to trade it. The encryption primitives used in the protocol are considered industry standards at the time of this report.

The remainder of this report is as follows. Section 4 discusses the preliminaries and background required for this project. Section 5 will be a brief overview of the required cryptographic primitives. Section 6 will be a detailed description of the protocol. Sections 7, 8, and 9 will delve into security and threat analysis, the limitations of the protocol, and related topics, respectively. The goal of this report is to serve as a comprehensive reference and description of the PEACE protocol.

# Background And Preliminaries

Understanding the protocol will require some technical knowledge of modern cryptographic methods, a basic understanding of elliptic curve arithmetic, and a general understanding of how smart contracts work on the Cardano blockchain. Anyone comfortable with these topics will find this report very useful and easy to follow. The report will attempt to use research standards for terminology and notation. The elliptic curve used in this protocol will be BLS12-381 [@bowe-bls12-381-2017]. All smart contracts required for the protocol are written in Aiken [@AikenCompiler].

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
| $g$ | A fixed generator in $\mathbb{G}_{1}$ |
| $q$ | A fixed generator in $\mathbb{G}_{2}$ |
| $R$ | The Fiat-Shamir transformer |
| $H_{\kappa}$ | A hash to group function for $\mathbb{G}_{\kappa}$ |
| $m$ | The order of Ed25519 |
| $\gamma$ | A non-zero integer in $\mathbb{Z}_{m}$ |

The protocol, including both on-chain and off-chain components, will heavily utilize the \texttt{Register} type shown in Listing \ref{lst:registertype}. The \texttt{Register} stores a generator, $g \in \mathbb{G}_{\kappa}$ and the corresponding public value $u = [\delta]g$ where $\delta \in \mathbb{Z}_{n}$ is a secret. We shall assume that the hardness of ECDLP and CDH in $\mathbb{G}_{1}$ will result in the inability to recover the secret $\delta$. When using a pairing, we additionally rely on the standard bilinear Diffie-Hellman assumptions over the subgroups $( \ \mathbb{G}_{1}, \mathbb{G}_{2}, \mathbb{G}_{T}\ )$. We will represent the groups $\mathbb{G}_{1}$ and $\mathbb{G}_{2}$ with additive notation and $\mathbb{G}_{T}$ with multiplicative notation.



```{=latex}
\begin{lstlisting}[
  style=rust,
  caption={The Register type},
  label={lst:registertype},
  float,
  floatplacement=H
]
pub type Register {
  // the generator, #<Bls12_381, G1> or #<Bls12_381, G2> 
  generator: ByteArray,
  // the public value, #<Bls12_381, G1> or #<Bls12_381, G2> 
  public_value: ByteArray,
}
\end{lstlisting}
```

Where required, we will verify Ed25519 signatures [@rfc8032] for cost-minimization as relying solely on pure BLS12-381 for simple signatures becomes too costly on-chain. There will be instances where the Fiat-Shamir transform [@fiat-shamir-1986] will be applied to a $\Sigma$-protocol to transform it into a non-interactive variant. In these cases, the hash function will be Blake2b-224 [@rfc7693].

# Cryptographic Primitives Overview

This section provides brief explanations of the cryptographic primitives required by the protocol. If a primitive has an algorithmic description, then it will be included in the respective sub-section. The \texttt{Register} type will be represented as a tuple,$\ ($ $g, u\ )$, for simplicity inside the algorithms. We shall assume that the compression and uncompression of the elliptic curve points are canonical [@ZcashProtocolSpec2022NU5]. Correctness proofs for many algorithms are in Appendix A.

## Register-based

The protocol requires proving knowledge of a user's secret using a Schnorr $\Sigma$-protocol [@thaler-pazk-2022] [@schnorr1991]. This algorithm is both complete and zero-knowledge. We can use simple Ed25519 signatures for spendability, and then utilize the Schnorr $\Sigma$-protocol for knowledge proofs related to encryption. We will make the protocol non-interacting via the Fiat-Shamir transform.

\begin{algorithm}[H]
\caption{Non-interactive Schnorr's $\Sigma$-protocol for the discrete logarithm relation}
\label{alg:schnorrsig}

\KwIn{\\ $\ ($ $g, u\ )$ where $g \in \mathbb{G}_{\kappa}$, $u=[\delta]g \in \mathbb{G}_{\kappa}$}
\KwOut{\textsf{bool}}

select a random $\delta' \in \mathbb{Z}_{n}$

compute $a = [\delta']g$

calculate $c = R(g, u, a)$

compute $z = \delta*c + \delta'$

output $[z]g = a + [c]u$
\end{algorithm}

The protocol requires proving a binding relationship between a user's public value and other known encryption related elliptic curve elements. The binding proof is multiple Schnorr's $\Sigma$-protocol combined together.

\begin{algorithm}[H]
\caption{Non-interactive Binding $\Sigma$-protocol}
\label{alg:bindingsig}

\KwIn{
  \\ $\ ($ $g, u\ )$ where $g \in \mathbb{G}_{1}$, $u=[\delta]g \in \mathbb{G}_{1}$ \\
  $(r_{1}, \chi)$ where $r_{1} \in \mathbb{G}_{1}$, $\chi \in \mathbb{G}_{1}$ \\
  $(a, r)$ where $a \in \mathbb{Z}_{n}$ and $r \in \mathbb{Z}_{n}$
}
\KwOut{\textsf{bool}}

select a random $\rho \in \mathbb{Z}_{n}$ and $\alpha \in \mathbb{Z}_{n}$ 

compute $t_{1} = [\rho]g$

compute $t_{2} = [\alpha]g + [\rho]u$

calculate $c = R(g, u, t_{1}, t_{2})$

compute $z_{a} = a*c + \alpha$

compute $z_{r} = r*c + \rho$

output $[z_{a}]g + [z_{r}]u = t_{2} + [c]\chi \land [z_{r}]g = t_{1} + [c]r_{1}$
\end{algorithm}

There will be times when the protocol requires proving some equality using pairings. In these cases, we can use something akin to the BLS signature scheme, allowing only someone with the knowledge of the secret to prove the pairing equivalence. BLS signatures are a straightforward yet important signature schemes for the protocol, as they enable public confirmation of knowledge of a complex relationship beyond the limitations of Schnorr's $\Sigma$-protocols. BLS signatures work because of the bilinearity of the pairing [@Menezes1993ECPKC].

\begin{algorithm}[H]
\caption{Boneh-Lynn-Shacham (BLS) signature method}
\label{alg:blssig}

\KwIn{\\$\ ($ $g, u, c, w, m\ )$ where $g \in \mathbb{G}_1$, $u=[\delta]g \in \mathbb{G}_1$, \\ $c = H_{2}(m) \in \mathbb{G}_2$, $w = [\delta]c \in \mathbb{G}_2$, and $m\in\{0,1\}^{*}$}
\KwOut{\textsf{bool}}

$e(u, c) = e(g, w)$

$e(q^{\delta}, c) = e(q, c^{\delta}) = e(q, c)^{\delta}$

\end{algorithm}


## ECIES + AES-GCM

The Elliptic Curve Integrated Encryption Scheme (ECIES) is a hybrid protocol involving asymmetric cryptography with symmetric ciphers. The encryption used in ECIES is the Advanced Encryption Standard (AES). ECIES and AES, combined with a key derivation function (KDF) such as HKDF [@cryptoeprint:2010/264], form a complete encryption system.

\begin{algorithm}[H]
\caption{Encryption using ECIES + AES}
\label{alg:encrypt-eciesaes}

\KwIn{\\$\ ($ $g, u\ )$ where $g \in \mathbb{G}_{\kappa}$, $u=[\delta]g \in \mathbb{G}_{\kappa}$, $m \in \{0,1\}^{*}$}
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

\KwIn{\\$\ ($ $g, u\ )$ where $g \in \mathbb{G}_1$, $u=[\delta]g \in \mathbb{G}_1$,\\$\ ($ $r, c, h\ )$ as the capsule}
\KwOut{$\ ($ $\{0,1\}^{*}$,\textsf{bool} $\ )$ }

compute $s' = [\delta]r$

generate $k' = KDF(s' | r)$

compute $m' = AES(c, k')$

compute $h' = BLAKE2B(m')$

output $\ ($ $m'$, h' = h $\ )$

\end{algorithm}

Algorithm \ref{alg:encrypt-eciesaes} describes the case where a \texttt{Register} is used to generate the DEK from the KDF function. Anyone with knowledge of $k$ may decrypt the ciphertext. The algorithm shown differs slightly from the PEACE protocol's implementation, as the protocol allows transferring the DEK to another \texttt{Register}; however, the general flow remains the same. The key takeaway here is that encrypting a message and decrypting the ciphertext requires a key for the KDF to generate the DEK. Both algorithms \ref{alg:encrypt-eciesaes} and \ref{alg:decrypt-eciesaes} use a simple hash function for authentication. In the PEACE protocol, we will use AES-GCM with authenticated encryption with associated data (AEAD) for authentication.

## Re-Encryption

There are various types of re-encryption schemes, ranging from classical proxy re-encryption (PRE) to hybrid methods. These re-encryption schemes involve a proxy, an entity that performs the re-encryption and verification processes. The PRE used in the PEACE protocol is modeled as an interactive flow between the current owner and a prospective buyer, utilizing a smart contract as part of the proxy. We need an interactive scheme because in many real-world use cases there are numerous off-chain checks such as KYC/AML regulations and various legal requirements that must occur before transferring the right to decrypt to the new owner. The PEACE protocol obtains interactivity via a bidding system and requiring the current owner to agree to the exchange.

The method described below is a hybrid approach. The current owner's wallet performs the re-encryption process for the buyer. At the same time, the Cardano smart contract acts as a proxy, verifying various cryptographic proofs, enforcing the correct bindings, handling payments, and updating the on-chain owner fields. This design explicitly supports off-chain processes before the transfer of decryption rights. The current owner only submits the re-encryption transaction once these off-chain conditions are satisfied. This method will allow for the most use cases for real-world assets. The PRE is unidirectional, meaning the re-encryption flow is one-way: from the current owner to the next owner. If Alice delegates to Bob, Bob does not automatically gain the ability to 'go backwards' and create ciphertexts for Alice using the same re-encryption material. This flow differs from a bidirectional method, where the PRE is symmetric, enabling a two-way encryption relationship between the parties. This means that Alice can transform a ciphertext into one for Bob, and Bob can transform a ciphertext into one for Alice, without either Alice or Bob having to re-run the entire re-encryption flow. That is not what we want for this implementation. Each direction is a separate, explicit transfer of rights with its own re-encryption material, matching the tradability requirements required by the protocol.

Note that in the original Catalyst proposal, the protocol defines itself as a bidirectional, multi-hop PRE. However, during the design phase, it became clear that the actual Cardano use case requires a unidirectional, multi-hop PRE. This change is fully compatible with the original proposal's PRE goals (transfer of decryption rights without exposing plaintext or private keys), but reflects the reality of trading tokens via Cardano smart contracts within the PRE landscape.

\begin{algorithm}[H]
\caption{Owner-mediated re-encryption from Alice to Bob}
\label{alg:reencrypt-alice-bob}

\KwIn{
  \\
  $(g, u)$ where $g \in \mathbb{G}_1$, $u = [\delta_{a}]g \in \mathbb{G}_1$ (Alice's public key),\\
  $(g, v)$ where $v = [\delta_{b}]g \in \mathbb{G}_1$ (Bob's public keys),\\
  Alice's secret key $\delta_{a} \in \mathbb{Z}_n$ \\
  $(r_{1,a}, r_{2,a}, r_{3,a})$, where $r_{1} \in \mathbb{G}_1$, $r_{2} \in \mathbb{G}_{T}$, and  $r_{3} \in \mathbb{G}_2$ \\
  $(h_{0}, h_{1}, h_{2})$, where $h_{i} \in \mathbb{G}_2$ are public points.
}
\KwOut{
  $(r_{1,b}, r_{2,b}, r_{3,b})$ and $(r_{1,a}', r_{2,a}', r_{3,a}')$
}

\BlankLine

select a random $a \in \mathbb{Z}_{n}$

compute $\kappa = e(q^{a}, h_{0})$

select a random $r \in \mathbb{Z}_{n}$

compute $r_{1,b} = [r]g$

compute $r_{2,b} = e(q^{a}, h_{0}) * e(v^{r}, h_{0}) = e(q^{a}v^{r}, h_{0})$

compute $c = [BLAKE2b(r_{1,b})]h_{1} + [BLAKE2b(r_{1,b} || r_{2,b})]h_{2}$

compute $r_{4,b} = [r]c$

compute $r_{5,b} = [BLAKE2b(\kappa)]p + [\delta_{a}]h_{0}$

update $r_{2,a}' = r_{2,a} * e(r_{1,a}, r_{5,b})$

output $(r_{1,b}, r_{2,b}, r_{4,b})$ and $(r_{1,a}, r_{2,a}', r_{3,a})$

\end{algorithm}


Algorithm \ref{alg:reencrypt-alice-bob} describes the actual re-encryption process for Alice. This will transfer the decryption rights to Bob. Bob can then use this information to recursive calculate the secret $\kappa$ and eventually the original secret used in the encryption process.

# Protocol Overview

The PEACE protocol is an ECIES-based, multi-hop, unidirectional proxy re-encryption scheme for the Cardano blockchain, allowing creators, collectors, and developers to trade encrypted NFTs without relying on centralized decryption services. The protocol should be viewed as a proof-of-concept, as the data storage layer for the protocol is the Cardano blockchain; thus, ultimately, the storage limit, the maximum size of the encrypted data and the required decryption data, is bound by the current parameters of the Cardano blockchain. In a production setting, the data storage layer should allow for arbitrary file sizes.

## Design Goals And Requirements

Two equally important areas, the on-chain and off-chain, define the protocol design. The on-chain design is everything related to smart contracts written in Aiken for the Cardano blockchain. The off-chain design includes transaction building, cryptographic proof generation, and the happy path flow. The design on both sides will focus on a two-party system: Alice and Bob, who want to trade encrypted data. Alice will be the original owner, and Bob will be the new owner. As this is a proof-of-concept, the off-chain will not include the general n-party system, as that is future work for a real-world production setting.

The protocol must allow continuous trading via a multi-hop PRE, meaning that Alice will trade with Bob, who could then trade with Carol. In this setting, Alice will trade to Bob then Bob will trade back to Alice rather than Carol without any loss of generality. Each hop will generate new owner and decryption data for the encryption UTxO. The storage of previous hop data should grow at most linearly. Users will use a basic bid system for token trading. A user may choose to not trade their token by simply not selecting a bid if one exists.

The re-encryption process needs to flow in one direction per hop. Alice trades with Bob and that is the end of their transaction. Bob does not gain any ability to re-encrypt the data back to Alice without a new bid made by Alice, restarting the re-encryption process. Any bidirectionality here implies symmetry between Alice and Bob, thereby circumventing the re-encryption requirement via token trading. The unidirectional requirement forces tradability to follow the typical trading interactions currently found on the Cardano blockchain.

Each UTxO in this system must be uniquely identified via an NFT. The uniqueness requirement works well for the encryption side because the NFT could be a tokenized representation of the encrypted data, something akin to a CIP68 [@CIP-68] contract, but using a single token. The bid side does work, but the token becomes a pointer rather than having any real data attached, essentially a unique, one-time-use token. Together, they provide the correct uniqueness requirement. UTxOs may be removed from the contract at any time by the owner. After the trade, the owner of the encrypted data may do whatever they want with that data. The protocol does not require the re-encryption contract to store the encrypted data permanently.

The protocol will use an owner-mediated re-encryption flow (a hybrid PRE), which is UX-equivalent to a classical proxy re-encryption scheme in this setting, since smart contracts on Cardano are passive validators and do not initiate actions. Ultimately, some user must act as the proxy, the one doing the re-encryption, because the contract cannot do it on its own. The smart contract must act as the proxy's validator, not solely as the proxy itself. To simplify this proof-of-concept implementation, the owner will act as their own proxy in the protocol.

## On-Chain And Off-Chain Architecture

There will be two user-focused smart contracts: one for re-encryption and the other for bid management. Any UTxO inside the re-encryption contract is for sale via the bidding system. A user may place a bid into the bid contract, and the current owner of the encrypted data may select it as payment for re-encrypting the data to the new owner. To ensure functionality, a reference data contract must exist, as it resolves circular dependencies. The reference datum will contain the script hashes for the re-encryption and bid contracts.

```{=latex}
\begin{lstlisting}[
  style=rust,
  caption={The Bid datum type},
  label={lst:biddatumtype},
  float,
  floatplacement=H
]
pub type BidDatum {
  owner_vkh: VerificationKeyHash,
  owner_g1: Register,
  pointer: AssetName,
  token: AssetName,
}
\end{lstlisting}
```

The bid contract datum structure is defined in Listing \ref{lst:biddatumtype}. The bid datum contains all of the required information for re-encryption. The owner of a bid UTxO will be type \texttt{Register} in $\mathbb{G}_{1}$. The \texttt{pointer} is the NFT name on the bid UTxO, and \texttt{token} is the NFT name on the re-encryption UTxO. The \texttt{token} forces the bid to only apply to a specific sale.

```{=latex}
\begin{lstlisting}[
  style=rust,
  caption={The Bid redeemer types},
  label={lst:bidredeemertypes},
  float,
  floatplacement=H
]
pub type BidMintRedeemer {
  EntryBidMint(SchnorrProof)
  LeaveBidBurn(AssetName)
}
pub type BidSpendRedeemer {
  RemoveBid
  UseBid
}
pub type SchnorrProof {
  z_b: ByteArray,
  g_r_b: ByteArray,
}
\end{lstlisting}
```

The bid contract redeemer structures are defined in Listing \ref{lst:bidredeemertypes}. Entering into the bid contract uses the \texttt{EntryBidMint} redeemer, triggering a \texttt{pointer} mint validation, a \texttt{token} UTxO existence check, a Ed25519 signature with \texttt{owner\_vkh}, and a Schnorr $\Sigma$-protocol using \texttt{owner\_g1}. Leaving the bid contract requires using \texttt{RemoveBid} and \texttt{LeaveBidBurn} redeemers together, triggering a \texttt{pointer} burn validation and Ed25519 signature with \texttt{owner\_vkh}. When a user selects a bid, they will use \texttt{UseBid} and \texttt{LeaveBidBurn} together, triggering a \texttt{pointer} burn validation and the proxy re-encryption validation.

```{=latex}
\begin{lstlisting}[
  style=rust,
  caption={The Encryption datum type},
  label={lst:encdatumtype},
  float,
  floatplacement=H
]
pub type EncryptionDatum {
  owner_vkh: VerificationKeyHash,
  owner_g1: Register,
  token: AssetName,
  levels: List<EncryptionLevel>,
  capsule: Capsule,
}
pub type Capsule {
  nonce: ByteArray,
  aad: ByteArray,
  ct: ByteArray,
}
pub type EncryptionLevel {
  r1b: ByteArray,
  r2: EmbeddedGt,
  r4b: ByteArray,
}
pub type EmbeddedGt {
  g1b: ByteArray,
  g2b: Option<ByteArray>,
}
\end{lstlisting}
```

The re-encryption contract datum structure is defined in Listing \ref{lst:encdatumtype}. The ciphertext and related data are held in the \texttt{capsule} sub-type and each hop generates a new encryption level sub-type. We can’t store or do full arithmetic on $\mathbb{G}_{T}$ elements on-chain, and storing extra group elements is expensive. So \texttt{EmbeddedGt} stores only the minimal factors needed to reconstruct the $\mathbb{G}_{T}$ elements during validation, while everything else is treated as an implied constant or a value that can be referenced elsewhere.

The re-encryption datum contains all of the required information for decryption. The owner of the re-encryption UTxO will be type \texttt{Register} in $\mathbb{G}_{1}$. The \texttt{token} is the NFT name on the re-encryption UTxO. The \texttt{capsule} contains the encryption information and \texttt{levels} contains the decryption information. Inside the \texttt{capsule} is the \texttt{nonce}, \texttt{aad}, and \texttt{ct}.

```{=latex}
\begin{lstlisting}[
  style=rust,
  caption={The Encryption redeemer types},
  label={lst:encredeemertypes},
  float,
  floatplacement=H
]
pub type EncryptionMintRedeemer {
  EntryEncryptionMint(SchnorrProof, BindingProof)
  LeaveEncryptionBurn(AssetName)
}
pub type EncryptionSpendRedeemer {
  RemoveEncryption
  UseEncryption(ByteArray, ByteArray, AssetName, BindingProof)
}
pub type BindingProof {
  z_a_b: ByteArray,
  z_r_b: ByteArray,
  t_1_b: ByteArray,
  t_2_b: ByteArray,
}
\end{lstlisting}
```

The re-encryption contract redeemer structures are defined in Listing \ref{lst:encredeemertypes}. Entering into the re-encryption contract uses the \texttt{EntryEncryptionMint} redeemer, triggering a \texttt{token} mint validation, a Ed25519 signature with \texttt{owner\_vkh}, a binding proof using \texttt{owner\_g1} and a Schnorr $\Sigma$-protocol using \texttt{owner\_g1}. Leaving the re-encryption contract requires using \texttt{RemoveEncryption} and \texttt{LeaveEncryptionBurn} redeemers together, triggering a \texttt{token} burn validation and a Ed25519 signature with \texttt{owner\_vkh}. When a user selects a bid, they will use the \texttt{UseEncryption} redeemer, triggering the proxy re-encryption validation.

The redeemers \texttt{UseEncryption}, \texttt{UseBid}, and \texttt{LeaveBidBurn} must be used together during re-encryption.

## Key Management And Identity

Each user in the protocol has the ability to deterministically generate BLS12-381 keypairs represented by \texttt{Register} value in $\mathbb{G}_{1}$. The $\mathbb{G}_{1}$ points are used as the user's on-chain identity for encryption and signature verification. The corresponding secret scalar $\delta \in \mathbb{Z}_n$ is held off-chain by the user's wallet or client software and is never published on-chain.

The BLS12-381 keys used for re-encryption are logically separate from the Ed25519 keys used to sign Cardano transactions. A wallet must manage both: Ed25519 keys to authorize UTxO spending and BLS12-381 scalars to obtain and delegate decryption rights. Losing or compromising the BLS12-381 secret key means losing the ability to decrypt any items associated with that identity, even if the Cardano spending keys are still available.

The proof-of-concept does not implement a full key rotation or revocation mechanism. If a user's BLS12-381 secret key is compromised, an attacker can decrypt all current and future capsules addressed to that key, but cannot retroactively remove or alter on-chain history. Handling key rotation, partial recovery, and revocation across many encrypted positions is left as future work for a real-world production deployment.

For each encrypted item, the protocol generates a fresh KEM used inside of the encryption level. The KEM is never directly stored on-chain. The on-chain capsule contains the AES-GCM nonce, associated data, and ciphertext.

## Protocol Specification

The protocol flow starts with Alice selecting a secret $[\gamma] \in \mathbb{Z}_{m}$ and $[\delta] \in \mathbb{Z}_{n}$. The secret $\gamma$ will generate a Ed25519 keypair. The secret $\delta$ will generate the \texttt{Register} in $\mathbb{G}_{1}$ using the fixed generator, $g$. Alice will fund the address associated with the \texttt{VerificationKeyHash} with enough Lovelace to pay for the minimum required Lovelace for the contract UTxO, the change UTxO, and the transaction fee. Alice may then build the re-encryption entry transaction.

The re-encryption entry transaction will contain a single input and two outputs. The transaction will mint a \texttt{token} using the \texttt{EntryEncryptionMint} redeemer. The \texttt{token} name is generated by the concatentation of the input's output index and transaction id as shown in the Listing \ref{lst:gentkn}. The specification for the protocol assumes a single input but in general many inputs may be used in this transaction. If more than one input exists then the first input of a lexicographically sorted input list will be used for the name generation.

```{=latex}
\begin{lstlisting}[
  style=rust,
  caption={Token name generation},
  label={lst:gentkn},
  float,
  floatplacement=H
]
/// Example Usage:
/// input = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef#24"
/// token_name = "181234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd"
///
pub fn generate_token_name(inputs: List<Input>) -> AssetName {
  let input: Input = builtin.head_list(inputs)
  let id: TransactionId = input.output_reference.transaction_id
  let idx: Int = input.output_reference.output_index
  id |> bytearray.push(idx) |> bytearray.slice(0, 31)
}
\end{lstlisting}
```

Alice may now finish building the \texttt{EncryptionDatum} by constructing the \texttt{levels} and \texttt{capsule} fields. Since Alice is the first owner, she will encrypt to herself. Alice will encrypt the original data by generating a root $\kappa$ in $\mathbb{G}_{T}$. The root secret will be used in the KDF to produce a valid AES key. The message will be encrypted using AES-GCM. The resulting information is stored in the \texttt{Capsule} type. Listing \ref{lst:first-level} is a pythonic psuedocode for generating the original encrypted data and the first encryption level.

```{=latex}
\begin{lstlisting}[style=python, caption={Creating the Encrypted data and first encryption level}, label={lst:first-level}, float, floatplacement=H]

message = "This is a secret message."

# generate random data for the first encryption level
a0 = rng()
r0 = rng()
k0 = random_fq12(a0)

# alice as a register, sk is the secret key
alice = Register(sk)

# generate the r terms
r1b = scale(g, r0)
r2_g1b = scale(g, a0 + r0*sk)

a = to_int(blake2b(r1b))
b = to_int(blake2b(r1b + r2_g1b))

c = combine(combine(scale(H1, a), scale(H2, b)), H3)
r4b = scale(c, r0)

# encrypt the message
nonce, aad, ct = encrypt(r1, k0, message)

\end{lstlisting}
```


```{=latex}
\begin{lstlisting}[
  style=rust,
  caption={Encryption data format},
  label={lst:actualfirstlevel},
  float,
  floatplacement=H
]
pub type EncryptionLevel {
  r1b,
  r2: EmbeddedGt {
    g1b: r2_g1b,
    g2b: None,
  },
  r4b,
}
pub type Capsule {
  nonce,
  aad,
  ct: ciphertext,
}
\end{lstlisting}
```

The sub-types can be populated as shown in Listing \ref{lst:actualfirstlevel}. The contract will validate the first encryption level using the assertion from Listing \ref{lst:validatefirstlevel}. Alice can prove to herself that the encryption level is valid by verifying the assertion in Listing \ref{lst:decryptfirstlevel}. Alice may now construct the full \texttt{EncryptionDatum} as shown in Listing \ref{lst:fullfirstdatum}.

```{=latex}
\begin{lstlisting}[style=python, caption={First level validation}, label={lst:validatefirstlevel}, float, floatplacement=H]
assert pair(g, r4b) = pair(r1b, c)
\end{lstlisting}
```

```{=latex}
\begin{lstlisting}[style=python, caption={Alice can decrypt the key}, label={lst:decryptfirstlevel}, float, floatplacement=H]
expected_k0 = pair(r2_g1b, H0) / pair(r1b, scale(H0, sk))
assert k0 == expected_k0
\end{lstlisting}
```

```{=latex}
\begin{lstlisting}[
  style=rust,
  caption={Full first level datum},
  label={lst:fullfirstdatum},
  float,
  floatplacement=H
]
pub type EncryptionDatum {
  owner_vkh,
  owner_g1,
  token: generate_token_name(inputs),
  levels: [
    EncryptionLevel {
      r1b,
      r2: EmbeddedGt {
        g1b: r2_g1b,
        g2b: None,
      },
      r4b,
    }
  ],
  capsule: Capsule {
    nonce,
    aad,
    ct: ciphertext,
  },
}
\end{lstlisting}
```

The entry redeemer verifies that Alice's \texttt{owner\_vkh} is valid via a simple Ed25519 signature as Alice needs a valid \texttt{vkh} to be able to remove the entry. The entry redeemer also verifies a valid \texttt{Register} via a Schnorr $\Sigma$-protocol \ref{alg:schnorrsig} as Alice needs this to decrypt her own data and it verifies that Alice binds her public value to the first encryption level via a binding proof \ref{alg:bindingsig}. After successfully creating a valid entry transaction and submitting it to the Cardano blockchain the encrypted data is ready to be traded.

Bob may now place a bid into the bid contract in an attempt to purchase the encrypted data from Alice. First, Bob selects a secret $[\gamma] \in \mathbb{Z}_{m}$ and $[\delta] \in \mathbb{Z}_{n}$. Similarily to Alice, the secret $\gamma$ will generate a Ed25519 keypair that will in turn generate the \texttt{VerificationKeyHash}, \texttt{vkh}, used on-chain in the Ed25519 signatures. The secret $\delta$ will generate the \texttt{Register} in $\mathbb{G}_{1}$ using the fixed generator, $g$. Bob will fund the address associated with \texttt{vkh} with enough Lovelace to pay for payment, the change UTxO, and the transaction fee. Bob may then build the bid entry transaction. Note that the protocol grows linearly thus the required Lovelace for some given encrypted message will increase over time, meaning Bob should contribute to the minimum required Lovelace for the encrypted data though this is not required on-chain.

The structure of the bid entry transaction is similar to the re-encryption entry transaction but using \texttt{EntryBidMint} instead of \texttt{EntryEncryptionMint}. The \texttt{pointer} token name is generated in the exact some way as the \texttt{token} name. Bob will create the \texttt{BidDatum}. The \texttt{token} name may be referenced on-chain from the re-encryption contract and the \texttt{pointer} is derived from the inputs as shown in Listing \ref{lst:fullbiddatum}.

```{=latex}
\begin{lstlisting}[
  style=rust,
  caption={Full Bid datum},
  label={lst:fullbiddatum},
  float,
  floatplacement=H
]
pub type BidDatum {
  owner_vkh,
  owner_g1,
  pointer: generate_token_name(inputs),
  token,
}
\end{lstlisting}
```
Similar to the re-encryption contract, the entry redeemer will verify Bob's \texttt{vkh} and the \texttt{Register} values in $\mathbb{G}_{1}$. This is important as the validity of these points will determine if Bob can decrypt the data after the re-encryption process. The value on the UTxO is price Bob is willing to pay for Alice to re-encrypt the data to his \texttt{Register}. There may be many bids but only one can be selected by Alice for the re-encryption transaction. For simplicity of the protocol, Bob will need to remove their old bids and recreate the bids for any nessecary price adjustments. Bob may remove his bid at any time.

Alice will select a bid UTxO from the bid contract and will do the re-encryption process using Bob's \texttt{Register} data. This step requires Alice to burn Bob's bid token, update the on-chain data to Bob's data, and create re-encryption proofs. This is the most important step as this is the tradability of both the token and the encrypted data. The re-encryption redeemer will provide all of the required proxy validation proofs. The PRE proofs are pairings between the original owner's \texttt{Register} values in $\mathbb{G}_{1}$, proving that the new owner's \texttt{Register} was used during the re-encryption process, resulting in a transfer of ownership and decryption rights. Listing \ref{lst:createnextlevel} is a pythonic psuedocode for generating the next encryption level.

```{=latex}
\begin{lstlisting}[style=python, caption={Generate the next level}, label={lst:createnextlevel}, float, floatplacement=H]
a1 = rng()
r1 = rng()
k1 = random_fq12(a1)

hk = to_int(k1)

r1b = scale(g, r1)
r2_g1b = combine(scale(g, a1), scale(bob_public_value, r1))

a = to_int(generate(r1b))
b = to_int(generate(r1b + r2_g1b))
c = combine(scale(H1, a), scale(H2, b))
r4b = scale(c, r1)

r5b = combine(scale(q, hk), scale(invert(H0), sk))
\end{lstlisting}
```

Bob's and Alice's encryption levels are shown in Listing \ref{lst:encryptionlevels}. The complete next encryption datum is shown in Listing \ref{lst:nextencryptiondatum}.

```{=latex}
\begin{lstlisting}[
  style=rust,
  caption={Bob's and Alice's encryption levels},
  label={lst:encryptionlevels},
  float,
  floatplacement=H
]
pub type EncryptionLevel {
  r1b,
  r2: EmbeddedGt {
    g1b: r2_g1b,
    g2b: None,
  },
  r4b,
}
pub type EncryptionLevel {
  r1b: alice.r1B,
  r2: EmbeddedGt {
    g1b: alice.r2_g1b,
    g2b: Some(r5b),
  },
  r4b: alice.r4b,
}
\end{lstlisting}
```

```{=latex}
\begin{lstlisting}[
  style=rust,
  caption={Bob's encryption datum},
  label={lst:nextencryptiondatum},
  float,
  floatplacement=H
]
pub type EncryptionDatum {
  owner_vkh: bob.owner_vkh,
  owner_g1: bob.owner_g1,
  token,
  levels: [
    EncryptionLevel {
      r1b,
      r2: EmbeddedGt {
        g1b: r2_g1b,
        g2b: None,
      },
      r4b,
    },
    EncryptionLevel {
      r1b: alice.r1B,
      r2: EmbeddedGt {
        g1b: alice.r2_g1b,
        g2b: Some(r5b),
      },
      r4b: alice.r4b,
    }
  ],
  capsule: Capsule {
    nonce,
    aad,
    ct: ciphertext,
  },
}
\end{lstlisting}
```

The contract will validate the re-encryption using a binding proof and two pairing proofs as shown in Listing \ref{lst:validatereencryption}. The first assertion follows Alice's first level validation, ensuring that the encryption level terms are consistent. The second assertion shows that Alice created the $r_{5}$ term correctly. Adding a SNARK for valid witness creation is left for later work.

```{=latex}
\begin{lstlisting}[style=python, caption={Validate the re-encryption process}, label={lst:validatereencryption}, float, floatplacement=H]
assert pair(g, bob.r4b) = pair(bob.r1b, c)
assert pair(g, alice.r5b) * pair(alice.u, H0) = pair(alice.witness, p)
\end{lstlisting}
```

Bob can now decrypt the root key by recursiving computing all the random $\mathbb{G}_{T}$ points as shown in Listing \ref{lst:decrypting}.

```{=latex}
\begin{lstlisting}[style=python, caption={Decrypting the secret message}, label={lst:decrypting}, float, floatplacement=H]

h0x = scale(H0, sk)
shared = h0x

for entry in encryption_levels:
    r1 = entry.r1

    if is_half_level(entry.r2):
        r2 = pair(entry.r2.g1, H0)
    else:
        r2 = pair(entry.r2.g1, H0) * pair(r1, entry.r2.g2)

    b = pair(r1, shared)
    key = fq12_encoding(r2 / b, F12_DOMAIN_TAG)
    k = to_int(key)
    shared = scale(q, k)

message = decrypt(r1, key, capsule.nonce, capsule.ct, capsule.aad)
\end{lstlisting}
```

# Security Model

The PEACE protocol needs to have reasonable security. In a real-world production setting, the protocol has a minimal attack surface. As a proof-of-concept, the protocol needs additional security to be production grade.

## Assumptions

This protocol is presented as a proof-of-concept and inherits standard assumptions from public-key cryptography and public blockchains. The assumptions below describe what must hold for the security claims in this document to be meaningful.

- Cryptographic assumptions hold: The security of the construction relies on standard hardness assumptions for the chosen primitives (pairing groups / discrete log), collision resistance / preimage resistance of the hash functions used (including domain separation), and unforgeability of any signature schemes used.

- Correct domain separation: All hashes used for hashing-to-scalar, Fiat–Shamir transcripts, and key derivations use fixed domain tags and unambiguous encodings. A domain-separation bug is treated as a critical security failure.

- Well-formed randomness: All secret scalars and nonces are sampled with high entropy and never reused where uniqueness is required. Randomness failures (poor RNG, nonce reuse, low-entropy secrets) are treated as catastrophic.

- Endpoint key safety: Alice’s and Bob’s long-term secret keys remain confidential. If keys are extracted from the wallet/device, confidentiality and authenticity guarantees for those parties do not hold.

- On-chain validation is authoritative: The ledger enforces the validator exactly as written (Aiken/Plutus semantics). Any check that is only performed off-chain is treated as advisory and not part of the security boundary.

- Proof system assumptions: If SNARKs/NIZKs are used, their required assumptions hold (soundness, and any additional properties needed for adversarial settings). If a trusted setup is used, the corresponding trapdoor (“toxic waste”) is assumed destroyed; otherwise, a transparent proof system must be used at the cost of performance.

- Chain security: The blockchain provides finality and censorship-resistance to the degree normally assumed for Cardano. Prolonged reorgs, validator bugs, or sustained censorship are out of scope.

- Scope boundary: The protocol does not assume (and does not attempt to enforce) that the plaintext has any particular meaning or quality, nor does it assume Bob will keep plaintext private after decryption. Those are handled as marketplace/legal/economic concerns rather than cryptographic properties.

## Trust Model

The protocol is designed to minimize trust between Alice and Bob. The smart contract is the source of truth for what is accepted as a valid re-encryption hop. Anything not enforced by the on-chain validator is treated as advisory.

We do not assume Alice or Bob are honest. Either party may attempt to cheat, submit malformed data, or abort mid-protocol. The proxy will be treated as semi-trusted at best: they may be offline, malicious, or compromised. Any compromised keys are treated as a serious failure.

We assume standard cryptographic hardness of the underlying primitives (pairings / discrete log, collision resistance of hashes, and signature unforgeability), and we assume endpoint key material is protected by the wallet/OS. A compromise of long-term keys (Alice/Bob/etc) is out of scope except where explicitly mitigated (e.g., domain separation and on-chain binding checks).

## Threat Analysis

**Adversary capabilities**

- Full network observer: can read all on-chain data, replay transactions, and correlate timing/amount patterns.

- Active attacker: can submit arbitrary transactions, craft malformed ciphertext/proofs, and attempt to use validator failures/success as an oracle.

- Insider attacker: Alice or Bob may act maliciously (sell garbage, withhold finalization, attempt to claim funds without delivering the correct re-encryption).

- Key compromise: theft of a participant’s secret keys is possible.

**Primary threats and mitigations**

- Invalid re-encryption accepted on-chain: mitigated by strict on-chain validation that binds ciphertext components, public keys, and transcript hashes to the expected relations.

- Related-ciphertext / CCA-style probing: mitigated by making ciphertexts and re-encryption steps non-malleable under the on-chain checks (proofs must bind all relevant fields so “tweaks” are rejected).

- Multi-hop bypass: if downstream decryption reveals intermediate artifacts that can be used to decrypt upstream ciphertexts without the proxy, it breaks the intended delegation boundary; mitigation is hop-level re-randomization / re-encapsulation and careful design to ensure decryption yields only plaintext (not reusable upstream capabilities).

- Fairness failure (abort/grief): either party can stop cooperating; mitigations are economic (bonding/escrow) and protocol flow design, not cryptography alone.

## Metadata Leakage

The protocol runs on a public UTxO ledger, so metadata leakage is unavoidable.

**Potential leakage includes:**

- Transaction graph linkage: repeated verification keys, registers, UTxO patterns, and timing can link multiple protocol runs to the same actors or workflow.

- Protocol fingerprinting: ciphertext sizes, hop count, and datum/redeemer structure can reveal which step the protocol is in and correlate participants across transactions.

- Value and timing leakage: amounts, fees, and time between steps can reveal trade size, urgency, and repeated counterparties.

- Key / identity linkage via commitments: even when values are hashed, fixed-format commitments and domain tags can still be fingerprinted if reused or if inputs have low entropy.

**Mitigations are partial and operational:**

- Rotate addresses and avoid stable identifiers where possible

- Minimize on-chain datum content.

- Keep encodings fixed-size and avoid optional fields that create distinct shapes.

- Treat privacy as a separate layer (mixing, batching, relayers) rather than something the core protocol guarantees.

## Limitations And Risks

- No guarantee of data semantics or quality: the protocol can prove key-binding and correct re-encryption relations, but it cannot prove that the encrypted content is “valuable” or matches an off-chain description. Disputes about semantics require external mechanisms.

- No protection after decryption: once Bob decrypts plaintext, Bob can copy or leak it. Cryptography cannot prevent exfiltration; only economic/legal controls can reduce this risk.

- Fair exchange is not automatic: either party can abort or grief at different stages. Achieving strong fairness typically requires escrow/bonding, timeouts, and explicit protocol-level incentives.

- Key compromise is catastrophic: theft of Alice/Bob secret keys breaks confidentiality for those assets; compromise of any proxy signing keys (if used) may enable malformed ciphertext acceptance unless the system is publicly verifiable.

- CCA security depends on strict non-malleability: if any ciphertext/proof field can be modified while still passing on-chain checks, an attacker may use acceptance/rejection or decryption behavior as an oracle. Proofs must bind the full transcript and all ciphertext components.

- Multi-hop complexity: limiting hops by UTxO size reduces state growth, but multi-hop designs are error-prone; additional formal review is recommended before treating multi-use delegation as production-secure.

- Cost and reliability risk: pairing-heavy verification and SNARK verification can approach the CPU budget, requiring multi-transaction validation flows. This increases complexity and can reduce UX reliability under network congestion.

## Performance And On-Chain Cost

The performance of the re-encryption process is really good. The generation of the proofs are quick. The encryption setup is easy. The PRE flow is simple. The cost of running the re-encryption validation leans towards the expensive side. The Schnorr and binding proofs are relatively cheap but the pairing proofs are expensive. A single pairing proof cost almost 15% of the total cpu budget per transaction. In a real-world production setting, the re-encryption step may max out the cpu budget completely because of the SNARK requirement. In that case, the re-encryption validation may need to be broken up into multiple transaction such that the cpu budget per transaction remains low enough to be valid on-chain.

# Conclusion

The PEACE protocol multi-use, unidirectional PRE for the Cardano blockchain with reasonable security guantees. This proof-of-concept should serve well for production grade implementations. A real-world production grade PEACE protocol will allow creators, collectors, and developers to trade encrypted NFTs without relying on centralized decryption services.

\clearpage
\appendix

# Appendix A - Proofs {#app:proofs}

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
