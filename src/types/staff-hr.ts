export const HR_DOCUMENT_TYPES = ['aadhar', 'biodata', 'education', 'pcc'] as const;

export type HrDocumentType = (typeof HR_DOCUMENT_TYPES)[number];

export const HR_DOCUMENT_LABELS: Record<HrDocumentType, string> = {
  aadhar: 'Aadhar',
  biodata: 'Biodata',
  education: 'Education',
  pcc: 'PCC',
};

export interface HrDocumentMeta {
  storagePath: string;
  uploadedAt: string;
  fileName?: string;
}

export type HrDocuments = Partial<Record<HrDocumentType, HrDocumentMeta>>;

export interface StaffHrProfile {
  hrPhotoUrl?: string | null;
  hrResidentialAddress?: string | null;
  hrPostalCode?: string | null;
  hrBloodGroup?: string | null;
  hrPoliceStation?: string | null;
  hrEmergencyContactName?: string | null;
  hrEmergencyContactRelationship?: string | null;
  hrEmergencyContactPhone?: string | null;
  hrJoinDate?: string | null;
  hrEmployeeId?: string | null;
  hrDesignation?: string | null;
  hrDocuments?: HrDocuments;
}

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

export function emptyHrProfile(): StaffHrProfile {
  return {
    hrPhotoUrl: null,
    hrResidentialAddress: null,
    hrPostalCode: null,
    hrBloodGroup: null,
    hrPoliceStation: null,
    hrEmergencyContactName: null,
    hrEmergencyContactRelationship: null,
    hrEmergencyContactPhone: null,
    hrJoinDate: null,
    hrEmployeeId: null,
    hrDesignation: null,
    hrDocuments: {},
  };
}
