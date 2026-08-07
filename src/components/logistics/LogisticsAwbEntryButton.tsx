import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Barcode } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { isInternalOpsUser } from '../../lib/staffAccess';
import { navigateToLogisticsBookingDetail } from '../../lib/logisticsPrefill';

interface LogisticsAwbEntryButtonProps {
  bookingId: string;
  /** Optional AWB / consignment shown under the label on card variant. */
  awbLabel?: string | null;
  className?: string;
  size?: 'sm' | 'md';
  variant?: 'button' | 'card';
}

export const LogisticsAwbEntryButton: React.FC<LogisticsAwbEntryButtonProps> = ({
  bookingId,
  awbLabel = null,
  className = '',
  size = 'md',
  variant = 'button',
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const id = bookingId.trim();

  if (!user || !id || !isInternalOpsUser(user)) return null;

  const open = () => navigateToLogisticsBookingDetail(navigate, user.role, id);
  const subtitle = awbLabel?.trim() || null;

  if (variant === 'card') {
    return (
      <button
        type="button"
        className={[
          'invoice-detail-top__card',
          'invoice-detail-top__card--orange',
          'book-courier-entry-btn',
          'book-courier-entry-btn--card',
          'logistics-awb-entry-btn',
          className,
        ].filter(Boolean).join(' ')}
        onClick={open}
        title={subtitle ? `Open AWB ${subtitle}` : 'Open logistics booking'}
      >
        <span className="invoice-detail-top__card-icon">
          <Barcode size={28} strokeWidth={1.75} aria-hidden />
        </span>
        <span className="invoice-detail-top__card-label">AWB</span>
        {subtitle ? (
          <span className="invoice-detail-top__card-sub">{subtitle}</span>
        ) : null}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={[
        'btn btn-primary',
        size === 'sm' ? 'btn-sm' : '',
        'book-courier-entry-btn',
        className,
      ].filter(Boolean).join(' ')}
      onClick={open}
    >
      <Barcode size={size === 'sm' ? 15 : 18} aria-hidden />
      AWB{subtitle ? ` ${subtitle}` : ''}
    </button>
  );
};
