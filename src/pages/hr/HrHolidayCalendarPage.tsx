import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { canManageHr } from '../../lib/staffAccess';
import {
  createHrHoliday,
  deleteHrHoliday,
  fetchHrHolidays,
  holidaysInMonth,
  holidayDatesSet,
  seedDefaultHrHolidays,
} from '../../lib/hrHolidays';
import {
  HR_HOLIDAY_TYPES,
  HR_HOLIDAY_TYPE_LABELS,
  type HrHoliday,
  type HrHolidayType,
} from '../../types/hr-holiday';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const EMPTY_FORM = {
  date: '',
  name: '',
  type: 'public' as HrHolidayType,
  note: '',
};

function monthMatrix(year: number, month: number): Array<Array<{ date: string; day: number } | null>> {
  const first = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const startPad = first.getDay();
  const cells: Array<{ date: string; day: number } | null> = [];

  for (let i = 0; i < startPad; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({ date, day });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: Array<Array<{ date: string; day: number } | null>> = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

export const HrHolidayCalendarPage: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const canEdit = canManageHr(user);
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [holidays, setHolidays] = useState<HrHoliday[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setHolidays(await fetchHrHolidays());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const monthHolidays = useMemo(
    () => holidaysInMonth(holidays, viewYear, viewMonth),
    [holidays, viewMonth, viewYear],
  );
  const holidayByDate = useMemo(() => {
    const map = new Map<string, HrHoliday[]>();
    for (const h of holidays) {
      const list = map.get(h.date) ?? [];
      list.push(h);
      map.set(h.date, list);
    }
    return map;
  }, [holidays]);
  const holidayDates = useMemo(() => holidayDatesSet(holidays), [holidays]);
  const weeks = useMemo(() => monthMatrix(viewYear, viewMonth), [viewMonth, viewYear]);

  const monthLabel = new Date(viewYear, viewMonth - 1, 1).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });

  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth - 1 + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth() + 1);
  };

  const openAddForm = (date?: string) => {
    setForm({
      ...EMPTY_FORM,
      date: date ?? `${viewYear}-${String(viewMonth).padStart(2, '0')}-01`,
    });
    setError('');
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !canEdit) return;
    if (!form.date || !form.name.trim()) {
      setError('Date and holiday name are required.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await createHrHoliday(
        {
          date: form.date,
          name: form.name,
          type: form.type,
          note: form.note || null,
        },
        user.uid,
      );
      setShowForm(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save holiday.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (holiday: HrHoliday) => {
    if (!canEdit) return;
    const ok = await confirm({
      title: 'Remove holiday?',
      message: `Delete "${holiday.name}" on ${holiday.date}?`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await deleteHrHoliday(holiday.id);
    await load();
  };

  const handleSeed = async () => {
    if (!user || !canEdit) return;
    const added = await seedDefaultHrHolidays(user.uid);
    await load();
    if (added === 0) {
      setError('Default holidays are already loaded.');
    } else {
      setError('');
    }
  };

  return (
    <div className="hr-holiday">
      <div className="hr-work-report__intro panel glass">
        <CalendarDays size={20} aria-hidden />
        <div>
          <p className="text-sm">
            Company and public holidays for YesOne staff — planning leave, service coverage,
            and dealer support rosters.
          </p>
        </div>
      </div>

      <div className="hr-holiday__toolbar panel glass">
        <div className="hr-holiday__nav">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            <ChevronLeft size={16} />
          </button>
          <strong>{monthLabel}</strong>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => shiftMonth(1)} aria-label="Next month">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="hr-holiday__actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
            <RefreshCw size={15} className={loading ? 'spin-icon' : undefined} />
          </button>
          {canEdit && (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleSeed()}>
                Load 2026 defaults
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => openAddForm()}>
                <Plus size={15} />
                Add holiday
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="text-sm" style={{ color: '#f87171' }}>{error}</p>}

      {showForm && canEdit && (
        <form className="hr-holiday__form panel glass" onSubmit={e => void handleSubmit(e)}>
          <h3 className="text-sm" style={{ margin: 0 }}>New holiday</h3>
          <div className="hr-holiday__form-grid">
            <label className="hr-staff-form__field">
              <span>Date</span>
              <input
                type="date"
                className="input-field"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                required
              />
            </label>
            <label className="hr-staff-form__field">
              <span>Name</span>
              <input
                className="input-field"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Onam"
                required
              />
            </label>
            <label className="hr-staff-form__field">
              <span>Type</span>
              <select
                className="input-field"
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as HrHolidayType }))}
              >
                {HR_HOLIDAY_TYPES.map(type => (
                  <option key={type} value={type}>{HR_HOLIDAY_TYPE_LABELS[type]}</option>
                ))}
              </select>
            </label>
            <label className="hr-staff-form__field hr-holiday__form-note">
              <span>Note (optional)</span>
              <input
                className="input-field"
                value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                placeholder="Office closed / skeleton staff"
              />
            </label>
          </div>
          <div className="hr-staff-form__actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
              Save
            </button>
          </div>
        </form>
      )}

      <div className="hr-holiday__calendar panel glass">
        <div className="hr-holiday__weekdays">
          {WEEKDAYS.map(day => (
            <span key={day} className="hr-holiday__weekday">{day}</span>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="hr-holiday__week">
            {week.map((cell, ci) => {
              if (!cell) {
                return <div key={ci} className="hr-holiday__day hr-holiday__day--empty" />;
              }
              const dayHolidays = holidayByDate.get(cell.date) ?? [];
              const isHoliday = holidayDates.has(cell.date);
              const isToday = cell.date === now.toISOString().slice(0, 10);
              return (
                <button
                  key={cell.date}
                  type="button"
                  className={[
                    'hr-holiday__day',
                    isHoliday ? 'is-holiday' : '',
                    isToday ? 'is-today' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => canEdit && openAddForm(cell.date)}
                  title={dayHolidays.map(h => h.name).join(', ')}
                >
                  <span className="hr-holiday__day-num">{cell.day}</span>
                  {dayHolidays.slice(0, 2).map(h => (
                    <span key={h.id} className={`hr-holiday__chip hr-holiday__chip--${h.type}`}>
                      {h.name}
                    </span>
                  ))}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="hr-holiday__list panel glass">
        <h3 className="text-sm" style={{ margin: '0 0 0.65rem' }}>
          Holidays in {monthLabel}
        </h3>
        {loading && monthHolidays.length === 0 ? (
          <p className="text-muted text-sm">Loading…</p>
        ) : monthHolidays.length === 0 ? (
          <p className="text-muted text-sm">No holidays this month.</p>
        ) : (
          <ul className="hr-holiday__list-items">
            {monthHolidays.map(holiday => (
              <li key={holiday.id} className="hr-holiday__list-item">
                <div>
                  <strong>{holiday.name}</strong>
                  <span className="text-muted text-sm">
                    {new Date(`${holiday.date}T12:00:00`).toLocaleDateString('en-IN', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
                    {' · '}
                    {HR_HOLIDAY_TYPE_LABELS[holiday.type]}
                  </span>
                  {holiday.note && <p className="text-sm text-muted">{holiday.note}</p>}
                </div>
                {canEdit && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void handleDelete(holiday)}
                    aria-label={`Delete ${holiday.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
