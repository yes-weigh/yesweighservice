import type { StaffLogisticsSite } from './staff-logistics';

export type DelhiveryB2bEnv = 'staging' | 'production';

/** Public (non-secret) Delhivery B2B connection block on logisticsSettings. */
export interface DelhiveryB2bPublicConfig {
  env: DelhiveryB2bEnv;
  username: string;
  passwordSet: boolean;
  pickupLocationBySite: Record<StaffLogisticsSite, string>;
  lastTestAt: string;
  lastTestOk: boolean;
  lastTestMessage: string;
  clientName: string;
}

export function emptyDelhiveryB2bPublicConfig(): DelhiveryB2bPublicConfig {
  return {
    env: 'staging',
    username: '',
    passwordSet: false,
    pickupLocationBySite: {
      cochin: '',
      head_office: '',
    },
    lastTestAt: '',
    lastTestOk: false,
    lastTestMessage: '',
    clientName: '',
  };
}
