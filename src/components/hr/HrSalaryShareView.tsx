import { useMemo } from 'react';
import {
  buildMonthDayCells,
  computeSalaryCalc,
  formatInr,
  formatLeaveDays,
  formatOtHours,
  formatTimeAmPm,
  overtimeEntryHours,
  projectWorkTotals,
} from '../../lib/hrSalary';
import type { HrHoliday } from '../../types/hr-holiday';
import {
  HR_SALARY_HOURS_PER_DAY,
  salaryPeriodLabel,
  type HrLeaveEntry,
  type HrOvertimeEntry,
  type HrSalaryPeriod,
  type HrSalaryProject,
  type HrWorkDayEntry,
} from '../../types/hr-salary';
import type { HrSalaryShareHoliday } from '../../types/hr-salary-share';

export type HrSalaryShareViewProps = {
  displayName: string;
  period: HrSalaryPeriod;
  perDaySalary: number;
  otPerDaySalary: number;
  leaveEntries: HrLeaveEntry[];
  projects: HrSalaryProject[];
  workDayEntries: HrWorkDayEntry[];
  overtimeEntries: HrOvertimeEntry[];
  holidays: HrHoliday[] | HrSalaryShareHoliday[];
};

function formatDayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function isSundayDate(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return false;
  return new Date(y, m - 1, d).getDay() === 0;
}

function toHrHolidays(holidays: HrHoliday[] | HrSalaryShareHoliday[]): HrHoliday[] {
  return holidays.map((h, i) => ({
    id: 'id' in h && h.id ? h.id : `share-h-${i}-${h.date}`,
    date: h.date,
    name: h.name,
    type: 'type' in h && h.type ? h.type : 'company',
    note: 'note' in h ? h.note ?? null : null,
    createdAt: 'createdAt' in h && h.createdAt ? h.createdAt : '',
    createdByUid: 'createdByUid' in h ? h.createdByUid ?? null : null,
  }));
}

