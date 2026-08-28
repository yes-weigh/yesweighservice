import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BadgeCheck, BarChart3, Check, ChevronDown, Percent, Radio, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useCatalogPageHeader, useTopBarAction } from '../../context/PageHeaderContext';
import { pushRcSoldToYesGatc } from '../../lib/yesgatcRecords';

type ReportsLayoutProps = {
  basePath: '/super-admin' | '/staff';
};

type ReportTab = {
  id: 'audit-report' | 'gatc-report' | 'incentive-report' | 'rc-ov-report';
  label: string;
  path: string;
  icon: React.ReactNode;
};

function ReportTypeFilter({
  tabs,
  activeId,
  onChange,
}: {
  tabs: ReportTab[];
  activeId: ReportTab['id'];
  onChange: (id: ReportTab['id']) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const active = tabs.find(tab => tab.id === activeId) ?? tabs[0];

  const updateMenuPosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(window.innerWidth - 16, 260);
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 8,
      left: Math.max(8, rect.right - width),
      width,
      zIndex: 520,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if ((target as Element).closest?.('.top-bar-period__menu')) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onReposition = () => updateMenuPosition();

    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);

    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  const menu = open ? (
    <div
      className="top-bar-period__menu dealer-dash-range-select__menu dealer-dash-range-select__menu--portal panel glass"
      style={menuStyle}
      role="listbox"
      aria-label="Report type"
    >
      <p className="top-bar-period__menu-label">Report type</p>
      <ul className="top-bar-period__list">
        {tabs.map(tab => {
          const selected = tab.id === active.id;
          return (
            <li key={tab.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={selected}
                className={`dealer-dash-range-select__option${selected ? ' is-active' : ''}`}
                onClick={() => {
                  onChange(tab.id);
                  setOpen(false);
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className={`top-bar-period reports-type-filter${open ? ' is-open' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="top-bar-period__trigger"
        onClick={() => setOpen(value => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Report type, ${active.label}`}
        title="Report type"
      >
        {active.icon}
        <span className="top-bar-period__value">{active.label}</span>
        <ChevronDown size={14} className="top-bar-period__chevron" aria-hidden />
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  );
}

function RcSoldSyncButton() {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const actorName = user?.displayName?.trim() || user?.email?.trim() || 'YESWEIGH';

  const sync = async () => {
    if (busy) return;
    setBusy(true);
    setDone(false);
    try {
      await pushRcSoldToYesGatc(actorName);
      setDone(true);
      window.setTimeout(() => setDone(false), 2400);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not push Sold to YesGATC.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className="reports-sold-sync"
      onClick={() => void sync()}
      disabled={busy}
      aria-label="Push Sold to YesGATC"
      title={done ? 'Sold sent to YesGATC' : 'Push Sold to YesGATC'}
    >
      {done
        ? <Check size={18} strokeWidth={2.6} aria-hidden />
        : <RefreshCw size={18} strokeWidth={2.4} className={busy ? 'spin-icon' : undefined} aria-hidden />}
    </button>
  );
}

export const ReportsLayout: React.FC<ReportsLayoutProps> = ({ basePath }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const tabs = useMemo<ReportTab[]>(() => [
    {
      id: 'gatc-report',
      label: 'GATC report',
      path: `${basePath}/reports/gatc-report`,
      icon: <BadgeCheck size={16} />,
    },
    {
      id: 'rc-ov-report',
      label: 'RC OV report',
      path: `${basePath}/reports/rc-ov-report`,
      icon: <Radio size={16} />,
    },
    {
      id: 'incentive-report',
      label: 'Incentive report',
      path: `${basePath}/reports/incentive-report`,
      icon: <Percent size={16} />,
    },
    {
      id: 'audit-report',
      label: 'Audit report',
      path: `${basePath}/reports/audit-report`,
      icon: <BarChart3 size={16} />,
    },
  ], [basePath]);

  const active = tabs.find(tab => (
    location.pathname === tab.path || location.pathname.startsWith(`${tab.path}/`)
  )) ?? tabs[0];

  useEffect(() => {
    if (
      location.pathname === `${basePath}/reports`
      || location.pathname === `${basePath}/reports/`
    ) {
      navigate(`${basePath}/reports/gatc-report`, { replace: true });
    }
  }, [basePath, location.pathname, navigate]);

  useCatalogPageHeader({ title: 'Reports' });

  const filter = useMemo(
    () => (
      <div className="reports-top-actions">
        {active.id === 'rc-ov-report' ? <RcSoldSyncButton /> : null}
        <ReportTypeFilter
          tabs={tabs}
          activeId={active.id}
          onChange={id => {
            const next = tabs.find(tab => tab.id === id);
            if (next) navigate(next.path);
          }}
        />
      </div>
    ),
    [active.id, navigate, tabs],
  );
  useTopBarAction(filter);

  const isLedger = active.id === 'gatc-report'
    || active.id === 'incentive-report'
    || active.id === 'rc-ov-report';

  return (
    <div className="reports-hub page-content fade-in">
      <div className={`reports-hub__shell${isLedger ? '' : ' panel glass'}`}>
        <div className="reports-hub__body">
          <Outlet />
        </div>
      </div>
    </div>
  );
};
