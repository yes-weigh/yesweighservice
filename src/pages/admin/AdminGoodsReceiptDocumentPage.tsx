import React, { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { AlertCircle, Check, ChevronDown, Eye, EyeOff, Package, PackageCheck, Plus, X } from 'lucide-react';
import { GoodsReceiptReceivedDialog } from '../../components/admin/GoodsReceiptReceivedDialog';
import { DocumentLineItemSpec } from '../../components/invoices/DocumentLineItemSpec';
import { ProductNcSelect } from '../../components/catalog/ProductNcSelect';
import { ProductPackageInfo } from '../../components/catalog/ProductPackageInfo';
import { PackageInfoIcon } from '../../components/catalog/PackageInfoIcon';
import { useAuth } from '../../context/AuthContext';
import { isFreightProductId, isFreightSku } from '../../constants/freightLines';
import {
  isReceivedBillStatus,
  markGoodsReceiptReceived,
  receiveLineLocations,
  saveGoodsReceiptReceiveCheck,
  setGoodsReceiptLineHidden,
} from '../../lib/admin-goods-receipts';
import { resolveCatalogProductsForLineItems, catalogProductHasCompleteSingleBoxPackageInfo } from '../../lib/catalog';
import { formatInvoiceDate, formatInvoiceDateTime, invoiceErrorMessage, moveFreightLinesToEnd } from '../../lib/invoices';
import { isFullSuperAdmin, isViewOnlySuperAdmin } from '../../lib/staffAccess';
import {
  listWarehouseZoneRows,
  listWarehouseZones,
} from '../../lib/warehouseLocations/data';
import type { CatalogPackageInfo, CatalogProduct } from '../../types/catalog';
import type { WarehouseZoneDoc, WarehouseZoneRowDoc } from '../../types/warehouse-locations';
import type { AdminGoodsReceiptDetailOutletContext } from './adminGoodsReceiptDetailContext';

function formatDiff(value: number): string {
  if (value === 0) return '0';
  return value > 0 ? `+${value}` : String(value);
}

function resolveCatalogForLine(
  line: { itemId?: string | null; sku?: string | null },
  catalogById: Record<string, CatalogProduct>,
): CatalogProduct | undefined {
  const itemId = line.itemId?.trim();
  if (itemId && catalogById[itemId]) return catalogById[itemId];
  const sku = line.sku?.trim();
  if (sku && catalogById[`sku:${sku}`]) return catalogById[`sku:${sku}`];
  return undefined;
}

type LocationDraft = {
  key: string;
  zoneId: string;
  zoneRowNumber: string;
  quantity: string;
};

type LineDraft = {
  locations: LocationDraft[];
};

function newLocationDraft(defaultZoneId = ''): LocationDraft {
  return {
    key: crypto.randomUUID(),
    zoneId: defaultZoneId,
    zoneRowNumber: '',
    quantity: '',
  };
}

function locationsEqual(
  a: Array<{ zoneId: string; zoneRowNumber: number; quantity: number }>,
  b: Array<{ zoneId: string; zoneRowNumber: number; quantity: number }>,
): boolean {
  if (a.length !== b.length) return false;
  return a.every((loc, i) => (
    loc.zoneId === b[i].zoneId
    && loc.zoneRowNumber === b[i].zoneRowNumber
    && loc.quantity === b[i].quantity
  ));
}

function parseDraftLocations(draft: LineDraft): {
  ok: true;
  locations: Array<{ zoneId: string; zoneRowNumber: number; quantity: number }>;
  empty: boolean;
} | {
  ok: false;
  error: string;
} {
  const prepared: Array<{ zoneId: string; zoneRowNumber: number; quantity: number }> = [];
  let anyPartial = false;

  for (const row of draft.locations) {
    const zoneId = row.zoneId.trim().toLowerCase();
    const rowRaw = row.zoneRowNumber.trim();
    const qtyRaw = row.quantity.trim();
    const blank = !zoneId && !rowRaw && !qtyRaw;
    if (blank) continue;

    anyPartial = true;
    if (!zoneId || !rowRaw) {
      return { ok: false, error: 'Each warehouse location needs a zone and row.' };
    }
    const zoneRowNumber = Number(rowRaw);
    const quantity = Number(qtyRaw);
    if (!Number.isFinite(zoneRowNumber) || zoneRowNumber < 1) {
      return { ok: false, error: 'Invalid row number.' };
    }
    if (qtyRaw === '' || !Number.isFinite(quantity) || quantity < 0) {
      return { ok: false, error: 'Enter a valid qty for each warehouse location.' };
    }
    if (quantity <= 0) continue;
    prepared.push({
      zoneId,
      zoneRowNumber: Math.floor(zoneRowNumber),
      quantity: Math.floor(quantity),
    });
  }

  return { ok: true, locations: prepared, empty: !anyPartial && prepared.length === 0 };
}

export const AdminGoodsReceiptDocumentPage: React.FC = () => {
  const { user } = useAuth();
  const { goodsReceipt, setGoodsReceipt, goodsReceiptId } = useOutletContext<
    AdminGoodsReceiptDetailOutletContext
  >();

  const [lineDrafts, setLineDrafts] = useState<Record<string, LineDraft>>({});
  const [saveError, setSaveError] = useState('');
  const [saveOk, setSaveOk] = useState('');
  const [hidingLineId, setHidingLineId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'draft' | 'post' | null>(null);
  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false);

  const [zones, setZones] = useState<WarehouseZoneDoc[]>([]);
  const [rowsByZone, setRowsByZone] = useState<Record<string, WarehouseZoneRowDoc[]>>({});
  const [loadingZones, setLoadingZones] = useState(true);
  const [catalogById, setCatalogById] = useState<Record<string, CatalogProduct>>({});
  const [expandedPackageIds, setExpandedPackageIds] = useState<Set<string>>(() => new Set());

  const canHideItems = isFullSuperAdmin(user);
  const canBackdateReceived = isFullSuperAdmin(user);
  const canMarkReceived = Boolean(user) && !isViewOnlySuperAdmin(user);
  const saving = Boolean(busy);

  const hiddenLineIds = useMemo(
    () => new Set(goodsReceipt?.receiveCheck?.hiddenLineIds ?? []),
    [goodsReceipt?.receiveCheck?.hiddenLineIds],
  );

  const lineItems = useMemo(
    () => (goodsReceipt ? moveFreightLinesToEnd(goodsReceipt.lineItems) : []),
    [goodsReceipt],
  );

  const visibleLineItems = useMemo(
    () => lineItems.filter(line => line.id && !hiddenLineIds.has(line.id)),
    [lineItems, hiddenLineIds],
  );

  const hiddenLineItems = useMemo(
    () => lineItems.filter(line => line.id && hiddenLineIds.has(line.id)),
    [lineItems, hiddenLineIds],
  );

  const defaultZoneId = zones[0]?.id ?? '';

  useEffect(() => {
    if (!goodsReceipt?.lineItems?.length) {
      setCatalogById({});
      return;
    }
    let active = true;
    void resolveCatalogProductsForLineItems(
      goodsReceipt.lineItems.map(line => ({
        itemId: line.itemId,
        sku: line.sku,
      })),
    )
      .then(next => {
        if (active) setCatalogById(next);
      })
      .catch(() => {
        if (active) setCatalogById({});
      });
    return () => {
      active = false;
    };
  }, [goodsReceipt?.lineItems]);

  useEffect(() => {
    let active = true;
    setLoadingZones(true);
    void listWarehouseZones()
      .then(async nextZones => {
        if (!active) return;
        const rowEntries = await Promise.all(
          nextZones.map(async zone => [zone.id, await listWarehouseZoneRows(zone.id)] as const),
        );
        if (!active) return;
        setZones(nextZones);
        setRowsByZone(Object.fromEntries(rowEntries));
      })
      .catch(() => {
        if (active) {
          setZones([]);
          setRowsByZone({});
        }
      })
      .finally(() => {
        if (active) setLoadingZones(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!goodsReceipt) return;
    const next: Record<string, LineDraft> = {};
    const savedLines = goodsReceipt.receiveCheck?.lines ?? {};
    for (const line of goodsReceipt.lineItems) {
      if (!line.id) continue;
      const savedLocs = receiveLineLocations(savedLines[line.id]);
      next[line.id] = {
        locations: savedLocs.length > 0
          ? savedLocs.map(loc => ({
            key: crypto.randomUUID(),
            zoneId: loc.zoneId,
            zoneRowNumber: String(loc.zoneRowNumber),
            quantity: String(loc.quantity),
          }))
          : [newLocationDraft(defaultZoneId)],
      };
    }
    setLineDrafts(next);
    setSaveError('');
    setSaveOk('');
  }, [goodsReceipt, defaultZoneId]);

  const dirty = useMemo(() => {
    if (!goodsReceipt) return false;
    const savedLines = goodsReceipt.receiveCheck?.lines ?? {};
    for (const line of goodsReceipt.lineItems) {
      if (!line.id || hiddenLineIds.has(line.id)) continue;
      const draft = lineDrafts[line.id] ?? { locations: [newLocationDraft()] };
      const parsed = parseDraftLocations(draft);
      if (!parsed.ok) return true;
      const saved = receiveLineLocations(savedLines[line.id]);
      if (parsed.empty && saved.length === 0) continue;
      if (!locationsEqual(parsed.locations, saved)) return true;
    }
    return false;
  }, [goodsReceipt, lineDrafts, hiddenLineIds]);

  const unposted = useMemo(() => {
    if (!goodsReceipt) return false;
    const postedLines = goodsReceipt.receiveCheck?.postedLines ?? {};
    for (const line of goodsReceipt.lineItems) {
      if (!line.id || hiddenLineIds.has(line.id)) continue;
      const draft = lineDrafts[line.id] ?? { locations: [newLocationDraft()] };
      const parsed = parseDraftLocations(draft);
      if (!parsed.ok) return true;
      const posted = receiveLineLocations(postedLines[line.id]);
      if (parsed.empty && posted.length === 0) continue;
      if (!locationsEqual(parsed.locations, posted)) return true;
    }
    return false;
  }, [goodsReceipt, lineDrafts, hiddenLineIds]);

  const missingPackageLines = useMemo(() => {
    if (!goodsReceipt) return [] as Array<{ lineId: string; name: string; productId: string }>;
    const missing: Array<{ lineId: string; name: string; productId: string }> = [];
    const seen = new Set<string>();
    for (const line of goodsReceipt.lineItems) {
      if (!line.id || hiddenLineIds.has(line.id)) continue;
      if (isFreightProductId(line.itemId) || isFreightSku(line.sku)) continue;
      const product = resolveCatalogForLine(line, catalogById);
      if (!product) continue;
      // Uncategorized products may skip package info.
      if (!product.categoryId?.trim()) continue;
      if (catalogProductHasCompleteSingleBoxPackageInfo(product)) continue;
      if (seen.has(product.id)) continue;
      seen.add(product.id);
      missing.push({
        lineId: line.id,
        name: line.name || product.name || product.sku || product.id,
        productId: product.id,
      });
    }
    return missing;
  }, [goodsReceipt, catalogById, hiddenLineIds]);

  const packageDataReady = missingPackageLines.length === 0;

  if (!goodsReceipt) return null;

  const togglePackageExpanded = (lineId: string) => {
    setExpandedPackageIds(prev => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  };

  const onPackageInfoSaved = (productId: string, info: CatalogPackageInfo) => {
    setCatalogById(prev => {
      const existing = prev[productId];
      if (!existing) return prev;
      return { ...prev, [productId]: { ...existing, packageInfo: info } };
    });
  };

  const handleToggleHidden = async (lineId: string, hidden: boolean) => {
    if (!user?.uid || !canHideItems) return;
    setHidingLineId(lineId);
    setSaveError('');
    try {
      const receiveCheck = await setGoodsReceiptLineHidden(
        goodsReceiptId,
        lineId,
        hidden,
        {
          lineItems: goodsReceipt.lineItems,
          previous: goodsReceipt.receiveCheck,
        },
        {
          uid: user.uid,
          displayName: user.displayName,
        },
      );
      setGoodsReceipt(prev => (prev ? { ...prev, receiveCheck } : prev));
      if (hidden) {
        setLineDrafts(prev => {
          const next = { ...prev };
          delete next[lineId];
          return next;
        });
      }
    } catch (err) {
      setSaveError(invoiceErrorMessage(err));
    } finally {
      setHidingLineId(null);
    }
  };

  const setLocationDraft = (
    lineId: string,
    locationKey: string,
    patch: Partial<Omit<LocationDraft, 'key'>>,
  ) => {
    setLineDrafts(prev => {
      const current = prev[lineId] ?? { locations: [newLocationDraft(defaultZoneId)] };
      return {
        ...prev,
        [lineId]: {
          locations: current.locations.map(loc => (
            loc.key === locationKey ? { ...loc, ...patch } : loc
          )),
        },
      };
    });
    setSaveOk('');
    setSaveError('');
  };

  const addLocation = (lineId: string) => {
    setLineDrafts(prev => {
      const current = prev[lineId] ?? { locations: [] };
      return {
        ...prev,
        [lineId]: {
          locations: [...current.locations, newLocationDraft(defaultZoneId)],
        },
      };
    });
    setSaveOk('');
    setSaveError('');
  };

  const removeLocation = (lineId: string, locationKey: string) => {
    setLineDrafts(prev => {
      const current = prev[lineId] ?? { locations: [newLocationDraft(defaultZoneId)] };
      const nextLocations = current.locations.filter(loc => loc.key !== locationKey);
      return {
        ...prev,
        [lineId]: {
          locations: nextLocations.length > 0 ? nextLocations : [newLocationDraft(defaultZoneId)],
        },
      };
    });
    setSaveOk('');
    setSaveError('');
  };

  const collectReceiveLines = (): Record<string, {
    locations: Array<{ zoneId: string; zoneRowNumber: number; quantity: number }>;
  }> | null => {
    const lines: Record<string, {
      locations: Array<{ zoneId: string; zoneRowNumber: number; quantity: number }>;
    }> = {};

    for (const line of goodsReceipt.lineItems) {
      if (!line.id || hiddenLineIds.has(line.id)) continue;
      const draft = lineDrafts[line.id] ?? { locations: [newLocationDraft(defaultZoneId)] };
      const parsed = parseDraftLocations(draft);
      if (!parsed.ok) {
        setSaveError(`${parsed.error} (${line.name})`);
        return null;
      }
      if (parsed.empty) continue;
      if (parsed.locations.length === 0) {
        setSaveError(`Enter qty for at least one warehouse location on ${line.name}.`);
        return null;
      }
      lines[line.id] = { locations: parsed.locations };
    }
    return lines;
  };

  const alreadyReceived = Boolean(goodsReceipt.opsReceivedAt);

  const persistReceiveCheck = async (mode: 'draft' | 'post', auditedAt?: string | null) => {
    if (!user?.uid) {
      setSaveError('You must be signed in to save.');
      return null;
    }
    const lines = collectReceiveLines();
    if (!lines) return null;
    return saveGoodsReceiptReceiveCheck(
      goodsReceiptId,
      {
        lines,
        lineItems: goodsReceipt.lineItems,
        previous: goodsReceipt.receiveCheck,
        mode,
        auditedAt: mode === 'post' ? (auditedAt ?? null) : null,
        zohoAlreadyIncludesInbound: alreadyReceived || isReceivedBillStatus(goodsReceipt.status),
      },
      {
        uid: user.uid,
        displayName: user.displayName,
      },
    );
  };

  const handleSaveDraft = async () => {
    setBusy('draft');
    setSaveError('');
    setSaveOk('');
    try {
      const receiveCheck = await persistReceiveCheck('draft');
      if (!receiveCheck) return;
      setGoodsReceipt(prev => (prev ? { ...prev, receiveCheck } : prev));
      setSaveOk('Draft saved');
    } catch (err) {
      setSaveError(invoiceErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const openGoodsReceivedDialog = () => {
    if (!user || !canMarkReceived) return;

    if (!packageDataReady) {
      const sample = missingPackageLines
        .slice(0, 3)
        .map(row => row.name)
        .join(', ');
      setSaveError(
        `Fill single box package information (weight + L × B × H) before marking goods received${
          sample ? ` — ${sample}${missingPackageLines.length > 3 ? '…' : ''}` : ''
        }.`,
      );
      return;
    }

    if (!collectReceiveLines()) return;
    setSaveError('');
    setSaveOk('');
    setReceiveDialogOpen(true);
  };

  const handleGoodsReceived = async (receivedAtIso: string) => {
    if (!user || !canMarkReceived) return;

    setBusy('post');
    setSaveError('');
    setSaveOk('');
    try {
      const receiveCheck = await persistReceiveCheck('post', receivedAtIso);
      if (!receiveCheck) return;
      let nextStatus = goodsReceipt.status;
      let nextReceivedDate = goodsReceipt.receivedDate;
      let nextOpsReceivedAt = goodsReceipt.opsReceivedAt;
      let nextOpsReceivedByUid = goodsReceipt.opsReceivedByUid;
      let nextOpsReceivedByName = goodsReceipt.opsReceivedByName;
      if (!alreadyReceived) {
        const result = await markGoodsReceiptReceived(goodsReceiptId, receivedAtIso);
        nextStatus = result.status;
        nextReceivedDate = result.receivedDate;
        nextOpsReceivedAt = result.opsReceivedAt;
        nextOpsReceivedByUid = result.opsReceivedByUid;
        nextOpsReceivedByName = result.opsReceivedByName;
      }
      setGoodsReceipt(prev => (prev ? {
        ...prev,
        receiveCheck,
        status: nextStatus,
        receivedDate: nextReceivedDate,
        opsReceivedAt: nextOpsReceivedAt,
        opsReceivedByUid: nextOpsReceivedByUid,
        opsReceivedByName: nextOpsReceivedByName,
      } : prev));
      setReceiveDialogOpen(false);
      setSaveOk('Goods received');
    } catch (err) {
      setSaveError(invoiceErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="goods-receipt-detail">
      <section className="goods-receipt-detail__meta">
        <div>
          <div className="text-muted text-sm">Vendor</div>
          <strong>{goodsReceipt.vendorName ?? '—'}</strong>
          {(goodsReceipt.vendorCity
            || goodsReceipt.vendorState
            || goodsReceipt.vendorCountry) && (
            <p className="text-muted text-sm mt-1 mb-0">
              {[
                goodsReceipt.vendorCity,
                goodsReceipt.vendorState,
                goodsReceipt.vendorCountry,
              ].filter(Boolean).join(', ')}
            </p>
          )}
        </div>
        <div className="goods-receipt-detail__dates">
          <div className="goods-receipt-detail__date goods-receipt-detail__date--po">
            <div className="text-muted text-sm">PO date</div>
            <strong>{formatInvoiceDate(goodsReceipt.poDate)}</strong>
          </div>
          <div className="goods-receipt-detail__date goods-receipt-detail__date--sailed">
            <div className="text-muted text-sm">Sailed date</div>
            <strong>{formatInvoiceDate(goodsReceipt.sailedDate)}</strong>
          </div>
          <div className="goods-receipt-detail__date goods-receipt-detail__date--received">
            <div className="text-muted text-sm">Received</div>
            <strong>
              {formatInvoiceDateTime(goodsReceipt.receivedDate, goodsReceipt.opsReceivedAt)}
            </strong>
            {alreadyReceived && goodsReceipt.opsReceivedByName && (
              <span className="text-muted text-sm">
                {goodsReceipt.opsReceivedByName}
              </span>
            )}
          </div>
        </div>
        {goodsReceipt.notes && (
          <p className="text-muted text-sm mb-0">{goodsReceipt.notes}</p>
        )}
      </section>

      <section className="invoice-detail-items goods-receipt-receive">
        <div className="goods-receipt-receive__header">
          <h3 className="invoice-detail-items__title mb-0">
            Items{visibleLineItems.length ? ` (${visibleLineItems.length})` : ''}
            {canHideItems && hiddenLineItems.length > 0
              ? ` · ${hiddenLineItems.length} hidden`
              : ''}
          </h3>
        </div>

        {visibleLineItems.length ? (
          <ul className="invoice-detail-item-list mt-3">
            {visibleLineItems.map(item => {
              const ordered = Number(item.quantity ?? 0);
              const draft = lineDrafts[item.id] ?? {
                locations: [newLocationDraft(defaultZoneId)],
              };
              const receivedTotal = draft.locations.reduce((sum, loc) => {
                const n = Number(loc.quantity);
                return sum + (Number.isFinite(n) && n > 0 ? n : 0);
              }, 0);
              const hasAnyQty = draft.locations.some(loc => loc.quantity.trim() !== '');
              const diff = hasAnyQty ? receivedTotal - ordered : null;
              const diffClass = diff == null
                ? ''
                : diff === 0
                  ? 'is-match'
                  : diff > 0
                    ? 'is-over'
                    : 'is-under';
              const catalogProduct = resolveCatalogForLine(item, catalogById);
              const isFreight = isFreightProductId(item.itemId)
                || isFreightSku(item.sku);
              const showPackageInfo = Boolean(catalogProduct && !isFreight);
              const packageRequired = Boolean(catalogProduct?.categoryId?.trim());
              const packageComplete = catalogProduct
                ? catalogProductHasCompleteSingleBoxPackageInfo(catalogProduct)
                : true;
              const packageMissing = showPackageInfo && packageRequired && !packageComplete;

              return (
                <li
                  key={item.id}
                  className={[
                    'invoice-detail-item',
                    'admin-invoice-detail-item',
                    'goods-receipt-receive__item',
                    packageMissing ? 'goods-receipt-receive__item--package-missing' : '',
                  ].filter(Boolean).join(' ')}
                >
                  {canHideItems && (
                    <button
                      type="button"
                      className="goods-receipt-receive__hide-btn"
                      disabled={saving || hidingLineId === item.id}
                      onClick={() => void handleToggleHidden(item.id, true)}
                      aria-label={`Hide ${item.name} from this goods receipt`}
                      title="Hide item"
                    >
                      <EyeOff size={15} aria-hidden />
                    </button>
                  )}
                  <div className="invoice-detail-item__image-wrap">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt=""
                        className="invoice-detail-item__image"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className="invoice-detail-item__placeholder" aria-hidden>
                        <Package size={22} />
                      </span>
                    )}
                  </div>
                  <DocumentLineItemSpec
                    name={item.name}
                    sku={item.sku}
                  >
                    <div className="goods-receipt-receive__summary">
                      <label className="goods-receipt-receive__field">
                        <span className="goods-receipt-receive__label">Ordered qty</span>
                        <input
                          type="text"
                          className="goods-receipt-receive__input"
                          value={String(ordered)}
                          readOnly
                          tabIndex={-1}
                          aria-readonly="true"
                        />
                      </label>
                      <label className="goods-receipt-receive__field">
                        <span className="goods-receipt-receive__label">Received qty</span>
                        <input
                          type="text"
                          className="goods-receipt-receive__input"
                          value={hasAnyQty ? String(receivedTotal) : ''}
                          placeholder="—"
                          readOnly
                          tabIndex={-1}
                          aria-readonly="true"
                          aria-label={`Received qty for ${item.name}`}
                        />
                      </label>
                      <div className="goods-receipt-receive__diff-wrap">
                        <span className="goods-receipt-receive__label">Difference</span>
                        <strong
                          className={`goods-receipt-receive__diff ${diffClass}`.trim()}
                          aria-label="Difference received minus ordered"
                        >
                          {diff == null ? '—' : formatDiff(diff)}
                        </strong>
                      </div>
                      {showPackageInfo && catalogProduct && (
                        <button
                          type="button"
                          className={`goods-receipt-receive__package-toggle${
                            packageMissing ? ' is-missing' : ''
                          }`}
                          onClick={() => togglePackageExpanded(item.id)}
                          aria-expanded={expandedPackageIds.has(item.id)}
                        >
                          <span className="goods-receipt-receive__label">Package</span>
                          <span className="goods-receipt-receive__package-status">
                            {packageMissing ? (
                              <span className="goods-receipt-receive__package-alarm">
                                <PackageInfoIcon size={16} title="Package info missing" />
                                Missing
                              </span>
                            ) : (
                              <span className="goods-receipt-receive__package-ok">OK</span>
                            )}
                            <ChevronDown
                              size={14}
                              aria-hidden
                              className={`goods-receipt-receive__package-chevron${
                                expandedPackageIds.has(item.id) ? ' is-open' : ''
                              }`}
                            />
                          </span>
                        </button>
                      )}
                    </div>

                    {showPackageInfo && catalogProduct && expandedPackageIds.has(item.id) && (
                      <div className="goods-receipt-receive__package is-open">
                        <ProductPackageInfo
                          product={catalogProduct}
                          packageInfo={catalogProduct.packageInfo}
                          canEdit
                          defaultEditing={packageMissing}
                          onPackageInfoChange={info => onPackageInfoSaved(catalogProduct.id, info)}
                        />
                      </div>
                    )}

                    <div className="goods-receipt-receive__locations">
                      <span className="goods-receipt-receive__label">Warehouse locations</span>
                      {draft.locations.map((loc, locIndex) => {
                        const zoneRows = loc.zoneId ? (rowsByZone[loc.zoneId] ?? []) : [];
                        const isLast = locIndex === draft.locations.length - 1;
                        return (
                          <div
                            key={loc.key}
                            className="goods-receipt-receive__location-row"
                          >
                            <label className="goods-receipt-receive__field">
                              <span className="goods-receipt-receive__label">Zone</span>
                              <ProductNcSelect
                                aria-label={`Zone for ${item.name}`}
                                value={loc.zoneId}
                                disabled={loadingZones || saving}
                                placeholder={loadingZones ? 'Loading…' : 'Select zone'}
                                onChange={next => setLocationDraft(item.id, loc.key, {
                                  zoneId: next,
                                  zoneRowNumber: '',
                                })}
                                options={zones.map(zone => ({
                                  value: zone.id,
                                  label: `${zone.id.toUpperCase()}${zone.label ? ` — ${zone.label}` : ''}`,
                                }))}
                              />
                            </label>
                            <label className="goods-receipt-receive__field">
                              <span className="goods-receipt-receive__label">Row</span>
                              <ProductNcSelect
                                aria-label={`Row for ${item.name}`}
                                value={loc.zoneRowNumber}
                                disabled={saving || !loc.zoneId || zoneRows.length === 0}
                                placeholder={!loc.zoneId ? 'Select zone first' : 'Select row'}
                                onChange={next => setLocationDraft(item.id, loc.key, {
                                  zoneRowNumber: next,
                                })}
                                options={zoneRows.map(row => ({
                                  value: String(row.number),
                                  label: row.label
                                    ? `${row.number} — ${row.label}`
                                    : String(row.number),
                                }))}
                              />
                            </label>
                            <label className="goods-receipt-receive__field goods-receipt-receive__field--qty">
                              <span className="goods-receipt-receive__label">Qty</span>
                              <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                step={1}
                                className="goods-receipt-receive__input goods-receipt-receive__input--editable"
                                value={loc.quantity}
                                placeholder="—"
                                disabled={saving}
                                onChange={e => setLocationDraft(item.id, loc.key, {
                                  quantity: e.target.value,
                                })}
                                aria-label={`Qty at location for ${item.name}`}
                              />
                            </label>
                            <div className="goods-receipt-receive__row-actions">
                              <button
                                type="button"
                                className="goods-receipt-receive__icon-btn goods-receipt-receive__icon-btn--remove"
                                disabled={saving || draft.locations.length <= 1}
                                onClick={() => removeLocation(item.id, loc.key)}
                                aria-label="Remove warehouse location"
                              >
                                <X size={14} aria-hidden />
                              </button>
                              {isLast && (
                                <button
                                  type="button"
                                  className="goods-receipt-receive__icon-btn goods-receipt-receive__icon-btn--add"
                                  disabled={saving}
                                  onClick={() => addLocation(item.id)}
                                  aria-label="Add warehouse location"
                                >
                                  <Plus size={14} aria-hidden />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </DocumentLineItemSpec>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="invoice-detail-items__empty text-muted text-sm">
            {hiddenLineItems.length > 0
              ? 'All items on this bill are hidden.'
              : 'No line items on this bill.'}
          </p>
        )}

        {canHideItems && hiddenLineItems.length > 0 && (
          <ul className="goods-receipt-receive__hidden-list" aria-label="Hidden items">
            {hiddenLineItems.map(item => (
              <li key={item.id} className="goods-receipt-receive__hidden-item">
                <div className="goods-receipt-receive__hidden-meta">
                  <span className="goods-receipt-receive__hidden-badge">Hidden</span>
                  <strong className="goods-receipt-receive__hidden-name">{item.name}</strong>
                  {item.sku ? (
                    <span className="text-muted text-sm">{item.sku}</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="goods-receipt-receive__unhide-btn"
                  disabled={saving || hidingLineId === item.id}
                  onClick={() => void handleToggleHidden(item.id, false)}
                >
                  <Eye size={14} aria-hidden />
                  {hidingLineId === item.id ? '…' : 'Unhide'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canMarkReceived && (
        <div className="goods-receipt-detail__actions">
          {saveError && (
            <div className="products-inline-error panel glass goods-receipt-detail__actions-error" role="alert">
              <AlertCircle size={16} />
              <span>{saveError}</span>
            </div>
          )}
          {saveOk && !dirty && (
            <p className="goods-receipt-receive__saved text-sm mb-0 goods-receipt-detail__actions-status" role="status">
              <Check size={14} aria-hidden />
              {saveOk}
              {goodsReceipt.receiveCheck?.updatedByName
                ? ` · ${goodsReceipt.receiveCheck.updatedByName}`
                : ''}
            </p>
          )}
          <div className="goods-receipt-detail__actions-btns">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving || !dirty}
              onClick={() => void handleSaveDraft()}
            >
              {busy === 'draft' ? 'Saving…' : 'Save as draft'}
            </button>
            <span
              className="goods-receipt-detail__actions-primary"
              title={
                !packageDataReady
                  ? `Fill package info (weight + L × B × H) for ${
                      missingPackageLines.length === 1
                        ? missingPackageLines[0].name
                        : `${missingPackageLines.length} products`
                    }`
                    : 'Posts warehouse stock and a product audit, then opens this draft bill in Zoho'
              }
            >
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || !packageDataReady || (alreadyReceived && !dirty && !unposted)}
                onClick={openGoodsReceivedDialog}
              >
                <PackageCheck size={16} aria-hidden />
                {busy === 'post' ? 'Updating…' : 'Goods received'}
              </button>
            </span>
          </div>
        </div>
      )}

      <GoodsReceiptReceivedDialog
        open={receiveDialogOpen}
        billNumber={goodsReceipt.billNumber}
        canBackdate={canBackdateReceived}
        saving={busy === 'post'}
        error={receiveDialogOpen ? saveError : ''}
        onClose={() => {
          if (busy === 'post') return;
          setReceiveDialogOpen(false);
        }}
        onConfirm={iso => void handleGoodsReceived(iso)}
      />
    </div>
  );
};
