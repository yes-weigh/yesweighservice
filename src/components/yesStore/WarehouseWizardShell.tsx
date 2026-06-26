import React from 'react';
import { ArrowLeft } from 'lucide-react';

export type WarehouseContext = {
  rackId?: string;
  rowNumber?: number;
  binNumber?: number;
};

type WarehouseWizardShellProps = {
  title: string;
  onBack: () => void;
  context?: WarehouseContext;
  footer?: React.ReactNode;
  children: React.ReactNode;
};

export const WarehouseWizardShell: React.FC<WarehouseWizardShellProps> = ({
  title,
  onBack,
  context,
  footer,
  children,
}) => (
  <div className="wh-wizard">
    <header className="wh-wizard__header">
      <button type="button" className="wh-wizard__back" onClick={onBack} aria-label="Back">
        <ArrowLeft size={22} />
      </button>
      <h1 className="wh-wizard__title">{title}</h1>
      <span className="wh-wizard__header-spacer" aria-hidden />
    </header>

    {context?.rackId && (
      <div className="wh-context">
        {context.rowNumber == null ? (
          <span className="wh-context__badge">
            Rack Selected: <strong>{context.rackId.toUpperCase()}</strong>
          </span>
        ) : (
          <>
            <span className="wh-context__chip">Rack: <strong>{context.rackId.toUpperCase()}</strong></span>
            <span className="wh-context__chip">Row: <strong>{context.rowNumber}</strong></span>
            {context.binNumber != null && (
              <span className="wh-context__chip">Bin: <strong>{context.binNumber}</strong></span>
            )}
          </>
        )}
      </div>
    )}

    <div className="wh-wizard__body">{children}</div>

    {footer && <footer className="wh-wizard__footer">{footer}</footer>}
  </div>
);

export function WizardNextButton({
  onClick,
  disabled,
  label = 'Next',
  variant = 'primary',
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  variant?: 'primary' | 'success';
}) {
  return (
    <button
      type="button"
      className={`wh-btn-next wh-btn-next--${variant}`}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
