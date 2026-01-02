A. Output: Comprehensive testing phase for the encryption protocol, including both on-chain and off-chain validation, covering good-path and bad-path scenarios to demonstrate protocol reliability.

Acceptance criteria: Testing coverage and reliability are demonstrated through executed tests for both expected (good path) and failure (bad path) scenarios; publicly available on GitHub with reproducible documentation and verification artifacts.

Evidence:
- Public repo (Milestone 3 tests + docs): https://github.com/logical-mechanism/peace-protocol
- Test plan / coverage summary (good-path + bad-path): https://github.com/logical-mechanism/peace-protocol/blob/main/app/coverage.txt


B. Output: Smart contracts compile successfully (Aiken build is clean).

Acceptance criteria: All on-chain smart contracts compile successfully without errors.

Evidence:
- Aiken contract source directory: https://github.com/logical-mechanism/peace-protocol/tree/main/app/contracts
- Test instructions (README section): https://github.com/logical-mechanism/peace-protocol/tree/main/app/contracts#testing
- Build instructions (README section): https://github.com/logical-mechanism/peace-protocol/tree/main/app/contracts#compiling


C. Output: All on-chain and off-chain tests executed successfully.

Acceptance criteria: All available tests run and pass (on-chain + off-chain) at the time of milestone submission.

Evidence:
- Off-chain scripts directory (Python/Bash): https://github.com/logical-mechanism/peace-protocol/tree/main/app/commands
- Configuration + cardano-cli integration (config files + usage): https://github.com/logical-mechanism/peace-protocol/blob/main/app/README.md#happy-path-usage
- Example command transcript (transactions): https://github.com/logical-mechanism/peace-protocol/blob/main/app/feasibility.md


D. Output: Transaction hashes demonstrate end-to-end functionality on Cardano pre-production (preprod) network.

Acceptance criteria: A list of transaction hashes is provided, and each tx demonstrates successful end-to-end operation of the protocol on preprod (encrypt → state transitions/trade/access control → decrypt or equivalent full flow).

Evidence:
- Preprod transaction hash list (canonical list in repo): https://github.com/logical-mechanism/peace-protocol/blob/main/app/feasibility.md
- Verification instructions (how to inspect tx on-chain, what fields to check): https://github.com/logical-mechanism/peace-protocol/blob/main/app/commands/README.md


E. Output: Off-chain tests pass and validate integration between smart contracts and off-chain logic.

Acceptance criteria: Off-chain tests validate the integration boundary:
- off-chain code constructs transactions correctly,
- interacts with compiled validators correctly,
- produces expected on-chain state transitions and/or validation outcomes,
- includes negative/bad-path assertions where applicable.

Evidence:
- Single command to run tests + expected output (docs): https://github.com/logical-mechanism/peace-protocol/blob/main/app/run_tests.sh
- Documentation for running these tests locally (dependencies/env vars): https://github.com/logical-mechanism/peace-protocol/tree/main/app#testing


F. Output: Comprehensive documentation for reproducing tests, executing commands, and verifying results.

Acceptance criteria: Documentation includes:
- how to set up environment,
- how to compile contracts,
- how to run on-chain tests and off-chain tests,
- how to reproduce end-to-end preprod runs,
- how to verify transaction hashes and expected outcomes.

Evidence:
- Setup guide: https://github.com/logical-mechanism/peace-protocol/tree/main/app#happy-path-setup
- Test execution guide (on-chain + off-chain): https://github.com/logical-mechanism/peace-protocol/tree/main/app#happy-path-usage


G. Output: Timestamped publication evidence (immutable reference to exactly what was delivered).

Acceptance criteria: Evidence is tied to a specific public commit/tag/release so reviewers can verify the exact state at submission time.

Evidence:
- Milestone 3 PR: https://github.com/logical-mechanism/peace-protocol/pull/8
