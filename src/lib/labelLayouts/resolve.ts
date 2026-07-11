import genuineSpareXml from './templates/genuine-spare.xml?raw';
import simpleBinXml from './templates/simple-bin.xml?raw';
import { DEFAULT_LABEL_LAYOUT_ID, isKnownLabelLayoutId } from './registry';

const TEMPLATE_XML: Record<string, string> = {
  'genuine-spare': genuineSpareXml,
  'simple-bin': simpleBinXml,
};

/** Resolve layout XML: optional per-printer override, else repo template by id. */
export function resolveLabelLayoutXml(
  layoutId: string | null | undefined,
  layoutXmlOverride?: string | null,
): { layoutId: string; xml: string; source: 'override' | 'template' } {
  const override = layoutXmlOverride?.trim() ?? '';
  if (override) {
    return {
      layoutId: layoutId?.trim() || DEFAULT_LABEL_LAYOUT_ID,
      xml: override,
      source: 'override',
    };
  }

  const id = layoutId?.trim() || DEFAULT_LABEL_LAYOUT_ID;
  const xml = TEMPLATE_XML[id] ?? TEMPLATE_XML[DEFAULT_LABEL_LAYOUT_ID];
  return {
    layoutId: isKnownLabelLayoutId(id) ? id : DEFAULT_LABEL_LAYOUT_ID,
    xml,
    source: 'template',
  };
}

export function getLabelLayoutTemplateXml(layoutId: string): string {
  return TEMPLATE_XML[layoutId] ?? TEMPLATE_XML[DEFAULT_LABEL_LAYOUT_ID];
}
