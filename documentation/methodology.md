# Milestone 1 Methodology (PEACE Protocol)

This document summarizes the methodology used to produce the Milestone 1 technical research report. It provides quick pointers to the corresponding sections of the report for verification.

## Scope of Milestone 1

Milestone 1 delivers a research-style technical report analyzing ECIES, proxy re-encryption (PRE), and AES-GCM in the context of on-chain data encryption in the Cardano (UTxO) setting. The milestone is documentation-focused: it specifies the protocol design, cryptographic primitives, security model/assumptions, threat analysis, and on-chain performance considerations.

**Primary deliverable:**

- Technical report (PDF): https://github.com/logical-mechanism/peace-protocol/blob/main/documentation/technical_report.pdf  
- Technical report (Markdown): https://github.com/logical-mechanism/peace-protocol/blob/main/documentation/technical_report.md  

## Methodology Summary

The report uses a design-and-analysis methodology:

1. **Requirements & constraints capture**

   - Identified constraints specific to on-chain execution (UTxO size limits, validator execution cost, limited cryptographic primitives, and off-chain/on-chain boundary design).

   - Defined the security objective: confidentiality of encrypted content with controlled delegation of decryption capability via PRE.

2. **Primitive selection and protocol composition**

   - Selected ECIES-style encapsulation for key agreement/transport, AES-GCM for symmetric authenticated encryption, and PRE to enable delegated re-encryption without exposing plaintext.

   - Composed primitives into an end-to-end protocol suitable for a passive-validator environment.

3. **Security modeling**

   - Defined the trust model and explicit assumptions necessary for correctness and security in the target environment.

   - Identified assets, adversaries, and security goals (confidentiality, integrity/authenticity where applicable, and delegation properties).

4. **Threat analysis & mitigations**

   - Performed structured threat analysis focusing on likely attack surfaces in an on-chain setting (metadata leakage, key compromise, replay/replace risks, misuse of re-encryption capability, operational risks).

   - Documented limitations and mitigations, including what is out of scope for this milestone.

5. **Performance considerations**

   - Evaluated feasibility and constraints for on-chain usage (cost/size/complexity tradeoffs, impact of multiple hops, and practical limits).

## Where this appears in the report (verification map)

- Research-paper structure: Abstract (Section 1), Introduction (Section 2), Background (Section 3), Conclusion (Section 7), Bibliography

- Cryptographic primitives and protocol: Sections 4–5
  - ECIES + AES-GCM: Section 4.2
  - PRE / re-encryption: Section 4.3
  - Protocol overview/specification: Sections 5.1–5.4

- Security assessment: Section 6
  - Assumptions: Section 6.1
  - Trust model: Section 6.2
  - Threat analysis: Section 6.3
  - Metadata leakage: Section 6.4
  - Limitations/risks: Section 6.5
  - Performance/on-chain cost: Section 6.6

## Timestamped publication evidence

- Milestone 1 PR (merge history): https://github.com/logical-mechanism/peace-protocol/pull/2

- (Optional) Tag/release for milestone verification: add `milestone-1` tag or GitHub release pointing to the exact report version.
