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
  - proxy re-encryption
  - ECIES
  - AES-GCM
rights: © 2025 Logical Mechanism LLC. All rights reserved.
header-includes:
  - \usepackage{fancyhdr}
  - \usepackage{amsmath,amssymb,amsthm}
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

In this report, we introduce the PEACE protocol, an ECIES-based, multi-hop, bidirectional proxy re-encryption scheme for Cardano. PEACE solves the encrypted-NFT problem by providing a decentralized, open-source protocol for transferable encryption rights, enabling creators, collectors, and developers to manage encrypted NFTs without relying on centralized decryption services. This work fills a significant gap in secure, private access to NFTs on Cardano. The PEACE protocol was funded in round 14 of Project Catalyst[^fund].

[^fund]: https://projectcatalyst.io/funds/14/cardano-use-cases-concepts/decentralized-on-chain-data-encryption

# Introduction

The encrypted NFT problem is one of the most significant issues with current NFT standards on Cardano. Either the data is not encrypted, available to everyone who views the nft, or the data encryption requires some form of centralization, some company doing the encryption on behalf of users. Current solutions [@stuffio-whitepaper] claim to offer decentralized encrypted assets (DEA), but lack a publicly available, verifiable cryptographic protocol or an open-source implementation. Most, if not all, of the mechanics behind current DEA solutions remain undisclosed. This report aims to fill that knowledge gap by providing an open-source implementation of a decentralized encryption protocol for encrypted assets on Cardano.

The encryption protocol must allow tradability of both the NFT itself and the right to decrypt the NFT data, implying that the solution must involve smart contracts and a form of encryption that allows data to be re-encrypted for another user without revealing the encrypted content in the process. The contract side of the protocol should be reasonably straightforward. It needs a way to price a token, to hold the encrypted data, and allow other users to purchase the token. To ensure tradability, the tokens may need to be soulbound. On the other side of the protocol is the encryption required to make this all work. Luckily, this type of encryption has been in cryptography research for quite some time [@mambo-okamoto-1997] [@blaze-bleumer-strauss-1998] [@ateniese-et-al-ndss2005]. There are even patented cloud-based solutions already in existence [@ironcore-recrypt-rs]. There is no open-source, fully on-chain, decentralized encryption protocol for encrypting NFT data on Cardano. The PEACE protocol aims to solve this problem.

The solution the PEACE protocol will implement is an ambitious yet well-defined bidirectional multi-hop proxy re-encryption scheme that uses ECIES [@ieee-1363a-2004] and AES [@fips-197]. Bidirectionality means that Alice may re-encrypt for Bob, and sequentially Bob may re-encrypt back to Alice. Bidirectionality is important for tradability, as there should be no restriction on who can purchase the NFT. Multi-hop means that the flow of encrypted data from Alice to Bob to Carol, and so on, does not end, in the sense that it cannot be re-encrypted for a new user. Multi-hopping is important for tradability, as a single tradable asset does not fit many use cases. An asset should always be tradable if the user wants to trade it. The encryption mechanisms used in the protocol are considered industry standards at the time of this report.

The remainder of this report is as follows. Section 4 discusses the preliminaries and background required for this project. Section 5 will be a brief overview of the required cryptographic primitives. Section 6 will be a detailed description of the protocol. Sections 7, 8, and 9 will dive into the security and threat analysis, and limitations of the protocol, respectively. The goal of this report will be to serve as a go-to reference and description of the PEACE protocol.

# Background And Preliminaries

Understanding the protocol will require some technical knowledge of modern cryptographic methods, a small amount of the arithmetic of elliptic curves, and just a pinch of knowledge about smart contracts on Cardano. Anyone comfortable with these topics will find this report very useful and easy to follow. The report will attempt to use research standards for terminology and notation. The elliptic curve used in this protocol will be BLS12-381 [@bowe-bls12-381-2017]. Aiken [@aiken-lang-site] is used to write all required smart contracts for the protocol.

Table: Symbol Description [@elmrabet-joye-2017]

| Symbol | Description |
|:-----:|-------------|
| $p$ | A prime number |
| $\mathbb{F}_{p}$ | The finite field of characteristic $p$ |
| $E(\mathbb{F}_{p})$ | An elliptic curve $E$ defined over $\mathbb{F}_{p}$ |
| $E'$ | A twisted elliptic curve of $E$ |
| $\#E(\mathbb{F}_{p})$ | The order of $E(\mathbb{F}_{p})$ (also denoted $n$) |
| $r$ | A prime number dividing $\#E(\mathbb{F}_{p})$ |
| $\delta$ | A non-zero integer in $\mathbb{Z}_{n}$ |
| $\mathcal{O}$ | The point at infinity of an elliptic curve $E$ |
| $\mathbb{G}_{1}$ | A subgroup of order $r$ of $E(\mathbb{F}_{p})$ |
| $\mathbb{G}_{2}$ | A subgroup of order $r$ of the twist $E'(\mathbb{F}_{p^{2}})$ |
| $\mathbb{G}_{T}$ | The multiplicative target group of the pairing: $\mu_r \subset \mathbb{F}_{p^{12}}^{\*}$ |
| $e: \mathbb{G}_{1} \times \mathbb{G}_{2} \to \mathbb{G}_{T}$ | A type-3 bilinear pairing |
| $R$ | A random oracle for the Fiat-Shamir transform |

