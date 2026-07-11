import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, Link2, Printer, Unlink } from 'lucide-react';
import { CatalogProductLinkPicker } from '../../components/yesStore/CatalogProductLinkPicker';
import { InventoryAuditQtyEditor } from '../../components/yesStore/InventoryAuditQtyEditor';
import { YesStorePhotoImg } from '../../components/yesStore/YesStorePhotoImg';
import {
  BinLabelPrintDialog,
  binLabelFieldsFromStoreItem,
} from '../../components/catalog/BinLabelPrintDialog';
import { FetchingLoader } from '../../components/FetchingLoader';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { fetchCatalog, formatStockQuantity } from '../../lib/catalog';
import type { BinLabelFields } from '../../lib/localPrinterLabel';
import { formatQtyDifference } from '../../lib/yesStore/inventoryAudit';
import { getItem, linkYesStoreItemToCatalog, listItemsByCatalogProduct, unlinkYesStoreItemFromCatalog } from '../../lib/yesStore/data';
import { syncCatalogAuditImagesToZoho, reconcileCatalogAuditImagesOnZoho } from '../../lib/yesStore/syncAuditImages';
import type { CatalogProduct } from '../../types/catalog';
import {
  formatItemLocationShort,
  isYesStoreItemLinked,
  readItemQuantity,
  type CatalogLinkMode,
  type YesStoreItemDoc,
} from '../../types/yes-store';

