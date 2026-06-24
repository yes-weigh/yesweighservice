import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { Check, Copy, MapPin, PackageCheck } from 'lucide-react';
import { db } from '../../firebase';
import { FIRM_NAME } from '../../constants/brand';
import {
  DEFAULT_SUPPORT_COURIER,
  SUPPORT_PACKING_CHECKLIST,
  formatSupportCourierAddress,
  type SupportCourierInfo,
} from '../../constants/supportCourier';

async function loadSupportCourierInfo(): Promise<SupportCourierInfo> {
  try {
    const snap = await getDoc(doc(db, 'appSettings', 'supportCourier'));
    if (!snap.exists()) return DEFAULT_SUPPORT_COURIER;
    const data = snap.data();
    return {
      companyName: String(data.companyName ?? DEFAULT_SUPPORT_COURIER.companyName),
      department: String(data.department ?? DEFAULT_SUPPORT_COURIER.department),
      addressLines: Array.isArray(data.addressLines)
        ? data.addressLines.map(String)
        : DEFAULT_SUPPORT_COURIER.addressLines,
      city: String(data.city ?? DEFAULT_SUPPORT_COURIER.city),
      state: String(data.state ?? DEFAULT_SUPPORT_COURIER.state),
      pincode: String(data.pincode ?? DEFAULT_SUPPORT_COURIER.pincode),
      phone: String(data.phone ?? DEFAULT_SUPPORT_COURIER.phone),
      email: String(data.email ?? DEFAULT_SUPPORT_COURIER.email),
    };
  } catch {
    return DEFAULT_SUPPORT_COURIER;
  }
}

interface SupportCourierInstructionsProps {
  requestNumber?: string;
  compact?: boolean;
}

export const SupportCourierInstructions: React.FC<SupportCourierInstructionsProps> = ({
  requestNumber,
  compact = false,
}) => {
  const [info, setInfo] = useState<SupportCourierInfo>(DEFAULT_SUPPORT_COURIER);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void loadSupportCourierInfo().then(setInfo);
  }, []);

  const handleCopy = async () => {
    const text = [
      requestNumber ? `Request: ${requestNumber}` : '',
      formatSupportCourierAddress(info),
    ]
      .filter(Boolean)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const checklist = SUPPORT_PACKING_CHECKLIST;

  return (
    <div className={`support-courier-instructions ${compact ? 'support-courier-instructions--compact' : ''}`}>
      <div className="support-courier-instructions__approval">
        <strong>Next step after approval</strong>
        <p className="text-muted text-sm">
          Once {FIRM_NAME} approves
          {requestNumber ? <> request <strong>{requestNumber}</strong></> : ' your request'}
          , courier the product to the address below.
        </p>
      </div>

      <div className="support-courier-instructions__address panel glass">
        <div className="support-courier-instructions__address-head">
          <MapPin size={18} aria-hidden />
          <strong>Courier to</strong>
          <button type="button" className="support-courier-instructions__copy" onClick={() => void handleCopy()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy address'}
          </button>
        </div>
        <p className="support-courier-instructions__company">{info.companyName}</p>
        <p className="support-courier-instructions__dept text-muted text-sm">{info.department}</p>
        {info.addressLines.map(line => (
          <p key={line} className="support-courier-instructions__line">{line}</p>
        ))}
        <p className="support-courier-instructions__line">
          {info.city}, {info.state} {info.pincode}
        </p>
        <p className="support-courier-instructions__contact text-muted text-sm">
          {info.phone} · {info.email}
        </p>
      </div>

      <div className="support-courier-instructions__checklist">
        <div className="support-courier-instructions__checklist-head">
          <PackageCheck size={18} aria-hidden />
          <strong>Packing checklist</strong>
        </div>
        <ol className="support-courier-instructions__list">
          {checklist.map(item => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </div>
    </div>
  );
};
