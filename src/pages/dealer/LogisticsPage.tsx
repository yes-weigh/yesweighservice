import React, { useCallback, useMemo, useState } from 'react';
import { Plus, Truck } from 'lucide-react';
import { useTopBarAction } from '../../context/PageHeaderContext';
import { DeliveryMethodPickerDialog } from '../../components/logistics/DeliveryMethodPickerDialog';
import {
  DELIVERY_METHODS,
  deliveryMethodLabel,
  type DeliveryMethod,
  type DeliveryMethodId,
} from '../../constants/deliveryMethods';

type LogisticsEntry = {
  id: string;
  methodId: DeliveryMethodId;
  createdAt: string;
};

export const LogisticsPage: React.FC = () => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [entries, setEntries] = useState<LogisticsEntry[]>([]);

  const openPicker = useCallback(() => {
    setPickerOpen(true);
  }, []);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
  }, []);

  const handleSelectMethod = useCallback((method: DeliveryMethod) => {
    setEntries(prev => [
      {
        id: `${method.id}-${Date.now()}`,
        methodId: method.id,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    setPickerOpen(false);
  }, []);

  const topBarAction = useMemo(
    () => (
      <button
        type="button"
        className="cart-header-btn cart-header-btn--primary"
        onClick={openPicker}
        aria-label="Add delivery method"
        title="Add delivery method"
      >
        <Plus size={22} />
      </button>
    ),
    [openPicker],
  );

  useTopBarAction(topBarAction, !pickerOpen);

  return (
    <div className="page-content fade-in logistics-page">
      {entries.length === 0 ? (
        <div className="logistics-page__empty panel glass">
          <Truck size={40} aria-hidden />
          <h3>Logistics</h3>
          <p className="text-muted text-sm">
            Track shipments, deliveries, and dispatch status for your orders.
          </p>
          <button type="button" className="btn btn-primary btn-sm" onClick={openPicker}>
            Choose delivery method
          </button>
        </div>
      ) : (
        <section className="logistics-page__list panel glass" aria-label="Delivery methods">
          <h3 className="logistics-page__list-title">Selected delivery methods</h3>
          <ul className="logistics-page__entries">
            {entries.map(entry => {
              const method = DELIVERY_METHODS.find(item => item.id === entry.methodId);
              return (
                <li key={entry.id} className="logistics-page__entry">
                  {method && (
                    <span className="logistics-page__entry-logo-wrap">
                      <img src={method.image} alt="" className="logistics-page__entry-logo" />
                    </span>
                  )}
                  <div className="logistics-page__entry-copy">
                    <strong>{deliveryMethodLabel(entry.methodId)}</strong>
                    <span className="text-muted text-sm">
                      Added {new Date(entry.createdAt).toLocaleString()}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {pickerOpen && (
        <DeliveryMethodPickerDialog onClose={closePicker} onSelect={handleSelectMethod} />
      )}
    </div>
  );
};
