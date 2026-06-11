import React from 'react';

interface InlineFormPanelProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export const InlineFormPanel: React.FC<InlineFormPanelProps> = ({ title, onClose, children }) => (
  <div className="inline-form-panel glass fade-in mb-4">
    <div className="form-panel-topbar">
      <h2>{title}</h2>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
        Cancel
      </button>
    </div>
    <div className="form-panel-body">{children}</div>
  </div>
);
