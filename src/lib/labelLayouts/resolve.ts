import { DEFAULT_LABEL_LAYOUT_ID, isKnownLabelLayoutId } from './registry';
import genuineSpareXml from './templates/genuine-spare.xml?raw';
import genuineSpareProductXml from './templates/genuine-spare-product.xml?raw';
import catalogProductXml from './templates/catalog-product.xml?raw';
import simpleBinXml from './templates/simple-bin.xml?raw';

const TEMPLATE_XML: Record<string, string> = {
  'genuine-spare': genuineSpareXml,
  'genuine-spare-product': genuineSpareProductXml,
  'catalog-product': catalogProductXml,
  'simple-bin': simpleBinXml,
};

/** Built-in layout XML by id (repo templates only — not user-editable). */
export function getLabelLayoutTemplateXml(layoutId: string): string {
  return TEMPLATE_XML[layoutId] ?? TEMPLATE_XML[DEFAULT_LABEL_LAYOUT_ID];
}

/** Resolve layout XML from a known template id. */
export function resolveLabelLayoutXml(
  layoutId: string | null | undefined,
): { layoutId: string; xml: string } {
  const id = layoutId?.trim() || DEFAULT_LABEL_LAYOUT_ID;
  const resolved = isKnownLabelLayoutId(id) ? id : DEFAULT_LABEL_LAYOUT_ID;
  return {
    layoutId: resolved,
    xml: getLabelLayoutTemplateXml(resolved),
  };
}
