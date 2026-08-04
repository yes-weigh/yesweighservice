import { Plus, Trash2, X } from 'lucide-react';
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

function ShiftRows({
  label,
  hoursLabel,
  canEdit,
  projects,
  shifts,
  onAdd,
  onPatch,
  onRemove,
  addLabel,
  removeLabel,
}: {
  label: string;
  hoursLabel: string;
  canEdit: boolean;
  projects: HrSalaryProject[];
  shifts: Array<{
    id: string;
    startTime: string;
    endTime: string;
    projectId: string | null;
  }>;
  onAdd: () => void;
  onPatch: (
    entryId: string,
    patch: Partial<{ startTime: string; endTime: string; projectId: string | null }>,
  ) => void;
  onRemove: (entryId: string) => void;
  addLabel: string;
  removeLabel: string;
}) {
  return (
    <section className="hr-salary__day-sheet-section">
      <div className="hr-salary__day-sheet-section-head">
        <span>{label}</span>
        <span className="text-muted">{hoursLabel}</span>
      </div>
      {shifts.length === 0 ? null : (
        <ul className="hr-salary__ot-list">
          {shifts.map(entry => {
            const project = projects.find(p => p.id === entry.projectId);
            return (
              <li key={entry.id} className="hr-salary__ot-row hr-salary__ot-row--project">
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
      )}
      {canEdit ? (
        <button
          type="button"
          className="btn btn-secondary btn-sm hr-salary__ot-add"
          onClick={onAdd}
        >
          <Plus size={14} aria-hidden />
          {addLabel}
        </button>
      ) : null}
    </section>
  );
}

function MoneyEntryRows({
  label,
  totalLabel,
  canEdit,
  rows,
  onAdd,
  onPatch,
  onRemove,
  addLabel,
  removeLabel,
  showKind,
}: {
  label: string;
  totalLabel: string;
  canEdit: boolean;
  rows: Array<{
    id: string;
    amount: number;
    note: string;
    kind?: HrSalaryReceiptKind;
  }>;
  onAdd?: () => void;
  onPatch: (
    entryId: string,
    patch: Partial<{ amount: number; note: string; kind: HrSalaryReceiptKind }>,
  ) => void;
  onRemove: (entryId: string) => void;
  addLabel: string;
  removeLabel: string;
  showKind?: boolean;
}) {
  return (
    <section className="hr-salary__day-sheet-section">
      <div className="hr-salary__day-sheet-section-head">
        <span>{label}</span>
        <span className="text-muted">{totalLabel}</span>
      </div>
      {rows.length === 0 ? null : (
        <ul className="hr-salary__money-list">
          {rows.map(entry => (
            <li key={entry.id} className="hr-salary__money-row">
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
                    <option value="reimbursement">Reimbursement</option>
                    <option value="salary_advance">Salary advance</option>
                  </select>
                </label>
              ) : null}
              <label>
                <span>Amount</span>
                <DecimalTextInput
                  className="input-field"
                  value={entry.amount > 0 ? String(entry.amount) : ''}
                  disabled={!canEdit}
                  aria-label={`${label} amount`}
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
              <span className="hr-salary__money-amount">{formatInr(entry.amount)}</span>
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
      )}
      {canEdit && onAdd ? (
        <button
          type="button"
          className="btn btn-secondary btn-sm hr-salary__ot-add"
          onClick={onAdd}
        >
          <Plus size={14} aria-hidden />
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
  const dayKindLabel = isSundayDate(date)
    ? 'Sunday'
    : holidayName
      ? `Holiday · ${holidayName}`
      : leaveKind === 'full'
        ? 'Full-day leave'
        : leaveKind === 'half'
          ? 'Half-day leave'
          : 'Working day';

  return (
    <div
      className="hr-salary__day-sheet"
      role="region"
      aria-label={`Day attendance for ${formatDayLabel(date)}`}
    >
      <header className="hr-salary__day-sheet-head">
        <div>
          <h4 className="hr-salary__day-sheet-title">{formatDayLabel(date)}</h4>
          <p className="text-sm text-muted hr-salary__day-sheet-sub">{dayKindLabel}</p>
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
        <section className="hr-salary__day-sheet-section">
          <div className="hr-salary__day-sheet-section-head">
            <span>Whole-day project</span>
            {hasWorkShifts ? (
              <span className="text-sm text-muted">Shifts override</span>
            ) : null}
          </div>
          {projects.length === 0 ? (
            <p className="text-sm text-muted">Add a project above first.</p>
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
          {hasWorkShifts ? (
            <p className="text-sm text-muted" style={{ marginTop: '0.5rem' }}>
              Timed daytime shifts are set — whole-day project is ignored.
            </p>
          ) : null}
          {canSetLeave && !hasWorkShifts && !dayProjectId ? (
            <p className="hr-salary__unassigned-hint" role="status">
              Regular pay for this day is Unassigned — pick a project or add daytime shifts.
            </p>
          ) : null}
        </section>

        <section className="hr-salary__day-sheet-section">
          <div className="hr-salary__day-sheet-section-head">
            <span>Clock in / out</span>
            <span className="text-muted">
              {formatOtHours(clockRegularHours)} regular
            </span>
          </div>
          {hasWorkShifts ? (
            <p className="text-sm text-muted">
              From daytime shifts: {formatTimeAmPm(displayClockIn)} – {formatTimeAmPm(displayClockOut)}
            </p>
          ) : (
            <div className="hr-salary__clock-row">
              <label className="hr-salary__join-field">
                <span className="text-sm text-muted">Clock-in</span>
                <input
                  type="time"
                  className="input-field"
                  value={displayClockIn}
                  disabled={!canEdit}
                  onChange={e => onSetDayClock({ joinedAt: e.target.value || null })}
                />
              </label>
              <label className="hr-salary__join-field">
                <span className="text-sm text-muted">Clock-out</span>
                <input
                  type="time"
                  className="input-field"
                  value={displayClockOut}
                  disabled={!canEdit}
                  onChange={e => onSetDayClock({ clockedOutAt: e.target.value || null })}
                />
              </label>
            </div>
          )}
          <p className="text-sm text-muted">
            Standard day {formatTimeAmPm(HR_SALARY_STANDARD_START_TIME)}
            {' – '}
            {formatTimeAmPm(HR_SALARY_STANDARD_END_TIME)}
          </p>
          {morningDeficit > 0 ? (
            <p className="hr-salary__join-hint" role="status">
              {formatOtHours(morningDeficit)} morning gap — overtime on this day fills that at
              regular pay first.
            </p>
          ) : null}
        </section>

        <ShiftRows
          label="Daytime shifts"
          hoursLabel={formatOtHours(dayWorkHours)}
          canEdit={canEdit}
          projects={projects}
          shifts={workShifts}
          onAdd={onAddWorkShift}
          onPatch={onPatchWorkShift}
          onRemove={onRemoveWorkShift}
          addLabel="Add daytime shift"
          removeLabel="Remove daytime shift"
        />

        <section className="hr-salary__day-sheet-section">
          <div className="hr-salary__day-sheet-section-head">
            <span>Leave</span>
            {!canSetLeave ? (
              <span className="text-sm text-muted">N/A</span>
            ) : null}
          </div>
          {canSetLeave ? (
            <div className="hr-salary__leave-seg" role="group" aria-label="Leave type">
              <button
                type="button"
                className={!leaveKind ? 'is-active' : ''}
                disabled={!canEdit}
                onClick={() => onSetLeave(null)}
              >
                Working
              </button>
              <button
                type="button"
                className={leaveKind === 'half' ? 'is-active' : ''}
                disabled={!canEdit}
                onClick={() => onSetLeave('half')}
              >
                Half day
              </button>
              <button
                type="button"
                className={leaveKind === 'full' ? 'is-active' : ''}
                disabled={!canEdit}
                onClick={() => onSetLeave('full')}
              >
                Full day
              </button>
            </div>
          ) : null}
        </section>

        <ShiftRows
          label="Overtime shifts"
          hoursLabel={formatOtHours(dayOtHours)}
          canEdit={canEdit}
          projects={projects}
          shifts={entries}
          onAdd={onAddOt}
          onPatch={onPatchOt}
          onRemove={onRemoveOt}
          addLabel="Add OT shift"
          removeLabel="Remove overtime shift"
        />

        <MoneyEntryRows
          label="Expenses"
          totalLabel={formatInr(dayExpenseTotal)}
          canEdit={canEdit}
          rows={expenses}
          onAdd={onAddExpense}
          onPatch={onPatchExpense}
          onRemove={onRemoveExpense}
          addLabel="Add expense"
          removeLabel="Remove expense"
        />

        <MoneyEntryRows
          label="Received"
          totalLabel={formatInr(dayReceiptTotal)}
          canEdit={canEdit}
          rows={receipts}
          onAdd={() => onAddReceipt('reimbursement')}
          onPatch={onPatchReceipt}
          onRemove={onRemoveReceipt}
          addLabel="Add reimbursement or advance"
          removeLabel="Remove receipt"
          showKind
        />
        {canEdit ? (
          <div className="hr-salary__receipt-quick-add">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onAddReceipt('salary_advance')}
            >
              <Plus size={14} aria-hidden />
              Add salary advance
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
