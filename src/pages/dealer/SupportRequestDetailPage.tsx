import React, { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SupportRequestDetailContent } from '../../components/support/SupportRequestDetailContent';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { useAuth } from '../../context/AuthContext';
import { supportBasePath } from '../../lib/dealerSupport';
import { navigateBack } from '../../lib/navigation';
import { isInternalOpsUser } from '../../lib/staffAccess';
import { supportDisplayLabel } from '../../lib/supportStatus';
import { supportRequestStageSubtitle } from '../../lib/supportRequestDisplay';
import type { DealerSupportRequest } from '../../types/dealer-support';

export const SupportRequestDetailPage: React.FC = () => {
  const { requestId } = useParams<{ requestId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const base = user ? supportBasePath(user.role) : '/dealer/warranty-support';

  const [request, setRequest] = useState<DealerSupportRequest | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const handleBack = useCallback(() => navigateBack(navigate, base), [navigate, base]);
  const toggleDetails = useCallback(() => setDetailsOpen(open => !open), []);

  useCatalogPageHeader({
    title: request?.requestNumber ?? 'Support request',
    subtitle: request
      ? (supportRequestStageSubtitle(request)
        || supportDisplayLabel(request, isInternalOpsUser(user) ? 'staff' : 'dealer'))
      : null,
    showBack: true,
    onBack: handleBack,
    onTitleClick: request ? toggleDetails : null,
    titleExpanded: detailsOpen,
  });

  if (!requestId || !user) return null;

  return (
    <SupportRequestDetailContent
      requestId={requestId}
      user={user}
      detailsOpen={detailsOpen}
      onDetailsOpenChange={setDetailsOpen}
      onRequestLoaded={setRequest}
    />
  );
};
