# Task 1 — Land the Stellar carbon rail (UKCO2) in UnyKorn-Carbon

FORGE-CLASS: entity=UnyKorn LLC  sec=HIGH  claims=REGULATED  custody=NONE  hearth=NONE  chain=NONE(this task)/ISSUE(gated follow-on)  surface=INTERNAL

Routing verdict: FULL FORGE for review (sec=HIGH: code path can sign with STELLAR_SECRET_* env keys; claims=REGULATED: `well-known/stellar.toml` asserts `regulated = true` and "verified carbon credits"). The on-chain issue (chain=ISSUE) is NOT part of this task and stays behind a founder flag.

## What
Bring the Stellar rail authored in a claude.ai session on 2026-09-27 (patch `0001-Stellar-carbon-rail-regulated-UKCO2-asset-mint-retir.patch`, OneDrive 11-Downloads) into this repo on branch `stellar-rail`, prove it runs offline, put a test suite around it, review it adversarially, and fix what the review finds. Source of the code: the patch, read in full first-hand before apply (six source files + lockfile audit: 69 packages, registry.npmjs.org only, no install scripts).

## Why
The prior session could not reach this machine. The rail turns one tonne of verified reduction into one `UKCO2` unit with Stellar's native regulated-asset flags (AUTH_REQUIRED, AUTH_REVOCABLE, AUTH_CLAWBACK_ENABLED), retires units by paying them back to the issuer with a SHA-256 record hash as memo, and meters x402/MPP machine calls into batched retirements per ERC-8004 agent id.

## In scope
- Apply patch on `stellar-rail`; `npm ci`; `npm run typecheck`; `npm run stellar:demo` passes offline.
- Test suite (node:test, no new deps) for `src/stellar/rail.ts` and `src/stellar/offset.ts`, including negative cases.
- Adversarial review; fixes for Critical/Important findings on the same branch.
- Stellar mainnet account checker (`scripts/check-accounts.ts`): read-only Horizon lookups for public keys listed in a gitignored `accounts.txt`; writes `out/accounts-status.csv`; suggests issuer / treasury / agent-operator candidates.
- Commit(s) on `stellar-rail`. Push of the branch only.

## Out of scope (founder-gated)
- Merging to `main`; publishing `well-known/stellar.toml`; any testnet or mainnet submission; filling `classes/ukco2.json` with real keys; any REGULATED string going to a public surface.

## Acceptance criteria
1. `npm run typecheck` exits 0.
2. `npm run stellar:demo` exits 0 and reports 13 built+signed transactions and 1,000 metered calls.
3. `npm test` exits 0 with tests covering: issuer flags set; memo = sha256 of the exact record; `toAmount` never exceeds 7 decimals and never rounds UP mass that is not owed; retire pays to issuer; clawback op present; `maybeSign` never signs without the env secret; meter flushes at threshold and never drops calls; x402 price includes offset >= 1e-6.
4. Review report in `.forge/review-task-1.md` with severity-tagged findings; all Critical fixed.
5. No secret, seed, or private key in any committed file (grep for `S[A-Z2-7]{55}` returns nothing in tracked files).

## Security properties (each must be exercised by a test or by the reviewer)
- P1: A transaction built by `rail.ts` is never signed unless `STELLAR_SECRET_<ROLE>` is present at runtime.
- P2: Retirement memo commits to the record bytes; changing any field changes the memo.
- P3: `toAmount` output is a valid Stellar amount (<= 7 decimals, non-negative, no exponent notation).
- P4: The demo prints no secret key material.

## Claims touched
`well-known/stellar.toml`: "regulated = true", "Verified carbon credits", `is_asset_anchored = true`, ORG_PHYSICAL_ADDRESS. All remain INTERNAL (file is not served) until a marketing-copy ADR + counsel pass. See founder-flags.
