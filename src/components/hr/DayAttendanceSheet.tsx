import { Plus, Trash2, X } from 'lucide-react';
import { formatOtHours, overtimeEntryHours } from '../../lib/hrSalary';
import type {
  HrLeaveKind,
  HrOvertimeEntry,
  HrSalaryProject,
  HrWorkShiftEntry,
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
  entries: HrOvertimeEntry[];
  onClose: () => void;
  onSetLeave: (kind: HrLeaveKind | null) => void;
  onSetDayProject: (projectId: string | null) => void;
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

export function DayAttendanceSheet({
  date,
  canEdit,
  canSetLeave,
  leaveKind,
  holidayName,
  projects,
  dayProjectId,
  workShifts,
  entries,
  onClose,
  onSetLeave,
  onSetDayProject,
  onAddWorkShift,
  onPatchWorkShift,
  onRemoveWorkShift,
  onAddOt,
  onPatchOt,
  onRemoveOt,
}: DayAttendanceSheetProps) {
  const dayWorkHours = workShifts.reduce(
    (sum, e) => sum + overtimeEntryHours(e.startTime, e.endTime),
    0,
  );
  const dayOtHours = entries.reduce(
    (sum, e) => sum + overtimeEntryHours(e.startTime, e.endTime),
    0,
  );
  const hasWorkShifts = workShifts.length > 0;
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
      </div>
    </div>
  );
}
