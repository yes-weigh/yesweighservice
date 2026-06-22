import React from 'react';
import { FileText, Upload } from 'lucide-react';

type HrDocumentUploadProps = {
  label: string;
  fileName?: string | null;
  hasExisting?: boolean;
  disabled?: boolean;
  onPick: (file: File | null) => void;
};

export const HrDocumentUpload: React.FC<HrDocumentUploadProps> = ({
  label,
  fileName,
  hasExisting = false,
  disabled,
  onPick,
}) => {
  const hasFile = Boolean(fileName) || hasExisting;

  return (
    <div className={`hr-doc-upload ${hasFile ? 'hr-doc-upload--has-file' : ''}`}>
      <span className="hr-doc-upload__label">{label}</span>
      <label className={`hr-doc-upload__btn ${disabled ? 'is-disabled' : ''}`}>
        <input
          type="file"
          className="hr-doc-upload__input"
          accept="application/pdf,image/*"
          disabled={disabled}
          onChange={e => onPick(e.target.files?.[0] ?? null)}
        />
        {hasFile ? <FileText size={16} aria-hidden /> : <Upload size={16} aria-hidden />}
        <span>{fileName ? 'Change file' : hasExisting ? 'Replace' : 'Upload'}</span>
      </label>
      <p className="hr-doc-upload__status text-muted text-sm">
        {fileName
          ? fileName
          : hasExisting
            ? 'Document on file'
            : 'PDF or image, max 15 MB'}
      </p>
    </div>
  );
};
