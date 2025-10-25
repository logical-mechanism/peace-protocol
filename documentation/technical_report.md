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
  - \usepackage{amsmath,amssymb}
  - \numberwithin{equation}{section}
  - \usepackage{etoolbox}
  - \usepackage[dvipsnames]{xcolor}
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

The encryption protocol must allow tradability of both the NFT itself and the right to decrypt the NFT data, implying that the solution must involve smart contracts and a form of encryption that allows data to be re-encrypted for another user without revealing the encrypted content in the process. The bright contract side of the protocol should be reasonably straightforward. It needs a way to price a token to hold the encrypted data and allow other users to receive it. To ensure tradability, the tokens may need to be soulbound. On the other side of the protocol is the encryption required to make this all work. Luckily, this type of encryption has been in cryptography research for quite some time [@mambo-okamoto-1997] [@blaze-bleumer-strauss-1998] [@ateniese-et-al-ndss2005]. There are even patented cloud-based solutions already in existence [@ironcore-recrypt-rs]. There is no open-source, fully on-chain, decentralized encryption protocol for encrypting NFT data on Cardano. The PEACE protocol aims to solve this problem.

The solution the PEACE protocol will implement is an ambitious yet well-defined bidirectional multi-hop proxy re-encryption scheme that uses ECIES [@ieee-1363a-2004] and AES [@fips-197]. Bidirectionality means that Alice may re-encrypt for Bob, and sequentially Bob may re-encrypt back to Alice. Bidirectionality is important for tradability, as there should be no restriction on who can purchase the NFT. Multi-hop means that the flow of encrypted data from Alice to Bob to Carol, and so on, does not end, in the sense that it cannot be re-encrypted for a new user. Multi-hopping is important for tradability, as a single tradable asset does not fit many use cases. An asset should always be tradable if the user wants to trade it. The encryption mechanisms used in the protocol are considered industry standards at the time of this report.

The remainder of this report is as follows. Section 4 discusses the preliminaries and background required for this project. Section 5 will be a brief overview of the required cryptographic primitives. Section 6 will be a detailed description of the protocol. Sections 7, 8, and 9 will dive into the security and threat analysis, and limitations of the protocol, respectively. The goal of this report will be to serve as a go-to reference and description of the PEACE protocol.

# Background And Preliminaries

# Cryptographic Primitives Overview

## ECIES

## AES-GCM

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
