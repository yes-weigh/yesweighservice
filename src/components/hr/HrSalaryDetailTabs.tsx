import type { ReactNode } from 'react';

export type HrSalaryDetailTab = 'calendar' | 'overtime' | 'expenses';

const TABS: { id: HrSalaryDetailTab; label: string }[] = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'overtime', label: 'Overtime' },
  { id: 'expenses', label: 'Expenses & payments' },
];

export type HrSalaryDetailTabsProps = {
  tab: HrSalaryDetailTab;
  onTabChange: (tab: HrSalaryDetailTab) => void;
  overtimeHint?: string;
  expensesHint?: string;
  children: ReactNode;
};

export function HrSalaryDetailTabs({
  tab,
  onTabChange,
  overtimeHint,
  expensesHint,
  children,
}: HrSalaryDetailTabsProps) {
  const hintFor = (id: HrSalaryDetailTab) => {
    if (id === 'overtime') return overtimeHint;
    if (id === 'expenses') return expensesHint;
    return undefined;
  };

  return (
    <div className="hr-salary__detail-tabs">
      <div
        className="hr-salary__detail-tablist"
        role="tablist"
        aria-label="Salary details"
        data-capture-ignore="1"
      >
        {TABS.map(item => {
          const selected = tab === item.id;
          const hint = hintFor(item.id);
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`hr-salary-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`hr-salary-panel-${item.id}`}
              tabIndex={0}
              className={['hr-salary__detail-tab', selected ? 'is-active' : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => onTabChange(item.id)}
            >
              <span className="hr-salary__detail-tab-label">{item.label}</span>
              {hint ? (
                <span className="hr-salary__detail-tab-hint">{hint}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div
        className="hr-salary__detail-tabpanel"
        role="tabpanel"
        id={`hr-salary-panel-${tab}`}
        aria-labelledby={`hr-salary-tab-${tab}`}
      >
        {children}
      </div>
    </div>
  );
}
