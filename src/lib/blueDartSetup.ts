/**
 * Blue Dart Settings setup checklist + default-verify acknowledgements.
 * Acks persist on BlueDartConfig.setupAcknowledgements (live-saved with rates).
 */
import {
  defaultBlueDartAirRates,
  defaultBlueDartDomesticPriorityRates,
  defaultBlueDartSharedRules,
  defaultBlueDartSurfaceRates,
} from '../constants/blueDartRates';
import type { BlueDartConfig, BlueDartSetupAckKey } from '../types/blue-dart-rates';

export type { BlueDartSetupAckKey };

export const BLUE_DART_SETUP_ACK_KEYS: readonly BlueDartSetupAckKey[] = [
  'shared.fuelSurchargePercent',
  'shared.cafPercent',
  'shared.gstPercent',
  'shared.rasPerKgInr',
  'shared.fov',
  'shared.originRegion',
  'shared.edlFlatFallbackInr',
  'air.rates',
  'surface.rates',
  'domestic_priority.rates',
];

/** Service tab that shows the task fields (shared charges live on every service tab). */
export type BlueDartSetupTab = 'air' | 'surface' | 'domestic_priority';

export type BlueDartSetupTask = {
  key: BlueDartSetupAckKey;
  title: string;
  detail: string;
  tab: BlueDartSetupTab;
  /** gap = missing/zero ops input; verify_default = seeded value needs a human check */
  kind: 'gap' | 'verify_default';
};

function isAcked(config: BlueDartConfig, key: BlueDartSetupAckKey): boolean {
  const raw = config.setupAcknowledgements?.[key];
  return typeof raw === 'string' && raw.trim().length > 0;
}

function numsEqual(a: number, b: number): boolean {
  return Math.round(a * 1000) === Math.round(b * 1000);
}

function kgRatesMatchDefault(
  rates: BlueDartConfig['air'],
  defaults: BlueDartConfig['air'],
): boolean {
  return JSON.stringify(rates.perKgInr) === JSON.stringify(defaults.perKgInr)
    && numsEqual(rates.minimumFreightInr, defaults.minimumFreightInr)
    && numsEqual(rates.docketFeeInr, defaults.docketFeeInr)
    && numsEqual(rates.minimumChargeableWeightKg, defaults.minimumChargeableWeightKg);
}

function dpRatesMatchDefault(config: BlueDartConfig): boolean {
  const rates = config.domestic_priority;
  const defaults = defaultBlueDartDomesticPriorityRates();
  return JSON.stringify(rates.first500gInr) === JSON.stringify(defaults.first500gInr)
    && JSON.stringify(rates.addl500gInr) === JSON.stringify(defaults.addl500gInr);
}

function edlNeedsFlat(config: BlueDartConfig): boolean {
  const mode = config.shared.edlMode;
  return mode === 'flat_fallback' || mode === 'matrix_when_km';
}

