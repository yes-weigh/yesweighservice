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
  createdBy: string | null;
  pushedAt: string | null;
  pushError: string | null;
  sku?: string | null;
  imageUrl?: string | null;
  productName?: string | null;
  sourcePoNumber?: string | null;
  sourceLineId?: string | null;
  sourceGoodsReceiptId?: string | null;
};

export type SerialNumberAllotmentDoc = {
  allotments: SerialNumberAllotment[];
  webhookUrl: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};
