import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Headphones,
  MessageSquareWarning,
  Package,
  RotateCcw,
} from 'lucide-react';
import { createSupportRequest, saveSupportRequestDraft } from '../../lib/dealerSupport';
import { SupportCourierInstructions } from './SupportCourierInstructions';
import type { User } from '../../types';
import type {
  DealerSupportRequest,
  SupportProductDraft,
  SupportRequestType,
} from '../../types/dealer-support';
import {
  COMPLAINT_CATEGORY_OPTIONS,
  RETURN_REASON_OPTIONS,
  SERVICE_ISSUE_OPTIONS,
  SUPPORT_INTENT_OPTIONS,
  SUPPORT_TYPE_LABELS,
  DEALER_COURIER_NOTICE,
  supportCategoryValueFromStored,
} from '../../types/dealer-support';
import {
  SupportEvidencePicker,
  cleanupPendingFiles,
  pendingFilesToUpload,
} from './SupportEvidencePicker';
import { validateEvidenceFiles, type SupportSubmitProgress } from '../../lib/supportAttachments';
import { SupportWizardSubmitProgress } from './SupportWizardSubmitProgress';
import {
  SupportInvoiceAutocomplete,
  SupportInvoiceProductPicker,
  type SupportInvoicePick,
} from './SupportInvoiceFields';
import type { PendingSupportFile } from '../../lib/supportAttachments';

type WizardStep = 'intent' | 'product' | 'details' | 'success';

function requestToProductDraft(request: DealerSupportRequest): SupportProductDraft | null {
  if (!request.invoiceId || !request.invoiceNumber || !request.product?.lineItemId) {
    return null;
  }
  return {
    invoiceId: request.invoiceId,
    invoiceNumber: request.invoiceNumber,
    salesOrderNumber: request.salesOrderNumber,
    lineItemId: request.product.lineItemId,
    itemId: request.product.itemId,
    itemName: request.product.name,
    itemSku: request.product.sku,
    quantity: request.product.quantity,
  };
}

function initialWizardStep(
  initialIntent?: SupportRequestType | null,
  productDraft?: SupportProductDraft | null,
  resumeDraft?: DealerSupportRequest | null,
): WizardStep {
  if (resumeDraft) return 'details';
  if (productDraft && initialIntent) return 'details';
  if (initialIntent) return 'product';
  return 'intent';
}

function progressStepState(
  step: WizardStep,
  target: 1 | 2 | 3,
): 'is-active' | 'is-done' | '' {
  const order: Record<WizardStep, number> = {
    intent: 1,
    product: 2,
    details: 3,
    success: 4,
  };
  const current = order[step];
  if (target < current) return 'is-done';
  if (target === current) return 'is-active';
  return '';
}

interface SupportWizardProps {
  user: User;
  productDraft: SupportProductDraft | null;
  initialIntent?: SupportRequestType | null;
  resumeDraft?: DealerSupportRequest | null;
  onCancel: () => void;
  onSuccess: (requestNumber: string, type: SupportRequestType, requestId: string) => void;
  onDraftSaved?: (requestNumber: string, requestId: string) => void;
}

const INTENT_ICONS: Record<SupportRequestType, React.ReactNode> = {
  service: <Headphones size={22} />,
  return: <RotateCcw size={22} />,
  complaint: <MessageSquareWarning size={22} />,
};

function supportActionErrorMessage(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : fallback;
  if (message.includes('signBlob') || message.includes('serviceAccounts.signBlob')) {
    return 'Upload could not start on the server. Please try again.';
  }
  return message || fallback;
}

