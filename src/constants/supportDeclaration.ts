import { FIRM_NAME } from './brand';

export const SUPPORT_DECLARATION_TITLE = 'Warranty & Service Declaration';

export const SUPPORT_DECLARATION_INTRO =
  'I hereby declare that the information, photos, videos, serial numbers, and supporting documents provided in this warranty/service request are true and accurate to the best of my knowledge.';

export const SUPPORT_DECLARATION_AGREEMENTS: string[] = [
  `${FIRM_NAME} reserves the right to inspect, verify, test, and evaluate the product and all submitted evidence before approving any warranty or service claim.`,
  'Approval of a warranty or service request does not guarantee repair, replacement, or refund until physical inspection and verification are completed.',
  'Providing false, incomplete, misleading, or manipulated information may result in rejection of the claim and further action as per company policy.',
  'Intentional misuse includes, but is not limited to: false defect reporting, tampering with serial numbers, submitting altered or misleading photos/videos, or claiming damage not related to manufacturing defects.',
  'Corrective actions may include rejection of the claim, penalty charges, suspension of warranty or dealer support privileges, recovery of costs, and legal action where applicable.',
  'I confirm that the product has not been repaired, modified, or tampered with by unauthorized personnel unless already disclosed in this request.',
  'By continuing, I confirm that I have read, understood, and accepted all terms stated in this declaration.',
];

export const SUPPORT_DECLARATION_WARRANTY_COVERS =
  'Warranty covers manufacturing defects only.';

export const SUPPORT_DECLARATION_WARRANTY_EXCLUDES: string[] = [
  'Physical damage or mishandling',
  'Water / liquid damage',
  'Fire damage',
  'Electrical surge damage',
  'Unauthorized repair or modification',
  'Improper installation or misuse',
  'Normal wear and tear',
];

export const SUPPORT_DECLARATION_ADDITIONAL_TERMS: string[] = [
  'Physical inspection of the product may be required before approval.',
  'Service, freight, or handling charges may apply where warranty terms do not cover the issue.',
  "The company's decision after inspection shall be final in accordance with warranty policy.",
];

export const SUPPORT_DECLARATION_WARNING =
  'Fraudulent warranty claims, false information, serial number tampering, or manipulated evidence may result in permanent suspension of warranty services, dealer account restrictions, penalty charges, and legal action.';

export const SUPPORT_DECLARATION_CHECKBOX_LABEL =
  'I Agree to the Warranty & Service Declaration';
