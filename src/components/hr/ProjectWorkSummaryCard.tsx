import {
  formatInr,
  formatLeaveDays,
  formatOtHours,
  formatWorkPercent,
  type HrProjectWorkTotal,
} from '../../lib/hrSalary';

export type ProjectWorkSummaryCardProps = {
  projectTotals: HrProjectWorkTotal[];
  projectSharePercents: Map<string, number>;
  earnedSalary: number;
  leaveDays: number;
  payableDays: number;
  rateDays: number;
  regularPay: number;
  overtimeHours: number;
  overtimePay: number;
};

export function ProjectWorkSummaryCard({
  projectTotals,
  projectSharePercents,
  earnedSalary,
  leaveDays,
  payableDays,
  rateDays,
  regularPay,
  overtimeHours,
  overtimePay,
}: ProjectWorkSummaryCardProps) {
  return (
    <div className="hr-salary__footer-summary hr-salary__footer-summary--panel">
      <table className="hr-salary__summary-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>%</th>
            <th>Days</th>
            <th>OT</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {projectTotals.map(total => (
            <tr key={total.projectId ?? '__unassigned'}>
              <td>
                <div className="hr-salary__project-cell">
                  <i
                    className={[
                      'hr-salary__proj-dot',
                      total.color ? '' : 'is-empty',
                    ].filter(Boolean).join(' ')}
                    style={total.color ? { background: total.color } : undefined}
                  />
                  {total.name}
                </div>
              </td>
              <td>
                {formatWorkPercent(
                  projectSharePercents.get(total.projectId ?? '__unassigned') ?? 0,
                )}
              </td>
              <td>{total.regularDays}d</td>
              <td>{formatOtHours(total.otHours)}</td>
              <td>{formatInr(total.totalPay)}</td>
            </tr>
          ))}
          <tr className="hr-salary__summary-total-row">
            <td colSpan={4}>Total Earned</td>
            <td>{formatInr(earnedSalary)}</td>
          </tr>
        </tbody>
      </table>
      <div className="hr-salary__footer-stats">
        <span>
          <strong>Leave:</strong> {formatLeaveDays(leaveDays)}
        </span>
        <span>
          <strong>Payable:</strong> {payableDays} / {rateDays}
        </span>
        <span>
          <strong>Regular pay:</strong> {formatInr(regularPay)}
        </span>
        <span>
          <strong>OT hours:</strong> {formatOtHours(overtimeHours)}
        </span>
        <span>
          <strong>OT pay:</strong> {formatInr(overtimePay)}
        </span>
      </div>
    </div>
  );
}
