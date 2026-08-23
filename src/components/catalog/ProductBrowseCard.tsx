import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, IndianRupee, Link2, Minus, Package, ShoppingCart } from 'lucide-react';
import { getCategoryTheme } from '../../lib/category-display';
import {
  catalogProductHasSingleBoxPackageInfo,
  expectsCatalogPackageInfo,
  formatStockQuantity,
  isCatalogSparePartProduct,
} from '../../lib/catalog';
import {
  catalogGridStockQty,
  resolveAdjustedAuditDisplay,
} from '../../lib/catalogProductAudit/display';
import { normalizeGatcIdList, productHasLinkedGatc } from '../../lib/gatcCart';
import { loadGatcStampingPrices } from '../../lib/catalogProductSettings';
import type { CatalogGatcStampingPriceEntry } from '../../constants/catalogProductSettings';
import { formatAuditDate } from '../../lib/yesStore/format';
import { formatQtyDifference } from '../../lib/yesStore/inventoryAudit';
import { useCart } from '../../context/useCart';
import { useCartFly } from '../../context/useCartFly';
import { useDealerOrderStockGate } from '../../hooks/useDealerOrderStockGate';
import { useDealerPriceLevels, useDealerUnitPrice } from '../../hooks/useDealerUnitPrice';
import { isCatalogProductSalesRestricted } from '../../lib/catalogSalesRestriction';
import {
  DEALER_ORDER_SCHEDULED_TITLE,
  DEALER_ORDER_UNAVAILABLE_TITLE,
} from '../../lib/dealerOrderStock';
import type { CatalogProduct } from '../../types/catalog';
import { AuditedSealIcon } from './AuditedSealIcon';
import { CatalogMerchBadges } from './CatalogMerchBadges';
import { RestrictedItemBadge } from './RestrictedItemBadge';
import { CategoryThumbnail } from './CategoryThumbnail';
import { CatalogOnOrderShipChip } from './CatalogOnOrderShipChip';
import { useAuth } from '../../context/AuthContext';
import {
  canSeeDealerUnitPrice,
  dealerStaffTeam,
} from '../../lib/dealerAccess';
import { CatalogMrpLabel, DealerPriceDisplay } from './DealerPriceDisplay';
import { StockBadge, StockQuantity } from './StockBadge';
import { PackageInfoIcon } from './PackageInfoIcon';
import { StampingShieldIcon } from './StampingShieldIcon';

const LONG_PRESS_MS = 480;
const LONG_PRESS_MOVE_PX = 10;

function catalogOverlayBlocksLongPress(): boolean {
  return Boolean(document.querySelector(
    '.dealers-modal-backdrop, .warehouse-location-dialog__backdrop',
  ));
}

let sharedGatcPricesPromise: Promise<CatalogGatcStampingPriceEntry[]> | null = null;

function loadSharedGatcPrices(): Promise<CatalogGatcStampingPriceEntry[]> {
  if (!sharedGatcPricesPromise) {
    sharedGatcPricesPromise = loadGatcStampingPrices().catch(() => []);
  }
  return sharedGatcPricesPromise;
}

export interface ProductBrowseCardProps {
  product: CatalogProduct;
  index: number;
  onSelect: () => void;
  enableCart?: boolean;
  /** When enableCart is true, hide cart button unless this returns true (defaults to always). */
  isCartable?: (product: CatalogProduct) => boolean;
  showStockQuantity?: boolean;
  /**
   * Dealer portal grid: hide missing-package icon; show stamping range labels.
   * Staff / admin keep package-missing + shield-only badges.
   */
  dealerView?: boolean;
  manageLabel?: string;
  onManage?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  linkedSpareCount?: number;
  warehouseLinked?: boolean;
  /** Open Non-Conformance count — staff/super_admin only. */
  openNcCount?: number;
  /** Audited location label (Zone·Row or Rack·Row·Bin) — staff/super_admin. */
  auditedLocationLabel?: string | null;
  /** Open / raised PO qty — staff/super_admin. */
  raisedPoQty?: number | null;
  /** Long-press (e.g. update Zoho warehouse) — staff/super_admin. */
  onLongPress?: (product: CatalogProduct) => void;
  /** Emphasize after returning from product detail. */
  highlighted?: boolean;
  editable?: boolean;
  dragProps?: {
    draggable: boolean;
    onDragStart: React.DragEventHandler;
    onDragOver: React.DragEventHandler;
    onDragLeave: React.DragEventHandler;
    onDrop: React.DragEventHandler;
    onDragEnd: React.DragEventHandler;
  };
}

