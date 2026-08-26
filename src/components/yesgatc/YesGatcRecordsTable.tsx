import React, { useState } from 'react';

export type YesGatcColumn<T> = {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
};

export function YesGatcRecordsTable<T extends { id: string; raw?: unknown }>({
  rows,
  columns,
  loading,
  empty,
}: {
  rows: T[];
  columns: Array<YesGatcColumn<T>>;
  loading: boolean;
  empty: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="yesgatc-records">
      {loading ? (
        <p className="settings-locations__loading">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="settings-locations__empty">{empty}</p>
      ) : (
        <div className="invoices-table-wrap">
          <table className="invoices-table yesgatc-records__table">
            <thead>
              <tr>
                {columns.map(col => (
                  <th key={col.key}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const open = openId === row.id;
                return (
                  <React.Fragment key={row.id}>
                    <tr
                      className="invoices-table__row--clickable"
                      onClick={() => setOpenId(open ? null : row.id)}
                    >
                      {columns.map(col => (
                        <td key={col.key}>{col.render(row)}</td>
                      ))}
                    </tr>
                    {open && row.raw != null ? (
                      <tr className="yesgatc-records__raw-row">
                        <td colSpan={columns.length}>
                          <pre className="yesgatc-records__raw">
                            {JSON.stringify(row.raw, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
