import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Mail,
  PackageCheck,
  Phone,
  User,
  Users,
} from 'lucide-react';
import { fetchDealerById } from '../../lib/dealers';
import { canManageSupportOps } from '../../lib/staffAccess';
import { isSupportOpen } from '../../lib/supportStatus';
import type { User as AppUser } from '../../types';
import type { DealerSupportRequest, SupportOpenStage } from '../../types/dealer-support';
import { SUPPORT_OPEN_STAGE_LABELS } from '../../types/dealer-support';
import { SupportAssigneeSelect } from './SupportAssigneeSelect';
import { SupportRequestTicketInfo } from './SupportRequestTicketInfo';

export interface SupportRequestDetailPanelProps {
  request: DealerSupportRequest;
  user: AppUser | null;
  open: boolean;
  onClose: () => void;
  error?: string;
  statusUpdating: boolean;
  resolutionNote: string;
  onResolutionNoteChange: (value: string) => void;
  staffStageOptions: SupportOpenStage[];
  canApproveCourier: boolean;
  canMarkReceived: boolean;
  canDealerCancel: boolean;
  onStageChange: (stage: SupportOpenStage) => void;
  onApproveCourier: () => void;
  onMarkReceived: () => void;
  onResolve: () => void;
  onCancel: () => void;
  onDealerCancel: () => void;
  onAdminDelete: () => void;
}

interface TicketContact {
  company: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
}

function InfoRow({
  icon,
  tone,
  label,
  value,
}: {
  icon: React.ReactNode;
  tone: 'purple' | 'blue' | 'green' | 'orange' | 'amber' | 'sky' | 'yellow' | 'violet';
  label: string;
  value: string;
}) {
  return (
    <div className="support-detail-info-row">
      <span className={`support-detail-info-row__icon support-detail-info-row__icon--${tone}`} aria-hidden>
        {icon}
      </span>
      <span className="support-detail-info-row__label">{label}</span>
      <span className="support-detail-info-row__value">{value}</span>
    </div>
  );
}

export const SupportRequestDetailPanel: React.FC<SupportRequestDetailPanelProps> = ({
  request,
  user,
  open,
  onClose,
  error,
  statusUpdating,
  resolutionNote,
  onResolutionNoteChange,
  staffStageOptions,
  canApproveCourier,
  canMarkReceived,
  canDealerCancel,
  onStageChange,
  onApproveCourier,
  onMarkReceived,
  onResolve,
  onCancel,
  onDealerCancel,
  onAdminDelete,
}) => {
  const [contact, setContact] = useState<TicketContact | null>(null);
  const isStaff = canManageSupportOps(user);

  useEffect(() => {
    if (!open || !isStaff) {
      setContact(null);
      return undefined;
    }

    let cancelled = false;

    const loadContact = async () => {
      try {
        const dealer = await fetchDealerById(request.dealerId);
        if (cancelled) return;
        const primary = dealer.zohoPrimaryContact
          ?? dealer.zohoContactPersons?.find(person => person.isPrimary)
          ?? dealer.zohoContactPersons?.[0]
          ?? null;
        setContact({
          company: request.dealerName ?? dealer.companyName ?? dealer.contactName ?? null,
          contactName: request.createdByName || primary?.name || primary?.firstName || null,
          phone: primary?.mobile || primary?.phone || dealer.mobile || dealer.phone || null,
          email: primary?.email || dealer.email || dealer.zohoEmail || null,
        });
      } catch {
        if (!cancelled) {
          setContact({
            company: request.dealerName,
            contactName: request.createdByName || null,
            phone: null,
            email: null,
          });
        }
      }
    };

    void loadContact();
    return () => {
      cancelled = true;
    };
  }, [open, isStaff, request.dealerId, request.dealerName, request.createdByName]);

  if (!open || !user) return null;

  return (
    <>
      <button
        type="button"
        className="support-detail-panel__backdrop"
        aria-label="Close request details"
        onClick={onClose}
      />
      <div
        className="support-detail-panel"
        role="region"
        aria-label="Request details"
      >
        {error && (
          <div className="products-inline-error support-detail-panel__error">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <SupportRequestTicketInfo
          request={request}
          user={user}
          showCancel={canDealerCancel}
          statusUpdating={statusUpdating}
          onCancel={onDealerCancel}
        />

        {isStaff && (contact?.company || contact?.contactName || contact?.phone || contact?.email) && (
          <section className="support-detail-card support-detail-card--ticket-info">
            <div className="support-detail-card__divider" aria-hidden />
            <div className="support-detail-info-list">
              {contact?.company && (
                <InfoRow
                  icon={<Users size={16} strokeWidth={2} />}
                  tone="green"
                  label="Customer / Dealer"
                  value={contact.company}
                />
              )}
              {contact?.contactName && (
                <InfoRow
                  icon={<User size={16} strokeWidth={2} />}
                  tone="orange"
                  label="Contact Person"
                  value={contact.contactName}
                />
              )}
              {contact?.phone && (
                <InfoRow
                  icon={<Phone size={16} strokeWidth={2} />}
                  tone="amber"
                  label="Phone"
                  value={contact.phone}
                />
              )}
              {contact?.email && (
                <InfoRow
                  icon={<Mail size={16} strokeWidth={2} />}
                  tone="sky"
                  label="Email"
                  value={contact.email}
                />
              )}
            </div>
          </section>
        )}

        {isStaff && isSupportOpen(request) && (
          <section className="support-detail-card support-detail-card--staff">
            <h3 className="support-detail-card__section-title">Staff actions</h3>
            <div className="support-detail-card__divider" aria-hidden />

            <div className="support-detail-staff-actions">
              {canApproveCourier && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={statusUpdating}
                  onClick={onApproveCourier}
                >
                  Approve for courier
                </button>
              )}
              {canMarkReceived && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={statusUpdating}
                  onClick={onMarkReceived}
                >
                  <PackageCheck size={15} />
                  Product received
                </button>
              )}
              <select
                className="catalog-select support-detail-staff-actions__stage"
                value={request.openStage ?? ''}
                disabled={statusUpdating}
                onChange={e => onStageChange(e.target.value as SupportOpenStage)}
              >
                {staffStageOptions.map(stage => (
                  <option key={stage} value={stage}>
                    {SUPPORT_OPEN_STAGE_LABELS[stage]}
                  </option>
                ))}
              </select>
              <SupportAssigneeSelect user={user!} request={request} />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={statusUpdating}
                onClick={onResolve}
              >
                Resolve
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={statusUpdating}
                onClick={onCancel}
              >
                Cancel
              </button>
            </div>

            <label className="support-detail-staff-actions__note">
              <span className="text-muted">Resolution note (optional)</span>
              <input
                type="text"
                className="catalog-input"
                value={resolutionNote}
                onChange={e => onResolutionNoteChange(e.target.value)}
                placeholder="Brief summary for internal records"
              />
            </label>
          </section>
        )}

        {user?.role === 'super_admin' && (
          <div className="support-detail-card__admin">
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={statusUpdating}
              onClick={onAdminDelete}
            >
              Delete ticket
            </button>
          </div>
        )}
      </div>
    </>
  );
};
