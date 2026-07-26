import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { HrSalaryShareView } from '../../components/hr/HrSalaryShareView';
import { fetchSalaryShare } from '../../lib/hrSalaryShares';
import type { HrSalaryShareRecord } from '../../types/hr-salary-share';
import { APP_NAME } from '../../constants/brand';

export const HrSalaryPublicSharePage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const [share, setShare] = useState<HrSalaryShareRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setShare(null);
    void (async () => {
      try {
        const rec = await fetchSalaryShare(token);
        if (cancelled) return;
        if (!rec) {
          setError('This salary link is invalid or has been removed.');
          return;
        }
        setShare(rec);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Unable to load this salary page.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!share) return;
    document.title = `${share.displayName} · ${share.period} · ${APP_NAME}`;
  }, [share]);

  if (loading) {
    return (
      <div className="hr-salary-public">
        <div className="hr-salary-public__state">
          <div className="loader-ring" />
          <p>Loading salary page…</p>
        </div>
      </div>
    );
  }

  if (error || !share) {
    return (
      <div className="hr-salary-public">
        <div className="hr-salary-public__state">
          <h1>Link unavailable</h1>
          <p>{error || 'This salary link is invalid or has been removed.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="hr-salary-public">
      <div className="hr-salary-public__shell">
        <HrSalaryShareView
          displayName={share.displayName}
          period={{ year: share.year, month: share.month }}
          perDaySalary={share.perDaySalary}
          otPerDaySalary={share.otPerDaySalary}
          leaveEntries={share.leaveEntries}
          projects={share.projects}
          workDayEntries={share.workDayEntries}
          overtimeEntries={share.overtimeEntries}
          holidays={share.holidays}
        />
      </div>
    </div>
  );
};
