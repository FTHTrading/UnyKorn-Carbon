# Founder Flags — Kevan sign-off required (UnyKorn-Carbon / stellar-rail)

## OPEN FLAGS

### F-1 (BLOCKS: merge to main) — Accept the Stellar rail as the carbon issuance design
**Question:** Approve `UKCO2` as a Stellar classic asset with AUTH_REQUIRED + AUTH_REVOCABLE + AUTH_CLAWBACK_ENABLED, retire-by-burn-with-memo-hash, over the alternatives (Soroban contract; XRPL MPT per rules/02).
**Why it matters:** One-way door once units are issued to third parties.
**Recommendation:** Accept for testnet. Mainnet only after F-2..F-5.

### F-2 (BLOCKS: any `--submit`) — Issuer and treasury keys
**Question:** Which Stellar accounts become issuer and treasury? Issuer key holds mint, freeze and clawback power over every holder.
**Why it matters:** Same single-key exposure the TerraNova review criticised in Triangle's contract. Needs multisig (Stellar native thresholds + signers) before any third party holds units.
**Recommendation:** Fresh, unused account as issuer; set med/high thresholds to 2-of-3 before first mint.

### F-3 (BLOCKS: serving `well-known/stellar.toml`) — REGULATED claims
`regulated = true`, "Verified carbon credits", `is_asset_anchored = true`, and the physical address (5655 Peachtree Pkwy NW is a deal property in memory, not a verified UnyKorn LLC address — UNVERIFIED). Counsel first; marketing-copy ADR required.

### F-4 (BLOCKS: first real mint) — Underlying credits
`batches/batch.example.json` names "Triangle Digital / Verra / ACR / BCarbon". No batch is locked. The TerraNova tranche sits in Triangle's shared wallet under a single key (see prior review). Do not mint UKCO2 against credits UnyKorn does not control.

### F-5 (BLOCKS: pricing copy) — Offset price basis
Offset surcharge uses the midpoint of this repo's `methane_capture` price range. Confirm the basis before any x402 challenge quotes it to a paying agent.

## RESOLVED FLAGS
_(none yet)_
