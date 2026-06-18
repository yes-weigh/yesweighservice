import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Headphones,
  MessageSquareWarning,
  Package,
  RotateCcw,
} from 'lucide-react';
import { createSupportRequest } from '../../lib/dealerSupport';
import { SupportCourierInstructions } from './SupportCourierInstructions';
import type { User } from '../../types';
import type {
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
} from '../../types/dealer-support';
import {
  SupportAttachmentPicker,
  cleanupPendingFiles,
  pendingFilesToUpload,
} from './SupportAttachmentPicker';
import type { PendingSupportFile } from '../../lib/supportAttachments';

type WizardStep = 'intent' | 'details' | 'success';

interface SupportWizardProps {
  user: User;
  productDraft: SupportProductDraft | null;
  initialIntent?: SupportRequestType | null;
  onCancel: () => void;
  onSuccess: (requestNumber: string, type: SupportRequestType, requestId: string) => void;
}

const INTENT_ICONS: Record<SupportRequestType, React.ReactNode> = {
  service: <Headphones size={22} />,
  return: <RotateCcw size={22} />,
  complaint: <MessageSquareWarning size={22} />,
};

export const SupportWizard: React.FC<SupportWizardProps> = ({
  user,
  productDraft,
  initialIntent,
  onCancel,
  onSuccess,
}) => {
  const [step, setStep] = useState<WizardStep>(initialIntent ? 'details' : 'intent');
  const [intent, setIntent] = useState<SupportRequestType | null>(initialIntent ?? null);
  const [category, setCategory] = useState(
    initialIntent === 'service' ? 'repair' : initialIntent === 'return' ? 'doa' : 'billing',
  );
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState(productDraft?.invoiceNumber ?? '');
  const [productName, setProductName] = useState(productDraft?.itemName ?? '');
  const [productSku, setProductSku] = useState(productDraft?.itemSku ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submittedRequestNumber, setSubmittedRequestNumber] = useState('');
  const [createdRequestId, setCreatedRequestId] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingSupportFile[]>([]);

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

  const handleIntentNext = () => {
    if (!intent) {
      setError('Please select what you need help with.');
      return;
    }
    setError('');
    setStep('details');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent) return;

    if (needsProduct && !productDraft && !productName.trim() && !invoiceNumber.trim()) {
      setError('Enter the invoice number or product name.');
      return;
    }
    if (intent === 'complaint' && !subject.trim()) {
      setError('Enter a short subject for your complaint.');
      return;
    }
    if (!description.trim()) {
      setError('Please describe the issue.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const created = await createSupportRequest(user, {
        type: intent,
        invoiceId: productDraft?.invoiceId ?? null,
        invoiceNumber: productDraft?.invoiceNumber ?? (invoiceNumber.trim() || null),
        salesOrderNumber: productDraft?.salesOrderNumber ?? null,
        lineItemId: productDraft?.lineItemId ?? null,
        itemId: productDraft?.itemId ?? null,
        itemName: productDraft?.itemName ?? (productName.trim() || undefined),
        itemSku: (productDraft?.itemSku ?? productSku.trim()) || null,
        quantity: productDraft?.quantity ?? 1,
        category: categoryLabel,
        subject: intent === 'complaint' ? subject.trim() : undefined,
        description: description.trim(),
        attachmentFiles: pendingFilesToUpload(pendingFiles),
      });
      cleanupPendingFiles(pendingFiles);
      setPendingFiles([]);
      setStep('success');
      setSubmittedRequestNumber(created.requestNumber);
      setCreatedRequestId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit request.');
    } finally {
      setSubmitting(false);
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

  return (
    <div className="support-wizard">
      <div className="support-wizard__progress" aria-hidden>
        <span className={step === 'intent' ? 'is-active' : 'is-done'}>1</span>
        <span className="support-wizard__progress-line" />
        <span className={step === 'details' ? 'is-active' : ''}>2</span>
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
            {SUPPORT_INTENT_OPTIONS.map(option => (
              <label
                key={option.value}
                className={`support-wizard__option ${intent === option.value ? 'is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="support-intent"
                  value={option.value}
                  checked={intent === option.value}
                  onChange={() => {
                    setIntent(option.value);
                    setCategory(
                      option.value === 'service'
                        ? 'repair'
                        : option.value === 'return'
                          ? 'doa'
                          : 'billing',
                    );
                    setError('');
                  }}
                />
                <span className="support-wizard__option-icon">{INTENT_ICONS[option.value]}</span>
                <span className="support-wizard__option-body">
                  <strong>{option.title}</strong>
                  <span className="support-wizard__option-desc">{option.description}</span>
                  <span className="support-wizard__option-hint">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="support-wizard__actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleIntentNext}>
              Next
              <ArrowRight size={16} />
            </button>
          </div>
        </section>
      )}

      {step === 'details' && intent && (
        <form className="support-wizard__step panel glass" onSubmit={e => void handleSubmit(e)}>
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
            {intent === 'service' && 'Service / repair details'}
            {intent === 'return' && 'Replacement request details'}
            {intent === 'complaint' && 'Complaint details'}
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
            <div className="support-wizard__fields">
              <div className="form-group">
                <label htmlFor="support-invoice">Invoice number</label>
                <input
                  id="support-invoice"
                  className="catalog-select"
                  value={invoiceNumber}
                  onChange={e => setInvoiceNumber(e.target.value)}
                  placeholder="e.g. INV-2024-00123"
                />
              </div>
              <div className="form-group">
                <label htmlFor="support-product">Product name</label>
                <input
                  id="support-product"
                  className="catalog-select"
                  value={productName}
                  onChange={e => setProductName(e.target.value)}
                  placeholder="Product model or name"
                />
              </div>
              <div className="form-group">
                <label htmlFor="support-sku">SKU (optional)</label>
                <input
                  id="support-sku"
                  className="catalog-select"
                  value={productSku}
                  onChange={e => setProductSku(e.target.value)}
                />
              </div>
            </div>
          )}

          {!productDraft && intent === 'complaint' && (
            <div className="form-group">
              <label htmlFor="support-invoice-complaint">Invoice / order ref (optional)</label>
              <input
                id="support-invoice-complaint"
                className="catalog-select"
                value={invoiceNumber}
                onChange={e => setInvoiceNumber(e.target.value)}
                placeholder="If related to a specific order"
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="support-category">
              {intent === 'service' && 'Issue type'}
              {intent === 'return' && 'Replacement reason'}
              {intent === 'complaint' && 'Complaint category'}
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
              <label htmlFor="support-subject">Subject</label>
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

          <div className="form-group">
            <label>Photos &amp; videos (optional)</label>
            <SupportAttachmentPicker
              files={pendingFiles}
              onChange={setPendingFiles}
              disabled={submitting}
            />
          </div>

          <div className="support-wizard__actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit request'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
