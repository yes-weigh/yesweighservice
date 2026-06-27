import React from 'react';

export type SupportDetailTab = 'chat' | 'flow' | 'logistics';

interface SupportRequestDetailTabsProps {
  active: SupportDetailTab;
  onChange: (tab: SupportDetailTab) => void;
  showLogistics?: boolean;
}

export const SupportRequestDetailTabs: React.FC<SupportRequestDetailTabsProps> = ({
  active,
  onChange,
  showLogistics = true,
}) => (
  <div className="support-detail-tabs" role="tablist" aria-label="Support request views">
    <div className={`support-detail-tabs__track${showLogistics ? ' support-detail-tabs__track--three' : ''}`}>
      <button
        type="button"
        role="tab"
        id="support-detail-tab-chat"
        aria-selected={active === 'chat'}
        aria-controls="support-detail-panel-chat"
        className={`support-detail-tabs__btn${active === 'chat' ? ' is-active' : ''}`}
        onClick={() => onChange('chat')}
      >
        Chat
      </button>
      <button
        type="button"
        role="tab"
        id="support-detail-tab-flow"
        aria-selected={active === 'flow'}
        aria-controls="support-detail-panel-flow"
        className={`support-detail-tabs__btn${active === 'flow' ? ' is-active' : ''}`}
        onClick={() => onChange('flow')}
      >
        Ticket&nbsp;flow
      </button>
      {showLogistics && (
        <button
          type="button"
          role="tab"
          id="support-detail-tab-logistics"
          aria-selected={active === 'logistics'}
          aria-controls="support-detail-panel-logistics"
          className={`support-detail-tabs__btn${active === 'logistics' ? ' is-active' : ''}`}
          onClick={() => onChange('logistics')}
        >
          Logistics
        </button>
      )}
    </div>
  </div>
);
