import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const LEDGER_PAGE_SIZE = 25;

export function useLedgerPagination<T>(
  rows: T[],
  resetKey = '',
): {
  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  totalPages: number;
  paginatedRows: T[];
  totalCount: number;
  pageSize: number;
  rangeStart: number;
  rangeEnd: number;
} {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [resetKey, rows.length]);

  const totalCount = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / LEDGER_PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * LEDGER_PAGE_SIZE;
    return rows.slice(start, start + LEDGER_PAGE_SIZE);
  }, [rows, page]);

  const rangeStart = totalCount === 0 ? 0 : (page - 1) * LEDGER_PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * LEDGER_PAGE_SIZE, totalCount);

  return {
    page,
    setPage,
    totalPages,
    paginatedRows,
    totalCount,
    pageSize: LEDGER_PAGE_SIZE,
    rangeStart,
    rangeEnd,
  };
}

export const StockLedgerPagination: React.FC<{
  page: number;
  totalPages: number;
  totalCount: number;
  rangeStart: number;
  rangeEnd: number;
  onPageChange: (page: number) => void;
  label?: string;
}> = ({
  page,
  totalPages,
  totalCount,
  rangeStart,
  rangeEnd,
  onPageChange,
  label = 'Ledger pagination',
}) => {
  if (totalCount <= LEDGER_PAGE_SIZE) return null;

  return (
    <nav className="stock-ledger__pagination" aria-label={label}>
      <span className="stock-ledger__pagination-info">
        {rangeStart}–{rangeEnd} of {totalCount.toLocaleString('en-IN')}
      </span>
      <div className="stock-ledger__pagination-btns">
        <button
          type="button"
          className="stock-ledger__pagination-btn"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft size={18} aria-hidden />
        </button>
        <span className="stock-ledger__pagination-page">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          className="stock-ledger__pagination-btn"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight size={18} aria-hidden />
        </button>
      </div>
    </nav>
  );
};
