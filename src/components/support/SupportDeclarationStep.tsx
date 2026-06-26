import React from 'react';
import { AlertTriangle, Check, FileText, List, Shield, X } from 'lucide-react';
import {
  SUPPORT_DECLARATION_ADDITIONAL_TERMS,
  SUPPORT_DECLARATION_AGREEMENTS,
  SUPPORT_DECLARATION_CHECKBOX_LABEL,
  SUPPORT_DECLARATION_INTRO,
  SUPPORT_DECLARATION_WARNING,
  SUPPORT_DECLARATION_WARRANTY_COVERS,
  SUPPORT_DECLARATION_WARRANTY_EXCLUDES,
} from '../../constants/supportDeclaration';
import { SupportWizardSubmitProgress } from './SupportWizardSubmitProgress';
import type { SupportSubmitProgress } from '../../lib/supportAttachments';

interface SupportDeclarationStepProps {
  agreed: boolean;
  onAgreedChange: (agreed: boolean) => void;
  onContinue: () => void;
  disabled?: boolean;
  submitting?: boolean;
  submitProgress?: SupportSubmitProgress | null;
  error?: string;
}

export const SupportDeclarationStep: React.FC<SupportDeclarationStepProps> = ({
  agreed,
  onAgreedChange,
  onContinue,
  disabled,
  submitting,
  submitProgress,
  error,
}) => (
  <section
    className={[
      'support-declaration panel glass',
      submitting && submitProgress ? 'support-declaration--busy' : '',
    ].filter(Boolean).join(' ')}
  >
    <div className="support-declaration__body">
      <div className="support-declaration__intro panel glass">
        <Shield size={24} className="support-declaration__intro-icon" aria-hidden />
        <p>{SUPPORT_DECLARATION_INTRO}</p>
      </div>

      <div className="support-declaration__terms panel glass">
        <h3 className="support-declaration__terms-title">
          <List size={18} aria-hidden />
          I understand and agree that:
        </h3>
        <ol className="support-declaration__terms-list">
          {SUPPORT_DECLARATION_AGREEMENTS.map((item, index) => (
            <li key={item}>{index + 1}. {item}</li>
          ))}
        </ol>
      </div>

      <div className="support-declaration__additional panel glass">
        <h3 className="support-declaration__additional-title">
          <FileText size={18} aria-hidden />
          Additional Important Terms &amp; Conditions
        </h3>

        <div className="support-declaration__warranty-grid">
          <div className="support-declaration__warranty-col support-declaration__warranty-col--yes">
            <p>
              <Check size={16} aria-hidden />
              {SUPPORT_DECLARATION_WARRANTY_COVERS}
            </p>
          </div>
          <div className="support-declaration__warranty-col support-declaration__warranty-col--no">
            <p className="support-declaration__warranty-heading">
              <X size={16} aria-hidden />
              Warranty does not cover:
            </p>
            <ul>
              {SUPPORT_DECLARATION_WARRANTY_EXCLUDES.map(item => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>

        <ul className="support-declaration__extra-list">
          {SUPPORT_DECLARATION_ADDITIONAL_TERMS.map(item => (
            <li key={item}>
              <Check size={16} aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="support-declaration__warning panel glass" role="alert">
        <AlertTriangle size={20} className="support-declaration__warning-icon" aria-hidden />
        <div>
          <strong>WARNING</strong>
          <p>{SUPPORT_DECLARATION_WARNING}</p>
        </div>
      </div>
    </div>

    <div className="support-declaration__footer support-wizard__actions--dock">
      <label className="support-declaration__checkbox">
        <input
          type="checkbox"
          checked={agreed}
          disabled={disabled || submitting}
          onChange={e => onAgreedChange(e.target.checked)}
        />
        <span>{SUPPORT_DECLARATION_CHECKBOX_LABEL}</span>
      </label>
      {error && <p className="support-wizard__error support-declaration__error">{error}</p>}
      {submitting && submitProgress && (
        <SupportWizardSubmitProgress progress={submitProgress} />
      )}
      <button
        type="button"
        className="btn btn-primary support-declaration__continue"
        disabled={disabled || submitting || !agreed}
        onClick={onContinue}
      >
        {submitting ? 'Submitting…' : 'Continue'}
      </button>
    </div>
  </section>
);
