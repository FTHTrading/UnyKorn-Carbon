# UnyKorn Carbon

**Portfolio-wide carbon accounting + SREC engine for private company portfolios.**

Computes emissions per entity across the whole portfolio — operating companies, holding cos, hospitality SPVs, energy assets. Values SRECs from any renewable generation. Recommends an offset portfolio to close the net gap. Emits a JSON report and a browsable HTML dashboard.

Built on real EPA emissions factors — not marketing numbers.

---

## Quick start

```bash
npm install

npm run calc              # emissions per entity
npm run srec              # SREC / REC value
npm run offsets           # recommended offset portfolio
npm run report            # write JSON report to reports/
npm run dashboard         # render dashboard/local.html from PRIVATE data (gitignored)
npm run dashboard:publish # render docs/index.html from EXAMPLE data (safe for Pages)
```

Everything defaults to fiscal year 2026. Pass `-- --year=2025 --data=example` to any command to change year or force example data.

## Public vs private data

- **`data/*.example.json`** — committed. Safe, generic. Used for the public GitHub Pages dashboard.
- **`data/*.json`** — gitignored. Real portfolio numbers. Stays local. If missing, CLI falls back to example.
- **`dashboard/local.html`** — gitignored. Rendered from private data. Do not commit.
- **`docs/index.html`** — committed. Rendered from example data only, via `npm run dashboard:publish`.

To add your real portfolio: create `data/entities.json`, `data/emissions-inputs.json`, `data/srec-inputs.json` following the shape of the `.example.json` files. Run any command with `--data=private` to force them (or the default `auto` picks them up).

## FY2026 snapshot (against the example dataset)

| Metric | Value |
|---|---|
| Gross emissions | **2,065 tCO2e** |
| SREC-avoided | 215 tCO2e |
| Net offset gap | **1,850 tCO2e** |
| Estimated offset cost | $132K – $304K |
| SREC market value | $4,200 |

The two hospitality assets in the example portfolio account for 96% of the footprint. That's typically where the SREC / ITC opportunity actually is in a hospitality-heavy REIT.

## Codebase

```text
src/
├── types.ts           Entity, EmissionsInputs, EmissionsBreakdown, SRECOutput, OffsetRecommendation
├── factors.ts         EPA eGRID subregion factors + fuel, cloud, offset, SREC price tables
├── engine.ts          computeFootprint() + recommendOffsets()
├── srec.ts            computeSREC() — kWh → SRECs → USD by state
├── portfolio.ts       Portfolio rollup, report writer, data-source loader
└── cli.ts             CLI entry point (calc / srec / offsets / report / dashboard)

data/
├── *.example.json     Generic seed data — committed, safe for the public repo
└── *.json             Real portfolio data — gitignored, local only

dashboard/
├── index.template.html   LDX-brand dashboard template
└── local.html            Local render from private data (gitignored)

docs/
└── index.html             GitHub-Pages dashboard, rendered from example data only

reports/
└── portfolio-YYYY.json    Structured report output (gitignored — may contain real numbers)
```

## Data sources

- Electricity: **EPA eGRID 2023** subregion emission rates, converted to kg CO2e/kWh.
- Natural gas, gasoline, diesel: **EPA GHG Emission Factors Hub** (April 2024).
- Cloud compute: hyperscaler PUE + $ → kWh proxy, times grid factor. Replace with provider carbon reports when available.
- Flights: **DEFRA 2024** average per-passenger-mile.
- Hotel nights: **Cornell Hotel Sustainability Benchmarking Index / HCMI** US avg.
- Offset prices: **Ecosystem Marketplace State of the VCM 2025** + Trove Research + MSCI Carbon Markets.
- SREC prices: **SRECTrade / Karbone / PJM-GATS** indicative quarterly benchmarks.

All factors are constants in `src/factors.ts`. Update quarterly.

## Data model — how to add a new entity

