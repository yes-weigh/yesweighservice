import {
  ClipboardList,
  Clock3,
  CreditCard,
  Package,
  PackageOpen,
  Ruler,
  Truck,
  UserRound,
  Weight,
  type LucideIcon,
} from 'lucide-react';

export type ShippingMetricIcon =
  | 'boxes'
  | 'boxNumber'
  | 'dimensions'
  | 'contents'
  | 'weight'
  | 'transport'
  | 'payment';

export type ShippingInfoIcon = 'time' | 'bookedBy';

const METRIC_ICONS: Record<ShippingMetricIcon, LucideIcon> = {
  boxes: Package,
  boxNumber: PackageOpen,
  dimensions: Ruler,
  contents: ClipboardList,
  weight: Weight,
  transport: Truck,
  payment: CreditCard,
};

const INFO_ICONS: Record<ShippingInfoIcon, LucideIcon> = {
  time: Clock3,
  bookedBy: UserRound,
};

export function ShippingMetricGlyph({
  name,
  className = 'sheet__glyph',
}: {
  name: ShippingMetricIcon;
  className?: string;
}) {
  const Icon = METRIC_ICONS[name];
  return <Icon className={className} strokeWidth={2.25} aria-hidden />;
}

export function ShippingInfoGlyph({
  name,
  className = 'sheet__glyph',
}: {
  name: ShippingInfoIcon;
  className?: string;
}) {
  const Icon = INFO_ICONS[name];
  return <Icon className={className} strokeWidth={2.25} aria-hidden />;
}
