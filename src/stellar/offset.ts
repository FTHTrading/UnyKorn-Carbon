/**
 * Energy-eater offset meter.
 *
 * Every paid machine call (x402 on Genesis402, an MPP session, or any metered
 * compute) reports the energy it used. The meter converts kWh to CO2e with the
 * EPA eGRID factors already in this repo, prices the offset, and batches it into
 * Stellar retirements tagged with the caller's ERC-8004 agent identity.
 */
import { GRID_KG_CO2_PER_KWH, OFFSET_PRICE_USD_PER_TCO2E } from "../factors.ts";
import { RetirementRecord, toAmount } from "./rail.ts";

export interface MeteredCall {
  paymentRef: string;          // x402 settlement tx / MPP session id
  rail: "x402" | "mpp";
  agentId: string;             // ERC-8004, e.g. "base:95721"
  endpoint: string;
  kwh: number;                 // energy used by this call (measured or estimated)
  gridRegion: keyof typeof GRID_KG_CO2_PER_KWH | string;
  at: string;
}

export interface OffsetQuote { kgCO2e: number; tonnes: string; usd: number }

const PRICE = OFFSET_PRICE_USD_PER_TCO2E.methane_capture; // $/t range from this repo's market table

/** Price an offset at the midpoint of the methane-capture range, rounded up to the cent. */
export function quoteOffset(kwh: number, region: string): OffsetQuote {
  const factor = GRID_KG_CO2_PER_KWH[region] ?? GRID_KG_CO2_PER_KWH.US_AVG;
  const kg = kwh * factor;
  const t = kg / 1000;
  const mid = (PRICE.low + PRICE.high) / 2;
  return { kgCO2e: kg, tonnes: toAmount(t), usd: Math.ceil(t * mid * 1e6) / 1e6 }; // USDC has 6 decimals
}

/** Accumulates calls per agent; flushes a retirement once the batch reaches `minTonnes`. */
export class OffsetMeter {
  private open = new Map<string, MeteredCall[]>();
  constructor(private assetId: string, private minTonnes = 0.001) {}

  record(call: MeteredCall): RetirementRecord | null {
    const list = this.open.get(call.agentId) ?? [];
    list.push(call);
    this.open.set(call.agentId, list);
    const kg = list.reduce((s, c) => s + c.kwh * (GRID_KG_CO2_PER_KWH[c.gridRegion] ?? GRID_KG_CO2_PER_KWH.US_AVG), 0);
    if (kg / 1000 < this.minTonnes) return null;
    return this.flush(call.agentId);
  }

  flush(agentId: string): RetirementRecord | null {
    const list = this.open.get(agentId);
    if (!list?.length) return null;
    this.open.delete(agentId);
    const kwh = list.reduce((s, c) => s + c.kwh, 0);
    const kg = list.reduce((s, c) => s + c.kwh * (GRID_KG_CO2_PER_KWH[c.gridRegion] ?? GRID_KG_CO2_PER_KWH.US_AVG), 0);
    const regions = [...new Set(list.map(c => c.gridRegion))].join(",");
    return {
      kind: "retirement",
      asset: this.assetId,
      tonnes: toAmount(kg / 1000),
      beneficiary: `agent ${agentId}`,
      purpose: `Offset of ${list.length} metered machine calls (${regions})`,
      agentId,
      paymentRefs: list.map(c => `${c.rail}:${c.paymentRef}`),
      energyKwh: Number(kwh.toFixed(6)),
      gridRegion: regions,
      kgCO2e: Number(kg.toFixed(6)),
      at: new Date().toISOString(),
    };
  }

  pending(): string[] { return [...this.open.keys()]; }
}

/**
 * x402 price line: what a paid endpoint quotes when "carbon-neutral" is on.
 * The 402 challenge carries both the service price and the offset surcharge,
 * so the agent sees exactly what it pays for its footprint.
 */
export function x402PriceWithOffset(serviceUsd: number, kwh: number, region: string) {
  const q = quoteOffset(kwh, region);
  const offsetUsd = Math.max(q.usd, 0.000001);
  return {
    maxAmountRequired: (serviceUsd + offsetUsd).toFixed(6), // USD; converted to USDC atomic units by the x402 server
    breakdown: { serviceUsd, offsetUsd, kgCO2e: Number(q.kgCO2e.toFixed(6)), tonnes: q.tonnes, region },
    extra: { carbonNeutral: true, retirementRail: "stellar", standard: "UnyKorn Carbon Rail v1" },
  };
}
