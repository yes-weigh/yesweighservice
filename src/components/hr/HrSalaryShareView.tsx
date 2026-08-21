import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { DecimalTextInput } from '../DecimalAmountInput';
import { DayAttendanceSheet } from './DayAttendanceSheet';
import { ExpenseSettlementCard } from './ExpenseSettlementCard';
import { HrSalaryDetailTabs, type HrSalaryDetailTab } from './HrSalaryDetailTabs';
import { ProjectWorkSummaryCard } from './ProjectWorkSummaryCard';
import {
  buildMonthDayCells,
  calendarDayHoverTitle,
  computeExpenseSettlement,
  computeOvertimePayWithMakeup,
  computeSalaryCalc,
  dayEarningsByDate,
  formatInr,
  formatOtHours,
  formatTimeAmPm,
  leaveKindForDate,
  overtimeEntryHours,
  projectWorkSharePercents,
  projectWorkTotals,
  resolveSalaryRates,
  workProjectIdForDate,
} from '../../lib/hrSalary';
import type { HrHoliday } from '../../types/hr-holiday';
import {
  HR_SALARY_HOURS_PER_DAY,
  salaryPeriodKey,
  salaryPeriodLabel,
  type HrLeaveEntry,
  type HrLeaveKind,
  type HrDayJoinEntry,
  type HrExpenseEntry,
  type HrOvertimeEntry,
  type HrSalaryPeriod,
  type HrSalaryProject,
  type HrSalaryReceiptEntry,
  type HrSalaryReceiptKind,
  type HrWorkDayEntry,
  type HrWorkShiftEntry,
} from '../../types/hr-salary';
import type { HrSalaryShareHoliday } from '../../types/hr-salary-share';

export type HrSalaryShareEditHandlers = {
  monthlySalaryInput: string;
  otPerDaySalaryInput: string;
  onMonthlySalaryChange: (value: string) => void;
  onOtPerDayChange: (value: string) => void;
  onAddProject: () => void;
  onRenameProject: (projectId: string, name: string) => void;
  onRemoveProject: (projectId: string) => void;
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  onSetLeave: (date: string, kind: HrLeaveKind | null) => void;
  onSetDayProject: (date: string, projectId: string | null) => void;
  onSetDayClock: (date: string, patch: { joinedAt?: string | null; clockedOutAt?: string | null }) => void;
  onAddWorkShift: (date: string) => void;
  onPatchWorkShift: (
    entryId: string,
    patch: Partial<Pick<HrWorkShiftEntry, 'startTime' | 'endTime' | 'projectId'>>,
  ) => void;
  onRemoveWorkShift: (entryId: string) => void;
  onAddOt: (date: string) => void;
  onPatchOt: (
    entryId: string,
    patch: Partial<Pick<HrOvertimeEntry, 'startTime' | 'endTime' | 'projectId'>>,
  ) => void;
  onRemoveOt: (entryId: string) => void;
  onAddExpense: (date: string) => void;
  onPatchExpense: (
    entryId: string,
    patch: Partial<Pick<HrExpenseEntry, 'amount' | 'note'>>,
  ) => void;
  onRemoveExpense: (entryId: string) => void;
  onAddReceipt: (date: string, kind: HrSalaryReceiptKind) => void;
  onPatchReceipt: (
    entryId: string,
    patch: Partial<Pick<HrSalaryReceiptEntry, 'amount' | 'note' | 'kind'>>,
  ) => void;
  onRemoveReceipt: (entryId: string) => void;
};

