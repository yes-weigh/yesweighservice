import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { subscribeZohoApiUsage, zohoUsageBlocksDaytime, type ZohoApiUsage } from '../../lib/zohoApiUsage';

export const ZohoApiQuotaBanner: React.FC = () => {
  const [usage, setUsage] = useState<ZohoApiUsage | null>(null);

  useEffect(() => subscribeZohoApiUsage(setUsage), []);

  if (!usage) return null;
  const exhausted = zohoUsageBlocksDaytime(usage, 80);
  const low = !exhausted && (usage.status === 'low' || usage.remaining <= 500);
  if (!exhausted && !low) return null;

  return (
    <div
      className={`zoho-api-quota-banner ${exhausted ? 'zoho-api-quota-banner--critical' : 'zoho-api-quota-banner--warn'}`}
      role="status"
    >
      <AlertTriangle size={16} aria-hidden />
      <span>
        {exhausted
          ? `Zoho API quota exhausted (${usage.callsToday.toLocaleString('en-IN')} / ${usage.dailyLimit.toLocaleString('en-IN')} today). Webhooks are queued until midnight IST. Skip catalog Sync and stock ledgers.`
          : `Zoho API quota low — ${usage.remaining.toLocaleString('en-IN')} of ${usage.dailyLimit.toLocaleString('en-IN')} calls left. Avoid lifetime stock ledgers and full catalog Sync.`}
      </span>
    </div>
  );
};
