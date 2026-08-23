import React from 'react';
import { LogOut } from 'lucide-react';
import { FIRM_TRADE_NAME } from '../../constants/brand';
import { HrStaffPhoto } from '../hr/HrStaffPhoto';
import { dealerStaffTeams } from '../../lib/dealerAccess';
import { ageYearsFromDob, formatAadharDisplay } from '../../lib/hrStaff';
import { buildContactLinks } from '../../lib/phoneLinks';
import { formatLoginIdDisplay } from '../../lib/loginAuth';
import type { FirestoreUserDoc } from '../../types';

function display(value: string | null | undefined): string {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  return text && text !== '—' ? text : '';
}

function formatDob(value: string | null | undefined): string {
  const raw = value?.slice(0, 10) ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return display(value);
  const [year, month, day] = raw.split('-');
  return `${day}/${month}/${year}`;
}

function Field({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string | null;
}) {
  const shown = value || '—';
  return (
    <div className="staff-id-card__field">
      <dt>{label}</dt>
      <dd>
        {href && value ? (
          <a href={href}>{shown}</a>
        ) : (
          shown
        )}
      </dd>
    </div>
  );
}

export const DealerStaffPortalProfile: React.FC<{
  uid: string;
  profile: FirestoreUserDoc;
  dealershipName?: string | null;
  onSignOut?: () => void;
}> = ({ uid, profile, dealershipName, onSignOut }) => {
  const name = display(profile.displayName);
  const teams = dealerStaffTeams(profile);
  const phone = display(profile.phone);
  const aadhaar = formatAadharDisplay(
    profile.aadhar || (profile.loginIdType === 'aadhar' ? profile.loginId : '') || '',
  );
  const dob = formatDob(profile.hrDateOfBirth);
  const age = ageYearsFromDob(profile.hrDateOfBirth);
  const blood = display(profile.hrBloodGroup);
  const loginId = profile.loginId
    ? formatLoginIdDisplay(profile.loginIdType ?? 'aadhar', profile.loginId)
    : '';
  const phoneHref = phone ? buildContactLinks(phone)?.tel : null;
  const firm = display(dealershipName);

  return (
    <div className="staff-id-card-wrap">
      <article className="staff-id-card" aria-label="Staff identity card">
        <header className="staff-id-card__brand">
          <img
            src="/yesweigh-mark.png"
            alt=""
            className="staff-id-card__logo"
            width={44}
            height={44}
          />
          <div className="staff-id-card__brand-copy">
            <p className="staff-id-card__trade">{FIRM_TRADE_NAME}</p>
            <p className="staff-id-card__firm">{firm || 'Authorized dealership'}</p>
          </div>
        </header>

        <div className="staff-id-card__identity">
          <HrStaffPhoto
            userId={uid}
            photo={profile}
            className="staff-id-card__photo"
            placeholderClassName="staff-id-card__photo staff-id-card__photo--placeholder"
            iconSize={28}
          />
          <div className="staff-id-card__who">
            <h2 className="staff-id-card__name">{name || 'Staff'}</h2>
            <div className="staff-id-card__badges">
              {teams.map(team => (
                <span
                  key={team}
                  className={`dealer-team__badge dealer-team__badge--${team}`}
                >
                  {team === 'admin' ? 'Admin' : team === 'service' ? 'Service' : 'Sales'}
                </span>
              ))}
            </div>
          </div>
        </div>

        <dl className="staff-id-card__grid">
          <Field label="Phone" value={phone} href={phoneHref} />
          <Field label="Aadhaar" value={aadhaar} />
          <Field
            label="Date of birth"
            value={age != null ? `${dob}  ·  ${age} yrs` : dob}
          />
          <Field label="Blood group" value={blood} />
          {loginId && loginId !== aadhaar ? (
            <Field label="Login ID" value={loginId} />
          ) : null}
        </dl>
      </article>

      {onSignOut ? (
        <button type="button" className="dealer-profile__signout" onClick={onSignOut}>
          <LogOut size={16} strokeWidth={2.1} />
          Sign out
        </button>
      ) : null}
    </div>
  );
};
