export const SERIAL_SERIES = [
  { id: 'gatc_50kg', label: '50Kg GATC' },
  { id: 'gatc_sl', label: 'Sl printed GATC' },
  { id: 'non_gatc', label: 'non GATC' },
] as const;

export type SerialSeriesId = (typeof SERIAL_SERIES)[number]['id'];

export const DEFAULT_SERIAL_SERIES: SerialSeriesId = 'gatc_50kg';

export type SerialNumberAllotment = {
  id: string;
  series: SerialSeriesId;
  from: string;
  to: string;
  missing: string[];
  count: number;
  createdAt: string;
};

export type SerialNumberAllotmentDoc = {
  allotments: SerialNumberAllotment[];
  updatedAt: string | null;
  updatedBy: string | null;
};
