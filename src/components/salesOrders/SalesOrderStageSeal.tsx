import React from 'react';
import underReviewSealUrl from '../../assets/seals/under-review.png';
import awaitingPaymentSealUrl from '../../assets/seals/awaiting-payment.png';
import invoicedSealUrl from '../../assets/seals/invoiced.png';
import type { SalesOrderSealKind } from '../../lib/salesOrderSeals';

export type { SalesOrderSealKind };

const SEAL_SRC: Record<SalesOrderSealKind, string> = {
  under_review: underReviewSealUrl,
  awaiting_payment: awaitingPaymentSealUrl,
  invoiced: invoicedSealUrl,
};

type SalesOrderStageSealProps = {
  kind: SalesOrderSealKind;
  className?: string;
  size?: 'tile' | 'inline';
};

/** Semi-transparent stage stamp over SO list rows. */
export const SalesOrderStageSeal: React.FC<SalesOrderStageSealProps> = ({
  kind,
  className,
  size = 'tile',
}) => (
  <span
    className={[
      'so-order-seal',
      `so-order-seal--${kind}`,
      size === 'inline' ? 'so-order-seal--inline' : '',
      className,
    ].filter(Boolean).join(' ')}
    aria-hidden
  >
    <img
      className="so-order-seal__img"
      src={SEAL_SRC[kind]}
      alt=""
      draggable={false}
    />
  </span>
);

/** @deprecated Use SalesOrderStageSeal with kind="under_review". */
export const OrderPlacedSeal: React.FC<Omit<SalesOrderStageSealProps, 'kind'>> = props => (
  <SalesOrderStageSeal kind="under_review" {...props} />
);
