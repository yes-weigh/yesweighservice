import { useMemo } from 'react';
import {
  buildExpenseSettlementLines,
  formatInr,
} from '../../lib/hrSalary';
import type {
  HrExpenseEntry,
  HrExpenseSettlement,
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

export type ExpenseSettlementCardProps = {
  settlement: HrExpenseSettlement;
  earnedSalary: number;
  expenseEntries: HrExpenseEntry[];
  receiptEntries: HrSalaryReceiptEntry[];
  /** Opens the day editor when a line is clicked (admin). */
  onLineClick?: (date: string) => void;
};

export function ExpenseSettlementCard({
  settlement,
  earnedSalary,
  expenseEntries,
  receiptEntries,
  onLineClick,
}: ExpenseSettlementCardProps) {
  const lines = useMemo(
    () => buildExpenseSettlementLines(expenseEntries, receiptEntries),
    [expenseEntries, receiptEntries],
  );
  const clickable = Boolean(onLineClick);

  return (
    <div className="hr-salary__card hr-salary__expense-detail">
      <div className="hr-salary__ot-detail-head">
        <h5>Expenses &amp; payments</h5>
        <span>{formatInr(settlement.netPayable)} net</span>
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
          </div>
          <ul className="hr-salary__expense-detail-list">
            {lines.map(line => {
              const row = (
                <>
                  <span className="hr-salary__expense-detail-date">
                    {formatDayLabel(line.date)}
                  </span>
                  <span className="hr-salary__expense-detail-desc">
                    <span className={`hr-salary__expense-kind is-${line.kind}`}>
                      {KIND_LABEL[line.kind]}
                    </span>
                    {line.note ? (
                      <span className="hr-salary__expense-note">{line.note}</span>
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
