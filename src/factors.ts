/**
 * Emissions factors — kg CO2e per unit.
 * Sources:
 *  - EPA eGRID 2023 (US subregion electricity factors)
 *  - EPA GHG Emission Factors Hub (April 2024)
 *  - DOE Alternative Fuels Data Center
 *  - Cloud PUE + carbon-intensity averages from Google, AWS, Microsoft sustainability reports (2024)
 *
 * Numbers are conservative annual averages. Real-world values should replace
 * these once bills/telemetry are ingested per entity.
 */

/** kg CO2e per kWh of electricity by eGRID subregion. */
export const GRID_KG_CO2_PER_KWH: Record<string, number> = {
  // US eGRID 2023 total output emission rate, lb/MWh -> kg/kWh
  SRSO: 0.409, // Southeast (GA, AL, part of MS) — M Helen (GA), Water Park (GA)
  SRTV: 0.331, // Tennessee Valley
  RFCE: 0.298, // RFC East (PA, NJ, DE, MD, DC)
  RFCW: 0.418, // RFC West (OH, MI, IN, IL, WI)
  ERCT: 0.401, // Texas (ERCOT)
  CAMX: 0.209, // California
  NEWE: 0.239, // New England
  NYCW: 0.209, // NYC + Westchester
  NWPP: 0.294, // Pacific NW (WA, OR, ID, MT)
  AZNM: 0.376, // Arizona/New Mexico
  US_AVG: 0.371,
};

/** Default grid region by state abbreviation. */
export const STATE_TO_GRID_REGION: Record<string, string> = {
  GA: "SRSO",
  AL: "SRSO",
  FL: "SRSO",
  TN: "SRTV",
  KY: "SRTV",
  PA: "RFCE",
  NJ: "RFCE",
  DE: "RFCE",
  MD: "RFCE",
  DC: "RFCE",
  OH: "RFCW",
  MI: "RFCW",
  IN: "RFCW",
  IL: "RFCW",
  WI: "RFCW",
  TX: "ERCT",
  CA: "CAMX",
  MA: "NEWE",
  CT: "NEWE",
  ME: "NEWE",
  NH: "NEWE",
  RI: "NEWE",
  VT: "NEWE",
  NY: "NYCW",
  WA: "NWPP",
  OR: "NWPP",
  ID: "NWPP",
  MT: "NWPP",
  WY: "NWPP",
  AZ: "AZNM",
  NM: "AZNM",
};

/** kg CO2e per therm of natural gas (EPA). */
export const NATURAL_GAS_KG_CO2_PER_THERM = 5.31;

/** kg CO2e per gallon of gasoline (EPA). */
export const GASOLINE_KG_CO2_PER_GAL = 8.887;

/** kg CO2e per gallon of diesel (EPA). */
export const DIESEL_KG_CO2_PER_GAL = 10.180;

/** kg CO2e per passenger flight-mile (DEFRA 2024, avg short+medium+long-haul). */
export const FLIGHT_KG_CO2_PER_MILE = 0.257;

/** kg CO2e per hotel night (Cornell / Hotel Carbon Measurement Initiative 2023 US avg). */
export const HOTEL_KG_CO2_PER_NIGHT = 22.5;

/**
 * Cloud emissions:
 *   $1/month cloud spend → ~2 kWh/month at aggregated hyperscaler PUE + rack density.
 *   → 24 kWh/year per $1/month, times grid factor.
 * This is a rough proxy — replace with provider-reported carbon reports when available.
 */
export const CLOUD_KWH_PER_USD_PER_YEAR = 24;

/**
 * Headcount overhead — for entities without utility bills yet.
 * Avg US office worker footprint (electricity + gas + water) at ~1.4 tCO2e / FTE-year.
 * Only applied when NO explicit utility inputs are provided.
 */
export const HEADCOUNT_OVERHEAD_TCO2E_PER_FTE = 1.4;

/**
 * SREC prices per state — 2025 secondary-market indicative ranges.
 * Source: SRECTrade, Karbone, PJM-GATS aggregated benchmarks.
 * Prices update quarterly — treat these as bootstrap defaults; override in
 * data/srec-markets.json for authoritative values.
 */
export const SREC_PRICE_USD_BY_STATE: Record<string, number> = {
  NJ: 210,
  MA: 285,
  DC: 335,
  PA: 42,
  MD: 65,
  OH: 8,
  IL: 65,
  DE: 22,
  VA: 45,
  // States without a compliance SREC market — voluntary REC only, cents-on-the-dollar
  GA: 8,
  FL: 6,
  TX: 4,
  CA: 15,
  AL: 6,
  TN: 6,
  NC: 12,
  US_AVG_VOLUNTARY: 6,
};

/**
 * Offset market benchmarks — USD per tCO2e, indicative 2025 voluntary market ranges.
 * Source: Ecosystem Marketplace State of the Voluntary Carbon Market 2025,
 * Trove Research, MSCI Carbon Markets.
 */
export const OFFSET_PRICE_USD_PER_TCO2E: Record<
  string,
  { low: number; high: number }
> = {
  forestry: { low: 5, high: 18 }, // REDD+, afforestation
  soil_carbon: { low: 12, high: 30 },
  biochar: { low: 130, high: 240 },
  direct_air_capture: { low: 400, high: 1000 },
  renewable_energy: { low: 3, high: 8 }, // I-RECs, older-vintage RE
  methane_capture: { low: 8, high: 22 },
};

/** Default offset portfolio mix used when the client hasn't stated a preference. */
export const DEFAULT_OFFSET_MIX = {
  forestry: 0.40,
  soil_carbon: 0.30,
  biochar: 0.20,
  direct_air_capture: 0.10,
} as const;