1. Add a row to `data/entities.json` (create the file if it doesn't exist — the file itself is gitignored):

   ```json
   {
     "slug": "new-spv-2027",
     "legal_name": "New SPV LLC",
     "kind": "spv",
     "parent": "acme-parent-inc",
     "jurisdiction": "DE"
   }
   ```
2. Add matching inputs in `data/emissions-inputs.json` (any subset of `utility` / `cloud` / `travel` / `vehicle` / `headcount` / `process_direct_tco2e`).
3. If it produces renewable energy, add a row to `data/srec-inputs.json`.
4. Run `npm run report` to regenerate.

## Why this exists

Two immediate uses in every private-portfolio deployment:

1. **ESG reporting for LP / lender relations.** Hospitality SPVs already have utility and process data; running it through this engine produces a defensible carbon disclosure for LP quarterlies and CMBS lender questionnaires.
2. **SREC monetization opportunity sizing.** Voluntary REC markets (GA, TX, FL) sell RECs at $4–$8 each. Compliance markets (NJ, MA, DC) sell the same MWh at $210–$335. This engine sizes the delta by asset and shows whether ITC + REC uplift justifies the capex to move generation ownership or add storage.

Productizing the engine for other private-portfolio operators is a natural next step alongside UnyKorn Sovereign — same non-custodial gateway pattern, different data model.

## Scope of what's *not* here yet

- No registry integration (Verra, Gold Standard, Puro.earth). The offset recommendation is a *mix and price band* — not a live inventory of specific projects. That's Phase 3, and it needs data licensing.
- No AI credit-quality scoring layer. Also Phase 3.
- No compliance market feed (JMS / PJM-GATS / SRECTrade). The state prices in `factors.ts` are indicative — update quarterly by hand until a market data source is licensed.
- No BitGo / on-chain retirement receipt. Kevan's LPS-1 provenance standard is the right primitive for that; hook in when retirements start being executed.

## Roadmap

- **v0.2** — hook to actual utility bill PDFs (parser → JSON inputs). Wire IoT energy telemetry from hospitality assets.
- **v0.3** — scenario planner: "what if we install 500kW PV at Asset X?" — projects generation, ITC value, SREC uplift, offset gap reduction.
- **v0.4** — hook the LPS-1 provenance standard for on-chain retirement receipts once offsets start being purchased and retired.
- **v0.5** — productize: pluggable brand skin, per-tenant data isolation, first external client.

---

*UnyKorn LLC operates as a non-custodial software gateway. Emissions and SREC calculations are decision-support outputs, not audited financial statements or regulatory-grade disclosures.*

---

## Carbon Rail on Stellar (`src/stellar/`)

One tonne of verified reduction = one `UKCO2` unit on Stellar, with regulated-asset controls built into the protocol: holders must be approved (`AUTH_REQUIRED`), can be frozen (`AUTH_REVOCABLE`), and invalidated units can be clawed back (`AUTH_CLAWBACK_ENABLED`). Retiring a unit means paying it back to the issuer with the SHA-256 of the public retirement record as the memo. Stellar's 7 decimals let a single machine call retire as little as 0.1 g CO2e.

**Energy-eater offsets over x402 / MPP / ERC-8004.** Every paid machine call reports its energy. The meter converts kWh to CO2e with the eGRID factors in `factors.ts`, adds the offset price to the x402 402-challenge (the agent sees service price + footprint price), and batches retirements per ERC-8004 agent identity, each one listing the x402/MPP payment refs it covers.

Offline run (`npm run stellar:demo`): 13 Stellar transactions built, signed and decoded, and 1,000 metered agent calls priced and batched into retirements:
- 1,000 mixed calls ≈ 1.08 kWh ≈ 0.42 kg CO2e. Making them carbon-neutral costs about $0.007 in total (a $0.001 large-model call carries a $0.000018 offset surcharge).
- 1 GWh of Georgia grid power ≈ 409 tCO2e ≈ $6,135 at a $15/t methane-credit midpoint. A 100 MW data center running a month draws ~72 GWh, ≈ 29,000 t.

**Issue for real** (from a machine with network access):
```bash
cp classes/ukco2.example.json classes/ukco2.json      # fill issuer + treasury public keys, serialRoot, dataRoomHash
cp batches/batch.example.json batches/b1.json         # the registry batch these units represent
npm run stellar:issue -- --net testnet --class classes/ukco2.json --batch batches/b1.json
```
Without secrets in the environment the script writes unsigned XDRs to `out/stellar/` for your wallet (Freighter, Lobstr, Ledger, Stellar Lab) to sign. With `STELLAR_SECRET_ISSUER` / `STELLAR_SECRET_TREASURY` set in your shell it signs locally, and `--submit` posts to Horizon. Publish `well-known/stellar.toml` at the home domain so wallets show the asset's terms.

Account funding (Stellar reserves): issuer ~3 XLM (1 base + 4 proof data entries), treasury ~1.5 XLM (1 base + 1 trustline), plus a few thousand stroops of fees.