export function HrSalaryShareView({
  displayName,
  period,
  perDaySalary,
  otPerDaySalary,
  leaveEntries,
  projects,
  workDayEntries,
  overtimeEntries,
  holidays: holidaysInput,
}: HrSalaryShareViewProps) {
  const holidays = useMemo(() => toHrHolidays(holidaysInput), [holidaysInput]);
  const calc = useMemo(
    () => computeSalaryCalc(
      perDaySalary,
      otPerDaySalary,
      period,
      holidays,
      leaveEntries,
      overtimeEntries,
    ),
    [period, holidays, leaveEntries, overtimeEntries, perDaySalary, otPerDaySalary],
  );
  const cells = useMemo(
    () => buildMonthDayCells(
      period,
      holidays,
      leaveEntries,
      overtimeEntries,
      projects,
      workDayEntries,
    ),
    [period, holidays, leaveEntries, overtimeEntries, projects, workDayEntries],
  );
  const leadingPads = new Date(period.year, period.month - 1, 1).getDay();
  const projectTotals = useMemo(
    () => projectWorkTotals(
      projects,
      workDayEntries,
      leaveEntries,
      overtimeEntries,
      period,
      holidays,
      perDaySalary,
      calc.otHourlyRate,
    ),
    [
      projects,
      workDayEntries,
      leaveEntries,
      overtimeEntries,
      period,
      holidays,
      perDaySalary,
      calc.otHourlyRate,
    ],
  );
  const otLines = useMemo(
    () => overtimeEntries
      .map(entry => {
        const hours = overtimeEntryHours(entry.startTime, entry.endTime);
        const project = projects.find(p => p.id === entry.projectId) ?? null;
        return {
          ...entry,
          hours,
          pay: hours * calc.otHourlyRate,
          project,
        };
      })
      .filter(line => line.hours > 0)
      .sort((a, b) => (
        a.date.localeCompare(b.date)
        || a.startTime.localeCompare(b.startTime)
      )),
    [overtimeEntries, projects, calc.otHourlyRate],
  );

  return (
    <div className="hr-salary__expand hr-salary__expand--public">
      <header className="hr-salary__dash-header">
        <div className="hr-salary__dash-header-info">
          <h3>{displayName}</h3>
          <span>{salaryPeriodLabel(period)}</span>
        </div>
        <div className="hr-salary__dash-header-right">
          <div className="hr-salary__dash-header-totals">
            <h4>{formatInr(calc.earnedSalary)}</h4>
            <p>
              {formatOtHours(calc.overtimeHours)} OT
              {' · '}
              {calc.payableDays} days worked
            </p>
          </div>
        </div>
      </header>

      <div className="hr-salary__config-row">
        <div className="hr-salary__rate-group">
          <div className="hr-salary__rate-item">
            <span>Per day</span>
            <div className="hr-salary__rate-value-text">{formatInr(perDaySalary)}</div>
            <span className="hr-salary__rate-sub">{formatInr(calc.hourlyRate)}/hr</span>
          </div>
          <div className="hr-salary__rate-item">
            <span>OT per day ({HR_SALARY_HOURS_PER_DAY}hrs)</span>
            <div className="hr-salary__rate-value-text">{formatInr(otPerDaySalary)}</div>
            <span className="hr-salary__rate-sub">{formatInr(calc.otHourlyRate)}/hr</span>
          </div>
        </div>
        <div className="hr-salary__project-selector">
          <span className="hr-salary__projects-label">Projects:</span>
          {projects.length === 0 ? (
            <span className="hr-salary__legend-item">None</span>
          ) : projects.map(project => (
            <span
              key={project.id}
              className="hr-salary__project-pill"
              style={{ ['--proj-color' as string]: project.color }}
            >
              <i className="hr-salary__proj-dot" style={{ background: project.color }} />
              {project.name}
            </span>
          ))}
        </div>
      </div>

      <div className="hr-salary__main-grid">
        <div className="hr-salary__card hr-salary__expand-cal">
          <div className="hr-salary__cal-head">
            <h4>{salaryPeriodLabel(period)}</h4>
          </div>
          <div
            className="hr-salary__cal"
            role="group"
            aria-label={`Attendance calendar for ${salaryPeriodLabel(period)}`}
          >
            <div className="hr-salary__cal-weekdays" aria-hidden>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(label => (
                <span key={label} className="hr-salary__cal-weekday">{label}</span>
              ))}
            </div>
            <div className="hr-salary__days">
              {Array.from({ length: leadingPads }, (_, i) => (
                <span key={`pad-${i}`} className="hr-salary__day-pad" />
              ))}
              {cells.map(cell => {
                const hasOt = cell.overtimeHours > 0;
                const sunday = isSundayDate(cell.date);
                const fullLeave = cell.kind === 'leave' || cell.leaveKind === 'full';
                const halfLeave = cell.kind === 'leave_half' || cell.leaveKind === 'half';
                const hasWork = (
                  hasOt
                  || cell.projectColors.length > 0
                  || cell.kind === 'working'
                );
                const showAsWorkday = hasWork && !fullLeave && !halfLeave && !sunday;
                return (
                  <div
                    key={cell.date}
                    title={
                      hasOt
                        ? `${formatOtHours(cell.overtimeHours)} OT`
                        : cell.kind === 'holiday'
                          ? cell.holidayName
                          : cell.kind === 'sunday'
                            ? 'Sunday'
                            : cell.kind === 'leave'
                              ? 'Full-day leave'
                              : cell.kind === 'leave_half'
                                ? 'Half-day leave'
                                : cell.date
                    }
                    className={[
                      'hr-salary__day',
                      'is-readonly',
                      hasWork ? 'has-work' : '',
                      hasOt ? 'has-ot' : '',
                      showAsWorkday ? 'is-regular' : '',
                      sunday && hasOt ? 'is-sunday-ot' : '',
                      `is-${cell.kind}`,
                      halfLeave && hasOt ? 'has-leave-half' : '',
                      fullLeave && hasOt ? 'has-leave' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <span className="hr-salary__day-num">{cell.day}</span>
                    {hasOt ? <span className="hr-salary__day-ot-badge">OT</span> : null}
                    {cell.projectColors.length > 0 ? (
                      <span className="hr-salary__day-dots" aria-hidden>
                        {cell.projectColors.map(color => (
                          <i
                            key={color}
                            className="hr-salary__proj-dot hr-salary__proj-dot--mini"
                            style={{ background: color }}
                          />
                        ))}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="hr-salary__legend" aria-label="Calendar colour legend">
            <span className="hr-salary__legend-item">
              <i className="hr-salary__legend-swatch is-workday" />
              Workday
            </span>
            <span className="hr-salary__legend-item">
              <i className="hr-salary__legend-swatch is-leave" />
              Leave
            </span>
            <span className="hr-salary__legend-item">
              <i className="hr-salary__legend-swatch is-leave-half" />
              Half leave
            </span>
            <span className="hr-salary__legend-item">
              <i className="hr-salary__legend-swatch is-holiday" />
              Holiday
            </span>
            <span className="hr-salary__legend-item">
              <span className="hr-salary__legend-ot-badge">OT</span>
              Overtime
            </span>
            {projects.map(project => (
              <span key={project.id} className="hr-salary__legend-item">
                <i
                  className="hr-salary__proj-dot hr-salary__proj-dot--mini"
                  style={{ background: project.color }}
                />
                {project.name}
              </span>
            ))}
          </div>
        </div>

        <div className="hr-salary__card hr-salary__ot-detail">
          <div className="hr-salary__ot-detail-head">
            <h5>Overtime</h5>
            <span>
              {formatOtHours(calc.overtimeHours)}
              {' · '}
              {formatInr(calc.overtimePay)}
            </span>
          </div>
          <div className="hr-salary__legend hr-salary__legend--ot" aria-label="Overtime project legend">
            {projects.map(project => (
              <span key={project.id} className="hr-salary__legend-item">
                <i
                  className="hr-salary__proj-dot hr-salary__proj-dot--mini"
                  style={{ background: project.color }}
                />
                {project.name}
              </span>
            ))}
            <span className="hr-salary__legend-item">
              <i className="hr-salary__proj-dot hr-salary__proj-dot--mini is-empty" />
              Unassigned
            </span>
          </div>
          {otLines.length === 0 ? (
            <p className="hr-salary__project-empty">No overtime yet</p>
          ) : (
            <ul className="hr-salary__ot-detail-list">
              {otLines.map(line => (
                <li key={line.id}>
                  <div className="hr-salary__ot-detail-line is-readonly">
                    <span className="hr-salary__ot-detail-date">
                      {line.project ? (
                        <i
                          className="hr-salary__proj-dot hr-salary__proj-dot--mini"
                          style={{ background: line.project.color }}
                          title={line.project.name}
                        />
                      ) : (
                        <i
                          className="hr-salary__proj-dot hr-salary__proj-dot--mini is-empty"
                          title="Unassigned"
                        />
                      )}
                      {formatDayLabel(line.date)}
                    </span>
                    <span className="hr-salary__ot-detail-time">
                      {formatTimeAmPm(line.startTime)} – {formatTimeAmPm(line.endTime)}
                    </span>
                    <span className="hr-salary__ot-detail-hrs">
                      {formatOtHours(line.hours)}
                    </span>
                    <span className="hr-salary__ot-detail-pay">
                      {formatInr(line.pay)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="hr-salary__footer-summary">
        <table className="hr-salary__summary-table">
          <thead>
            <tr>
              <th>Project</th>
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
                <td>{total.regularDays}d</td>
                <td>{formatOtHours(total.otHours)}</td>
                <td>{formatInr(total.totalPay)}</td>
              </tr>
            ))}
            <tr className="hr-salary__summary-total-row">
              <td colSpan={3}>Total Earned</td>
              <td>{formatInr(calc.earnedSalary)}</td>
            </tr>
          </tbody>
        </table>
        <div className="hr-salary__footer-stats">
          <span>
            <strong>Leave:</strong> {formatLeaveDays(calc.leaveDays)}
          </span>
          <span>
            <strong>Payable:</strong> {calc.payableDays} / {calc.rateDays}
          </span>
          <span>
            <strong>Regular pay:</strong> {formatInr(calc.regularPay)}
          </span>
          <span>
            <strong>OT hours:</strong> {formatOtHours(calc.overtimeHours)}
          </span>
          <span>
            <strong>OT pay:</strong> {formatInr(calc.overtimePay)}
          </span>
        </div>
      </div>
    </div>
  );
}
