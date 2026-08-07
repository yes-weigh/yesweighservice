/**
 * Default Trackon / Phoenix Cargo Cochin tariff (27 Feb 2026).
 * Keep in sync with scripts/seed-trackon-rates.mjs.
 */
import type {
  TrackonAirDestinationRates,
  TrackonConfig,
  TrackonNorthDestinationId,
  TrackonNorthSurfaceRates,
  TrackonServiceId,
  TrackonSharedRules,
  TrackonSouthDestinationId,
  TrackonSouthSurfaceRates,
  TrackonWeightSlabs,
} from '../types/trackon-rates';
import {
  TRACKON_NORTH_DESTINATION_IDS,
  TRACKON_SOUTH_DESTINATION_IDS,
} from '../types/trackon-rates';

function slabs(
  upTo250gInr: number,
  upTo500gInr: number,
  upTo1000gInr: number,
  additionalPer500gInr?: number,
): TrackonWeightSlabs {
  const addl = additionalPer500gInr ?? Math.max(0, upTo1000gInr - upTo500gInr);
  return {
    upTo250gInr,
    upTo500gInr,
    upTo1000gInr,
    additionalPer500gInr: addl,
  };
}

function airRow(
  upTo250gInr: number,
  upTo500gInr: number,
  upTo1000gInr: number,
): TrackonAirDestinationRates {
  return slabs(upTo250gInr, upTo500gInr, upTo1000gInr);
}

function southRow(
  upTo250gInr: number,
  upTo500gInr: number,
  upTo1000gInr: number,
  bulkPerKgInr: number,
): TrackonSouthSurfaceRates {
  return {
    ...slabs(upTo250gInr, upTo500gInr, upTo1000gInr),
    bulkPerKgInr,
  };
}

export const DEFAULT_TRACKON_SHARED: TrackonSharedRules = {
  fuelSurchargePercent: 15,
  volumetricDivisor: 5000,
  oversizedSideCm: 100,
  northernMinimumChargeableKg: 1,
  southernBulkMinimumKg: 4,
};

export function defaultTrackonConfig(): TrackonConfig {
  const airDestinations = {
    mumbai: airRow(45, 50, 110),
    delhi: airRow(45, 50, 120),
    andhra_pradesh: airRow(45, 55, 120),
    kolkata: airRow(55, 60, 150),
    northern_sectors: airRow(55, 60, 150),
  } satisfies Record<TrackonNorthDestinationId, TrackonAirDestinationRates>;

  const northernSurface = {
    mumbai: { perKgInr: 55 },
    delhi: { perKgInr: 60 },
    andhra_pradesh: { perKgInr: 60 },
    kolkata: { perKgInr: 70 },
    northern_sectors: { perKgInr: 70 },
  } satisfies Record<TrackonNorthDestinationId, TrackonNorthSurfaceRates>;

  const southernSurface = {
    chennai: southRow(40, 35, 40, 35),
    bangalore: southRow(40, 40, 45, 35),
    coimbatore: southRow(40, 35, 40, 35),
    salem: southRow(40, 35, 40, 35),
    tamil_nadu: southRow(40, 35, 40, 35),
    karnataka: southRow(40, 40, 45, 35),
    kerala: southRow(30, 17, 17, 17),
    kerala_hilly: southRow(30, 20, 20, 20),
  } satisfies Record<TrackonSouthDestinationId, TrackonSouthSurfaceRates>;

  return {
    shared: { ...DEFAULT_TRACKON_SHARED },
    air: { destinations: airDestinations },
    surface: {
      northern: northernSurface,
      southern: southernSurface,
    },
    source: {
      label: 'Phoenix Cargo — Trackon franchise (Cochin)',
      dated: '2026-02-27',
      notes: 'Quotation to M/S Interweighing Pvt Ltd, Cochin. Fuel 15%. Vol = L×B×H/5000; side >100 cm doubles vol.',
    },
  };
}

export function trackonServiceHasRate(
  config: TrackonConfig,
  service: TrackonServiceId,
): boolean {
  if (service === 'air') {
    return TRACKON_NORTH_DESTINATION_IDS.some(id => {
      const row = config.air.destinations[id];
      return row.upTo1000gInr > 0 || row.additionalPer500gInr > 0;
    });
  }
  const northOk = TRACKON_NORTH_DESTINATION_IDS.some(
    id => config.surface.northern[id].perKgInr > 0,
  );
  const southOk = TRACKON_SOUTH_DESTINATION_IDS.some(id => {
    const row = config.surface.southern[id];
    return row.upTo250gInr > 0
      || row.upTo500gInr > 0
      || row.upTo1000gInr > 0
      || row.bulkPerKgInr > 0;
  });
  return northOk || southOk;
}

export function trackonConfigHasRate(config: TrackonConfig): boolean {
  return trackonServiceHasRate(config, 'air') || trackonServiceHasRate(config, 'surface');
}
