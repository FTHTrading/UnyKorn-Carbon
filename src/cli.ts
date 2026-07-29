#!/usr/bin/env -S npx tsx
import { computePortfolio, writeReport, ROOT, DataSource } from "./portfolio.ts";
import { recommendOffsets } from "./engine.ts";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const [, , cmd = "help", ...args] = process.argv;

const YEAR = Number(
  args.find((a) => a.startsWith("--year="))?.split("=")[1] ?? 2026,
);
const DATA: DataSource =
  (args.find((a) => a.startsWith("--data="))?.split("=")[1] as DataSource) ??
  "auto";
const PUBLISH = args.includes("--publish");

function usd(n: number): string {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function t(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 }) + " tCO2e";
}
function bar(v: number, max: number, width = 24): string {
  const filled = Math.round((v / (max || 1)) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function sourceLabel(src: DataSource): string {
  return src === "example"
    ? " · using EXAMPLE data"
    : src === "private"
      ? " · using PRIVATE portfolio"
      : "";
}

switch (cmd) {
  case "calc": {
    const { breakdowns } = computePortfolio(YEAR, DATA);
    console.log(`\n  UnyKorn Carbon — Emissions by Entity · FY${YEAR}${sourceLabel(DATA)}\n`);
    const maxTot = Math.max(...breakdowns.map((b) => b.total_tco2e));
    for (const b of breakdowns) {
      console.log(
        `  ${b.entity.padEnd(24)} ${bar(b.total_tco2e, maxTot)} ${t(b.total_tco2e)}`,
      );
    }
    const sum = breakdowns.reduce((a, b) => a + b.total_tco2e, 0);
    console.log(`\n  Portfolio total: ${t(sum)}\n`);
    break;
  }

  case "srec": {
    const { srecs } = computePortfolio(YEAR, DATA);
    console.log(`\n  UnyKorn Carbon — SREC / REC Value · FY${YEAR}${sourceLabel(DATA)}\n`);
    let total_value = 0;
    let total_srecs = 0;
    for (const s of srecs) {
      console.log(
        `  ${s.entity.padEnd(24)} ${s.eligible_srecs.toString().padStart(6)} SRECs @ ${usd(s.price_per_srec_usd)}  =  ${usd(s.estimated_value_usd)}   [${s.state}]`,
      );
      total_value += s.estimated_value_usd;
      total_srecs += s.eligible_srecs;
    }
    console.log(
      `\n  Total: ${total_srecs.toLocaleString()} SRECs → ${usd(total_value)}\n`,
    );
    break;
  }

  case "offsets": {
    const { rollup } = computePortfolio(YEAR, DATA);
    const rec = recommendOffsets(
      "PORTFOLIO_TOTAL",
      YEAR,
      rollup.net_tco2e_needing_offset,
    );
    console.log(`\n  UnyKorn Carbon — Offset Recommendation · FY${YEAR}${sourceLabel(DATA)}\n`);
    console.log(`  Gap to cover:  ${t(rollup.net_tco2e_needing_offset)}\n`);
    for (const p of rec.portfolio) {
      console.log(
        `  ${p.category.padEnd(20)} ${p.weight_pct.toString().padStart(3)}%   ${p.tco2e_allocated.toFixed(1).padStart(7)} tCO2e   ${usd(p.cost_low_usd).padStart(9)} – ${usd(p.cost_high_usd)}`,
      );
    }
    console.log(
      `\n  Total offset cost:  ${usd(rec.total_cost_usd_low)} – ${usd(rec.total_cost_usd_high)}\n`,
    );
    break;
  }

  case "report": {
    const suffix = DATA === "example" ? "-example" : "";
    const filename = `portfolio-${YEAR}${suffix}.json`;
    const path = writeReport(YEAR, filename, DATA);
    console.log(`\n  Report written: ${path}\n`);
    const { rollup } = computePortfolio(YEAR, DATA);
    console.log(`  Gross emissions:            ${t(rollup.gross_tco2e)}`);
    console.log(`  SREC-avoided emissions:     ${t(rollup.srec_avoided_tco2e)}`);
    console.log(`  Net offset gap:             ${t(rollup.net_tco2e_needing_offset)}`);
    console.log(
      `  Estimated offset cost:      ${usd(rollup.estimated_offset_cost_low_usd)} – ${usd(rollup.estimated_offset_cost_high_usd)}`,
    );
    console.log(`  Portfolio SREC value:       ${usd(rollup.total_srec_value_usd)}\n`);
    break;
  }

  case "dashboard": {
    // Default: render local dashboard from PRIVATE data (or auto).
    // --publish: force example data + write to docs/index.html for GitHub Pages.
    const source: DataSource = PUBLISH ? "example" : DATA;
    const { rollup, breakdowns, srecs } = computePortfolio(YEAR, source);
    const offsetRec = recommendOffsets(
      "PORTFOLIO_TOTAL",
      YEAR,
      rollup.net_tco2e_needing_offset,
    );

    const template = readFileSync(
      join(ROOT, "dashboard/index.template.html"),
      "utf-8",
    );

    const rendered = template
      .replace(/__YEAR__/g, String(YEAR))
      .replace(/__GENERATED__/g, new Date().toISOString().slice(0, 10))
      .replace(/__MODE__/g, PUBLISH ? "Example data" : "Private portfolio")
      .replace(/__DATA__/g, JSON.stringify({ rollup, breakdowns, srecs, offsetRec }));

    const outPath = PUBLISH
      ? join(ROOT, "docs/index.html")
      : join(ROOT, "dashboard/local.html");
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, rendered);
    console.log(`\n  Dashboard written: ${outPath}`);
    if (PUBLISH) {
      console.log(`  Mode: PUBLISH (example data) — safe for public GitHub Pages\n`);
    } else {
      console.log(`  Mode: local (private data) — gitignored, do not commit\n`);
    }
    break;
  }

  case "help":
  default: {
    console.log(`
  UnyKorn Carbon — CLI

    carbon calc       [--year=YYYY] [--data=auto|private|example]
    carbon srec       [--year=YYYY] [--data=auto|private|example]
    carbon offsets    [--year=YYYY] [--data=auto|private|example]
    carbon report     [--year=YYYY] [--data=auto|private|example]
    carbon dashboard  [--year=YYYY] [--data=auto|private|example]
    carbon dashboard  --publish            Render docs/index.html from EXAMPLE data
                                           (for GitHub Pages — real numbers stay out)

  Defaults: year=2026, data=auto (private if present, else example).
  Dashboard default output: dashboard/local.html (gitignored, private numbers).
`);
    break;
  }
}
