import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ExternalLink, Printer, Unlink } from 'lucide-react';
import { InventoryAuditProductPreview } from '../../components/yesStore/InventoryAuditProductPreview';
import { AuditTileStockLocation } from '../../components/yesStore/AuditTileStockLocation';
import {
  BinLabelPrintDialog,
  binLabelFieldsFromStoreItem,
} from '../../components/catalog/BinLabelPrintDialog';
import { FetchingLoader } from '../../components/FetchingLoader';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { getOpenAuditCycle } from '../../lib/auditCycles/data';
import { fetchCatalog } from '../../lib/catalog';
import { recordCatalogProductAudit } from '../../lib/catalogProductAudit/data';
import type { BinLabelFields } from '../../lib/localPrinterLabel';
import { calculateGroupTotals } from '../../lib/yesStore/inventoryAudit';
import { listItemsByCatalogProduct, batchUnlinkYesStoreItemsFromCatalog } from '../../lib/yesStore/data';
import { reconcileCatalogAuditImagesOnZoho } from '../../lib/yesStore/syncAuditImages';
import type { CatalogProduct } from '../../types/catalog';
import { formatItemLocationShort, readItemQuantity, type YesStoreItemDoc } from '../../types/yes-store';

export const InventoryAuditLinkedGroupPage: React.FC = () => {
  const { catalogProductId } = useParams<{ catalogProductId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const confirm = useConfirm();
  const base = user?.role === 'super_admin' ? '/super-admin/catalog' : '/catalog';

  const [items, setItems] = useState<YesStoreItemDoc[]>([]);
  const [catalogProduct, setCatalogProduct] = useState<CatalogProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unlinkingAll, setUnlinkingAll] = useState(false);
  const [printFields, setPrintFields] = useState<BinLabelFields | null>(null);

  const load = useCallback(async () => {
    if (!catalogProductId) return;
    setLoading(true);
    setError('');
    try {
      const [groupItems, catalog] = await Promise.all([
        listItemsByCatalogProduct(catalogProductId),
        fetchCatalog(),
      ]);
      if (!groupItems.length) {
        setError('No warehouse bins linked to this catalog item.');
        setItems([]);
        setCatalogProduct(null);
        return;
      }
      setItems(groupItems);
      setCatalogProduct(catalog.items.find(p => p.id === catalogProductId) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load linked audit group.');
    } finally {
      setLoading(false);
    }
  }, [catalogProductId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(
    () => calculateGroupTotals(items, catalogProduct),
    [items, catalogProduct],
  );

  const productName =
    items[0]?.catalogProductName?.trim() ||
    catalogProduct?.name ||
    'Linked item';

  const handleBack = useCallback(() => {
    navigate(`${base}?section=inventory-audit`, { replace: false });
  }, [navigate, base]);

  const handleUnlinkAll = useCallback(async () => {
    const locationCount = items.length;
    const ok = await confirm({
      title: 'Unlink all stock locations?',
      message:
        locationCount > 1
          ? `Remove the Zoho link from all ${locationCount} stock locations for “${productName}”? The warehouse counts stay in Yes Store.`
          : `Remove the Zoho link from “${productName}”? The warehouse count stays in Yes Store.`,
      confirmLabel: 'Unlink all',
      destructive: true,
    });
    if (!ok) return;

    setUnlinkingAll(true);
    setError('');
    const productId = catalogProductId?.trim() || '';
    try {
      await batchUnlinkYesStoreItemsFromCatalog(items.map(item => item.id));
      if (productId) {
        try {
          const openCycle = await getOpenAuditCycle('head_office');
          if (openCycle) {
            await recordCatalogProductAudit(productId, 'warehouse_count', openCycle.id);
          }
        } catch {
          // Unlink succeeded; audit refresh is best-effort.
        }
        try {
          await reconcileCatalogAuditImagesOnZoho(productId);
        } catch (syncErr) {
          setError(
            syncErr instanceof Error
              ? `Unlinked, but Zoho photo cleanup failed: ${syncErr.message}`
              : 'Unlinked, but Zoho photo cleanup failed.',
          );
          return;
        }
      }
      navigate(`${base}?section=inventory-audit`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unlink stock locations.');
    } finally {
      setUnlinkingAll(false);
    }
  }, [base, catalogProductId, confirm, items, navigate, productName]);

  useCatalogPageHeader({
    title: productName,
    showBack: true,
    onBack: handleBack,
  });

  if (user?.role !== 'super_admin') {
    return <Navigate to={base} replace />;
  }

  if (!catalogProductId) {
    return <Navigate to={`${base}?section=inventory-audit`} replace />;
  }

  if (loading && items.length === 0) {
    return (
      <div className="page-content fade-in catalog-inventory-audit-detail">
        <FetchingLoader label="Loading linked item…" />
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="page-content fade-in catalog-inventory-audit-detail">
        <div className="products-inline-error panel glass">
          <AlertCircle size={18} />
          <span>{error || 'Linked group not found.'}</span>
        </div>
        <Link to={`${base}?section=inventory-audit`} className="btn btn-secondary btn-sm">
          Back to inventory audit
        </Link>
      </div>
    );
  }

  return (
    <div className="page-content fade-in catalog-inventory-audit-detail">
      {error && (
        <div className="products-inline-error panel glass">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {catalogProduct && (
        <section className="catalog-inventory-audit-detail__preview">
          <InventoryAuditProductPreview
            product={catalogProduct}
            items={items}
            totals={totals}
          />
        </section>
      )}

      {totals.mode === 'bundle' && (
        <p className="catalog-inventory-audit-detail__bundle-note text-muted panel glass">
          Kit mode: complete units are the minimum whole sets that can be built from all parts.
          {totals.rawCountedQty > 0 && ` (${totals.rawCountedQty} part pieces counted in total.)`}
        </p>
      )}

      <section className="catalog-inventory-audit-group-locations panel glass">
        <div className="catalog-inventory-audit-group-locations__head">
          <h2 className="catalog-inventory-audit-group-locations__title">
            Stock location ({items.length})
          </h2>
          <button
            type="button"
            className="btn btn-secondary btn-sm catalog-inventory-audit-group-locations__unlink-all"
            disabled={unlinkingAll}
            onClick={() => void handleUnlinkAll()}
          >
            <Unlink size={14} aria-hidden />
            {unlinkingAll ? 'Unlinking…' : 'Unlink all'}
          </button>
        </div>

        <div className="wh-item-table-wrap catalog-inventory-audit-locations-table-wrap">
          <table className="wh-item-table catalog-inventory-audit-locations-table">
            <thead>
              <tr>
                <th className="catalog-inventory-audit-locations-table__th-location">Location</th>
                {totals.mode === 'bundle' && (
                  <th className="catalog-inventory-audit-locations-table__th-part">Part</th>
                )}
                <th className="catalog-inventory-audit-locations-table__th-qty">Counted qty</th>
                <th className="catalog-inventory-audit-locations-table__th-actions" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {totals.parts.map((part, locationIndex) => {
                const binItem = items.find(item => item.id === part.itemId);
                if (!binItem) return null;

                const locationShort = formatItemLocationShort(
                  binItem.rackId,
                  binItem.rowNumber,
                  binItem.binNumber,
                );
                const showPartLabel =
                  totals.mode === 'bundle' && part.partLabel.trim() !== locationShort;
                const quantity = readItemQuantity(binItem);

                return (
                  <tr key={part.itemId} className="catalog-inventory-audit-locations-table__row">
                    <td className="catalog-inventory-audit-locations-table__location">
                      <AuditTileStockLocation
                        variant="cells"
                        rackId={binItem.rackId}
                        rowNumber={binItem.rowNumber}
                        binNumber={binItem.binNumber}
                        index={locationIndex}
                        total={items.length}
                      />
                    </td>
                    {totals.mode === 'bundle' && (
                      <td className="catalog-inventory-audit-locations-table__part">
                        {showPartLabel ? (
                          <strong>{part.partLabel}</strong>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                        <div className="catalog-inventory-audit-locations-table__bundle-meta text-muted">
                          <span>Per unit: {part.unitsPerProduct}</span>
                          <span>Sets: {part.completeUnits}</span>
                          <span>Leftover: {part.remainderQty}</span>
                        </div>
                      </td>
                    )}
                    <td className="catalog-inventory-audit-locations-table__qty">
                      <span
                        className="catalog-inventory-audit-locations-table__qty-value"
                        aria-label={`Counted quantity ${quantity}`}
                      >
                        {quantity}
                      </span>
                    </td>
                    <td className="catalog-inventory-audit-locations-table__actions">
                      <div className="catalog-inventory-audit-locations-table__action-btns">
                        <button
                          type="button"
                          className="product-site-stock__print-btn"
                          onClick={() =>
                            setPrintFields(
                              binLabelFieldsFromStoreItem(
                                catalogProduct ?? {
                                  id: catalogProductId,
                                  name: productName,
                                  sku: items[0]?.catalogProductSku ?? null,
                                },
                                binItem,
                              ),
                            )
                          }
                          aria-label="Print label"
                          title="Print label"
                        >
                          <Printer size={16} aria-hidden />
                        </button>
                        <Link
                          to={`${base}/inventory-audit/${part.itemId}`}
                          className="btn-icon catalog-inventory-audit-locations-table__edit"
                          aria-label="Edit link"
                          title="Edit link"
                        >
                          <ExternalLink size={16} aria-hidden />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {printFields && (
        <BinLabelPrintDialog
          fields={printFields}
          layoutId="genuine-spare"
          onClose={() => setPrintFields(null)}
        />
      )}
    </div>
  );
};
