const TOPPER_KEYS = [
  'accurate trade links',
  'meezan electronic scales',
];

function normDealerName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function isTopperDealer(dealer: {
  companyName?: string | null;
  contactName?: string | null;
}): boolean {
  const names = [dealer.companyName, dealer.contactName]
    .map(value => normDealerName(String(value ?? '')))
    .filter(Boolean);
  return names.some(name => TOPPER_KEYS.some(key => name.includes(key)));
}
