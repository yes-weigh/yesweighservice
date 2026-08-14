import type { StaffLogisticsSite } from './staff-logistics';

export type BlueDartApiEnv = 'sandbox' | 'production';

/** Public (non-secret) Blue Dart connection block on logisticsSettings. */
export interface BlueDartPublicConfig {
  env: BlueDartApiEnv;
  loginId: string;
  customerCode: string;
  originArea: string;
  customerPincode: string;
  customerName: string;
  clientSecretSet: boolean;
  shippingLicenseSet: boolean;
  trackingLicenseSet: boolean;
  sandboxLicenseSet: boolean;
  lastTestAt: string;
  lastTestOk: boolean;
  lastTestMessage: string;
}

export function emptyBlueDartPublicConfig(): BlueDartPublicConfig {
  return {
    env: 'production',
    loginId: '',
    customerCode: '',
    originArea: '',
    customerPincode: '',
    customerName: '',
    clientSecretSet: false,
    shippingLicenseSet: false,
    trackingLicenseSet: false,
    sandboxLicenseSet: false,
    lastTestAt: '',
    lastTestOk: false,
    lastTestMessage: '',
  };
}

export type BlueDartShipFromSite = StaffLogisticsSite;
