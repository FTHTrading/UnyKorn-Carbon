# ADR-0001: UKCO2 issuance design — Stellar classic asset vs Base ERC-20

- **Status:** Proposed (blocked on founder flag F-1 in `.forge/founder-flags.md`)
- **Date:** 2026-09-27
- **Deciders:** Kevan (owner), Claude (implementer)
- **Scope:** Cross-cutting — carbon rail

## Context
Two implementations of a one-tonne-per-unit UnyKorn carbon token were produced on 2026-09-27 in separate sessions:

1. **Stellar classic asset** (`src/stellar/`, this branch). Regulated-asset behaviour comes from protocol flags (AUTH_REQUIRED, AUTH_REVOCABLE, AUTH_CLAWBACK_ENABLED); no custom contract. Retirement = payment back to issuer with a SHA-256 record hash as memo. 7-decimal amounts allow per-API-call retirement (0.1 g). Offline demo: 13 txs built and signed, 1,000 metered calls → 0.423 kg retired.
2. **Base ERC-20 + reserve vault** (`ukco2-base.zip`, OneDrive 11-Downloads, not extracted). Hardhat, OpenZeppelin 5, 50M hard cap, batch-gated minting, freeze/wipe, KYC mode, permit; vault with time-locked, per-day-capped releases. Not run here.

The TerraNova/Triangle review (same day) showed the failure mode to avoid: a single EOA owner with mint, admin-transfer, burn, upgrade and kill-switch powers over holders, and no on-chain link to registry serials.

## Decision
None yet. This ADR records the options so the founder can choose. The Stellar rail is the only one integrated, tested and reviewed in this repo.

## Trade-offs
| | Stellar classic asset | Base ERC-20 |
|---|---|---|
| Custom contract risk | none (protocol flags) | full (audit required) |
| Issuer power over holders | freeze + clawback, native, visible in flags | freeze/wipe/upgrade as coded |
| Multisig for issuer key | native thresholds/signers | needs Safe + role split |
| Precision | 7 decimals | 18 decimals |
| x402/USDC settlement co-location | separate rail from USDC-on-Base | same chain as x402 USDC |
| Wallet/exchange reach | Stellar wallets, SEP-1 toml | EVM wallets, broad DeFi reach |
| Registry linkage | manage_data entries (serialRoot, dataRoom) | batch struct + proof hash |

## Consequences
- Until F-1 resolves, nothing is issued on either chain (testnet included).
- Whichever design is chosen must put the issuer/admin key under a multisig before any third party holds units (the exact defect found in Triangle's contract).
- Both designs currently name credits UnyKorn does not control (Triangle/TerraNova batch, DEMO batch). A real batch under UnyKorn's title or a signed lock evidence is a precondition for mainnet (F-4).

## Related
`.forge/task-1-brief.md`, `.forge/founder-flags.md`, memory `project_carbon_repo_moved_d_usb_failing_2026_09_27`.
