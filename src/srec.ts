import { SRECInputs, SRECOutput } from "./types.ts";
import {
  GRID_KG_CO2_PER_KWH,
  STATE_TO_GRID_REGION,
  SREC_PRICE_USD_BY_STATE,
} from "./factors.ts";

const KG_PER_T = 1000;
const KWH_PER_SREC = 1000; // 1 SREC = 1 MWh in every US state that has an SREC market

/**
 * Compute SREC eligibility, avoided emissions, and estimated market value
 * for a given entity's renewable generation year.
 */
export function computeSREC(inputs: SRECInputs): SRECOutput {
  const state = inputs.state.toUpperCase();

  // Every 1 MWh generated = 1 SREC eligible in states with a compliance market;
  // voluntary states still issue RECs at the same conversion.
  const generation_mwh = inputs.generation_kwh / KWH_PER_SREC;
  const gross_srecs = Math.floor(generation_mwh);
  const eligible_srecs = Math.max(0, gross_srecs - (inputs.already_sold_srecs ?? 0));

  // Avoided emissions = generation_kwh * grid factor
  const region =
    inputs.grid_region ??
    STATE_TO_GRID_REGION[state] ??
    "US_AVG";
  const factor = GRID_KG_CO2_PER_KWH[region] ?? GRID_KG_CO2_PER_KWH.US_AVG;
  const avoided_tco2e = round((inputs.generation_kwh * factor) / KG_PER_T);

  const price =
    SREC_PRICE_USD_BY_STATE[state] ??
    SREC_PRICE_USD_BY_STATE.US_AVG_VOLUNTARY;

  return {
    entity: inputs.entity,
    year: inputs.year,
    state,
    generation_mwh: round(generation_mwh),
    eligible_srecs,
    avoided_tco2e,
    estimated_value_usd: round(eligible_srecs * price),
    price_per_srec_usd: price,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
