---
title: "The PEACE Protocol\\thanks{This project was funded in Fund 14 of Project Catalyst.}"
subtitle: "A protocol for decentralized encrypted data exchange."
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

Test Citation [@schnorr1991]

Inline sanity: let $x\in\mathbb{Z}_q$, $u\in\mathbf{G}_1$, $Q\in\mathbf{G}_2$, and $E=mc^2$.

\begin{equation}\label{eq:aead}
c \;=\; \mathrm{AEAD}_{k}\!\big(m;\ \mathsf{nonce},\ \mathsf{ad}\big).
\end{equation}

As in \eqref{eq:aead}, we encrypt with key $k$ derived via HKDF:
\begin{align}
\mathrm{ikm} &= H\!\left(\mathrm{ECDH}\big(u,\ \mathrm{pk}_B\big)\right),\\
k &= \mathrm{HKDF}\!\left(\mathrm{salt},\ \mathrm{ikm},\ \text{``PEACE-AES-GCM''},\ 32\right). \tag{\*}
\end{align}

\begin{equation*}
\mathrm{Dec}_k(c) \;=\;
\begin{cases}
m, & \text{if } \mathrm{AEAD\_Dec}_k(c;\ \mathsf{nonce},\ \mathsf{ad}) \text{ verifies},\\[0.25em]
\perp, & \text{otherwise.}
\end{cases}
\end{equation*}

\begin{equation*}
M \;=\;
\begin{bmatrix}
1 & 0\\
0 & 1
\end{bmatrix},
\qquad
\lVert u \rVert_2 \leq 1,
\qquad
\Pr[\text{forge}] \le 2^{-\lambda}.
\end{equation*}

\begin{equation*}
S(n)=\sum_{i=1}^n i \;=\; \frac{n(n+1)}{2},
\qquad
\int_0^1 x^2\,dx=\frac{1}{3}.
\end{equation*}
