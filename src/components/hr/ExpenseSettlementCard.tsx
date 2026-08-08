import { useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import {
  buildExpenseSettlementLines,
  formatInr,
} from '../../lib/hrSalary';
import { downloadElementScreenshot } from '../../lib/shareElementScreenshot';
import type {
  HrExpenseEntry,
  HrExpenseSettlement,
  HrExpenseSettlementLine,
  HrExpenseSettlementLineKind,
  HrSalaryReceiptEntry,
} from '../../types/hr-salary';

function formatDayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

const KIND_LABEL: Record<HrExpenseSettlementLineKind, string> = {
  expense: 'Expense',
  reimbursement: 'Reimbursement',
  salary_advance: 'Advance',
};

function expenseNoteLabel(line: HrExpenseSettlementLine): string | null {
  if (line.kind !== 'expense' || !line.parts || line.parts.length <= 1) {
    return line.note;
  }
  return `${line.parts.length} items`;
}

function expenseSplitTitle(line: HrExpenseSettlementLine): string | undefined {
  if (!line.parts || line.parts.length <= 1) return undefined;
  return line.parts
    .map(part => `${part.note || 'Expense'}: ${formatInr(part.amount)}`)
    .join('\n');
}

export type ExpenseSettlementCardProps = {
  settlement: HrExpenseSettlement;
  earnedSalary: number;
  expenseEntries: HrExpenseEntry[];
  receiptEntries: HrSalaryReceiptEntry[];
  /** Opens the day editor when a line is clicked (admin). */
  onLineClick?: (date: string) => void;
  /** Suggested download filename (`.jpg` appended if missing). */
  downloadFileName?: string;
};

export function ExpenseSettlementCard({
  settlement,
  earnedSalary,
  expenseEntries,
  receiptEntries,
  onLineClick,
  downloadFileName,
}: ExpenseSettlementCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const lines = useMemo(
    () => buildExpenseSettlementLines(expenseEntries, receiptEntries),
    [expenseEntries, receiptEntries],
  );
  const clickable = Boolean(onLineClick);

  const handleDownloadJpg = async () => {
    const el = cardRef.current;
    if (!el || downloading) return;
    setDownloading(true);
    try {
      const base = (downloadFileName || 'expenses-payments').replace(/\.jpe?g$/i, '');
      await downloadElementScreenshot(el, {
        format: 'jpeg',
        quality: 0.92,
        backgroundColor: '#1a1d27',
        fileName: `${base}.jpg`,
      });
    } catch (err) {
      console.error(err);
      window.alert(err instanceof Error ? err.message : 'Could not download image.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div ref={cardRef} className="hr-salary__card hr-salary__expense-detail">
      <div className="hr-salary__ot-detail-head">
        <h5>Expenses &amp; payments</h5>
        <div className="hr-salary__ot-detail-head-right">
          <span>{formatInr(settlement.netPayable)} net</span>
          <button
            type="button"
            className="hr-salary__capture-btn"
            data-capture-ignore="1"
            disabled={downloading}
            onClick={() => { void handleDownloadJpg(); }}
            aria-label="Download expenses and payments as JPG"
          >
            <Download size={15} aria-hidden />
            {downloading ? 'Downloading…' : 'Download JPG'}
          </button>
        </div>
      </div>

      <ul className="hr-salary__settlement-lines">
        <li>
          <span>Earned salary</span>
          <span>{formatInr(earnedSalary)}</span>
        </li>
        {settlement.totalExpenses > 0 ? (
          <li>
            <span>Expenses</span>
            <span>{formatInr(settlement.totalExpenses)}</span>
          </li>
        ) : null}
        {settlement.totalReimbursements > 0 ? (
          <li>
            <span>Reimbursements received</span>
            <span>− {formatInr(settlement.totalReimbursements)}</span>
          </li>
        ) : null}
        {settlement.unreimbursedExpenses > 0 ? (
          <li className="is-highlight">
            <span>Pending reimbursement</span>
            <span>+ {formatInr(settlement.unreimbursedExpenses)}</span>
          </li>
        ) : null}
        {settlement.totalSalaryAdvances > 0 ? (
          <li>
            <span>Salary advances received</span>
            <span>− {formatInr(settlement.totalSalaryAdvances)}</span>
          </li>
        ) : null}
      </ul>

      {lines.length === 0 ? (
        <p className="hr-salary__project-empty">No expenses or payments yet</p>
      ) : (
        <>
          <div className="hr-salary__expense-detail-divider">
            <span>By date</span>
            <span aria-hidden />
            <span className="hr-salary__expense-detail-col-label">Amount</span>
            <span className="hr-salary__expense-detail-col-label">Balance</span>
          </div>
          <ul className="hr-salary__expense-detail-list">
            {lines.map(line => {
              const noteLabel = expenseNoteLabel(line);
              const hasSplit = Boolean(line.parts && line.parts.length > 1);
              const row = (
                <>
                  <span className="hr-salary__expense-detail-date">
                    {formatDayLabel(line.date)}
                  </span>
                  <span
                    className={[
                      'hr-salary__expense-detail-desc',
                      hasSplit ? 'has-split' : '',
                    ].filter(Boolean).join(' ')}
                    title={expenseSplitTitle(line)}
                  >
                    <span className={`hr-salary__expense-kind is-${line.kind}`}>
                      {KIND_LABEL[line.kind]}
                    </span>
                    {noteLabel ? (
                      <span className="hr-salary__expense-note">{noteLabel}</span>
                    ) : null}
                    {hasSplit && line.parts ? (
                      <span className="hr-salary__expense-split" role="tooltip">
                        {line.parts.map(part => (
                          <span key={part.id} className="hr-salary__expense-split-row">
                            <span>{part.note || 'Expense'}</span>
                            <span>{formatInr(part.amount)}</span>
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={[
                      'hr-salary__expense-detail-amount',
                      line.sign === '+' ? 'is-credit' : 'is-debit',
                    ].join(' ')}
                  >
                    {line.sign} {formatInr(line.amount)}
                  </span>
                  <span className="hr-salary__expense-detail-balance">
                    {formatInr(line.balance)}
                  </span>
                </>
              );

              if (clickable && onLineClick) {
                return (
                  <li key={line.id}>
                    <button
                      type="button"
                      className="hr-salary__expense-detail-line"
                      onClick={() => onLineClick(line.date)}
                    >
                      {row}
                    </button>
                  </li>
                );
              }

              return (
                <li key={line.id}>
                  <div className="hr-salary__expense-detail-line is-readonly">
                    {row}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
