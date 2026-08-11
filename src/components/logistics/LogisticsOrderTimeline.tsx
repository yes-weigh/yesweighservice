import React, { useEffect, useState } from 'react';
import { Clock, ExternalLink, History } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  loadLogisticsOrderTimeline,
  type LogisticsOrderTimelineEvent,
} from '../../lib/logisticsOrderTimeline';
import type { LogisticsBooking } from '../../types/logistics-dispatch';
import type { Role } from '../../types';

type Props = {
  booking: LogisticsBooking;
  isOps: boolean;
  role: Role;
};

export const LogisticsOrderTimeline: React.FC<Props> = ({
  booking,
  isOps,
  role,
}) => {
  const [events, setEvents] = useState<LogisticsOrderTimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void loadLogisticsOrderTimeline(booking, { isOps, role })
      .then(rows => {
        if (!cancelled) setEvents(rows);
      })
      .catch(err => {
        if (!cancelled) {
          setEvents([]);
          setError(err instanceof Error ? err.message : 'Could not load order history.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [
    booking.id,
    booking.invoiceId,
    booking.updatedAt,
    booking.status,
    booking.createdAt,
    booking.dealer.zohoCustomerId,
    isOps,
    role,
  ]);

  if (!loading && events.length === 0 && !error && !booking.invoiceId) {
    return null;
  }

  return (
    <section className="logistics-booking__order-history" aria-label="Order history">
      <div className="logistics-booking__card logistics-booking__card--wide">
        <h4>
          <History size={16} aria-hidden />
          Order history
        </h4>
        {loading && events.length === 0 ? (
          <p className="text-muted text-sm">Loading order history…</p>
        ) : null}
        {error ? (
          <p className="logistics-booking__order-history-error text-sm">{error}</p>
        ) : null}
        {!loading && events.length === 0 && !error ? (
          <p className="text-muted text-sm">No workflow history found for this shipment yet.</p>
        ) : null}
        {events.length > 0 ? (
          <ol className="logistics-booking__order-history-list">
            {events.map((event, index) => (
              <li
                key={event.id}
                className={index === events.length - 1 ? 'is-latest' : undefined}
              >
                <span className="logistics-booking__order-history-dot" aria-hidden />
                <div className="logistics-booking__order-history-copy">
                  <div className="logistics-booking__order-history-head">
                    <strong>{event.title}</strong>
                    <time className="logistics-booking__order-history-at">
                      <Clock size={12} aria-hidden />
                      {event.atLabel}
                    </time>
                  </div>
                  {event.details.length > 0 ? (
                    <div className="logistics-booking__order-history-details">
                      {event.details.map(detail => (
                        <p key={detail}>{detail}</p>
                      ))}
                    </div>
                  ) : null}
                  {event.links && event.links.length > 0 ? (
                    <div className="logistics-booking__order-history-links">
                      {event.links.map(link => (
                        link.external ? (
                          <a
                            key={link.href}
                            href={link.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="logistics-booking__order-history-link"
                          >
                            {link.label}
                            <ExternalLink size={12} aria-hidden />
                          </a>
                        ) : (
                          <Link
                            key={link.href}
                            to={link.href}
                            className="logistics-booking__order-history-link"
                          >
                            {link.label}
                            <ExternalLink size={12} aria-hidden />
                          </Link>
                        )
                      ))}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </section>
  );
};
