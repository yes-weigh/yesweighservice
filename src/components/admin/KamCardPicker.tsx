import { useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';
import { HrStaffPhoto } from '../hr/HrStaffPhoto';
import { portalKamKey } from '../../lib/dealerKamDisplay';
import { listKamStaffDirectory, type KamStaffPhoto } from '../../lib/zohoSalespersonStaff';

export type KamCardOption = {
  id: string;
  name: string;
};

type Props = {
  options: KamCardOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  loading?: boolean;
  'aria-label'?: string;
};

export function KamCardPicker({
  options,
  value,
  onChange,
  disabled = false,
  loading = false,
  'aria-label': ariaLabel,
}: Props) {
  const [staffById, setStaffById] = useState<Map<string, KamStaffPhoto>>(new Map());
  const [staffByName, setStaffByName] = useState<Map<string, KamStaffPhoto>>(new Map());

  useEffect(() => {
    let cancelled = false;
    void listKamStaffDirectory()
      .then(dir => {
        if (cancelled) return;
        setStaffById(dir.byId);
        setStaffByName(dir.byName);
      })
      .catch(() => {
        if (cancelled) return;
        setStaffById(new Map());
        setStaffByName(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || options.length === 0) {
    return null;
  }

  return (
    <div className="kam-card-picker" role="listbox" aria-label={ariaLabel ?? 'KAM'}>
      {options.map(opt => {
        const staff = staffById.get(opt.id) || staffByName.get(portalKamKey(opt.name));
        const selected = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="option"
            aria-selected={selected}
            disabled={disabled}
            className={`kam-card-picker__card${selected ? ' is-selected' : ''}`}
            onClick={() => onChange(opt.id)}
          >
            {staff ? (
              <HrStaffPhoto
                userId={staff.uid}
                photo={staff}
                className="kam-card-picker__photo"
                placeholderClassName="kam-card-picker__photo kam-card-picker__photo--placeholder"
                iconSize={20}
              />
            ) : (
              <div className="kam-card-picker__photo kam-card-picker__photo--placeholder" aria-hidden>
                <UserRound size={20} />
              </div>
            )}
            <span className="kam-card-picker__name">{opt.name}</span>
          </button>
        );
      })}
    </div>
  );
}
