import React, { useMemo } from 'react';
import { Building2, Crown, Sparkles } from 'lucide-react';
import {
  ALL_DEALER_PERMISSIONS,
  DEALER_PERMISSION_GROUPS,
  DEALER_PERMISSION_LABELS,
  DEALER_TIER_DEFAULT_PERMISSIONS,
  DEALER_TIER_DESCRIPTIONS,
  DEALER_TIER_LABELS,
  type DealerAccessMode,
  type DealerPermission,
  type DealerTier,
} from '../../types/dealer-access';
import { effectiveDealerPermissionSet } from '../../lib/dealerAccess';

export interface DealerRoleDraft {
  tier: DealerTier;
  accessMode: DealerAccessMode;
  permissions: DealerPermission[];
}

export const EMPTY_DEALER_ROLE_DRAFT: DealerRoleDraft = {
  tier: 'standard',
  accessMode: 'tier',
  permissions: [],
};

const TIER_ICONS: Record<DealerTier, React.ReactNode> = {
  standard: <Building2 size={22} aria-hidden />,
  director: <Crown size={22} aria-hidden />,
};

const TIER_TONES: Record<DealerTier, string> = {
  standard: 'blue',
  director: 'purple',
};

export function dealerRoleDraftFromRecord(input: {
  dealerTier?: DealerTier;
  dealerAccessMode?: DealerAccessMode;
  dealerPermissions?: DealerPermission[];
}): DealerRoleDraft {
  const tier = input.dealerTier ?? 'standard';
  const accessMode = input.dealerAccessMode ?? 'tier';
  const permissions = accessMode === 'custom' && input.dealerPermissions?.length
    ? input.dealerPermissions
    : DEALER_TIER_DEFAULT_PERMISSIONS[tier];

  return { tier, accessMode, permissions };
}

export function dealerRoleDraftToPayload(draft: DealerRoleDraft): {
  dealerTier: DealerTier;
  dealerAccessMode: DealerAccessMode;
  dealerPermissions: DealerPermission[];
} {
  const effective = effectiveDealerPermissionSet(draft.tier, draft.accessMode, draft.permissions);
  return {
    dealerTier: draft.tier,
    dealerAccessMode: draft.accessMode,
    dealerPermissions: draft.accessMode === 'custom' ? effective : [],
  };
}

interface DealerRoleEditorProps {
  value: DealerRoleDraft;
  onChange: (next: DealerRoleDraft) => void;
  disabled?: boolean;
}

export const DealerRoleEditor: React.FC<DealerRoleEditorProps> = ({
  value,
  onChange,
  disabled,
}) => {
  const effectivePermissions = useMemo(
    () => effectiveDealerPermissionSet(value.tier, value.accessMode, value.permissions),
    [value.accessMode, value.tier, value.permissions],
  );

  const defaultSet = useMemo(
    () => new Set(DEALER_TIER_DEFAULT_PERMISSIONS[value.tier]),
    [value.tier],
  );

  const setTier = (tier: DealerTier) => {
    onChange({
      tier,
      accessMode: 'tier',
      permissions: DEALER_TIER_DEFAULT_PERMISSIONS[tier],
    });
  };

  const enableCustomize = (enabled: boolean) => {
    if (enabled) {
      onChange({
        ...value,
        accessMode: 'custom',
        permissions: effectivePermissions,
      });
      return;
    }
    onChange({
      ...value,
      accessMode: 'tier',
      permissions: DEALER_TIER_DEFAULT_PERMISSIONS[value.tier],
    });
  };

  const togglePermission = (permission: DealerPermission) => {
    const next = new Set(effectivePermissions);
    if (next.has(permission)) next.delete(permission);
    else next.add(permission);
    onChange({
      ...value,
      accessMode: 'custom',
      permissions: ALL_DEALER_PERMISSIONS.filter(item => next.has(item)),
    });
  };

  const customize = value.accessMode === 'custom';

  return (
    <div className="dealer-role-editor">
      <div className="dealer-role-editor__section">
        <h4 className="dealer-role-editor__heading">Dealer access tier</h4>
        <p className="dealer-role-editor__hint text-muted text-sm">
          Controls what this account can see in the product catalog.
        </p>
        <div className="dealer-role-editor__tiers">
          {(['standard', 'director'] as DealerTier[]).map(tier => (
            <button
              key={tier}
              type="button"
              disabled={disabled}
              className={`dealer-role-editor__tier dealer-role-editor__tier--${TIER_TONES[tier]} ${value.tier === tier ? 'is-active' : ''}`}
              onClick={() => setTier(tier)}
            >
              <span className="dealer-role-editor__tier-icon">{TIER_ICONS[tier]}</span>
              <span className="dealer-role-editor__tier-label">{DEALER_TIER_LABELS[tier]}</span>
              <span className="dealer-role-editor__tier-desc">{DEALER_TIER_DESCRIPTIONS[tier]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="dealer-role-editor__section">
        <div className="dealer-role-editor__perm-head">
          <div>
            <h4 className="dealer-role-editor__heading">Permissions</h4>
            <p className="dealer-role-editor__hint text-muted text-sm">
              {effectivePermissions.length} active
              {!customize && ` · using ${DEALER_TIER_LABELS[value.tier]} defaults`}
            </p>
          </div>
          <label className="dealer-role-editor__customize">
            <input
              type="checkbox"
              checked={customize}
              disabled={disabled}
              onChange={e => enableCustomize(e.target.checked)}
            />
            Customize
          </label>
        </div>

        {!customize ? (
          <div className="dealer-role-editor__chips">
            {effectivePermissions.length === 0 ? (
              <span className="dealer-role-editor__chip dealer-role-editor__chip--muted">
                Stock quantities hidden
              </span>
            ) : (
              effectivePermissions.map(permission => (
                <span key={permission} className="dealer-role-editor__chip">
                  {DEALER_PERMISSION_LABELS[permission]}
                </span>
              ))
            )}
          </div>
        ) : (
          <div className="dealer-role-editor__groups">
            {DEALER_PERMISSION_GROUPS.map(group => (
              <div key={group.id} className="dealer-role-editor__group panel glass">
                <h5>{group.label}</h5>
                <ul className="dealer-role-editor__perm-list">
                  {group.permissions.map(permission => {
                    const on = effectivePermissions.includes(permission);
                    const isDefault = defaultSet.has(permission);
                    return (
                      <li key={permission}>
                        <button
                          type="button"
                          disabled={disabled}
                          className={`dealer-role-editor__perm ${on ? 'is-on' : ''} ${isDefault ? 'is-default' : ''}`}
                          onClick={() => togglePermission(permission)}
                        >
                          <span className="dealer-role-editor__perm-check" aria-hidden />
                          <span className="dealer-role-editor__perm-label">
                            {DEALER_PERMISSION_LABELS[permission]}
                          </span>
                          {isDefault && on && (
                            <span className="dealer-role-editor__perm-badge">Default</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="dealer-role-editor__preview panel glass">
        <Sparkles size={16} aria-hidden />
        <span>
          Effective access: <strong>{DEALER_TIER_LABELS[value.tier]}</strong>
          {' · '}
          {effectivePermissions.length}/{ALL_DEALER_PERMISSIONS.length} permissions
        </span>
      </div>
    </div>
  );
};
