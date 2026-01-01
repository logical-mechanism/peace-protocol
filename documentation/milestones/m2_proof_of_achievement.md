A. Output: Minimum Viable Product (MVP) implementation of the encryption protocol, including on-chain smart contracts (Aiken) and off-chain components (Python/Bash), demonstrating the happy-path flow for decentralized encryption and decryption.

Acceptance criteria: MVP implementation exists and demonstrates functional integration between on-chain and off-chain components; includes reproducible scripts/config for cardano-cli usage; publicly available on GitHub with basic documentation and usage instructions.

Evidence:
- Public repo (MVP source + docs): https://github.com/logical-mechanism/peace-protocol
- MVP overview / usage docs (setup + run instructions): https://github.com/logical-mechanism/peace-protocol/blob/main/app/README.md


B. Output: On-chain smart contracts compile successfully in Aiken.

Acceptance criteria: All on-chain Aiken contracts compile successfully without errors.

Evidence:
- Aiken contract source directory: https://github.com/logical-mechanism/peace-protocol/tree/main/app/contracts
- Test instructions (README section): https://github.com/logical-mechanism/peace-protocol/tree/main/app/contracts#testing
- Build instructions (README section): https://github.com/logical-mechanism/peace-protocol/tree/main/app/contracts#compiling


C. Output: Off-chain components (Python/Bash) execute correctly.

Acceptance criteria: Off-chain scripts run successfully and produce the expected artifacts/transactions for the happy path.

Evidence:
- Off-chain scripts directory (Python/Bash): https://github.com/logical-mechanism/peace-protocol/tree/main/app/commands
- Configuration + cardano-cli integration (config files + usage): https://github.com/logical-mechanism/peace-protocol/blob/main/app/README.md#happy-path-usage
- Example command transcript (transactions): https://github.com/logical-mechanism/peace-protocol/blob/main/app/feasibility.md


D. Output: On-chain tests confirming encrypted data behaves as designed (access control + asset tradability).

Acceptance criteria: On-chain tests demonstrate:
1) encrypted datum/state transitions follow the protocol,
2) correct access control is enforced (only intended party can progress/decrypt),
3) assets remain tradable as designed during the encrypted state.

Evidence:
- On-chain tests directory: https://github.com/logical-mechanism/peace-protocol/tree/main/app/contracts/lib/tests


E. Output: All tests available at this stage pass successfully.

Acceptance criteria: All implemented tests (unit/integration/on-chain simulation) pass in the repository at the time of submission.

Evidence:
- Single command to run tests + expected output (docs): https://github.com/logical-mechanism/peace-protocol/blob/main/app/run_tests.sh


F. Output: Reproducibility and transparency package (documentation + scripts + configuration).

Acceptance criteria: Repository contains:
- source code (Aiken + Python/Bash),
- documentation for setup/compilation/testing,
- scripts/configuration needed to reproduce the happy path using cardano-cli.

Evidence:
- Setup Instructions: https://github.com/logical-mechanism/peace-protocol/blob/main/app/README.md#happy-path-setup


G. Output: Verified test results confirming proper functioning of the happy path.

Acceptance criteria: Proof that the happy path works end-to-end (not just “code exists”), with inspectable logs/results.

Evidence:
- Test output artifact (saved log file): https://github.com/logical-mechanism/peace-protocol/blob/main/app/feasibility.md


H. Output: Timestamped publication evidence (immutable).

Acceptance criteria: Evidence is tied to a specific public commit/tag/release so reviewers can verify exactly what was delivered at milestone submission time.

Evidence:
- Milestone 2 PR: https://github.com/logical-mechanism/peace-protocol/pull/7