export const InventoryAuditItemPage: React.FC = () => {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const confirm = useConfirm();
  const base = user?.role === 'super_admin' ? '/super-admin/catalog' : '/catalog';

  const [item, setItem] = useState<YesStoreItemDoc | null>(null);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [siblingItems, setSiblingItems] = useState<YesStoreItemDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [error, setError] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);
  const [linkMode, setLinkMode] = useState<CatalogLinkMode>('unit');
  const [partLabel, setPartLabel] = useState('');
  const [unitsPerProduct, setUnitsPerProduct] = useState(1);
  const [printFields, setPrintFields] = useState<BinLabelFields | null>(null);

  const loadItem = useCallback(async () => {
    if (!itemId) return;
    setLoading(true);
    setError('');
    try {
      const data = await getItem(itemId);
      if (!data) {
        setError('Audit item not found.');
        setItem(null);
        setSiblingItems([]);
      } else {
        setItem(data);
        if (data.catalogLinkMode === 'part') {
          setLinkMode('part');
          setPartLabel(data.partLabel?.trim() ?? '');
          setUnitsPerProduct(Math.max(1, data.unitsPerProduct ?? 1));
        } else {
          setLinkMode('unit');
          setPartLabel('');
          setUnitsPerProduct(1);
        }
        if (data.catalogProductId) {
          const siblings = await listItemsByCatalogProduct(data.catalogProductId);
          setSiblingItems(siblings.filter(sibling => sibling.id !== data.id));
        } else {
          setSiblingItems([]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load audit item.');
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    void loadItem();
  }, [loadItem]);

  useEffect(() => {
    let cancelled = false;
    setCatalogLoading(true);
    void fetchCatalog()
      .then(response => {
        if (!cancelled) setCatalogProducts(response.items);
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load catalog.');
        }
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!item?.catalogProductId || !catalogProducts.length) return;
    const linked = catalogProducts.find(p => p.id === item.catalogProductId);
    if (linked) setSelectedProduct(linked);
  }, [item?.catalogProductId, catalogProducts]);

  useEffect(() => {
    if (!selectedProduct || siblingItems.length === 0) return;
    const siblingUsesPart = siblingItems.some(sibling => sibling.catalogLinkMode === 'part');
    if (siblingUsesPart) setLinkMode('part');
  }, [selectedProduct, siblingItems]);

  const linked = item ? isYesStoreItemLinked(item) : false;
  const linkChanged =
    !selectedProduct ||
    !item ||
    selectedProduct.id !== item.catalogProductId ||
    (linkMode === 'part'
      ? item.catalogLinkMode !== 'part' ||
        (item.partLabel?.trim() ?? '') !== partLabel.trim() ||
        Math.max(1, item.unitsPerProduct ?? 1) !== Math.max(1, unitsPerProduct)
      : item.catalogLinkMode === 'part');
  const canLink = selectedProduct && item && linkChanged;
  const partModeInvalid = linkMode === 'part' && !partLabel.trim();

  const handleLink = async () => {
    if (!item || !selectedProduct || !user || partModeInvalid) return;
    setLinking(true);
    setError('');
    try {
      await linkYesStoreItemToCatalog(item.id, selectedProduct, user.uid, {
        mode: linkMode,
        partLabel: linkMode === 'part' ? partLabel.trim() : null,
        unitsPerProduct: linkMode === 'part' ? unitsPerProduct : 1,
        linkedByName: user.displayName,
      });
      try {
        await syncCatalogAuditImagesToZoho(selectedProduct.id);
      } catch (syncErr) {
        setError(
          syncErr instanceof Error
            ? `Linked, but Zoho photo sync failed: ${syncErr.message}`
            : 'Linked, but Zoho photo sync failed.',
        );
        return;
      }
      navigate(`${base}/inventory-audit/linked/${selectedProduct.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not link item.');
    } finally {
      setLinking(false);
    }
  };

  const handleUnlink = async () => {
    if (!item) return;
    const ok = await confirm({
      title: 'Unlink warehouse item?',
      message: `Remove the Zoho link from this stock location? The counted quantity stays in Yes Store.`,
      confirmLabel: 'Unlink',
      destructive: true,
    });
    if (!ok) return;

    setUnlinking(true);
    setError('');
    const catalogProductId = item.catalogProductId?.trim() || '';
    try {
      await unlinkYesStoreItemFromCatalog(item.id);
      if (catalogProductId) {
        try {
          await reconcileCatalogAuditImagesOnZoho(catalogProductId);
        } catch (syncErr) {
          setError(
            syncErr instanceof Error
              ? `Unlinked, but Zoho photo cleanup failed: ${syncErr.message}`
              : 'Unlinked, but Zoho photo cleanup failed.',
          );
          return;
        }
      }
      if (siblingItems.length > 0 && catalogProductId) {
        navigate(`${base}/inventory-audit/linked/${catalogProductId}`, { replace: true });
        return;
      }
      navigate(`${base}?section=inventory-audit`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unlink item.');
    } finally {
      setUnlinking(false);
    }
  };

  const handleBack = useCallback(() => {
    if (item?.catalogProductId) {
      navigate(`${base}/inventory-audit/linked/${item.catalogProductId}`, { replace: false });
      return;
    }
    navigate(`${base}?section=inventory-audit`, { replace: false });
  }, [navigate, base, item?.catalogProductId]);

  useCatalogPageHeader({
    title: item ? formatItemLocationShort(item.rackId, item.rowNumber, item.binNumber) : 'Audit item',
    showBack: true,
    onBack: handleBack,
  });

  const previewQty = useMemo(() => {
    const countedQty = item ? readItemQuantity(item) : 0;
    const zohoQty = selectedProduct?.stock ?? null;
  return { countedQty, zohoQty, qtyDifference: zohoQty != null ? countedQty - zohoQty : null };
  }, [item, selectedProduct]);

  if (user?.role !== 'super_admin') {
    return <Navigate to={base} replace />;
  }

  if (!itemId) {
    return <Navigate to={`${base}?section=inventory-audit`} replace />;
  }

  if (loading && !item) {
    return (
      <div className="page-content fade-in catalog-inventory-audit-detail">
        <FetchingLoader label="Loading audit item…" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="page-content fade-in catalog-inventory-audit-detail">
        <div className="products-inline-error panel glass">
          <AlertCircle size={18} />
          <span>{error || 'Audit item not found.'}</span>
        </div>
        <Link to={`${base}?section=inventory-audit`} className="btn btn-secondary btn-sm">
          Back to inventory audit
        </Link>
      </div>
    );
  }

  const photos = item.photos ?? [];
  const { countedQty, qtyDifference } = previewQty;

  return (
    <div className="page-content fade-in catalog-inventory-audit-detail">
      {error && (
        <div className="products-inline-error panel glass">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {linked && item.catalogProductId && (
        <p className="catalog-inventory-audit-detail__group-link text-muted">
          Part of{' '}
          <Link to={`${base}/inventory-audit/linked/${item.catalogProductId}`}>
            {item.catalogProductName || 'linked Zoho item'}
          </Link>
          {siblingItems.length > 0 && ` · ${siblingItems.length + 1} stock locations`}
        </p>
      )}

      <section className="catalog-inventory-audit-detail__hero panel glass">
        <div className="catalog-inventory-audit-detail__summary">
          <InventoryAuditQtyEditor item={item} />
          <span
            className={`catalog-inventory-audit-detail__status catalog-inventory-audit-detail__status--${
              linked ? 'linked' : 'unlinked'
            }`}
          >
            {linked ? 'Linked' : 'Unlinked'}
          </span>
        </div>

        <div className="catalog-inventory-audit-detail__photos">
          {[0, 1].map(index => (
            <div key={index} className="catalog-inventory-audit-detail__photo">
              {photos[index] ? (
                <YesStorePhotoImg photo={photos[index]} alt={`Audit photo ${index + 1}`} />
              ) : (
                <span className="catalog-inventory-audit-detail__photo-empty text-muted">No photo</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="catalog-inventory-audit-detail__link panel glass">
        <h2 className="catalog-inventory-audit-detail__link-title">
          <Link2 size={18} aria-hidden />
          Link to Zoho catalog item
        </h2>

        <div className="catalog-inventory-audit-detail__link-form">
          <CatalogProductLinkPicker
            products={catalogProducts}
            value={selectedProduct}
            onChange={setSelectedProduct}
            loading={catalogLoading}
            disabled={linking}
          />

          {selectedProduct && (
            <>
              <fieldset className="catalog-inventory-audit-detail__link-mode">
                <legend className="catalog-inventory-audit-detail__link-mode-legend">How this bin counts</legend>
                <label className="catalog-inventory-audit-detail__link-mode-option">
                  <input
                    type="radio"
                    name="linkMode"
                    value="unit"
                    checked={linkMode === 'unit'}
                    disabled={linking || siblingItems.some(sibling => sibling.catalogLinkMode === 'part')}
                    onChange={() => setLinkMode('unit')}
                  />
                  <span>
                    <strong>Same item, another location</strong>
                    <span className="text-muted">Qty at this bin is added to the total.</span>
                  </span>
                </label>
                <label className="catalog-inventory-audit-detail__link-mode-option">
                  <input
                    type="radio"
                    name="linkMode"
                    value="part"
                    checked={linkMode === 'part'}
                    disabled={linking}
                    onChange={() => setLinkMode('part')}
                  />
                  <span>
                    <strong>Kit part</strong>
                    <span className="text-muted">
                      Multiple bins are parts of one Zoho item. Complete units = min of floor(qty ÷ required).
                    </span>
                  </span>
                </label>
              </fieldset>

              {linkMode === 'part' && (
                <div className="catalog-inventory-audit-detail__part-fields">
                  <label className="catalog-inventory-audit-detail__part-field">
                    <span>Part name</span>
                    <input
                      type="text"
                      value={partLabel}
                      onChange={event => setPartLabel(event.target.value)}
                      placeholder="e.g. Part A"
                      disabled={linking}
                    />
                  </label>
                  <label className="catalog-inventory-audit-detail__part-field">
                    <span>Required per Zoho unit</span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={unitsPerProduct}
                      onChange={event =>
                        setUnitsPerProduct(Math.max(1, Number(event.target.value) || 1))
                      }
                      disabled={linking}
                    />
                  </label>
                </div>
              )}

              <div className="catalog-inventory-audit-detail__qty-compare">
                <div className="catalog-inventory-audit-detail__qty-compare-item">
                  <span className="catalog-inventory-audit-detail__qty-compare-label">Zoho qty</span>
                  <strong>{formatStockQuantity(selectedProduct.stock, selectedProduct.unit)}</strong>
                </div>
                <div className="catalog-inventory-audit-detail__qty-compare-item">
                  <span className="catalog-inventory-audit-detail__qty-compare-label">This bin</span>
                  <strong>{countedQty}</strong>
                </div>
                <div className="catalog-inventory-audit-detail__qty-compare-item">
                  <span className="catalog-inventory-audit-detail__qty-compare-label">Difference</span>
                  <strong
                    className={`catalog-inventory-audit-detail__qty-compare-diff${
                      qtyDifference != null && qtyDifference !== 0
                        ? qtyDifference > 0
                          ? ' is-over'
                          : ' is-under'
                        : ''
                    }`}
                  >
                    {qtyDifference != null ? formatQtyDifference(qtyDifference) : '—'}
                  </strong>
                </div>
              </div>
            </>
          )}

          <div className="catalog-inventory-audit-detail__actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canLink || linking || unlinking || catalogLoading || partModeInvalid}
              onClick={() => void handleLink()}
            >
              {linking ? 'Linking…' : linked && canLink ? 'Update link' : 'Link item'}
            </button>
            {linked && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={linking || unlinking}
                  onClick={() =>
                    setPrintFields(
                      binLabelFieldsFromStoreItem(
                        selectedProduct ?? {
                          id: item.catalogProductId || item.id,
                          name: item.catalogProductName || 'Linked item',
                          sku: item.catalogProductSku ?? null,
                        },
                        item,
                      ),
                    )
                  }
                >
                  <Printer size={16} aria-hidden />
                  Print Label
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={linking || unlinking}
                  onClick={() => void handleUnlink()}
                >
                  <Unlink size={16} aria-hidden />
                  {unlinking ? 'Unlinking…' : 'Unlink item'}
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {printFields && (
        <BinLabelPrintDialog
          fields={printFields}
          onClose={() => setPrintFields(null)}
        />
      )}
    </div>
  );
};
