/**
 * @deprecated Prefer `labelStudio.ts` (Printers × Layouts × Labels).
 * Kept so older imports keep compiling during the migration window.
 */
export {
  STORE_LABEL_PRINTER_ID,
  emptyStoreLabelPrinter,
  emptyLabelPrinter as emptyLocalPrinter,
  emptyLabelStudioDoc as emptyLocalPrintersDoc,
  loadLabelStudioDoc as loadLocalPrintersDoc,
  saveLabelStudioDoc as saveLocalPrintersDoc,
  validatePrinterHost,
  validateLabelPrinter as validateLocalPrinter,
  type LabelPrinter as LocalPrinter,
  type LabelStudioDoc as LocalPrintersDoc,
} from './labelStudio';