export const SupportWizard: React.FC<SupportWizardProps> = ({
  user,
  productDraft,
  initialIntent,
  resumeDraft,
  onCancel,
  onSuccess,
  onDraftSaved,
}) => {
  const [step, setStep] = useState<WizardStep>(() =>
    initialWizardStep(initialIntent, productDraft, resumeDraft),
  );
  const [intent, setIntent] = useState<SupportRequestType | null>(
    resumeDraft?.type ?? initialIntent ?? null,
  );
  const [category, setCategory] = useState(() => {
    if (resumeDraft) {
      return supportCategoryValueFromStored(resumeDraft.type, resumeDraft.category);
    }
    return initialIntent === 'service' ? 'repair' : initialIntent === 'return' ? 'doa' : 'billing';
  });
  const [subject, setSubject] = useState(resumeDraft?.subject ?? '');
  const [description, setDescription] = useState(resumeDraft?.description ?? '');
  const [serialNumber, setSerialNumber] = useState(resumeDraft?.product?.serialNumber ?? '');
  const [productSelection, setProductSelection] = useState<SupportProductDraft | null>(
    productDraft ?? (resumeDraft ? requestToProductDraft(resumeDraft) : null),
  );
  const [complaintInvoice, setComplaintInvoice] = useState<SupportInvoicePick | null>(() => {
    if (productDraft) {
      return {
        invoiceId: productDraft.invoiceId,
        invoiceNumber: productDraft.invoiceNumber,
        salesOrderNumber: productDraft.salesOrderNumber,
      };
    }
    if (resumeDraft?.invoiceId && resumeDraft.invoiceNumber) {
      return {
        invoiceId: resumeDraft.invoiceId,
        invoiceNumber: resumeDraft.invoiceNumber,
        salesOrderNumber: resumeDraft.salesOrderNumber,
      };
    }
    return null;
  });
  const [draftRequestId, setDraftRequestId] = useState(resumeDraft?.id ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [error, setError] = useState('');
  const [submittedRequestNumber, setSubmittedRequestNumber] = useState('');
  const [createdRequestId, setCreatedRequestId] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingSupportFile[]>([]);
  const [submitProgress, setSubmitProgress] = useState<SupportSubmitProgress | null>(null);

  const isBusy = submitting || savingDraft;

  const categoryOptions = useMemo(() => {
    if (intent === 'return') return RETURN_REASON_OPTIONS;
    if (intent === 'complaint') return COMPLAINT_CATEGORY_OPTIONS;
    return SERVICE_ISSUE_OPTIONS;
  }, [intent]);

  const categoryLabel = useMemo(
    () => categoryOptions.find(option => option.value === category)?.label ?? category,
    [category, categoryOptions],
  );

  const needsProduct = intent === 'service' || intent === 'return';

  const selectIntent = (value: SupportRequestType) => {
    setIntent(value);
    setCategory(
      value === 'service' ? 'repair' : value === 'return' ? 'doa' : 'billing',
    );
    setError('');
  };

  const proceedWithIntent = (value: SupportRequestType) => {
    selectIntent(value);
    setStep('product');
  };

  const handleProductNext = () => {
    if (needsProduct && !productDraft && !productSelection) {
      setError('Select an invoice and product from your invoice.');
      return;
    }
    setError('');
    setStep('details');
  };

  const buildRequestPayload = () => {
    const selection = productDraft ?? productSelection;
    return {
      type: intent!,
      requestId: draftRequestId || undefined,
      invoiceId: selection?.invoiceId ?? complaintInvoice?.invoiceId ?? null,
      invoiceNumber: selection?.invoiceNumber ?? complaintInvoice?.invoiceNumber ?? null,
      salesOrderNumber: selection?.salesOrderNumber ?? complaintInvoice?.salesOrderNumber ?? null,
      lineItemId: selection?.lineItemId ?? null,
      itemId: selection?.itemId ?? null,
      itemName: selection?.itemName,
      itemSku: selection?.itemSku ?? null,
      serialNumber: serialNumber.trim() || null,
      quantity: selection?.quantity ?? 1,
      category: categoryLabel,
      subject: intent === 'complaint' ? subject.trim() : undefined,
      description: description.trim(),
    };
  };

  const handleSaveDraft = async () => {
    if (!intent) return;

    if (needsProduct && !productDraft && !productSelection) {
      setError('Select an invoice and product before saving a draft.');
      return;
    }

    setSavingDraft(true);
    setSubmitProgress({ phase: 'preparing', label: 'Saving draft…', percent: null });
    setError('');
    try {
      const saved = await saveSupportRequestDraft(user, buildRequestPayload());
      setDraftRequestId(saved.id);
      setSubmitProgress({ phase: 'finalizing', label: 'Draft saved', percent: 100 });
      onDraftSaved?.(saved.requestNumber, saved.id);
    } catch (err) {
      setError(supportActionErrorMessage(err, 'Could not save draft.'));
    } finally {
      setSavingDraft(false);
      setSubmitProgress(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent) return;

    if (intent === 'complaint' && !subject.trim()) {
      setError('Enter a short subject for your complaint.');
      return;
    }
    if (!description.trim()) {
      setError('Please describe the issue.');
      return;
    }
    const evidenceError = validateEvidenceFiles(pendingFiles);
    if (evidenceError) {
      setError(evidenceError);
      return;
    }

    setSubmitting(true);
    setSubmitProgress({ phase: 'preparing', label: 'Starting submit…', percent: 2 });
    setError('');
    try {
      const created = await createSupportRequest(user, {
        ...buildRequestPayload(),
        attachmentFiles: pendingFilesToUpload(pendingFiles),
      }, setSubmitProgress);
      cleanupPendingFiles(pendingFiles);
      setPendingFiles([]);
      setStep('success');
      setSubmittedRequestNumber(created.requestNumber);
      setCreatedRequestId(created.id);
    } catch (err) {
      setError(supportActionErrorMessage(err, 'Could not submit request.'));
    } finally {
      setSubmitting(false);
      setSubmitProgress(null);
    }
  };

  if (step === 'success' && intent) {
    return (
      <div className="support-wizard__success-wrap">
        <div className="support-wizard__success panel glass">
          <div className="support-wizard__success-icon" aria-hidden>
            {INTENT_ICONS[intent]}
          </div>
          <h3>Request submitted</h3>
          {submittedRequestNumber && (
            <p className="support-wizard__request-number">{submittedRequestNumber}</p>
          )}
          <p className="text-muted text-sm">
            Your {SUPPORT_TYPE_LABELS[intent].toLowerCase()} request has been logged.
            {needsProduct
              ? ' Review the shipping details below — ship only after we approve this request.'
              : ' Our team will review and contact you shortly.'}
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              if (submittedRequestNumber && intent && createdRequestId) {
                onSuccess(submittedRequestNumber, intent, createdRequestId);
              } else {
                onCancel();
              }
            }}
          >
            Back to requests
          </button>
        </div>

        {needsProduct && (
          <SupportCourierInstructions requestNumber={submittedRequestNumber} />
        )}
      </div>
    );
  }

  const selectedProduct = productDraft ?? productSelection;

  return (
    <div className="support-wizard">
      <div className="support-wizard__progress support-wizard__progress--three" aria-hidden>
        <span className={progressStepState(step, 1)}>1</span>
        <span className="support-wizard__progress-line" />
        <span className={progressStepState(step, 2)}>2</span>
        <span className="support-wizard__progress-line" />
        <span className={progressStepState(step, 3)}>3</span>
      </div>

      {error && <p className="support-wizard__error">{error}</p>}

      {step === 'intent' && (
        <section className="support-wizard__step panel glass">
          <h3 className="support-wizard__question">What do you need help with?</h3>
          <p className="support-wizard__lead text-muted text-sm">
            Choose the option that best matches your situation. This helps our team route
            your case to the right department.
          </p>
          <p className="support-wizard__courier-note">{DEALER_COURIER_NOTICE}</p>

          <div className="support-wizard__options" role="radiogroup" aria-label="Support type">
            {SUPPORT_INTENT_OPTIONS.map(option => {
              const selected = intent === option.value;
              return (
              <div
                key={option.value}
                className={`support-wizard__option ${selected ? 'is-selected' : ''}`}
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => selectIntent(option.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectIntent(option.value);
                  }
                }}
              >
                <span className="support-wizard__option-icon">{INTENT_ICONS[option.value]}</span>
                <span className="support-wizard__option-body">
                  <strong>{option.title}</strong>
                  <span className="support-wizard__option-desc">{option.description}</span>
                  <span className="support-wizard__option-hint">{option.hint}</span>
                  {selected && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm support-wizard__option-next"
                      onClick={e => {
                        e.stopPropagation();
                        proceedWithIntent(option.value);
                      }}
                    >
                      Next
                      <ArrowRight size={16} />
                    </button>
                  )}
                </span>
              </div>
              );
            })}
          </div>

          <div className="support-wizard__actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {step === 'product' && intent && (
        <section className="support-wizard__step support-wizard__step--details panel glass">
          <div className="support-wizard__step-body">
            <button
              type="button"
              className="support-wizard__back-link"
              onClick={() => {
                if (initialIntent) {
                  onCancel();
                } else {
                  setStep('intent');
                }
              }}
            >
              <ArrowLeft size={15} />
              {initialIntent ? 'Cancel' : 'Change request type'}
            </button>

            <h3 className="support-wizard__question">
              {needsProduct ? 'Select invoice & product' : 'Link invoice'}
            </h3>

            {needsProduct && (
              <p className="support-wizard__courier-note">{DEALER_COURIER_NOTICE}</p>
            )}

            {productDraft && (
              <div className="support-wizard__product panel glass">
                <Package size={18} aria-hidden />
                <div>
                  <strong>{productDraft.itemName}</strong>
                  <span className="text-muted text-sm">
                    Invoice {productDraft.invoiceNumber}
                    {productDraft.salesOrderNumber && ` · SO ${productDraft.salesOrderNumber}`}
                  </span>
                </div>
              </div>
            )}

            {!productDraft && needsProduct && (
              <SupportInvoiceProductPicker
                userId={user.uid}
                value={productSelection}
                onChange={setProductSelection}
                disabled={isBusy}
                requestType={intent === 'service' || intent === 'return' ? intent : undefined}
              />
            )}

            {!productDraft && intent === 'complaint' && (
              <SupportInvoiceAutocomplete
                userId={user.uid}
                value={complaintInvoice}
                onChange={setComplaintInvoice}
                disabled={isBusy}
                id="support-invoice-complaint"
                label="Invoice / order ref"
                placeholder="Search invoice if related to an order"
              />
            )}
          </div>

          <div className="support-wizard__actions support-wizard__actions--dock" aria-label="Form actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleProductNext}>
              Next
              <ArrowRight size={16} />
            </button>
          </div>
        </section>
      )}

      {step === 'details' && intent && (
        <form
          className={[
            'support-wizard__step support-wizard__step--details panel glass',
            isBusy && submitProgress ? 'support-wizard__step--busy' : '',
          ].filter(Boolean).join(' ')}
          onSubmit={e => void handleSubmit(e)}
        >
          <div className="support-wizard__step-body">
          <button
            type="button"
            className="support-wizard__back-link"
            onClick={() => {
              if (productDraft) {
                onCancel();
              } else {
                setStep('product');
              }
            }}
          >
            <ArrowLeft size={15} />
            {productDraft ? 'Cancel' : 'Back to invoice & product'}
          </button>

          <h3 className="support-wizard__question">
            {intent === 'service' && 'Service / repair details'}
            {intent === 'return' && 'Replacement request details'}
            {intent === 'complaint' && 'Complaint details'}
          </h3>

          {needsProduct && (
            <p className="support-wizard__courier-note">{DEALER_COURIER_NOTICE}</p>
          )}

          {selectedProduct && (
            <div className="support-wizard__product panel glass">
              <Package size={18} aria-hidden />
              <div>
                <strong>{selectedProduct.itemName}</strong>
                <span className="text-muted text-sm">
                  Invoice {selectedProduct.invoiceNumber}
                  {selectedProduct.salesOrderNumber && ` · SO ${selectedProduct.salesOrderNumber}`}
                </span>
              </div>
            </div>
          )}

          {!selectedProduct && complaintInvoice && (
            <div className="support-wizard__product panel glass">
              <Package size={18} aria-hidden />
              <div>
                <strong>Invoice {complaintInvoice.invoiceNumber}</strong>
                {complaintInvoice.salesOrderNumber && (
                  <span className="text-muted text-sm">Order {complaintInvoice.salesOrderNumber}</span>
                )}
              </div>
            </div>
          )}

          {needsProduct && (
            <div className="form-group">
              <label htmlFor="support-serial">Serial number</label>
              <input
                id="support-serial"
                className="catalog-select"
                value={serialNumber}
                onChange={e => setSerialNumber(e.target.value)}
                placeholder="Unit serial number, if available"
                disabled={isBusy}
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="support-category">
              {intent === 'service' && 'Issue type'}
              {intent === 'return' && 'Replacement reason'}
              {intent === 'complaint' && 'Complaint category'}
              <span className="form-label__required" aria-hidden> *</span>
            </label>
            <select
              id="support-category"
              className="catalog-select"
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              {categoryOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {intent === 'complaint' && (
            <div className="form-group">
              <label htmlFor="support-subject">
                Subject
                <span className="form-label__required" aria-hidden> *</span>
              </label>
              <input
                id="support-subject"
                className="catalog-select"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Brief summary of your complaint"
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="support-description">
              {intent === 'complaint' ? 'Full description' : 'Describe the problem'}
              <span className="form-label__required" aria-hidden> *</span>
            </label>
            <textarea
              id="support-description"
              className="service-request-form__textarea"
              rows={4}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={
                intent === 'return'
                  ? 'When did the fault start? Any error messages or photos available?'
                  : intent === 'complaint'
                    ? 'What happened, when, and what outcome do you expect?'
                    : 'Symptoms, error codes, when it started, etc.'
              }
            />
          </div>

          <div className="form-group form-group--flush">
            <SupportEvidencePicker
              files={pendingFiles}
              onChange={setPendingFiles}
              disabled={isBusy}
            />
          </div>
          </div>

          <div className="support-wizard__actions support-wizard__actions--dock" aria-label="Form actions">
            {isBusy && submitProgress && (
              <SupportWizardSubmitProgress progress={submitProgress} />
            )}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onCancel}
              disabled={isBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void handleSaveDraft()}
              disabled={isBusy}
            >
              {savingDraft ? 'Saving…' : 'Save draft'}
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={isBusy}
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
