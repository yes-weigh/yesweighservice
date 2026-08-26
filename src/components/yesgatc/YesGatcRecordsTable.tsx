import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';

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
  searchPlaceholder,
  extraSearch,
}: {
  rows: T[];
  columns: Array<YesGatcColumn<T>>;
  loading: boolean;
  empty: string;
  searchPlaceholder: string;
  extraSearch?: (row: T) => string;
}) {
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(row => {
      const blob = [
        extraSearch?.(row) ?? '',
        ...columns.map(col => {
          const value = col.render(row);
          return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
        }),
      ].join(' ').toLowerCase();
      return blob.includes(needle);
    });
  }, [columns, extraSearch, query, rows]);

  return (
    <div className="yesgatc-records">
      <label className="yesgatc-records__search">
        <Search size={16} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
        />
      </label>
      {loading ? (
        <p className="settings-locations__loading">Loading…</p>
      ) : filtered.length === 0 ? (
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
              {filtered.map(row => {
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
