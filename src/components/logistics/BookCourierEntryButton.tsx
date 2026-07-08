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
}

export const BookCourierEntryButton: React.FC<BookCourierEntryButtonProps> = ({
  entry,
  className = '',
  size = 'md',
  label = 'Book Courier',
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();

  if (!user || !canCreateLogisticsBooking(user)) return null;

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
