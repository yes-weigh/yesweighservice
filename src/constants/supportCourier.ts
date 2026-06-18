export interface SupportCourierInfo {
  companyName: string;
  department: string;
  addressLines: string[];
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
}

/** Default workshop / RMA address — override via Firestore `appSettings/supportCourier`. */
export const DEFAULT_SUPPORT_COURIER: SupportCourierInfo = {
  companyName: 'YesWeigh (Interweighing Pvt Ltd)',
  department: 'Service & Warranty — RMA',
  addressLines: ['3rd Floor, Asian Tower', '49/470 D1, Vyttila'],
  city: 'Kochi',
  state: 'Kerala',
  pincode: '682019',
  phone: '+91 88033 33444',
  email: 'sales@yesweigh.in',
};

export const SUPPORT_PACKING_CHECKLIST: string[] = [
  'Wait for YesWeigh to approve your request before shipping — you will be notified.',
  'Write your request number (SRV- or RMA-) clearly on the outside of the box.',
  'Place a copy of the invoice, or note the invoice number, inside the package.',
  'Include the product serial number on a slip inside the box.',
  'Use the original carton where possible; pad the unit so it cannot move in transit.',
  'Ship only the faulty unit unless our team asks for accessories.',
  'Use an insured courier and keep the tracking receipt until the case is closed.',
];

export function formatSupportCourierAddress(info: SupportCourierInfo): string {
  return [
    info.companyName,
    info.department,
    ...info.addressLines,
    `${info.city}, ${info.state} ${info.pincode}`,
    `Phone: ${info.phone}`,
    `Email: ${info.email}`,
  ].join('\n');
}
