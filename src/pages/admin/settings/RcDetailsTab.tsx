import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { YesGatcRecordsTable } from '../../../components/yesgatc/YesGatcRecordsTable';
import {
  formatYesGatcWhen,
  listYesGatcRcDetails,
  type YesGatcRcDetail,
} from '../../../lib/yesgatcRecords';

export const RcDetailsTab: React.FC = () => {
  const [rows, setRows] = useState<YesGatcRcDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await listYesGatcRcDetails());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load RC details.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = useMemo(() => [
    { key: 'when', label: 'Received', render: (row: YesGatcRcDetail) => formatYesGatcWhen(row.receivedAt) },
    { key: 'code', label: 'Code', render: (row: YesGatcRcDetail) => row.code || '—' },
    { key: 'name', label: 'Name', render: (row: YesGatcRcDetail) => row.name || '—' },
    {
      key: 'place',
      label: 'Place',
      render: (row: YesGatcRcDetail) => [row.city, row.state].filter(Boolean).join(', ') || row.address || '—',
    },
    { key: 'phone', label: 'Phone', render: (row: YesGatcRcDetail) => row.phone || '—' },
    { key: 'status', label: 'Status', render: (row: YesGatcRcDetail) => row.status || '—' },
  ], []);

  return (
    <section className="settings-locations panel glass">
      <header className="settings-locations__header">
        <div>
          <h3>RC details</h3>
          <p className="text-muted text-sm">
            Regional Center records pushed from YesGATC.
          </p>
        </div>
      </header>
      {error ? <p className="settings-locations__error">{error}</p> : null}
      <YesGatcRecordsTable
        rows={rows}
        columns={columns}
        loading={loading}
        empty="No RC details yet. After YesGATC posts to the webhook, they will show here."
      />
    </section>
  );
};