The protocol, both the on-chain and off-chain components, will make heavy use of the `Register` type. The `Register` stores a generator, $g \in \mathbb{G}_{1}$ and the corresponding public value $u = [\delta]g$ where $\delta \in \mathbb{Z}_{n}$ is a secret. We shall assume that the hardness of ECDLP and CDH in $\mathbb{G}_{1}$ and $\mathbb{G}_{2}$ will result in the inability to recover the secret $\delta \in \mathbb{Z}_{n}$. When using a pairing, we additionally rely on the standard bilinear Diffie-Hellman assumptions over $( \ \mathbb{G}_{1}, \mathbb{G}_{2}, \mathbb{G}_{T}\ )$. We will represent the groups $\mathbb{G}_{1}$ and $\mathbb{G}_{2}$ with additive notation and $\mathbb{G}_{T}$ with multiplicative notation.

The `Register` type in Aiken:

```rust
pub type Register {
  // the generator, #<Bls12_381, G1>
  generator: ByteArray,
  // the public value, #<Bls12_381, G1>
  public_value: ByteArray,
}
```

Where required, we will verify Ed25519 signatures [@rfc8032] as a cost-minimization approach; relying solely on pure BLS12-381 for simple signatures becomes costly on-chain. There will be instances where the Fiat-Shamir transform [@fiat-shamir-1986] will be applied to a $\Sigma$-protocols for non-interactive purposes. In theses cases, the hash function will be the Blake2b-256 hash function [@rfc7693].

# Cryptographic Primitives Overview

This section provides brief explanations of the cryptographic primitives required by the protocol. Where applicable, an algorithm describing the primitives will be in its respective algorithm segment. The `Register` type will be a tuple, $\ ($ $g, u\ )$, for simplicity inside the algorithms. We shall assume that the decompression of the $\mathbb{G}_1$ points is a given. Proofs for many algorithms are in Appendix A.

There may be instances where we need to create a new `Register` from an existing `Register` [@ergo-sigma-join] via a re-randomization. The random integer $\delta'$ is considered toxic waste. Randomization allows a public register to remain stealthy, which can be beneficial for data privacy and ownership.

\begin{algorithm}[H]
\caption{Re-randomization of the Register type}
\label{alg:rerandom}

\KwIn{$\ ($ $g, u\ )$ where $g \in \mathbb{G}_1$, $u=[\delta]g \in \mathbb{G}_1$}
\KwOut{$\ ($ $g', u'\ )$}

select a random $\delta' \in \mathbb{Z}_{n}$

compute $g' = [\delta']g$ and $u' = [\delta']u$

output $\ ($ $g', u'\ )$
\end{algorithm}

The protocol may require proving knowledge of a user's secret using a Schnorr $\Sigma$-protocol [@thaler-pazk-2022] [@schnorr1991]. This algorithm is perfectly complete and zero-knowledge, which is precisely what we need in this context. We can use simple Ed25519 signatures for spendability, and then use the Schnorr $\Sigma$-protocol for knowledge proofs for encryption. We will make the protocol non-interacting via the Fiat-Shamir transform.

\begin{algorithm}[H]
\caption{Non-interactive Schnorr's $\Sigma$-protocol for the discrete logarithm relation}
\label{alg:schnorrsig}

\KwIn{$\ ($ $g, u\ )$ where $g \in \mathbb{G}_1$, $u=[\delta]g \in \mathbb{G}_1$}
\KwOut{\textsf{bool}}

select a random $\delta' \in \mathbb{Z}_{n}$

compute $a = [\delta']g$

calculate $c = R(g, u, a)$

compute $z = \delta*c + \delta'$

output $[z]g = a + [c]u$
\end{algorithm}

## ECIES + AES-GCM

The Elliptic Curve Integrated Encryption Scheme (ECIES) is a hybrid protocol involving asymmetric cryptography
with symmetric ciphers. The encryption used in ECIES is the Advanced Encryption Standard (AES). ECIES and AES combined with a key derivation function (KDF) like Argon2 [@rfc9106] create a complete encryption system.

\begin{algorithm}[H]
\caption{Encryption using ECIES + AES}
\label{alg:eciesaes}

\KwIn{$\ ($ $g, u\ )$ where $g \in \mathbb{G}_1$, $u=[\delta]g \in \mathbb{G}_1$, m as the message}
\KwOut{$\ ($ $r, c, h\ )$ }

select a random $\delta' \in \mathbb{Z}_{n}$

compute $r = [\delta']g$

compute $s = [\delta']u$

generate $k = KDF(s | r)$

encrypt $c = AES(m, k)$


\end{algorithm}

## Proxy Re-Encryption

# Protocol Overview

## Design Goals And Requirements

## On-Chain And Off-Chain Architecture

## Key Management And Identity

## Protocol Specification

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

# Appendix A — Security Proofs {#app:proofs}

\begin{proof}
Since $Z=[r]X=[r][y]g=[y][r]g=[y]R=Z'$, both parties derive the same $K$; AEAD decryption then yields $m$.
\end{proof}

<!-- Add a page between the appendix and the bib -->
\clearpage
