import { Plus, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { DecimalTextInput } from '../DecimalAmountInput';
import {
  formatInr,
  formatOtHours,
  formatTimeAmPm,
  dayJoinRegularHours,
  morningDeficitHoursForDate,
  overtimeEntryHours,
} from '../../lib/hrSalary';
import {
  HR_SALARY_STANDARD_END_TIME,
  HR_SALARY_STANDARD_START_TIME,
  type HrDayJoinEntry,
  type HrExpenseEntry,
  type HrLeaveKind,
  type HrOvertimeEntry,
  type HrSalaryProject,
  type HrSalaryReceiptEntry,
  type HrSalaryReceiptKind,
  type HrWorkShiftEntry,
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

function isSundayDate(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return false;
  return new Date(y, m - 1, d).getDay() === 0;
}

export type DayAttendanceSheetProps = {
  date: string;
  canEdit: boolean;
  canSetLeave: boolean;
  leaveKind: HrLeaveKind | null;
  holidayName: string | null;
  projects: HrSalaryProject[];
  dayProjectId: string | null;
  workShifts: HrWorkShiftEntry[];
  joinedAt: string | null;
  clockedOutAt: string | null;
  entries: HrOvertimeEntry[];
  onClose: () => void;
  onSetLeave: (kind: HrLeaveKind | null) => void;
  onSetDayProject: (projectId: string | null) => void;
  onSetDayClock: (patch: { joinedAt?: string | null; clockedOutAt?: string | null }) => void;
  onAddWorkShift: () => void;
  onPatchWorkShift: (
    entryId: string,
    patch: Partial<Pick<HrWorkShiftEntry, 'startTime' | 'endTime' | 'projectId'>>,
  ) => void;
  onRemoveWorkShift: (entryId: string) => void;
  onAddOt: () => void;
  onPatchOt: (
    entryId: string,
    patch: Partial<Pick<HrOvertimeEntry, 'startTime' | 'endTime' | 'projectId'>>,
  ) => void;
  onRemoveOt: (entryId: string) => void;
  expenses: HrExpenseEntry[];
  receipts: HrSalaryReceiptEntry[];
  onAddExpense: () => void;
  onPatchExpense: (
    entryId: string,
    patch: Partial<Pick<HrExpenseEntry, 'amount' | 'note'>>,
  ) => void;
  onRemoveExpense: (entryId: string) => void;
  onAddReceipt: (kind: HrSalaryReceiptKind) => void;
  onPatchReceipt: (
    entryId: string,
    patch: Partial<Pick<HrSalaryReceiptEntry, 'amount' | 'note' | 'kind'>>,
  ) => void;
  onRemoveReceipt: (entryId: string) => void;
};

type ShiftLike = {
  id: string;
  startTime: string;
  endTime: string;
  projectId: string | null;
};

function ShiftList({
  canEdit,
  projects,
  shifts,
  onPatch,
  onRemove,
  removeLabel,
}: {
  canEdit: boolean;
  projects: HrSalaryProject[];
  shifts: ShiftLike[];
  onPatch: (
    entryId: string,
    patch: Partial<{ startTime: string; endTime: string; projectId: string | null }>,
  ) => void;
  onRemove: (entryId: string) => void;
  removeLabel: string;
}) {
  return (
    <ul className="hr-salary__ot-list">
      {shifts.map(entry => {
        const project = projects.find(p => p.id === entry.projectId);
        return (
          <li key={entry.id} className="hr-salary__ot-row hr-salary__ot-row--project">
            <label>
              <span>Start</span>
              <input
                type="time"
                className="input-field"
                value={entry.startTime}
                disabled={!canEdit}
                onChange={e => onPatch(entry.id, { startTime: e.target.value })}
              />
            </label>
            <label>
              <span>End</span>
              <input
                type="time"
                className="input-field"
                value={entry.endTime}
                disabled={!canEdit}
                onChange={e => onPatch(entry.id, { endTime: e.target.value })}
              />
            </label>
            {projects.length > 0 ? (
              <label className="hr-salary__ot-project-field">
                <span>Project</span>
                <select
                  className="input-field"
                  value={entry.projectId ?? ''}
                  disabled={!canEdit}
                  onChange={e => onPatch(entry.id, {
                    projectId: e.target.value || null,
                  })}
                >
                  <option value="">Unassigned</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <span className="hr-salary__ot-hours">
              {project ? (
                <i className="hr-salary__proj-dot" style={{ background: project.color }} />
              ) : null}
              {formatOtHours(overtimeEntryHours(entry.startTime, entry.endTime))}
            </span>
            {canEdit ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm hr-salary__ot-remove"
                aria-label={removeLabel}
                onClick={() => onRemove(entry.id)}
              >
                <Trash2 size={14} aria-hidden />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function MoneyList({
  canEdit,
  rows,
  onPatch,
  onRemove,
  removeLabel,
  showKind,
}: {
  canEdit: boolean;
  rows: Array<{
    id: string;
    amount: number;
    note: string;
    kind?: HrSalaryReceiptKind;
  }>;
  onPatch: (
    entryId: string,
    patch: Partial<{ amount: number; note: string; kind: HrSalaryReceiptKind }>,
  ) => void;
  onRemove: (entryId: string) => void;
  removeLabel: string;
  showKind?: boolean;
}) {
  return (
    <ul className="hr-salary__money-list">
      {rows.map(entry => (
        <li
          key={entry.id}
          className={[
            'hr-salary__money-row',
            showKind ? 'has-kind' : '',
          ].filter(Boolean).join(' ')}
        >
          {showKind ? (
            <label>
              <span>Type</span>
              <select
                className="input-field"
                value={entry.kind ?? 'reimbursement'}
                disabled={!canEdit}
                onChange={e => onPatch(entry.id, {
                  kind: e.target.value === 'salary_advance' ? 'salary_advance' : 'reimbursement',
                })}
              >
                <option value="reimbursement">Reimburse</option>
                <option value="salary_advance">Advance</option>
              </select>
            </label>
          ) : null}
          <label>
            <span>Amount</span>
            <DecimalTextInput
              className="input-field"
              value={entry.amount > 0 ? String(entry.amount) : ''}
              disabled={!canEdit}
              aria-label="Amount"
              onChange={value => onPatch(entry.id, {
                amount: Math.max(0, Number.parseFloat(value) || 0),
              })}
            />
          </label>
          <label className="hr-salary__money-note">
            <span>Note</span>
            <input
              type="text"
              className="input-field"
              value={entry.note}
              disabled={!canEdit}
              placeholder="Optional"
              onChange={e => onPatch(entry.id, { note: e.target.value })}
            />
          </label>
          {canEdit ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm hr-salary__ot-remove"
              aria-label={removeLabel}
              onClick={() => onRemove(entry.id)}
            >
              <Trash2 size={14} aria-hidden />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ExtraEmpty({
  label,
  hint,
  actions,
}: {
  label: string;
  hint?: string;
  actions: ReactNode;
}) {
  return (
    <div className="hr-salary__day-extra">
      <div className="hr-salary__day-extra-copy">
        <span className="hr-salary__day-extra-label">{label}</span>
        {hint ? <span className="hr-salary__day-extra-hint">{hint}</span> : null}
      </div>
      <div className="hr-salary__day-extra-actions">{actions}</div>
    </div>
  );
}

function ExtraFilled({
  label,
  meta,
  live,
  canEdit,
  addLabel,
  onAdd,
  children,
}: {
  label: string;
  meta: string;
  live?: boolean;
  canEdit: boolean;
  addLabel?: string;
  onAdd?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="hr-salary__day-sheet-section is-filled">
      <div className="hr-salary__day-sheet-section-head">
        <span>{label}</span>
        <span className={live ? 'hr-salary__day-sheet-meta is-live' : 'hr-salary__day-sheet-meta'}>
          {meta}
        </span>
      </div>
      {children}
      {canEdit && onAdd ? (
        <button type="button" className="hr-salary__day-add-inline" onClick={onAdd}>
          <Plus size={13} aria-hidden />
          {addLabel}
        </button>
      ) : null}
    </section>
  );
}

export function DayAttendanceSheet({
  date,
  canEdit,
  canSetLeave,
  leaveKind,
  holidayName,
  projects,
  dayProjectId,
  workShifts,
  joinedAt,
  clockedOutAt,
  entries,
  onClose,
  onSetLeave,
  onSetDayProject,
  onSetDayClock,
  onAddWorkShift,
  onPatchWorkShift,
  onRemoveWorkShift,
  onAddOt,
  onPatchOt,
  onRemoveOt,
  expenses,
  receipts,
  onAddExpense,
  onPatchExpense,
  onRemoveExpense,
  onAddReceipt,
  onPatchReceipt,
  onRemoveReceipt,
}: DayAttendanceSheetProps) {
  const dayWorkHours = workShifts.reduce(
    (sum, e) => sum + overtimeEntryHours(e.startTime, e.endTime),
    0,
  );
  const dayOtHours = entries.reduce(
    (sum, e) => sum + overtimeEntryHours(e.startTime, e.endTime),
    0,
  );
  const dayExpenseTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
  const dayReceiptTotal = receipts.reduce((sum, e) => sum + e.amount, 0);
  const hasWorkShifts = workShifts.length > 0;
  const shiftClockIn = hasWorkShifts
    ? workShifts.reduce(
      (earliest, entry) => (entry.startTime < earliest ? entry.startTime : earliest),
      workShifts[0].startTime,
    )
    : null;
  const shiftClockOut = hasWorkShifts
    ? workShifts.reduce(
      (latest, entry) => (entry.endTime > latest ? entry.endTime : latest),
      workShifts[0].endTime,
    )
    : null;
  const displayClockIn = shiftClockIn ?? joinedAt ?? HR_SALARY_STANDARD_START_TIME;
  const displayClockOut = shiftClockOut ?? clockedOutAt ?? HR_SALARY_STANDARD_END_TIME;
  const dayJoinForCalc: HrDayJoinEntry = {
    date,
    joinedAt: displayClockIn,
    clockedOutAt: displayClockOut,
  };
  const clockRegularHours = hasWorkShifts
    ? dayWorkHours
    : dayJoinRegularHours(dayJoinForCalc);
  const morningDeficit = morningDeficitHoursForDate(
    date,
    workShifts,
    joinedAt || clockedOutAt
      ? [{ date, joinedAt: displayClockIn, clockedOutAt: displayClockOut }]
      : [],
  );
  const closedDay = isSundayDate(date) || Boolean(holidayName);
  const isFullLeave = leaveKind === 'full';
  const showAttendance = !isFullLeave && !closedDay;
  const dayKindLabel = closedDay
    ? (isSundayDate(date) ? 'Sunday' : `Holiday · ${holidayName}`)
    : leaveKind === 'full'
      ? 'Full-day leave'
      : leaveKind === 'half'
        ? 'Half-day leave'
        : 'Working day';
  const statusTone = closedDay
    ? 'closed'
    : leaveKind === 'full'
      ? 'leave'
      : leaveKind === 'half'
        ? 'leave-half'
        : 'working';

  return (
    <div
      className="hr-salary__day-sheet"
      role="region"
      aria-label={`Day attendance for ${formatDayLabel(date)}`}
    >
      <header className="hr-salary__day-sheet-head">
        <div className="hr-salary__day-sheet-head-main">
          <h4 className="hr-salary__day-sheet-title">{formatDayLabel(date)}</h4>
          <p className={`hr-salary__day-sheet-status is-${statusTone}`}>{dayKindLabel}</p>
        </div>
        <button
          type="button"
          className="hr-salary__day-sheet-close"
          aria-label="Close day editor"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>

      <div className="hr-salary__day-sheet-body">
        {canSetLeave ? (
          <div className="hr-salary__leave-seg" role="group" aria-label="Day status">
            <button
              type="button"
              className={!leaveKind ? 'is-active is-working' : ''}
              disabled={!canEdit}
              onClick={() => onSetLeave(null)}
            >
              Working
            </button>
            <button
              type="button"
              className={leaveKind === 'half' ? 'is-active is-half' : ''}
              disabled={!canEdit}
              onClick={() => onSetLeave('half')}
            >
              Half day
            </button>
            <button
              type="button"
              className={leaveKind === 'full' ? 'is-active is-full' : ''}
              disabled={!canEdit}
              onClick={() => onSetLeave('full')}
            >
              Full day
            </button>
          </div>
        ) : null}

        {isFullLeave ? (
          <p className="hr-salary__day-sheet-note">
            Regular hours are off. Overtime and payments can still be added.
          </p>
        ) : null}

        {closedDay && !hasWorkShifts ? (
          <p className="hr-salary__day-sheet-note">
            No regular pay on this day. Add overtime below if they worked.
          </p>
        ) : null}

        {showAttendance ? (
          <section className="hr-salary__day-sheet-block">
            {projects.length === 0 ? (
              <p className="hr-salary__day-sheet-note">Add a project above first.</p>
            ) : (
              <div className="hr-salary__project-chips" role="group" aria-label="Whole-day project">
                <button
                  type="button"
                  className={!dayProjectId ? 'is-active' : ''}
                  disabled={!canEdit || hasWorkShifts}
                  onClick={() => onSetDayProject(null)}
                >
                  None
                </button>
                {projects.map(project => (
                  <button
                    key={project.id}
                    type="button"
                    className={dayProjectId === project.id ? 'is-active' : ''}
                    disabled={!canEdit || hasWorkShifts}
                    style={{ ['--proj-color' as string]: project.color }}
                    onClick={() => onSetDayProject(project.id)}
                  >
                    <i className="hr-salary__proj-dot" style={{ background: project.color }} />
                    {project.name}
                  </button>
                ))}
              </div>
            )}
            {canSetLeave && !hasWorkShifts && !dayProjectId ? (
              <p className="hr-salary__unassigned-hint" role="status">
                Unassigned — pick a project, or split the day into shifts.
              </p>
            ) : null}

            {hasWorkShifts ? (
              <p className="hr-salary__day-sheet-note">
                Hours from shifts: {formatTimeAmPm(displayClockIn)} – {formatTimeAmPm(displayClockOut)}
                {' · '}
                {formatOtHours(clockRegularHours)}
              </p>
            ) : (
              <div className="hr-salary__clock-row">
                <label className="hr-salary__join-field">
                  <span>In</span>
                  <input
                    type="time"
                    className="input-field"
                    value={displayClockIn}
                    disabled={!canEdit}
                    onChange={e => onSetDayClock({ joinedAt: e.target.value || null })}
                  />
                </label>
                <span className="hr-salary__clock-arrow" aria-hidden>→</span>
                <label className="hr-salary__join-field">
                  <span>Out</span>
                  <input
                    type="time"
                    className="input-field"
                    value={displayClockOut}
                    disabled={!canEdit}
                    onChange={e => onSetDayClock({ clockedOutAt: e.target.value || null })}
                  />
                </label>
                <span className="hr-salary__clock-total">
                  {formatOtHours(clockRegularHours)}
                  <small>regular</small>
                </span>
              </div>
            )}
            {morningDeficit > 0 ? (
              <p className="hr-salary__join-hint" role="status">
                {formatOtHours(morningDeficit)} late start — OT on this day fills that at regular
                pay first.
              </p>
            ) : null}
          </section>
        ) : null}

        <div className="hr-salary__day-extras">
          {entries.length === 0 ? (
            canEdit ? (
              <ExtraEmpty
                label="Overtime"
                hint="None"
                actions={(
                  <button type="button" className="hr-salary__day-extra-add" onClick={onAddOt}>
                    <Plus size={13} aria-hidden />
                    Add
                  </button>
                )}
              />
            ) : null
          ) : (
            <ExtraFilled
              label="Overtime"
              meta={formatOtHours(dayOtHours)}
              live
              canEdit={canEdit}
              addLabel="Add shift"
              onAdd={onAddOt}
            >
              <ShiftList
                canEdit={canEdit}
                projects={projects}
                shifts={entries}
                onPatch={onPatchOt}
                onRemove={onRemoveOt}
                removeLabel="Remove overtime shift"
              />
            </ExtraFilled>
          )}

          {workShifts.length === 0 ? (
            canEdit && showAttendance ? (
              <ExtraEmpty
                label="Split day"
                hint="Multiple projects"
                actions={(
                  <button type="button" className="hr-salary__day-extra-add" onClick={onAddWorkShift}>
                    <Plus size={13} aria-hidden />
                    Add
                  </button>
                )}
              />
            ) : null
          ) : (
            <ExtraFilled
              label="Daytime shifts"
              meta={formatOtHours(dayWorkHours)}
              live={dayWorkHours > 0}
              canEdit={canEdit}
              addLabel="Add shift"
              onAdd={onAddWorkShift}
            >
              <ShiftList
                canEdit={canEdit}
                projects={projects}
                shifts={workShifts}
                onPatch={onPatchWorkShift}
                onRemove={onRemoveWorkShift}
                removeLabel="Remove daytime shift"
              />
            </ExtraFilled>
          )}

          {expenses.length === 0 ? (
            canEdit ? (
              <ExtraEmpty
                label="Expense"
                hint="None"
                actions={(
                  <button type="button" className="hr-salary__day-extra-add" onClick={onAddExpense}>
                    <Plus size={13} aria-hidden />
                    Add
                  </button>
                )}
              />
            ) : null
          ) : (
            <ExtraFilled
              label="Expenses"
              meta={formatInr(dayExpenseTotal)}
              live={dayExpenseTotal > 0}
              canEdit={canEdit}
              addLabel="Add expense"
              onAdd={onAddExpense}
            >
              <MoneyList
                canEdit={canEdit}
                rows={expenses}
                onPatch={onPatchExpense}
                onRemove={onRemoveExpense}
                removeLabel="Remove expense"
              />
            </ExtraFilled>
          )}

          {receipts.length === 0 ? (
            canEdit ? (
              <ExtraEmpty
                label="Received"
                hint="None"
                actions={(
                  <>
                    <button
                      type="button"
                      className="hr-salary__day-extra-add"
                      onClick={() => onAddReceipt('reimbursement')}
                    >
                      <Plus size={13} aria-hidden />
                      Reimburse
                    </button>
                    <button
                      type="button"
                      className="hr-salary__day-extra-add"
                      onClick={() => onAddReceipt('salary_advance')}
                    >
                      <Plus size={13} aria-hidden />
                      Advance
                    </button>
                  </>
                )}
              />
            ) : null
          ) : (
            <ExtraFilled
              label="Received"
              meta={formatInr(dayReceiptTotal)}
              live={dayReceiptTotal > 0}
              canEdit={canEdit}
              addLabel="Add receipt"
              onAdd={() => onAddReceipt('reimbursement')}
            >
              <MoneyList
                canEdit={canEdit}
                rows={receipts}
                onPatch={onPatchReceipt}
                onRemove={onRemoveReceipt}
                removeLabel="Remove receipt"
                showKind
              />
            </ExtraFilled>
          )}
        </div>
      </div>
    </div>
  );
}