/** Open setup items for the checklist (completed items omitted). */
export function listOpenBlueDartSetupTasks(config: BlueDartConfig): BlueDartSetupTask[] {
  const sharedDefaults = defaultBlueDartSharedRules();
  const open: BlueDartSetupTask[] = [];

  const maybeVerify = (
    key: BlueDartSetupAckKey,
    stillDefault: boolean,
    title: string,
    detail: string,
    tab: BlueDartSetupTab = 'air',
  ) => {
    if (isAcked(config, key) || !stillDefault) return;
    open.push({ key, title, detail, tab, kind: 'verify_default' });
  };

  maybeVerify(
    'shared.fuelSurchargePercent',
    numsEqual(config.shared.fuelSurchargePercent, sharedDefaults.fuelSurchargePercent),
    'Confirm Fuel (FS) %',
    `Seeded at ${sharedDefaults.fuelSurchargePercent}% — verify against the current Blue Dart circular.`,
  );
  maybeVerify(
    'shared.cafPercent',
    numsEqual(config.shared.cafPercent, sharedDefaults.cafPercent),
    'Confirm CAF %',
    `Seeded at ${sharedDefaults.cafPercent}% — verify against the current circular.`,
  );
  maybeVerify(
    'shared.gstPercent',
    numsEqual(config.shared.gstPercent, sharedDefaults.gstPercent),
    'Confirm GST %',
    `Seeded at ${sharedDefaults.gstPercent}% — change if you quote freight exclusive of GST.`,
  );
  maybeVerify(
    'shared.rasPerKgInr',
    numsEqual(config.shared.rasPerKgInr, sharedDefaults.rasPerKgInr),
    'Confirm Remote area (RAS) ₹/kg',
    `Seeded at ₹${sharedDefaults.rasPerKgInr}/kg for listed RAS states.`,
  );
  maybeVerify(
    'shared.fov',
    numsEqual(config.shared.fov.minInr, sharedDefaults.fov.minInr)
      && numsEqual(config.shared.fov.percentOfInvoice, sharedDefaults.fov.percentOfInvoice),
    'Confirm insurance (FOV)',
    `Seeded min ₹${sharedDefaults.fov.minInr} and ${sharedDefaults.fov.percentOfInvoice}% of invoice.`,
  );
  maybeVerify(
    'shared.originRegion',
    config.shared.originRegion === sharedDefaults.originRegion,
    'Confirm ship-from region',
    'Seeded as SOUTH (Kerala warehouses). Change if your origin region differs.',
  );

  // EDL flat is a real gap when mode needs it and value is still 0.
  if (edlNeedsFlat(config) && config.shared.edlFlatFallbackInr <= 0 && !isAcked(config, 'shared.edlFlatFallbackInr')) {
    open.push({
      key: 'shared.edlFlatFallbackInr',
      title: 'Set EDL flat ₹ (or keep ₹0 intentionally)',
      detail: 'EDL pins with unknown hub distance currently charge ₹0. Enter a flat amount, or acknowledge if ₹0 is correct.',
      tab: 'air',
      kind: 'gap',
    });
  }

  if (
    !isAcked(config, 'air.rates')
    && kgRatesMatchDefault(config.air, defaultBlueDartAirRates())
  ) {
    open.push({
      key: 'air.rates',
      title: 'Review Air (BDAIR) zone rates',
      detail: 'Seeded Apex ₹/kg table — open the Air tab and confirm or edit.',
      tab: 'air',
      kind: 'verify_default',
    });
  }

  if (
    !isAcked(config, 'surface.rates')
    && kgRatesMatchDefault(config.surface, defaultBlueDartSurfaceRates())
  ) {
    open.push({
      key: 'surface.rates',
      title: 'Review Surface (BDFRC) zone rates',
      detail: 'Seeded Surface Band 13 ₹/kg table — open the Surface tab and confirm or edit.',
      tab: 'surface',
      kind: 'verify_default',
    });
  }

  if (!isAcked(config, 'domestic_priority.rates') && dpRatesMatchDefault(config)) {
    open.push({
      key: 'domestic_priority.rates',
      title: 'Review Domestic Priority (BDDP) slabs',
      detail: 'Seeded 500 g slabs — open Domestic Priority and confirm or edit.',
      tab: 'domestic_priority',
      kind: 'verify_default',
    });
  }

  return open;
}

/** Show the inline “verify / keep as is” note above a field. */
export function blueDartFieldNeedsVerifyNote(
  config: BlueDartConfig,
  key: BlueDartSetupAckKey,
): boolean {
  return listOpenBlueDartSetupTasks(config).some(task => task.key === key);
}

export function acknowledgeBlueDartSetup(
  config: BlueDartConfig,
  key: BlueDartSetupAckKey,
  at = new Date().toISOString(),
): BlueDartConfig {
  return {
    ...config,
    setupAcknowledgements: {
      ...(config.setupAcknowledgements ?? {}),
      [key]: at,
    },
  };
}

export function parseBlueDartSetupAcknowledgements(
  raw: unknown,
): Partial<Record<BlueDartSetupAckKey, string>> {
  if (!raw || typeof raw !== 'object') return {};
  const data = raw as Record<string, unknown>;
  const out: Partial<Record<BlueDartSetupAckKey, string>> = {};
  for (const key of BLUE_DART_SETUP_ACK_KEYS) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) {
      out[key] = value.trim();
    }
  }
  return out;
}
