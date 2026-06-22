import React from 'react';
import { ExternalLink, User } from 'lucide-react';
import type { UserRecord } from '../../types';
import type { HrDocumentType } from '../../types/staff-hr';
import { HR_DOCUMENT_LABELS, HR_DOCUMENT_TYPES } from '../../types/staff-hr';
import {
  formatAadharDisplay,
  formatJoinDate,
  readHrProfileFromDoc,
} from '../../lib/hrStaff';
import { resolveProfileLogin } from '../../lib/profileLogin';
import { formatLoginIdDisplay, loginIdTypeLabel } from '../../lib/loginAuth';
import { staffDepartmentLabel } from '../../lib/staffAccess';

type HrStaffProfileViewProps = {
  record: UserRecord;
  roleName?: string | null;
  documentUrls?: Partial<Record<HrDocumentType, string>>;
  onOpenDocument?: (type: HrDocumentType) => void;
  compact?: boolean;
};

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="hr-profile__row">
      <span className="hr-profile__label text-muted text-sm">{label}</span>
      <span className="hr-profile__value">{value || '—'}</span>
    </div>
  );
}

export const HrStaffProfileView: React.FC<HrStaffProfileViewProps> = ({
  record,
  roleName,
  documentUrls = {},
  onOpenDocument,
  compact = false,
}) => {
  const hr = readHrProfileFromDoc(record);
  const login = resolveProfileLogin(record);
  const aadhar = record.aadhar ?? (login?.type === 'aadhar' ? login.value : null);

  return (
    <div className={`hr-profile panel glass ${compact ? 'hr-profile--compact' : ''}`}>
      <header className="hr-profile__header">
        <div className="hr-profile__avatar">
          {hr.hrPhotoUrl ? (
            <img src={hr.hrPhotoUrl} alt="" />
          ) : (
            <User size={32} aria-hidden />
          )}
        </div>
        <div className="hr-profile__identity">
          <h2 className="hr-profile__name">{record.displayName}</h2>
          {hr.hrDesignation && (
            <p className="hr-profile__designation text-muted text-sm">{hr.hrDesignation}</p>
          )}
          {aadhar && (
            <p className="hr-profile__aadhar text-sm">{formatAadharDisplay(aadhar)}</p>
          )}
        </div>
        <span className={`hr-profile__status ${record.active === false ? 'is-inactive' : 'is-active'}`}>
          {record.active === false ? 'Inactive' : 'Active'}
        </span>
      </header>

      <div className="hr-profile__grid">
        <DetailRow label="Role" value={roleName ?? staffDepartmentLabel(record.staffDepartment)} />
        <DetailRow label="Employee ID" value={hr.hrEmployeeId} />
        <DetailRow label="Join date" value={formatJoinDate(hr.hrJoinDate)} />
        <DetailRow
          label="Login"
          value={
            login
              ? `${loginIdTypeLabel(login.type)} · ${formatLoginIdDisplay(login.type, login.value)}`
              : '—'
          }
        />
        <DetailRow label="Mobile" value={record.phone} />
        <DetailRow label="Email" value={record.email} />
        <DetailRow label="Blood group" value={hr.hrBloodGroup} />
        <DetailRow label="Postal code" value={hr.hrPostalCode} />
        <DetailRow label="Police station" value={hr.hrPoliceStation} />
        <DetailRow label="Residential address" value={hr.hrResidentialAddress} />
        <DetailRow label="Emergency contact" value={hr.hrEmergencyContactName} />
        <DetailRow label="Relationship" value={hr.hrEmergencyContactRelationship} />
        <DetailRow label="Emergency phone" value={hr.hrEmergencyContactPhone} />
      </div>

      <section className="hr-profile__documents">
        <h3 className="hr-profile__documents-title">Documents</h3>
        <div className="hr-profile__doc-grid">
          {HR_DOCUMENT_TYPES.map(type => {
            const meta = hr.hrDocuments?.[type];
            const url = documentUrls[type];
            const hasDoc = Boolean(meta?.storagePath || url);
            return (
              <button
                key={type}
                type="button"
                className={`hr-profile__doc-btn ${hasDoc ? 'has-file' : ''}`}
                disabled={!hasDoc}
                onClick={() => onOpenDocument?.(type)}
              >
                <span>{HR_DOCUMENT_LABELS[type]}</span>
                {hasDoc && <ExternalLink size={14} aria-hidden />}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};
