# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | Yes       |
| < 0.2   | No        |

## Reporting a Vulnerability

If you discover a security vulnerability in the PEACE Protocol, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Email: support@logicalmechanism.io

Please include:

- Description of the vulnerability
- Steps to reproduce
- Which component is affected (contracts, Python CLI, Go prover, UI)
- Potential impact assessment

We will acknowledge receipt within 72 hours and aim to provide a fix or mitigation plan within 30 days.

## Scope

The following components are in scope for security reports:

- Aiken smart contracts (`app/contracts/validators/`)
- Cryptographic operations (`app/src/`, `app/snark/`)
- Key management and encryption flows
- On-chain datum handling and validation logic

The following are out of scope:

- The reference contract (intentionally minimal, always-true by design)
- UI-only bugs that do not affect on-chain security
- Denial-of-service through Cardano network congestion

## Security Audits

- [Smart Contract Audit](./app/contracts/claude-audit.md)
- [SNARK Prover Audit](./app/snark/claude-audit.md)
- [Technical Report](./documentation/technical_report.pdf)
