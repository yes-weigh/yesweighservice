import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  FileText,
  Hash,
  LayoutGrid,
  Mail,
  MessageSquare,
  Package,
  PackageCheck,
  Phone,
  Truck,
  User,
  Users,
  Wrench,
} from 'lucide-react';
import { FIRM_NAME } from '../../constants/brand';
import { fetchDealerById } from '../../lib/dealers';
import { canManageSupportOps, isInternalOpsUser } from '../../lib/staffAccess';
import { isSupportOpen } from '../../lib/supportStatus';
import {
  formatSupportDetailOpenedOn,
  supportDetailStatusBadge,
} from '../../lib/supportRequestDisplay';
import type { User as AppUser } from '../../types';
import type { DealerSupportRequest, SupportOpenStage } from '../../types/dealer-support';
import {
  SUPPORT_OPEN_STAGE_LABELS,
  SUPPORT_TYPE_LABELS,
} from '../../types/dealer-support';
import { SupportAssigneeSelect } from './SupportAssigneeSelect';

export interface SupportRequestDetailPanelProps {
  request: DealerSupportRequest;
  user: AppUser | null;
  open: boolean;
  onClose: () => void;
  error?: string;
  statusUpdating: boolean;
  tracking: string;
  onTrackingChange: (value: string) => void;
  resolutionNote: string;
  onResolutionNoteChange: (value: string) => void;
  staffStageOptions: SupportOpenStage[];
  canApproveCourier: boolean;
  canMarkReceived: boolean;
  canDealerShip: boolean;
  canDealerCancel: boolean;
  onStageChange: (stage: SupportOpenStage) => void;
  onApproveCourier: () => void;
  onMarkReceived: () => void;
  onResolve: () => void;
  onCancel: () => void;
  onDealerCancel: () => void;
  onMarkShipped: () => void;
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
  tracking,
  onTrackingChange,
  resolutionNote,
  onResolutionNoteChange,
  staffStageOptions,
  canApproveCourier,
  canMarkReceived,
  canDealerShip,
  canDealerCancel,
  onStageChange,
  onApproveCourier,
  onMarkReceived,
  onResolve,
  onCancel,
  onDealerCancel,
  onMarkShipped,
  onAdminDelete,
}) => {
  const [contact, setContact] = useState<TicketContact | null>(null);
  const audience = isInternalOpsUser(user) ? 'staff' : 'dealer';
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

  if (!open) return null;

  const statusBadge = supportDetailStatusBadge(request, audience);

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

        <section className="support-detail-card support-detail-card--ticket-info">
          <h3 className="support-detail-card__section-title">Ticket Information</h3>
          <div className="support-detail-card__divider" aria-hidden />

          <div className="support-detail-info-list">
            <InfoRow
              icon={<LayoutGrid size={16} strokeWidth={2} />}
              tone="purple"
              label="Category"
              value={SUPPORT_TYPE_LABELS[request.type]}
            />
            <InfoRow
              icon={<Calendar size={16} strokeWidth={2} />}
              tone="blue"
              label="Opened On"
              value={formatSupportDetailOpenedOn(request.createdAt)}
            />
            <InfoRow
              icon={<CheckCircle2 size={16} strokeWidth={2} />}
              tone="yellow"
              label="Status"
              value={statusBadge}
            />
            {request.product?.name && (
              <InfoRow
                icon={<Package size={16} strokeWidth={2} />}
                tone="violet"
                label="Product"
                value={request.product.name}
              />
            )}
            {request.invoiceNumber && (
              <InfoRow
                icon={<FileText size={16} strokeWidth={2} />}
                tone="sky"
                label="Invoice"
                value={request.invoiceNumber}
              />
            )}
            {request.salesOrderNumber && (
              <InfoRow
                icon={<Hash size={16} strokeWidth={2} />}
                tone="blue"
                label="Sales Order"
                value={request.salesOrderNumber}
              />
            )}
            {request.category && (
              <InfoRow
                icon={<Wrench size={16} strokeWidth={2} />}
                tone="orange"
                label="Issue"
                value={request.category}
              />
            )}
            {request.subject && (
              <InfoRow
                icon={<MessageSquare size={16} strokeWidth={2} />}
                tone="purple"
                label="Subject"
                value={request.subject}
              />
            )}
            {isStaff && contact?.company && (
              <InfoRow
                icon={<Users size={16} strokeWidth={2} />}
                tone="green"
                label="Customer / Dealer"
                value={contact.company}
              />
            )}
            {isStaff && contact?.contactName && (
              <InfoRow
                icon={<User size={16} strokeWidth={2} />}
                tone="orange"
                label="Contact Person"
                value={contact.contactName}
              />
            )}
            {isStaff && contact?.phone && (
              <InfoRow
                icon={<Phone size={16} strokeWidth={2} />}
                tone="amber"
                label="Phone"
                value={contact.phone}
              />
            )}
            {isStaff && contact?.email && (
              <InfoRow
                icon={<Mail size={16} strokeWidth={2} />}
                tone="sky"
                label="Email"
                value={contact.email}
              />
            )}
            {request.courierTracking && (
              <InfoRow
                icon={<Truck size={16} strokeWidth={2} />}
                tone="green"
                label="Tracking"
                value={request.courierTracking}
              />
            )}
            {request.lifecycle === 'resolved' && request.resolutionSummary && (
              <InfoRow
                icon={<CheckCircle2 size={16} strokeWidth={2} />}
                tone="green"
                label="Resolution"
                value={request.resolutionSummary}
              />
            )}
          </div>

          {canDealerCancel && (
            <div className="support-detail-card__footer">
              <button
                type="button"
                className="support-detail-card__cancel-btn"
                disabled={statusUpdating}
                onClick={onDealerCancel}
              >
                Cancel request
              </button>
            </div>
          )}
        </section>

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

        {canDealerShip && (
          <section className="support-detail-card support-detail-card--ship">
            <h3 className="support-detail-card__section-title">
              <Truck size={17} aria-hidden />
              Mark product as shipped
            </h3>
            <p className="support-detail-card__hint text-muted text-sm">
              After you courier the product to {FIRM_NAME}, confirm shipment below. Add a tracking number if you have one.
            </p>
            <div className="support-detail-ship__form">
              <input
                type="text"
                className="catalog-input"
                value={tracking}
                onChange={e => onTrackingChange(e.target.value)}
                placeholder="Courier tracking number (optional)"
                disabled={statusUpdating}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={statusUpdating}
                onClick={onMarkShipped}
              >
                I&apos;ve shipped the product
              </button>
            </div>
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
