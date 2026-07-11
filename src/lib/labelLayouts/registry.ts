export const DEFAULT_LABEL_LAYOUT_ID = 'genuine-spare';

export type LabelLayoutTemplateMeta = {
  id: string;
  name: string;
  description: string;
};

export const LABEL_LAYOUT_TEMPLATES: LabelLayoutTemplateMeta[] = [
  {
    id: 'genuine-spare',
    name: 'Genuine Spare',
    description: 'Store-room bin label — brand header, fields, rack/row/bin, QR',
  },
  {
    id: 'genuine-spare-product',
    name: 'Genuine Spare Product',
    description: 'Product pack label — header, specs, QR, packed/QC/batch footer (text only)',
  },
  {
    id: 'simple-bin',
    name: 'Simple bin',
    description: 'Compact name + SKU + location + QR for smaller labels',
  },
];

export function isKnownLabelLayoutId(id: string): boolean {
  return LABEL_LAYOUT_TEMPLATES.some(t => t.id === id);
}
