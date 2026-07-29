import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  Entity,
  EmissionsInputs,
  SRECInputs,
  EmissionsBreakdown,
  SRECOutput,
  PortfolioRollup,
} from "./types.ts";
import { computeFootprint, recommendOffsets } from "./engine.ts";
import { computeSREC } from "./srec.ts";
import { DEFAULT_OFFSET_MIX, OFFSET_PRICE_USD_PER_TCO2E } from "./factors.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..");

export type DataSource = "auto" | "private" | "example";

/**
 * Load a JSON data file, preferring the private (real) version when it exists.
 * `--data=example` forces the example dataset — used to render the public
 * Pages dashboard so real portfolio numbers never leak.
 */
function loadJson<T>(baseName: string, source: DataSource): T {
  const priv = join(ROOT, "data", `${baseName}.json`);
  const ex = join(ROOT, "data", `${baseName}.example.json`);
  const chosen =
    source === "example" ? ex : source === "private" ? priv : existsSync(priv) ? priv : ex;
  return JSON.parse(readFileSync(chosen, "utf-8"));
}

export function loadEntities(source: DataSource = "auto"): Entity[] {
  return loadJson<Entity[]>("entities", source);
}

export function loadEmissionsInputs(source: DataSource = "auto"): EmissionsInputs[] {
  return loadJson<EmissionsInputs[]>("emissions-inputs", source);
}

export function loadSRECInputs(source: DataSource = "auto"): SRECInputs[] {
  return loadJson<SRECInputs[]>("srec-inputs", source);
}

export function computePortfolio(
  year: number,
  source: DataSource = "auto",
): {
  breakdowns: EmissionsBreakdown[];
  srecs: SRECOutput[];
  rollup: PortfolioRollup;
} {
  const entities = loadEntities(source);
  const emissionsInputs = loadEmissionsInputs(source).filter((i) => i.year === year);
  const srecInputs = loadSRECInputs(source).filter((i) => i.year === year);

  const entityMap = new Map(entities.map((e) => [e.slug, e]));

  const breakdowns: EmissionsBreakdown[] = emissionsInputs.map((inp) => {
    const ent = entityMap.get(inp.entity);
    if (!ent) throw new Error(`Unknown entity in emissions inputs: ${inp.entity}`);
    return computeFootprint(inp, ent);
  });

  const srecs: SRECOutput[] = srecInputs.map((inp) => computeSREC(inp));

  const avoidedByEntity = new Map<string, number>();
  const srecValueByEntity = new Map<string, number>();
  for (const s of srecs) {
    avoidedByEntity.set(
      s.entity,
      (avoidedByEntity.get(s.entity) ?? 0) + s.avoided_tco2e,
    );
    srecValueByEntity.set(
      s.entity,
      (srecValueByEntity.get(s.entity) ?? 0) + s.estimated_value_usd,
    );
  }

  const per_entity = breakdowns.map((b) => {
    const ent = entityMap.get(b.entity)!;
    const srec_avoided = avoidedByEntity.get(b.entity) ?? 0;
    const srec_val = srecValueByEntity.get(b.entity) ?? 0;
    const net = Math.max(0, b.total_tco2e - srec_avoided);
    return {
      entity: b.entity,
      legal_name: ent.legal_name,
      gross_tco2e: b.total_tco2e,
      srec_avoided_tco2e: round(srec_avoided),
      net_tco2e: round(net),
      srec_value_usd: round(srec_val),
    };
  });

  const gross = per_entity.reduce((a, e) => a + e.gross_tco2e, 0);
  const avoided = per_entity.reduce((a, e) => a + e.srec_avoided_tco2e, 0);
  const net = Math.max(0, gross - avoided);
  const srec_val_total = per_entity.reduce((a, e) => a + e.srec_value_usd, 0);

  // Offset cost estimate using default mix
  let low = 0;
  let high = 0;
  for (const [cat, weight] of Object.entries(DEFAULT_OFFSET_MIX)) {
    const p = OFFSET_PRICE_USD_PER_TCO2E[cat];
    if (!p) continue;
    low += net * weight * p.low;
    high += net * weight * p.high;
  }

  const rollup: PortfolioRollup = {
    as_of_year: year,
    total_entities: per_entity.length,
    gross_tco2e: round(gross),
    srec_avoided_tco2e: round(avoided),
    net_tco2e_needing_offset: round(net),
    estimated_offset_cost_low_usd: round(low),
    estimated_offset_cost_high_usd: round(high),
    total_srec_value_usd: round(srec_val_total),
    per_entity,
  };

  return { breakdowns, srecs, rollup };
}

export function writeReport(
  year: number,
  filename: string,
  source: DataSource = "auto",
): string {
  const out = computePortfolio(year, source);
  const offsetRec = recommendOffsets(
    "PORTFOLIO_TOTAL",
    year,
    out.rollup.net_tco2e_needing_offset,
  );

  const report = {
    generated_at: new Date().toISOString(),
    year,
    rollup: out.rollup,
    per_entity_breakdown: out.breakdowns,
    srecs: out.srecs,
    recommended_offset_portfolio: offsetRec,
  };

  const reportsDir = join(ROOT, "reports");
  mkdirSync(reportsDir, { recursive: true });
  const outPath = join(reportsDir, filename);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  return outPath;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