function formatProductTitle(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const ProductBrowseCard: React.FC<ProductBrowseCardProps> = ({
  product,
  index,
  onSelect,
  enableCart = false,
  isCartable,
  showStockQuantity = false,
  dealerView = false,
  manageLabel,
  onManage,
  linkedSpareCount,
  warehouseLinked = false,
  openNcCount,
  auditedLocationLabel = null,
  raisedPoQty = null,
  onLongPress,
  highlighted = false,
  editable = false,
  dragProps,
}) => {
  const { addItem, isInCart } = useCart();
  const { flyToCart } = useCartFly();
  const { user } = useAuth();
  const dealerStock = useDealerOrderStockGate();
  const { billingState } = useDealerPriceLevels();
  const dealerPricing = useDealerUnitPrice(dealerView ? product : null);
  const dealerCanAdd = dealerStock.canOrder(product);
  const salesRestricted = dealerView && isCatalogProductSalesRestricted(product, billingState);
  const dealerInboundOnly = dealerStock.usesScheduledInbound(product);
  const inboundQty = dealerStock.scheduledQty(product.id);
  const isSpareItem = isCatalogSparePartProduct(product);
  const hideDealerSpareQty = dealerStock.gate && isSpareItem;
  const hideTeamQty = dealerStaffTeam(user) != null;
  /** Directors (owner) see finished-goods qty; Sales/Service staff never see qty. */
  const showQty = showStockQuantity && !hideDealerSpareQty && !hideTeamQty;
  const showInboundQty = showQty && inboundQty > 0;
  const catalogMrp = product.mrpOverride != null && Number(product.mrpOverride) > 0
    ? Math.round(Number(product.mrpOverride) * 100) / 100
    : null;
  const showDealerCharge = dealerView && canSeeDealerUnitPrice(user, isSpareItem);
  const showMrpOnly = dealerView && !showDealerCharge;
  const showSpareMrpBeside = dealerView
    && dealerStaffTeam(user) === 'service'
    && isSpareItem
    && catalogMrp != null;
  const hideDealerAuditMeta = dealerStock.gate;
  const [addedFlash, setAddedFlash] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [gatcOptions, setGatcOptions] = useState<CatalogGatcStampingPriceEntry[]>([]);
  const longPressTimer = useRef<number | null>(null);
  const longPressOrigin = useRef<{ x: number; y: number } | null>(null);
  const longPressFired = useRef(false);
  const theme = getCategoryTheme(index);
  const inCart = isInCart(product.id);
  const showCartButton = enableCart && !salesRestricted && (!isCartable || isCartable(product));
  const showRestrictedBadge = enableCart && salesRestricted && (!isCartable || isCartable(product));
  const hasStamping = productHasLinkedGatc(product);
  // Grid badge: only single-box counts — master carton alone is not enough.
  const hasSingleBoxPackageInfo = catalogProductHasSingleBoxPackageInfo(product);
  const showPackageMissingIcon = !dealerView
    && !hasSingleBoxPackageInfo
    && expectsCatalogPackageInfo(product);

  useEffect(() => {
    if (!dealerView || !hasStamping) {
      setGatcOptions([]);
      return;
    }
    let active = true;
    void loadSharedGatcPrices().then(list => {
      if (active) setGatcOptions(list);
    });
    return () => {
      active = false;
    };
  }, [dealerView, hasStamping, product.id]);

  const stampingChipLines = useMemo(() => {
    if (!dealerView || !hasStamping) return [];
    return normalizeGatcIdList(product.gatcStampingPriceIds).map(id => {
      const opt = gatcOptions.find(entry => entry.id === id);
      return {
        id,
        // Dealer grid: range only — fee is shown when choosing stamping in cart.
        label: opt ? opt.stampingRange : id,
      };
    });
  }, [dealerView, hasStamping, product.gatcStampingPriceIds, gatcOptions]);

  const showBottomLeft = showPackageMissingIcon
    || hasStamping
    || Boolean(auditedLocationLabel);

  const clearLongPress = () => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressOrigin.current = null;
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    if (!onLongPress || event.button !== 0 || !event.isPrimary) return;
    if (catalogOverlayBlocksLongPress()) return;
    if ((event.target as HTMLElement | null)?.closest('.catalog-product-card__on-order')) {
      return;
    }
    longPressFired.current = false;
    longPressOrigin.current = { x: event.clientX, y: event.clientY };
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      if (catalogOverlayBlocksLongPress()) {
        longPressFired.current = false;
        return;
      }
      longPressFired.current = true;
      onLongPress(product);
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!longPressOrigin.current || longPressTimer.current == null) return;
    const dx = event.clientX - longPressOrigin.current.x;
    const dy = event.clientY - longPressOrigin.current.y;
    if (dx * dx + dy * dy > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) {
      clearLongPress();
    }
  };

  const handlePointerUp = () => {
    clearLongPress();
  };

  const handleSelect = () => {
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    onSelect();
  };

  const auditDisplay = useMemo(() => {
    if (!showQty || !product.auditSnapshot) return null;
    return resolveAdjustedAuditDisplay({
      currentZohoQty: product.stock,
      snapshot: product.auditSnapshot,
      livePhysicalQty: null,
    });
  }, [showQty, product.auditSnapshot, product.stock]);

  /** Grid qty pill: audited stock (Zoho + Diff), same as the product detail Audited column. */
  const gridStockQty = showQty ? catalogGridStockQty(product) : 0;

  const gridStockStatus = gridStockQty <= 0
    ? 'out_of_stock' as const
    : product.stockStatus === 'low_stock'
      ? 'low_stock' as const
      : 'in_stock' as const;

  const auditDiff = auditDisplay?.displayDifference ?? null;
  const auditDiffState =
    auditDiff == null ? null
      : auditDiff > 0 ? 'over'
        : auditDiff < 0 ? 'under'
          : 'match';
  const showAuditInfo = auditDisplay?.hasAuditSnapshot === true && auditDiff != null;
  const onOrderQty = Number(raisedPoQty);
  const showOnOrderQty = !hideDealerSpareQty
    && !hideTeamQty
    && Number.isFinite(onOrderQty)
    && onOrderQty > 0;

  const cardStyle = {
    '--cat-accent': theme.accent,
    '--cat-badge': theme.badge,
  } as React.CSSProperties;

  const handleAddToCart = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!dealerCanAdd) return;
    // Stampable items add without stamping; dealer configures in cart.
    if (addItem(product)) {
      flyToCart(event.currentTarget, { imageUrl: product.imageUrl });
      setAddedFlash(true);
      window.setTimeout(() => setAddedFlash(false), 1200);
    }
  };

  return (
    <>
    <article
      {...(editable ? dragProps : {})}
      style={cardStyle}
      className={[
        'catalog-product-card',
        inCart ? 'catalog-product-card--in-cart' : '',
        editable ? 'catalog-product-card--editable' : '',
        dragOver ? 'catalog-product-card--drag-over' : '',
        onLongPress ? 'catalog-product-card--long-press' : '',
        showCartButton || showRestrictedBadge ? 'catalog-product-card--has-cart' : '',
        highlighted ? 'is-focus' : '',
      ].filter(Boolean).join(' ')}
      data-product-id={product.id}
      onDragOver={editable ? e => {
        e.preventDefault();
        setDragOver(true);
        dragProps?.onDragOver(e);
      } : undefined}
      onDragLeave={editable ? e => {
        setDragOver(false);
        dragProps?.onDragLeave(e);
      } : undefined}
      onDrop={editable ? e => {
        setDragOver(false);
        dragProps?.onDrop(e);
      } : undefined}
      onPointerDown={onLongPress ? handlePointerDown : undefined}
      onPointerMove={onLongPress ? handlePointerMove : undefined}
      onPointerUp={onLongPress ? handlePointerUp : undefined}
      onPointerCancel={onLongPress ? handlePointerUp : undefined}
      onContextMenu={onLongPress ? e => {
        e.preventDefault();
        if (catalogOverlayBlocksLongPress()) return;
        if ((e.target as HTMLElement | null)?.closest('.catalog-product-card__on-order')) return;
        onLongPress(product);
      } : undefined}
    >
      <button type="button" className="catalog-product-card__main" onClick={handleSelect}>
        <div className="catalog-product-card__media">
          {product.sku && (
            <span className="catalog-product-card__sku-badge">{product.sku}</span>
          )}
          {product.modelNumber?.trim() && (
            <span className="catalog-product-card__sku-badge catalog-product-card__model-badge">
              {product.modelNumber.trim()}
            </span>
          )}
          <StockBadge status={product.stockStatus} overlay variant="tile" iconOnly />
          {(showBottomLeft) && (
            <div className="catalog-product-card__media-bottom-left">
              {showPackageMissingIcon && (
                <span
                  className="catalog-product-card__package-badge"
                  title="Package info missing"
                  aria-label="Package info missing"
                >
                  <PackageInfoIcon size={28} aria-hidden />
                </span>
              )}
              {hasStamping && dealerView && (
                <div
                  className="catalog-product-card__stamping-stack"
                  title="Stamping available"
                  aria-label="Stamping available"
                >
                  <span className="catalog-product-card__stamping-badge">
                    <StampingShieldIcon size={18} aria-hidden />
                  </span>
                  <div className="catalog-product-card__stamping-chip">
                    {stampingChipLines.map(line => (
                      <span key={line.id} className="catalog-product-card__stamping-chip-line">
                        {line.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {hasStamping && !dealerView && (
                <span
                  className="catalog-product-card__stamping-badge"
                  title="Stamping available"
                  aria-label="Stamping available"
                >
                  <StampingShieldIcon size={22} aria-hidden />
                </span>
              )}
              {auditedLocationLabel && (
                <span className="catalog-product-card__location-badge" title={auditedLocationLabel}>
                  {auditedLocationLabel}
                </span>
              )}
            </div>
          )}
          {product.imageUrl ? (
            <div className="catalog-product-card__visual" aria-hidden>
              <CategoryThumbnail src={product.imageUrl} />
            </div>
          ) : (
            <Package size={36} className="catalog-product-card__fallback" aria-hidden />
          )}
        </div>

        <CatalogMerchBadges product={product} className="catalog-merch-badges--under-photo" />

        <div className="catalog-product-card__body">
          <h3 className="catalog-product-card__title">{formatProductTitle(product.name)}</h3>
          <div className="catalog-product-card__price-row">
            <div className="catalog-product-card__price">
              {showDealerCharge ? (
                <>
                  <DealerPriceDisplay listRate={product.rate} pricing={dealerPricing} />
                  {showSpareMrpBeside ? (
                    <CatalogMrpLabel mrp={catalogMrp} iconSize={12} />
                  ) : null}
                </>
              ) : showMrpOnly ? (
                <CatalogMrpLabel mrp={catalogMrp} iconSize={14} />
              ) : (
                <>
                  <IndianRupee size={14} strokeWidth={2.5} aria-hidden />
                  <span>{product.rate.toLocaleString('en-IN')}</span>
                </>
              )}
            </div>
            {(showQty || showOnOrderQty || showInboundQty) && (
              <div className="catalog-product-card__stock-meta">
                {showQty && (
                  <StockQuantity
                    stock={gridStockQty}
                    unit={product.unit}
                    status={gridStockStatus}
                    compact
                  />
                )}
                {showOnOrderQty && (
                  <CatalogOnOrderShipChip
                    productId={product.id}
                    quantity={onOrderQty}
                    unit={product.unit}
                  />
                )}
                {showInboundQty && (
                  <span
                    className="catalog-product-card__inbound-chip catalog-product-card__inbound-chip--qty"
                    title={DEALER_ORDER_SCHEDULED_TITLE}
                  >
                    {formatStockQuantity(inboundQty, product.unit)}
                  </span>
                )}
              </div>
            )}
          </div>

          {!hideDealerAuditMeta && openNcCount != null && openNcCount > 0 ? (
            <div className="catalog-product-card__tag-row">
              <span className="catalog-product-card__nc-badge">
                NC {openNcCount}
              </span>
            </div>
          ) : null}

          {showAuditInfo && !hideDealerAuditMeta && (
            <div className="catalog-product-card__audit">
              <p className="catalog-product-card__audit-heading">
                Stock difference (after last audit)
              </p>
              <div className="catalog-product-card__audit-row">
                {auditDiffState === 'match' ? (
                  <div className="catalog-product-card__audit-match">
                    <AuditedSealIcon className="catalog-product-card__audited-seal" />
                  </div>
                ) : (
                  <div
                    className={[
                      'catalog-product-card__audit-diff',
                      auditDiffState ? `catalog-product-card__audit-diff--${auditDiffState}` : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <span className="catalog-product-card__audit-diff-icon" aria-hidden>
                      {auditDiffState === 'under'
                        ? <ArrowDown size={12} strokeWidth={2.75} />
                        : auditDiffState === 'over'
                          ? <ArrowUp size={12} strokeWidth={2.75} />
                          : <Minus size={12} strokeWidth={2.75} />}
                    </span>
                    <div className="catalog-product-card__audit-diff-copy">
                      <span className="catalog-product-card__audit-diff-value">
                        {`${formatQtyDifference(auditDiff!)} ${product.unit}`.trim()}
                      </span>
                      {auditDiffState === 'over' && (
                        <span className="catalog-product-card__audit-diff-note">(Found more)</span>
                      )}
                      {auditDiffState === 'under' && (
                        <span className="catalog-product-card__audit-diff-note">(Found less)</span>
                      )}
                    </div>
                  </div>
                )}
                <div className="catalog-product-card__audit-date">
                  <span className="catalog-product-card__audit-date-label">Last audit</span>
                  <span className="catalog-product-card__audit-date-value">
                    {formatAuditDate(auditDisplay?.lastAuditedAt)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {(linkedSpareCount !== undefined || warehouseLinked) && (
            <div className="catalog-product-card__footer-meta">
              {linkedSpareCount !== undefined && (
                <span
                  className={`catalog-product-card__spare-count ${linkedSpareCount === 0 ? 'catalog-product-card__spare-count--none' : ''}`}
                >
                  <Link2 size={12} aria-hidden />
                  {linkedSpareCount === 0
                    ? 'No spares linked'
                    : `${linkedSpareCount} spare${linkedSpareCount === 1 ? '' : 's'} linked`}
                </span>
              )}
              {warehouseLinked && (
                <span className="catalog-product-card__warehouse-link">
                  <Link2 size={12} aria-hidden />
                  Warehouse linked
                </span>
              )}
            </div>
          )}
        </div>
      </button>

      {onManage && manageLabel && (
        <button
          type="button"
          className="catalog-product-card__manage-btn"
          onClick={onManage}
          aria-label={manageLabel}
          title={manageLabel}
        >
          <Link2 size={14} />
        </button>
      )}

      {showRestrictedBadge && <RestrictedItemBadge compact />}

      {showCartButton && (
        <button
          type="button"
          className={`catalog-product-card__cart-btn ${addedFlash ? 'catalog-product-card__cart-btn--added' : ''}`}
          onClick={handleAddToCart}
          disabled={!dealerCanAdd}
          aria-label={
            !dealerCanAdd
              ? DEALER_ORDER_UNAVAILABLE_TITLE
              : inCart
                ? 'Add another to cart'
                : 'Add to cart'
          }
          title={
            !dealerCanAdd
              ? DEALER_ORDER_UNAVAILABLE_TITLE
              : dealerInboundOnly
                ? DEALER_ORDER_SCHEDULED_TITLE
                : 'Add to cart'
          }
        >
          <ShoppingCart size={16} />
        </button>
      )}
    </article>
    </>
  );
};
