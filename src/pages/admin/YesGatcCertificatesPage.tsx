import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { YesGatcRecordsTable } from '../../components/yesgatc/YesGatcRecordsTable';
import {
  formatYesGatcWhen,
  listYesGatcCertificates,
  type YesGatcCertificate,
} from '../../lib/yesgatcRecords';

export const YesGatcCertificatesPage: React.FC = () => {
  const [rows, setRows] = useState<YesGatcCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await listYesGatcCertificates());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load certificates.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = useMemo(() => [
    {
      key: 'when',
      label: 'Received',
      render: (row: YesGatcCertificate) => formatYesGatcWhen(row.receivedAt),
    },
    {
      key: 'cert',
      label: 'Certificate',
      render: (row: YesGatcCertificate) => row.certificateNumber || '—',
    },
    {
      key: 'serial',
      label: 'Serial',
      render: (row: YesGatcCertificate) => row.serialNumber || '—',
    },
    {
      key: 'dealer',
      label: 'Dealer',
      render: (row: YesGatcCertificate) => row.dealerName || '—',
    },
    {
      key: 'product',
      label: 'Product',
      render: (row: YesGatcCertificate) => row.productName || '—',
    },
    {
      key: 'rc',
      label: 'RC',
      render: (row: YesGatcCertificate) => row.rcCode || '—',
    },
    {
      key: 'file',
      label: 'File',
      render: (row: YesGatcCertificate) => (
        row.pdfUrl ? (
          <a
            href={row.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={event => event.stopPropagation()}
          >
            PDF
          </a>
        ) : '—'
      ),
    },
  ], []);

  return (
    <div className="page-content fade-in">
      <section className="settings-locations panel glass">
        <header className="settings-locations__header">
          <div>
            <h3>Certificate</h3>
            <p className="text-muted text-sm">
              Certificates pushed from YesGATC. Tap a row for the full payload.
            </p>
          </div>
        </header>
        {error ? <p className="settings-locations__error">{error}</p> : null}
        <YesGatcRecordsTable
          rows={rows}
          columns={columns}
          loading={loading}
          empty="No certificates yet. Paste the YesOne webhook URL into YesGATC, then wait for the first push."
          searchPlaceholder="Search certificate, serial, dealer…"
          extraSearch={row => [
            row.certificateNumber,
            row.serialNumber,
            row.dealerName,
            row.productName,
            row.sku,
            row.rcCode,
            row.status,
          ].join(' ')}
        />
      </section>
    </div>
  );
};
