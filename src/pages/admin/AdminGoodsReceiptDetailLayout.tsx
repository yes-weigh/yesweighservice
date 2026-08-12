import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, PackageCheck } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import {
  fetchAdminGoodsReceiptDetail,
  type AdminGoodsReceiptDetail,
} from '../../lib/admin-goods-receipts';
import { formatInvoiceDate, invoiceErrorMessage } from '../../lib/invoices';
import type { AdminGoodsReceiptDetailOutletContext } from './adminGoodsReceiptDetailContext';

export const AdminGoodsReceiptDetailLayout: React.FC = () => {
  const { goodsReceiptId = '' } = useParams<{ goodsReceiptId: string }>();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const basePath = pathname.startsWith('/staff') ? '/staff' : '/super-admin';
  const listPath = `${basePath}/goods-receipts`;

  const [goodsReceipt, setGoodsReceipt] = useState<AdminGoodsReceiptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const handleBack = useCallback(() => {
    navigate(listPath);
  }, [navigate, listPath]);

  useCatalogPageHeader({
    title: goodsReceipt?.billNumber ?? 'Goods receipt',
    subtitle: goodsReceipt?.date ? formatInvoiceDate(goodsReceipt.date) : null,
    showBack: true,
    onBack: handleBack,
  });

  useEffect(() => {
    if (!goodsReceiptId) return;
    let cancelled = false;

    setLoading(true);
    setError('');

    fetchAdminGoodsReceiptDetail(goodsReceiptId)
      .then(data => {
        if (!cancelled) {
          setGoodsReceipt(data);
          setError('');
        }
      })
      .catch(err => {
        if (!cancelled) {
          setGoodsReceipt(null);
          setError(invoiceErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [goodsReceiptId]);

  if (!goodsReceiptId) return null;

  const outletContext: AdminGoodsReceiptDetailOutletContext = {
    goodsReceipt,
    setGoodsReceipt,
    loading,
    error,
    goodsReceiptId,
    listPath,
  };

  return (
    <div className="page-content fade-in invoice-detail-page">
      {error && (
        <div className="products-inline-error panel glass invoice-detail-page__error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {loading && !goodsReceipt ? (
        <FetchingLoader label="Loading goods receipt…" />
      ) : !goodsReceipt ? (
        <div className="invoices-empty panel glass">
          <PackageCheck size={36} aria-hidden />
          <h2>Goods receipt not found</h2>
          <p className="text-muted text-sm">This goods receipt may have been removed or is unavailable.</p>
        </div>
      ) : (
        <Outlet context={outletContext} />
      )}
    </div>
  );
};
