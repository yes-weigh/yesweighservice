import React from 'react';
import { DELIVERY_METHODS, type DeliveryMethod } from '../../constants/deliveryMethods';
import type { DeliveryMethodId } from '../../constants/deliveryMethods';
import { CourierPartnerPicker } from './CourierPartnerPicker';

interface DeliveryMethodPickerDialogProps {
  onClose: () => void;
  onSelect: (method: DeliveryMethod) => void;
}

export const DeliveryMethodPickerDialog: React.FC<DeliveryMethodPickerDialogProps> = ({
  onClose,
  onSelect,
}) => (
  <CourierPartnerPicker
    onClose={onClose}
    onSelect={methodId => {
      const method = DELIVERY_METHODS.find(item => item.id === methodId as DeliveryMethodId);
      if (method) onSelect(method);
    }}
  />
);
