import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { APP_NAME } from '../../constants/brand';
import { daysInMonth } from '../../lib/hrSalary';
import { subscribeWorklogShare } from '../../lib/hrSalaryShares';
import { salaryPeriodLabel } from '../../types/hr-salary';
import type { HrWorklogEntry } from '../../types/hr-salary';
import type { HrWorklogShareRecord } from '../../types/hr-salary-share';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDayHeading(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
}

function groupWorklogsByDate(
  entries: HrWorklogEntry[],
): Array<{ date: string; notes: HrWorklogEntry[] }> {
  const byDate = new Map<string, HrWorklogEntry[]>();
  for (const entry of entries) {
    if (!entry.text.trim()) continue;
    const list = byDate.get(entry.date) ?? [];
    list.push(entry);
    byDate.set(entry.date, list);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, notes]) => ({ date, notes }));
}

export const HrWorklogPublicSharePage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const [share, setShare] = useState<HrWorklogShareRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [focusDate, setFocusDate] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    setShare(null);
    setFocusDate(null);
    const unsub = subscribeWorklogShare(
      token,
      next => {
        setLoading(false);
        if (!next) {
          setShare(null);
          setError('This worklog link is invalid or has been removed.');
          return;
        }
        setError('');
        setShare(next);
      },
      err => {
        setLoading(false);
        setError(err.message || 'Unable to load this worklog page.');
      },
    );
    return () => unsub();
  }, [token]);

  useEffect(() => {
    if (!share) return;
    document.title = `${share.displayName} · worklog · ${salaryPeriodLabel({
      year: share.year,
      month: share.month,
    })} · ${APP_NAME}`;
  }, [share]);

  const groups = useMemo(
    () => groupWorklogsByDate(share?.worklogEntries ?? []),
    [share],
  );
  const noteDates = useMemo(
    () => new Set(groups.map(g => g.date)),
    [groups],
  );
  const totalNotes = useMemo(
    () => groups.reduce((sum, g) => sum + g.notes.length, 0),
    [groups],
  );

  const calendar = useMemo(() => {
    if (!share) return null;
    const { year, month } = share;
    const total = daysInMonth(year, month);
    const leadingPads = new Date(year, month - 1, 1).getDay();
    const dates = Array.from({ length: total }, (_, i) => (
      `${year}-${pad2(month)}-${pad2(i + 1)}`
    ));
    return { leadingPads, dates };
  }, [share]);

  const jumpToDate = (date: string) => {
    if (!noteDates.has(date)) return;
    setFocusDate(date);
    const el = document.getElementById(`worklog-day-${date}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (loading) {
    return (
      <div className="hr-worklog-public">
        <div className="hr-salary-public__state">
          <div className="loader-ring" />
          <p>Loading worklog…</p>
        </div>
      </div>
    );
  }

  if (error || !share) {
    return (
      <div className="hr-worklog-public">
        <div className="hr-salary-public__state">
          <h1>Link unavailable</h1>
          <p>{error || 'This worklog link is invalid or has been removed.'}</p>
        </div>
      </div>
    );
  }

  const period = { year: share.year, month: share.month };

  return (
    <div className="hr-worklog-public">
      <div className="hr-worklog-public__shell">
        <header className="hr-worklog-public__header">
          <div>
            <p className="hr-worklog-public__kicker">Work log</p>
            <h1>{share.displayName}</h1>
            <p className="hr-worklog-public__period">{salaryPeriodLabel(period)}</p>
          </div>
          <div className="hr-worklog-public__stats" aria-label="Worklog summary">
            <div>
              <strong>{totalNotes}</strong>
              <span>{totalNotes === 1 ? 'note' : 'notes'}</span>
            </div>
            <div>
              <strong>{groups.length}</strong>
              <span>{groups.length === 1 ? 'day' : 'days'}</span>
            </div>
          </div>
        </header>

        {calendar ? (
          <section className="hr-worklog-public__cal" aria-label="Days with worklogs">
            <div className="hr-worklog-public__cal-weekdays" aria-hidden>
              {WEEKDAYS.map(label => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="hr-worklog-public__cal-days">
              {Array.from({ length: calendar.leadingPads }, (_, i) => (
                <span key={`pad-${i}`} className="hr-worklog-public__cal-pad" />
              ))}
              {calendar.dates.map(date => {
                const day = Number(date.slice(-2));
                const hasNotes = noteDates.has(date);
                const selected = focusDate === date;
                return (
                  <button
                    key={date}
                    type="button"
                    disabled={!hasNotes}
                    aria-label={
                      hasNotes
                        ? `${formatDayHeading(date)}, has worklog`
                        : `${formatDayHeading(date)}`
                    }
                    className={[
                      'hr-worklog-public__cal-day',
                      hasNotes ? 'has-notes' : '',
                      selected ? 'is-selected' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => jumpToDate(date)}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {groups.length === 0 ? (
          <div className="hr-worklog-public__empty">
            <h2>No worklogs yet</h2>
            <p>Nothing was recorded for {salaryPeriodLabel(period)}.</p>
          </div>
        ) : (
          <ol className="hr-worklog-public__timeline">
            {groups.map(group => (
              <li
                key={group.date}
                id={`worklog-day-${group.date}`}
                className={
                  focusDate === group.date
                    ? 'hr-worklog-public__day is-focused'
                    : 'hr-worklog-public__day'
                }
              >
                <header className="hr-worklog-public__day-head">
                  <h2>{formatDayHeading(group.date)}</h2>
                  <span>
                    {group.notes.length === 1 ? '1 note' : `${group.notes.length} notes`}
                  </span>
                </header>
                <ul>
                  {group.notes.map(note => (
                    <li key={note.id}>
                      <p>{note.text}</p>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
};
