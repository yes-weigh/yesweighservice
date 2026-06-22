import React, { useEffect, useState } from 'react';
import { assignSupportRequest, fetchSupportAssignees } from '../../lib/dealerSupport';
import type { DealerSupportRequest, SupportAssignee } from '../../types/dealer-support';
import type { User } from '../../types';

interface SupportAssigneeSelectProps {
  user: User;
  request: DealerSupportRequest;
  onAssigned?: () => void;
}

export const SupportAssigneeSelect: React.FC<SupportAssigneeSelectProps> = ({
  user,
  request,
  onAssigned,
}) => {
  const [assignees, setAssignees] = useState<SupportAssignee[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void fetchSupportAssignees().then(setAssignees).catch(() => setAssignees([]));
  }, []);

  const handleChange = async (value: string) => {
    setSaving(true);
    setError('');
    try {
      const assignee = value
        ? assignees.find(item => item.uid === value) ?? null
        : null;
      await assignSupportRequest(user, request.id, assignee);
      onAssigned?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not assign ticket.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="support-assignee">
      <label htmlFor="support-assignee" className="text-muted text-sm">Assigned to</label>
      <select
        id="support-assignee"
        className="catalog-select support-assignee__select"
        value={request.assignedToUid ?? ''}
        disabled={saving}
        onChange={e => void handleChange(e.target.value)}
      >
        <option value="">Unassigned</option>
        {assignees.map(assignee => (
          <option key={assignee.uid} value={assignee.uid}>
            {assignee.displayName}
          </option>
        ))}
      </select>
      {error && <p className="support-assignee__error text-sm">{error}</p>}
    </div>
  );
};
