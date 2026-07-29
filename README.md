# UnyKorn Carbon

**Portfolio-wide carbon accounting + SREC engine for UnyKorn and LD Capital.**

Computes emissions per entity (UnyKorn LLC, UNYKORN 7777, LD Capital, M Helen Hotel, Water Park at Helen, Miguel Alexandrite). Values SRECs from any renewable generation. Recommends an offset portfolio to close the net gap. Emits a JSON report and a browsable HTML dashboard.

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
