import React, { useEffect, useState } from 'react';
import { Phone, UserRound } from 'lucide-react';
import { HrStaffPhoto } from '../hr/HrStaffPhoto';
import {
  resolveStaffForZohoSalesperson,
  type ZohoSalespersonStaff,
} from '../../lib/zohoSalespersonStaff';

function WhatsAppIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

type Props = {
  salespersonId?: string | null;
  salespersonName?: string | null;
  className?: string;
  /** When true, show a missing-salesperson placeholder instead of hiding. */
  showMissing?: boolean;
  missingHint?: string | null;
};

export const DocumentKamStrip: React.FC<Props> = ({
  salespersonId,
  salespersonName,
  className = '',
  showMissing = false,
  missingHint = null,
}) => {
  const id = salespersonId?.trim() || '';
  const zohoName = salespersonName?.trim() || '';
  const [staff, setStaff] = useState<ZohoSalespersonStaff | null>(null);
  const [resolved, setResolved] = useState(!(id || zohoName));

  useEffect(() => {
    let active = true;
    if (!id && !zohoName) {
      setStaff(null);
      setResolved(true);
      return () => {
        active = false;
      };
    }
    setResolved(false);
    void resolveStaffForZohoSalesperson(id || null, zohoName || null)
      .then(result => {
        if (!active) return;
        setStaff(result);
      })
      .catch(() => {
        if (!active) return;
        setStaff(null);
      })
      .finally(() => {
        if (active) setResolved(true);
      });
    return () => {
      active = false;
    };
  }, [id, zohoName]);

  if (!id && !zohoName) {
    if (!showMissing) return null;
    return (
      <aside
        className={`doc-kam-strip doc-kam-strip--missing ${className}`.trim()}
        aria-label="Sales staff missing"
      >
        <div className="doc-kam-strip__media">
          <div className="doc-kam-strip__photo doc-kam-strip__photo--placeholder" aria-hidden>
            <UserRound size={22} />
          </div>
        </div>
        <div className="doc-kam-strip__body">
          <strong className="doc-kam-strip__name">No sales staff</strong>
          <span className="doc-kam-strip__role">Required for Verify &amp; invoice</span>
          {missingHint ? (
            <span className="doc-kam-strip__hint text-muted">{missingHint}</span>
          ) : (
            <span className="doc-kam-strip__hint text-muted">
              Assign sales staff on the dealer, then apply here
            </span>
          )}
        </div>
      </aside>
    );
  }
  if (!resolved && !zohoName) return null;

  const displayName = staff?.displayName
    || staff?.zohoSalespersonName
    || zohoName
    || 'Sales staff';

  return (
    <aside className={`doc-kam-strip ${className}`.trim()} aria-label="Sales staff">
      <div className="doc-kam-strip__media">
        {staff ? (
          <HrStaffPhoto
            userId={staff.uid}
            photo={{
              hrPhotoUrl: staff.hrPhotoUrl,
              hrPhotoStoragePath: staff.hrPhotoStoragePath,
            }}
            className="doc-kam-strip__photo"
            placeholderClassName="doc-kam-strip__photo doc-kam-strip__photo--placeholder"
            iconSize={22}
          />
        ) : (
          <div className="doc-kam-strip__photo doc-kam-strip__photo--placeholder" aria-hidden>
            <UserRound size={22} />
          </div>
        )}
      </div>
      <div className="doc-kam-strip__body">
        <strong className="doc-kam-strip__name">{displayName}</strong>
        <span className="doc-kam-strip__role">Sales staff</span>
        {!staff && zohoName ? (
          <span className="doc-kam-strip__hint text-muted">Not linked to staff</span>
        ) : null}
      </div>
      {staff?.telHref || staff?.whatsappHref ? (
        <div className="doc-kam-strip__actions">
          {staff.telHref ? (
            <a className="doc-kam-strip__action" href={staff.telHref} aria-label={`Call ${displayName}`}>
              <Phone size={14} aria-hidden />
              Call
            </a>
          ) : null}
          {staff.whatsappHref ? (
            <a
              className="doc-kam-strip__action doc-kam-strip__action--wa"
              href={staff.whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`WhatsApp ${displayName}`}
            >
              <WhatsAppIcon />
              WhatsApp
            </a>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
};
