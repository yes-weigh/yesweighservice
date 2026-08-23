import React, { useState } from 'react';
import { X } from 'lucide-react';
import {
  isValidEmail,
  isValidPhone,
  normalizeEmail,
  normalizePhone,
} from '../../lib/loginAuth';
import { createDealer, dealerErrorMessage } from '../../lib/dealers';
import type { ZohoDealer } from '../../types/dealers';

interface CreateDealerModalProps {
  onClose: () => void;
  onCreated: (dealer: ZohoDealer) => void;
}

export const CreateDealerModal: React.FC<CreateDealerModalProps> = ({
  onClose,
  onCreated,
}) => {
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const company = companyName.trim();
    if (!company) {
      setError('Company name is required.');
      return;
    }
    const mobile = normalizePhone(phone);
    if (phone.trim() && !isValidPhone(mobile)) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }
    const mail = email.trim() ? normalizeEmail(email) : '';
    if (mail && !isValidEmail(mail)) {
      setError('Enter a valid email address.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const dealer = await createDealer({
        companyName: company,
        contactName: contactName.trim() || undefined,
        phone: mobile || undefined,
        email: mail || undefined,
      });
      onCreated(dealer);
    } catch (err) {
      setError(dealerErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dealers-modal-backdrop" onClick={onClose}>
      <div
        className="dealers-modal panel glass"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-labelledby="create-dealer-title"
      >
        <div className="dealers-modal__header">
          <div>
            <h2 id="create-dealer-title">Add dealer</h2>
            <p className="text-muted text-sm">Creates a customer in Zoho Inventory.</p>
          </div>
          <button type="button" className="dealers-modal__close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form className="dealers-modal__form" onSubmit={e => void handleSubmit(e)}>
          <label className="dealers-modal__field">
            <span>Company name</span>
            <input
              type="text"
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              placeholder="Dealer company"
              autoFocus
              required
            />
          </label>
          <label className="dealers-modal__field">
            <span>Contact name</span>
            <input
              type="text"
              value={contactName}
              onChange={e => setContactName(e.target.value)}
              placeholder="Owner / contact"
            />
          </label>
          <label className="dealers-modal__field">
            <span>Mobile</span>
            <input
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="10-digit mobile"
            />
          </label>
          <label className="dealers-modal__field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="optional"
            />
          </label>
          {error ? <p className="dealers-modal__error">{error}</p> : null}
          <div className="dealers-modal__actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create dealer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
