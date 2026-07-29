export type EntityKind =
  | "operating_company"
  | "spv"
  | "reit"
  | "hotel"
  | "hospitality"
  | "energy_asset"
  | "commercial_property";

export interface Entity {
  slug: string;
  legal_name: string;
  kind: EntityKind;
  parent?: string;
  jurisdiction: string;
  notes?: string;
}

/** Emissions inputs the entity actually consumes each year. */
export interface EmissionsInputs {
  entity: string;
  year: number;

  utility?: {
    electricity_kwh?: number;
    natural_gas_therms?: number;
    /** Grid emissions region (eGRID). Default derived from jurisdiction. */
    grid_region?: string;
  };

  cloud?: {
    /** Monthly cloud spend in USD, all providers combined. */
    monthly_usd?: number;
    /** Optional override kWh consumed if measured directly. */
    kwh_measured?: number;
  };

  travel?: {
    /** Employee flight-miles per year. */
    flight_miles?: number;
    hotel_nights?: number;
  };

  vehicle?: {
    gasoline_gallons?: number;
    diesel_gallons?: number;
    ev_kwh?: number;
  };

  headcount?: {
    fte?: number;
    /** ft office days per year. Used for office overhead estimate when no utility data available. */
    office_days_per_fte?: number;
  };

  /** Direct combustion at hospitality kitchens, boilers, etc. Metric tons CO2e. */
  process_direct_tco2e?: number;
}

export interface EmissionsBreakdown {
  entity: string;
  year: number;
  /** Metric tons CO2e per category. */
  categories: {
    electricity: number;
    natural_gas: number;
    cloud: number;
    travel: number;
    vehicle: number;
    process: number;
    headcount_overhead: number;
  };
  total_tco2e: number;
  scope_1_tco2e: number;
  scope_2_tco2e: number;
  scope_3_tco2e: number;
}

export interface SRECInputs {
  entity: string;
  year: number;
  /** Solar / wind / other renewable generation in kWh. */
  generation_kwh: number;
  /** State ISO — determines market price and SREC rules. */
  state: string;
  /** Grid region (eGRID) — determines avoided-emissions factor. */
  grid_region?: string;
  /** If already sold in earlier vintages, deduct here. */
  already_sold_srecs?: number;
}

export interface SRECOutput {
  entity: string;
  year: number;
  state: string;
  generation_mwh: number;
  eligible_srecs: number;
  /** Avoided emissions attributable to this generation, metric tons CO2e. */
  avoided_tco2e: number;
  /** Estimated market value in USD at current state prices. */
  estimated_value_usd: number;
  price_per_srec_usd: number;
}

export interface OffsetRecommendation {
  entity: string;
  year: number;
  tco2e_needed: number;
  portfolio: OffsetPortfolioItem[];
  total_cost_usd_low: number;
  total_cost_usd_high: number;
}

export interface OffsetPortfolioItem {
  category:
    | "forestry"
    | "soil_carbon"
    | "biochar"
    | "direct_air_capture"
    | "renewable_energy"
    | "methane_capture";
  weight_pct: number;
  tco2e_allocated: number;
  price_per_tco2e_low: number;
  price_per_tco2e_high: number;
  cost_low_usd: number;
  cost_high_usd: number;
}

export interface PortfolioRollup {
  as_of_year: number;
  total_entities: number;
  gross_tco2e: number;
  srec_avoided_tco2e: number;
  net_tco2e_needing_offset: number;
  estimated_offset_cost_low_usd: number;
  estimated_offset_cost_high_usd: number;
  total_srec_value_usd: number;
  per_entity: Array<{
    entity: string;
    legal_name: string;
    gross_tco2e: number;
    srec_avoided_tco2e: number;
    net_tco2e: number;
    srec_value_usd: number;
  }>;
}
