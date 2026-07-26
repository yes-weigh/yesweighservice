import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { canCreateLogisticsBooking } from '../../lib/logisticsBookings';
import { navigateToLogisticsBooking, type LogisticsEntryState } from '../../lib/logisticsPrefill';

interface BookCourierEntryButtonProps {
  entry: LogisticsEntryState;
  className?: string;
  size?: 'sm' | 'md';
  label?: string;
  /** Match invoice detail section cards (icon + label stacked). */
  variant?: 'button' | 'card';
}

export const BookCourierEntryButton: React.FC<BookCourierEntryButtonProps> = ({
  entry,
  className = '',
  size = 'md',
  label = 'Book Courier',
  variant = 'button',
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();

  if (!user || !canCreateLogisticsBooking(user)) return null;

  if (variant === 'card') {
    return (
      <button
        type="button"
        className={[
          'invoice-detail-top__card',
          'invoice-detail-top__card--orange',
          'book-courier-entry-btn',
          'book-courier-entry-btn--card',
          className,
        ].filter(Boolean).join(' ')}
        onClick={() => navigateToLogisticsBooking(navigate, user.role, entry)}
      >
        <span className="invoice-detail-top__card-icon">
          <Truck size={28} strokeWidth={1.75} aria-hidden />
        </span>
        <span className="invoice-detail-top__card-label">{label}</span>
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
      onClick={() => navigateToLogisticsBooking(navigate, user.role, entry)}
    >
      <Truck size={size === 'sm' ? 15 : 18} aria-hidden />
      {label}
    </button>
  );
};
