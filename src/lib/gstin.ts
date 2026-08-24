export const GST_TREATMENTS = [
  { id: '', label: 'Not set' },
  { id: 'business_gst', label: 'Registered business — regular' },
  { id: 'business_registered_composition', label: 'Registered business — composition' },
  { id: 'business_none', label: 'Unregistered business' },
  { id: 'consumer', label: 'Consumer' },
  { id: 'overseas', label: 'Overseas' },
  { id: 'sez', label: 'SEZ' },
] as const;

export const GST_TAXPAYER_TYPES = [
  'Regular',
  'Composition',
  'Casual Taxable Person',
  'SEZ',
  'Input Service Distributor',
  'TDS Deductor',
  'TCS Collector',
  'Non Resident Taxable Person',
  'UIN Holder',
  'OIDAR',
] as const;

export const GST_CONSTITUTIONS = [
  'Proprietorship',
  'Partnership',
  'Limited Liability Partnership',
  'Private Limited Company',
  'Public Limited Company',
  'Hindu Undivided Family',
  'Society/Club/Trust/AOP',
  'Government Department',
  'Public Sector Undertaking',
  'Unlimited Company',
  'Foreign Company',
] as const;

export function gstTreatmentLabel(value: string): string {
  return GST_TREATMENTS.find(row => row.id === value)?.label || value || '';
}

export function withFetchedOption(options: readonly string[], value: string): string[] {
  const next = value.trim();
  if (!next || options.some(row => row.toLowerCase() === next.toLowerCase())) {
    return [...options];
  }
  return [next, ...options];
}
