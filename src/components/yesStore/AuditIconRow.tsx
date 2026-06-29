import React from 'react';
import type { LucideIcon } from 'lucide-react';

export type AuditIconTone =
  | 'blue'
  | 'purple'
  | 'green'
  | 'orange'
  | 'teal'
  | 'amber'
  | 'rose'
  | 'indigo';

export interface AuditIconRowProps {
  icon: LucideIcon;
  tone: AuditIconTone;
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}

export function AuditIconRow({
  icon: Icon,
  tone,
  label,
  value,
  valueClassName,
}: AuditIconRowProps) {
  return (
    <div className="audit-icon-row">
      <span className={`audit-icon-row__icon audit-icon-row__icon--${tone}`} aria-hidden>
        <Icon size={17} strokeWidth={2.1} />
      </span>
      <div className="audit-icon-row__body">
        <span className="audit-icon-row__label">{label}</span>
        <span className={`audit-icon-row__value${valueClassName ? ` ${valueClassName}` : ''}`}>
          {value}
        </span>
      </div>
    </div>
  );
}

export function AuditIconPanel({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`audit-icon-panel ${className}`.trim()}>{children}</div>;
}