export type HrSalaryShareViewProps = {
  displayName: string;
  period: HrSalaryPeriod;
  monthlySalary: number;
  /** Legacy shares may omit monthly and only provide per-day. */
  perDaySalary?: number;
  otPerDaySalary: number;
  leaveEntries: HrLeaveEntry[];
  projects: HrSalaryProject[];
  workDayEntries: HrWorkDayEntry[];
  workShiftEntries?: HrWorkShiftEntry[];
  dayJoinEntries?: HrDayJoinEntry[];
  expenseEntries?: HrExpenseEntry[];
  receiptEntries?: HrSalaryReceiptEntry[];
  overtimeEntries: HrOvertimeEntry[];
  holidays: HrHoliday[] | HrSalaryShareHoliday[];
  /** When set, rates / projects / calendar are editable. */
  edit?: HrSalaryShareEditHandlers | null;
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  saveError?: string;
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
  monthlySalary,
  perDaySalary: legacyPerDay = 0,
  otPerDaySalary,
  leaveEntries,
  projects,
  workDayEntries,
  workShiftEntries = [],
  dayJoinEntries = [],
  expenseEntries = [],
  receiptEntries = [],
  overtimeEntries,
  holidays: holidaysInput,
  edit = null,
  saveStatus = 'idle',
  saveError = '',
}: HrSalaryShareViewProps) {
  const editable = Boolean(edit);
  const [detailTab, setDetailTab] = useState<HrSalaryDetailTab>('calendar');
  const holidays = useMemo(() => toHrHolidays(holidaysInput), [holidaysInput]);
  const holidayDateSet = useMemo(
    () => new Set(holidays.map(h => h.date)),
    [holidays],
  );
  const resolvedMonthly = useMemo(
    () => resolveSalaryRates(
      {
        monthlySalary,
        perDaySalary: legacyPerDay,
        otPerDaySalary,
      },
      period,
      holidays,
    ).monthlySalary,
    [monthlySalary, legacyPerDay, otPerDaySalary, period, holidays],
  );
  const calc = useMemo(
    () => computeSalaryCalc(
      resolvedMonthly,
      otPerDaySalary,
      period,
      holidays,
      leaveEntries,
      overtimeEntries,
      workShiftEntries,
      workDayEntries,
      dayJoinEntries,
      projects,
    ),
    [
      period,
      holidays,
      leaveEntries,
      overtimeEntries,
      workShiftEntries,
      workDayEntries,
      dayJoinEntries,
      projects,
      resolvedMonthly,
      otPerDaySalary,
    ],
  );
  const settlement = useMemo(
    () => computeExpenseSettlement(
      expenseEntries,
      receiptEntries,
      calc.earnedSalary,
      period,
    ),
    [expenseEntries, receiptEntries, calc.earnedSalary, period],
  );
  const cells = useMemo(
    () => buildMonthDayCells(
      period,
      holidays,
      leaveEntries,
      overtimeEntries,
      projects,
      workDayEntries,
      workShiftEntries,
      dayJoinEntries,
    ),
    [period, holidays, leaveEntries, overtimeEntries, projects, workDayEntries, workShiftEntries, dayJoinEntries],
  );
  const dayEarnings = useMemo(
    () => dayEarningsByDate(
      period,
      holidays,
      leaveEntries,
      overtimeEntries,
      workShiftEntries,
      workDayEntries,
      dayJoinEntries,
      projects,
      calc.perDaySalary,
      calc.otPerDaySalary,
    ),
    [
      period,
      holidays,
      leaveEntries,
      overtimeEntries,
      workShiftEntries,
      workDayEntries,
      dayJoinEntries,
      projects,
      calc.perDaySalary,
      calc.otPerDaySalary,
    ],
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
      calc.perDaySalary,
      calc.otHourlyRate,
      workShiftEntries,
      dayJoinEntries,
      calc.hourlyRate,
    ),
    [
      projects,
      workDayEntries,
      leaveEntries,
      overtimeEntries,
      period,
      holidays,
      calc.perDaySalary,
      calc.otHourlyRate,
      calc.hourlyRate,
      workShiftEntries,
      dayJoinEntries,
    ],
  );
  const otPaySplit = useMemo(
    () => computeOvertimePayWithMakeup(
      overtimeEntries,
      workShiftEntries,
      dayJoinEntries,
      period,
      calc.hourlyRate,
      calc.otHourlyRate,
      holidays,
    ),
    [overtimeEntries, workShiftEntries, dayJoinEntries, period, calc.hourlyRate, calc.otHourlyRate, holidays],
  );
  const projectSharePercents = useMemo(
    () => projectWorkSharePercents(projectTotals),
    [projectTotals],
  );
  const otLines = useMemo(
    () => overtimeEntries
      .map(entry => {
        const hours = overtimeEntryHours(entry.startTime, entry.endTime);
        const split = otPaySplit.entryPay.get(entry.id);
        const project = projects.find(p => p.id === entry.projectId) ?? null;
        return {
          ...entry,
          hours,
          makeupHours: split?.makeupHours ?? 0,
          billableOtHours: split?.billableOtHours ?? hours,
          pay: split?.pay ?? hours * calc.otHourlyRate,
          project,
        };
      })
      .filter(line => line.hours > 0)
      .sort((a, b) => (
        a.date.localeCompare(b.date)
        || a.startTime.localeCompare(b.startTime)
      )),
    [overtimeEntries, projects, calc.otHourlyRate, otPaySplit.entryPay],
  );

  const selectedDate = edit?.selectedDate ?? null;
  const selectDate = (date: string | null) => {
    setDetailTab('calendar');
    edit?.onSelectDate(date);
  };

  return (
    <div className={`hr-salary__expand hr-salary__expand--public${editable ? ' is-editing' : ''}`}>
      <header className="hr-salary__dash-header">
        <div className="hr-salary__dash-header-info">
          <h3>{displayName}</h3>
          <span>{salaryPeriodLabel(period)}</span>
        </div>
        <div className="hr-salary__dash-header-right">
          <div className="hr-salary__dash-header-totals">
            <h4>{formatInr(settlement.netPayable)}</h4>
            <p>
              {formatInr(calc.earnedSalary)} earned
              {settlement.unreimbursedExpenses > 0
                ? ` + ${formatInr(settlement.unreimbursedExpenses)} expenses`
                : ''}
              {settlement.totalSalaryAdvances > 0
                ? ` − ${formatInr(settlement.totalSalaryAdvances)} advance`
                : ''}
            </p>
            <p className="text-sm text-muted">
              {formatOtHours(calc.overtimeHours)} OT
              {' · '}
              {calc.payableDays} days worked
            </p>
          </div>
          {editable ? (
            <p className="hr-salary__share-save-status" aria-live="polite">
              {saveStatus === 'saving'
                ? 'Saving…'
                : saveStatus === 'saved'
                  ? 'Saved'
                  : saveStatus === 'error'
                    ? (saveError || 'Save failed')
                    : null}
            </p>
          ) : null}
        </div>
      </header>

      <div className="hr-salary__config-row">
        <div className="hr-salary__rate-group">
          <div className="hr-salary__rate-item">
            <span>Per month</span>
            {editable && edit ? (
              <>
                <DecimalTextInput
                  className="input-field hr-salary__rate-input"
                  value={edit.monthlySalaryInput}
                  onChange={edit.onMonthlySalaryChange}
                  aria-label="Monthly salary"
                />
                <span className="hr-salary__rate-sub">
                  {formatInr(calc.perDaySalary)}/day · {calc.rateDays} days
                </span>
              </>
            ) : (
              <>
                <div className="hr-salary__rate-value-text">{formatInr(resolvedMonthly)}</div>
                <span className="hr-salary__rate-sub">
                  {formatInr(calc.perDaySalary)}/day · {calc.rateDays} days
                </span>
              </>
            )}
          </div>
          <div className="hr-salary__rate-item">
            <span>OT per day ({HR_SALARY_HOURS_PER_DAY}hrs)</span>
            {editable && edit ? (
              <>
                <DecimalTextInput
                  className="input-field hr-salary__rate-input"
                  value={edit.otPerDaySalaryInput}
                  onChange={edit.onOtPerDayChange}
                  aria-label="OT per day salary"
                />
                <span className="hr-salary__rate-sub">{formatInr(calc.otHourlyRate)}/hr</span>
              </>
            ) : (
              <>
                <div className="hr-salary__rate-value-text">{formatInr(otPerDaySalary)}</div>
                <span className="hr-salary__rate-sub">{formatInr(calc.otHourlyRate)}/hr</span>
              </>
            )}
          </div>
        </div>
        <div className="hr-salary__project-selector">
          <span className="hr-salary__projects-label">Projects:</span>
          {projects.length === 0 && !editable ? (
            <span className="hr-salary__legend-item">None</span>
          ) : null}
          {projects.map(project => (
            <span
              key={project.id}
              className="hr-salary__project-pill"
              style={{ ['--proj-color' as string]: project.color }}
            >
              <i className="hr-salary__proj-dot" style={{ background: project.color }} />
              {editable && edit ? (
                <>
                  <input
                    className="input-field hr-salary__project-name-input"
                    value={project.name}
                    onChange={e => edit.onRenameProject(project.id, e.target.value)}
                    aria-label="Project name"
                  />
                  <button
                    type="button"
                    className="hr-salary__project-remove"
                    aria-label={`Remove ${project.name}`}
                    onClick={() => edit.onRemoveProject(project.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </>
              ) : (
                project.name
              )}
            </span>
          ))}
          {editable && edit ? (
            <button
              type="button"
              className="hr-salary__btn-add"
              onClick={edit.onAddProject}
            >
              <Plus size={14} aria-hidden />
              Add project
            </button>
          ) : null}
        </div>
      </div>

      <div className="hr-salary__main-grid">
        <HrSalaryDetailTabs
          tab={detailTab}
          onTabChange={setDetailTab}
          overtimeHint={`${formatOtHours(calc.overtimeHours)} · ${formatInr(calc.overtimePay)}`}
          expensesHint={`${formatInr(settlement.netPayable)} net`}
        >
        {detailTab === 'calendar' ? (
        <div className="hr-salary__cal-row">
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
                const dayEarn = dayEarnings.get(cell.date);
                const dayTitle = calendarDayHoverTitle(cell, dayEarn, sunday);
                const DayTag = editable ? 'button' : 'div';
                const dayProps = editable && edit
                  ? {
                    type: 'button' as const,
                    onClick: () => selectDate(cell.date),
                  }
                  : {};
                return (
                  <DayTag
                    key={cell.date}
                    {...dayProps}
                    aria-label={dayTitle}
                    className={[
                      'hr-salary__day',
                      editable ? '' : 'is-readonly',
                      hasWork ? 'has-work' : '',
                      hasOt ? 'has-ot' : '',
                      showAsWorkday ? 'is-regular' : '',
                      sunday && hasOt ? 'is-sunday-ot' : '',
                      cell.hasUnassignedRegular ? 'has-unassigned' : '',
                      `is-${cell.kind}`,
                      selectedDate === cell.date ? 'is-selected' : '',
                      halfLeave && hasOt ? 'has-leave-half' : '',
                      fullLeave && hasOt ? 'has-leave' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <span className="hr-salary__day-num">{cell.day}</span>
                    {hasOt ? <span className="hr-salary__day-ot-badge">OT</span> : null}
                    {cell.projectColors.length > 0 || cell.hasUnassignedRegular ? (
                      <span className="hr-salary__day-dots" aria-hidden>
                        {cell.projectColors.map(color => (
                          <i
                            key={color}
                            className="hr-salary__proj-dot hr-salary__proj-dot--mini"
                            style={{ background: color }}
                          />
                        ))}
                        {cell.hasUnassignedRegular ? (
                          <i
                            className="hr-salary__proj-dot hr-salary__proj-dot--mini is-empty"
                            title="Unassigned"
                          />
                        ) : null}
                      </span>
                    ) : null}
                    {dayEarn ? (
                      <span className="hr-salary__day-tip" role="tooltip">
                        <strong>{formatInr(dayEarn.totalPay)}</strong>
                        {dayEarn.regularPay > 0 || dayEarn.overtimePay > 0 ? (
                          <span>
                            {dayEarn.regularPay > 0
                              ? `Regular ${formatInr(dayEarn.regularPay)}`
                              : null}
                            {dayEarn.regularPay > 0 && dayEarn.overtimePay > 0 ? ' · ' : null}
                            {dayEarn.overtimePay > 0
                              ? `OT ${formatInr(dayEarn.overtimePay)}`
                              : null}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </DayTag>
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
            <span className="hr-salary__legend-item">
              <i className="hr-salary__proj-dot hr-salary__proj-dot--mini is-empty" />
              Unassigned day
            </span>
          </div>
          </div>

          <div className="hr-salary__day-panel">
            {editable && edit && selectedDate ? (
              <DayAttendanceSheet
                  date={selectedDate}
                  canEdit
                  canSetLeave={
                    !isSundayDate(selectedDate) && !holidayDateSet.has(selectedDate)
                  }
                  leaveKind={leaveKindForDate(leaveEntries, selectedDate)}
                  holidayName={
                    holidays.find(h => h.date === selectedDate)?.name ?? null
                  }
                  projects={projects}
                  dayProjectId={workProjectIdForDate(workDayEntries, selectedDate)}
                  workShifts={workShiftEntries
                    .filter(e => e.date === selectedDate)
                    .sort((a, b) => a.startTime.localeCompare(b.startTime))}
                  joinedAt={
                    dayJoinEntries.find(e => e.date === selectedDate)?.joinedAt ?? null
                  }
                  clockedOutAt={
                    dayJoinEntries.find(e => e.date === selectedDate)?.clockedOutAt ?? null
                  }
                  entries={overtimeEntries.filter(e => e.date === selectedDate)}
                  onClose={() => selectDate(null)}
                  onSetLeave={kind => edit.onSetLeave(selectedDate, kind)}
                  onSetDayProject={projectId => edit.onSetDayProject(selectedDate, projectId)}
                  onSetDayClock={patch => edit.onSetDayClock(selectedDate, patch)}
                  onAddWorkShift={() => edit.onAddWorkShift(selectedDate)}
                  onPatchWorkShift={edit.onPatchWorkShift}
                  onRemoveWorkShift={edit.onRemoveWorkShift}
                  onAddOt={() => edit.onAddOt(selectedDate)}
                  onPatchOt={edit.onPatchOt}
                  onRemoveOt={edit.onRemoveOt}
                  expenses={expenseEntries.filter(e => e.date === selectedDate)}
                  receipts={receiptEntries.filter(e => e.date === selectedDate)}
                  onAddExpense={() => edit.onAddExpense(selectedDate)}
                  onPatchExpense={edit.onPatchExpense}
                  onRemoveExpense={edit.onRemoveExpense}
                  onAddReceipt={kind => edit.onAddReceipt(selectedDate, kind)}
                  onPatchReceipt={edit.onPatchReceipt}
                  onRemoveReceipt={edit.onRemoveReceipt}
                />
            ) : (
              <ProjectWorkSummaryCard
                projectTotals={projectTotals}
                projectSharePercents={projectSharePercents}
                earnedSalary={calc.earnedSalary}
                leaveDays={calc.leaveDays}
                payableDays={calc.payableDays}
                rateDays={calc.rateDays}
                regularPay={calc.regularPay}
                overtimeHours={calc.overtimeHours}
                overtimePay={calc.overtimePay}
              />
            )}
          </div>
        </div>
        ) : null}

        {detailTab === 'expenses' ? (
        <ExpenseSettlementCard
          settlement={settlement}
          earnedSalary={calc.earnedSalary}
          expenseEntries={expenseEntries}
          receiptEntries={receiptEntries}
          onLineClick={editable ? date => selectDate(date) : undefined}
          downloadFileName={`${displayName
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'staff'}-expenses-${salaryPeriodKey(period)}`}
        />
        ) : null}

        {detailTab === 'overtime' ? (
        <div className="hr-salary__card hr-salary__ot-detail">
          <div className="hr-salary__ot-detail-head">
            <span className="hr-salary__expense-detail-title">Overtime</span>
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
                  {editable ? (
                    <button
                      type="button"
                      className="hr-salary__ot-detail-line"
                      onClick={() => selectDate(line.date)}
                    >
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
                        {line.makeupHours > 0 ? (
                          <>
                            {formatOtHours(line.billableOtHours)} OT
                            {' + '}
                            {formatOtHours(line.makeupHours)} reg
                          </>
                        ) : (
                          formatOtHours(line.hours)
                        )}
                      </span>
                      <span className="hr-salary__ot-detail-pay">
                        {formatInr(line.pay)}
                      </span>
                    </button>
                  ) : (
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
                        {line.makeupHours > 0 ? (
                          <>
                            {formatOtHours(line.billableOtHours)} OT
                            {' + '}
                            {formatOtHours(line.makeupHours)} reg
                          </>
                        ) : (
                          formatOtHours(line.hours)
                        )}
                      </span>
                      <span className="hr-salary__ot-detail-pay">
                        {formatInr(line.pay)}
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        ) : null}
        </HrSalaryDetailTabs>
      </div>
    </div>
  );
}
