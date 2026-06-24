import React, { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, MessageSquareWarning, XCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { supportBasePath } from '../../lib/dealerSupport';

interface GuidelinesLocationState {
  openWizard?: boolean;
}

const REPAIR_TYPES = [
  'Product not working',
  'Display issue',
  'Weighing error',
  'Printer issue',
  'Calibration issue',
  'Spare part failure',
];

const REPLACEMENT_TYPES = [
  'Dead on Arrival (DOA)',
  'Transit damage',
  'Wrong product received',
  'Manufacturing defect',
];

const OTHER_COMPLAINT_TYPES = [
  'Missing item',
  'Invoice issue',
  'Delivery delay',
  'Order mismatch',
  'Service-related issue',
  'General feedback',
];

const VIDEO_CHECKLIST = [
  'Product condition',
  'Nature of the issue',
  'Product operation (if applicable)',
  'Display, indicators, or error messages',
  'Brief audio explanation of the problem',
];

const REVIEW_STEPS = [
  'Submit Complaint',
  'Technical Review by YESWEIGH',
  'Verification of Evidence',
  'Approval by Support Team',
  'Inspection (if required)',
  'Repair or Replacement Decision',
  'Complaint Closure',
];

const RESPONSE_TIMES = [
  { type: 'Technical Support', time: 'Within 1 Working Day' },
  { type: 'Spare Parts Complaint', time: 'Within 1 Working Day' },
  { type: 'Product Replacement', time: '2–3 Working Days' },
  { type: 'General Complaint', time: '1–2 Working Days' },
];

const REJECTION_REASONS = [
  'Video evidence is not provided',
  'Serial number is missing or unclear',
  'Product has been tampered with',
  'Warranty or service terms are violated',
  'Incorrect or misleading information is submitted',
  'Duplicate complaint already exists',
];

const TRACKING_STATUSES = [
  'Submitted',
  'Under Review',
  'Approved',
  'Awaiting Product',
  'Inspection in Progress',
  'Repair in Progress',
  'Replacement Approved',
  'Closed',
];

export const ComplaintGuidelinesPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as GuidelinesLocationState | null) ?? {};
  const base = user ? supportBasePath(user.role) : '/dealer/warranty-support';

  const handleBack = useCallback(() => {
    if (state.openWizard) {
      navigate(base, { state: { openWizard: true } });
      return;
    }
    navigate(base);
  }, [base, navigate, state.openWizard]);

  useCatalogPageHeader({
    title: 'Complaint guidelines',
    showBack: true,
    onBack: handleBack,
  });

  return (
    <div className="page-content fade-in complaint-guidelines-page">
      <header className="complaint-guidelines-page__intro panel glass">
        <MessageSquareWarning size={28} className="complaint-guidelines-page__intro-icon" aria-hidden />
        <div>
          <h1 className="complaint-guidelines-page__title">YESWEIGH Complaint Guidelines</h1>
          <h2 className="complaint-guidelines-page__subtitle">Before You Submit a Complaint</h2>
          <p className="text-muted text-sm">
            To help us resolve your issue quickly and efficiently, please follow the guidelines below.
          </p>
        </div>
      </header>

      <section className="complaint-guidelines-page__section panel glass">
        <h3>1. Select the Correct Complaint Type</h3>

        <div className="complaint-guidelines-page__subsection">
          <h4>Repair / Technical Support</h4>
          <ul className="complaint-guidelines-page__list">
            {REPAIR_TYPES.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="complaint-guidelines-page__subsection">
          <h4>Product Replacement</h4>
          <ul className="complaint-guidelines-page__list">
            {REPLACEMENT_TYPES.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="complaint-guidelines-page__subsection">
          <h4>Other Complaints</h4>
          <ul className="complaint-guidelines-page__list">
            {OTHER_COMPLAINT_TYPES.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="complaint-guidelines-page__section panel glass">
        <h3>2. Video Evidence (Mandatory)</h3>
        <p className="text-muted text-sm complaint-guidelines-page__lead">
          Record a clear video showing:
        </p>
        <ul className="complaint-guidelines-page__tips">
          {VIDEO_CHECKLIST.map(item => (
            <li key={item}>
              <CheckCircle2 size={16} aria-hidden />
              {item}
            </li>
          ))}
        </ul>
        <div className="complaint-guidelines-page__duration">
          <p><strong>Minimum Duration:</strong> 30 Seconds</p>
          <p><strong>Maximum Duration:</strong> 2 Minutes</p>
        </div>
      </section>

      <section className="complaint-guidelines-page__section panel glass">
        <h3>3. Serial Number Photo (Mandatory)</h3>
        <p className="text-muted text-sm complaint-guidelines-page__lead">
          Upload a clear photo showing:
        </p>
        <ul className="complaint-guidelines-page__list">
          <li>Product Serial Number</li>
          <li>Model Number</li>
          <li>Identification Label</li>
        </ul>
        <p className="complaint-guidelines-page__note text-sm">
          The serial number must be clearly visible and readable.
        </p>
      </section>

      <section className="complaint-guidelines-page__section panel glass">
        <h3>4. Product Label Photo (Mandatory)</h3>
        <p className="text-muted text-sm complaint-guidelines-page__lead">
          Upload a clear photo showing:
        </p>
        <ul className="complaint-guidelines-page__list">
          <li>YESWEIGH Product Label</li>
          <li>Model Information</li>
          <li>Part Number (for spare parts complaints)</li>
        </ul>
      </section>

      <section className="complaint-guidelines-page__section panel glass">
        <h3>5. Additional Photos (Recommended)</h3>
        <p className="text-muted text-sm complaint-guidelines-page__lead">You may also upload:</p>
        <ul className="complaint-guidelines-page__list">
          <li>Damaged area photos</li>
          <li>Packaging photos</li>
          <li>Courier package photos</li>
          <li>Invoice copy</li>
          <li>Delivery label</li>
        </ul>
      </section>

      <section className="complaint-guidelines-page__section panel glass">
        <h3>6. Complaint Review Process</h3>
        <ol className="complaint-guidelines-page__process">
          {REVIEW_STEPS.map(step => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="complaint-guidelines-page__warning-banner">
          <AlertCircle size={16} aria-hidden />
          Do not courier any product unless instructed by YESWEIGH Support.
        </p>
      </section>

      <section className="complaint-guidelines-page__section panel glass">
        <h3>7. Expected Response Time</h3>
        <div className="complaint-guidelines-page__table-wrap">
          <table className="complaint-guidelines-page__table">
            <thead>
              <tr>
                <th scope="col">Complaint Type</th>
                <th scope="col">Response Time</th>
              </tr>
            </thead>
            <tbody>
              {RESPONSE_TIMES.map(row => (
                <tr key={row.type}>
                  <td>{row.type}</td>
                  <td>{row.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="complaint-guidelines-page__section panel glass">
        <h3>8. Complaint May Be Rejected If</h3>
        <ul className="complaint-guidelines-page__reject">
          {REJECTION_REASONS.map(reason => (
            <li key={reason}>
              <XCircle size={16} aria-hidden />
              {reason}
            </li>
          ))}
        </ul>
      </section>

      <section className="complaint-guidelines-page__section panel glass">
        <h3>9. Complaint Tracking</h3>
        <p className="text-muted text-sm complaint-guidelines-page__lead">
          After submission, a unique Complaint ID will be generated.
        </p>
        <p className="complaint-guidelines-page__example">Example: CMP-2026-000123</p>
        <p className="text-muted text-sm">You can track the status:</p>
        <ul className="complaint-guidelines-page__list complaint-guidelines-page__list--status">
          {TRACKING_STATUSES.map(status => (
            <li key={status}>{status}</li>
          ))}
        </ul>
      </section>

      <section className="complaint-guidelines-page__declaration panel glass">
        <h3>Declaration</h3>
        <p>
          I hereby confirm that all information, photos, videos, serial numbers, invoices,
          supporting documents, and evidence submitted with this complaint are true and accurate
          to the best of my knowledge.
        </p>
        <p>
          I understand that Interweighing Private Limited reserves the right to inspect, verify,
          test, and evaluate the complaint before approval, repair, replacement, or closure.
        </p>
        <p>
          Providing false, incomplete, or misleading information may result in rejection of the
          complaint and suspension of warranty or service support.
        </p>
        <p>
          By submitting this complaint, I agree to the above terms and conditions.
        </p>
      </section>
    </div>
  );
};
