import {
  EmissionsInputs,
  EmissionsBreakdown,
  Entity,
  OffsetRecommendation,
  OffsetPortfolioItem,
} from "./types.ts";
import {
  GRID_KG_CO2_PER_KWH,
  STATE_TO_GRID_REGION,
  NATURAL_GAS_KG_CO2_PER_THERM,
  GASOLINE_KG_CO2_PER_GAL,
  DIESEL_KG_CO2_PER_GAL,
  FLIGHT_KG_CO2_PER_MILE,
  HOTEL_KG_CO2_PER_NIGHT,
  CLOUD_KWH_PER_USD_PER_YEAR,
  HEADCOUNT_OVERHEAD_TCO2E_PER_FTE,
  OFFSET_PRICE_USD_PER_TCO2E,
  DEFAULT_OFFSET_MIX,
} from "./factors.ts";

const KG_PER_T = 1000;

function gridFactor(region: string | undefined, entityJurisdiction: string): number {
  if (region && GRID_KG_CO2_PER_KWH[region] !== undefined) {
    return GRID_KG_CO2_PER_KWH[region];
  }
  const state = entityJurisdiction.toUpperCase().split(/[-_ ]/)[0];
  const inferred = STATE_TO_GRID_REGION[state];
  return inferred ? GRID_KG_CO2_PER_KWH[inferred] : GRID_KG_CO2_PER_KWH.US_AVG;
}

/** Compute an entity's emissions breakdown for a given year. */
export function computeFootprint(
  inputs: EmissionsInputs,
  entity: Entity,
): EmissionsBreakdown {
  const factor = gridFactor(inputs.utility?.grid_region, entity.jurisdiction);

  const kwh = inputs.utility?.electricity_kwh ?? 0;
  const therms = inputs.utility?.natural_gas_therms ?? 0;

  const cloudKwh =
    inputs.cloud?.kwh_measured ??
    (inputs.cloud?.monthly_usd ?? 0) * CLOUD_KWH_PER_USD_PER_YEAR;

  const flightMi = inputs.travel?.flight_miles ?? 0;
  const hotelNt = inputs.travel?.hotel_nights ?? 0;

  const gasGal = inputs.vehicle?.gasoline_gallons ?? 0;
  const dieselGal = inputs.vehicle?.diesel_gallons ?? 0;
  const evKwh = inputs.vehicle?.ev_kwh ?? 0;

  const electricity_kg = (kwh + evKwh) * factor;
  const natural_gas_kg = therms * NATURAL_GAS_KG_CO2_PER_THERM;
  const cloud_kg = cloudKwh * factor;
  const travel_kg =
    flightMi * FLIGHT_KG_CO2_PER_MILE + hotelNt * HOTEL_KG_CO2_PER_NIGHT;
  const vehicle_kg =
    gasGal * GASOLINE_KG_CO2_PER_GAL + dieselGal * DIESEL_KG_CO2_PER_GAL;

  const process_t = inputs.process_direct_tco2e ?? 0;

  // Headcount overhead only applies when NO utility data was provided
  const hasUtility = (kwh > 0) || (therms > 0);
  const fte = inputs.headcount?.fte ?? 0;
  const headcount_overhead_t = hasUtility ? 0 : fte * HEADCOUNT_OVERHEAD_TCO2E_PER_FTE;

  const categories = {
    electricity: electricity_kg / KG_PER_T,
    natural_gas: natural_gas_kg / KG_PER_T,
    cloud: cloud_kg / KG_PER_T,
    travel: travel_kg / KG_PER_T,
    vehicle: vehicle_kg / KG_PER_T,
    process: process_t,
    headcount_overhead: headcount_overhead_t,
  };

  const total = Object.values(categories).reduce((a, b) => a + b, 0);

  // GHG Protocol scope classification (simplified but accurate for these categories)
  const scope_1 = categories.natural_gas + categories.vehicle + categories.process;
  const scope_2 = categories.electricity + categories.cloud;
  const scope_3 = categories.travel + categories.headcount_overhead;

  return {
    entity: inputs.entity,
    year: inputs.year,
    categories,
    total_tco2e: round(total),
    scope_1_tco2e: round(scope_1),
    scope_2_tco2e: round(scope_2),
    scope_3_tco2e: round(scope_3),
  };
}

/** Recommend an offset portfolio for a given emissions gap. */
export function recommendOffsets(
  entity: string,
  year: number,
  tco2e_gap: number,
  mix: Record<string, number> = DEFAULT_OFFSET_MIX,
): OffsetRecommendation {
  const portfolio: OffsetPortfolioItem[] = [];
  let total_low = 0;
  let total_high = 0;

  for (const [category, weight] of Object.entries(mix)) {
    const price = OFFSET_PRICE_USD_PER_TCO2E[category];
    if (!price) continue;
    const allocated = tco2e_gap * weight;
    const cost_low = allocated * price.low;
    const cost_high = allocated * price.high;
    portfolio.push({
      category: category as OffsetPortfolioItem["category"],
      weight_pct: weight * 100,
      tco2e_allocated: round(allocated),
      price_per_tco2e_low: price.low,
      price_per_tco2e_high: price.high,
      cost_low_usd: round(cost_low),
      cost_high_usd: round(cost_high),
    });
    total_low += cost_low;
    total_high += cost_high;
  }

  return {
    entity,
    year,
    tco2e_needed: round(tco2e_gap),
    portfolio,
    total_cost_usd_low: round(total_low),
    total_cost_usd_high: round(total_high),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
