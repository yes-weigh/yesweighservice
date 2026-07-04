import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { canNavigateBackInApp } from '../../lib/navigation';
import {
  ArrowLeft,
  Ban,
  Camera,
  ChevronRight,
  Download,
  IndianRupee,
  Link2,
  Package,
  Pencil,
  RefreshCw,
  Save,
  ShoppingCart,
  Tag,
  X,
} from 'lucide-react';
import {
  downloadCatalogProductImage,
  fetchCatalog,
  fetchCatalogProductDetail,
  fetchCatalogSpareLinks,
  formatCurrency,
  formatStockQuantity,
  getCategorizedProducts,
  getUncategorizedProducts,
  hasCatalogCategory,
  saveCatalogProductSpareLinks,
  saveCatalogSpareProductLinks,
  setCatalogProductStatus,
  updateCatalogProductDetails,
  uploadCatalogProductImage,
} from '../../lib/catalog';
import { getCategoryTheme } from '../../lib/category-display';
import { useCart } from '../../context/useCart';
import { useCartFly } from '../../context/useCartFly';
import { useConfirm } from '../../context/ConfirmContext';
import { listItemsByCatalogProduct } from '../../lib/yesStore/data';
import {
  calculateGroupTotals,
  collectWarehouseAuditPhotos,
  formatQtyDifference,
  type InventoryAuditGroupTotals,
} from '../../lib/yesStore/inventoryAudit';
import { resolveYesStorePhotoUrls } from '../../lib/yesStore/photos';
import type { CatalogProduct, CatalogProductDetail } from '../../types/catalog';
import { useAuth } from '../../context/AuthContext';
import { getCatalogSiteInventory } from '../../lib/catalogSiteInventory/data';
import {
  CATALOG_INVENTORY_SITE_CONFIG,
  resolveActiveInventorySites,
} from '../../lib/catalogInventorySites';
import { ProductSiteStockLocations } from './ProductSiteStockLocations';
import {
  catalogSiteInventoryTotalQuantity,
  type CatalogSiteInventoryDoc,
} from '../../types/catalog-site-inventory';
import type { YesStoreItemDoc } from '../../types/yes-store';
import {
  buildProductNavState,
  buildSpareNavState,
  type CatalogNavState,
} from '../../lib/catalogNav';
import { CategoryThumbnail } from './CategoryThumbnail';
import { RelatedCatalogItems } from './RelatedCatalogItems';
import { SpareLinkEditor } from './SpareLinkEditor';
import { StockBadge } from './StockBadge';

function formatProductTitle(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function themeIndexFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash + id.charCodeAt(i) * (i + 1)) % 9973;
  }
  return hash;
}

export const ProductDetailView: React.FC<{
  productId: string;
  backPath: string;
  backLabel?: string;
  backState?: CatalogNavState | null;
  preview?: CatalogProduct | null;
  variant?: 'app' | 'public';
  showWarehouseStock?: boolean;
  showStockQuantity?: boolean;
  showAuditedStock?: boolean;
  showCartActions?: boolean;
  ordersPath?: string;
  showRelatedLinks?: boolean;
  manageSpareLinks?: boolean;
  canEditProductDetails?: boolean;
  canSetInactive?: boolean;
  onInactiveSuccess?: () => void;
  productsBasePath?: string;
  sparesBasePath?: string;
  currentNavState?: CatalogNavState | null;
}> = ({
  productId,
  backPath,
  backLabel = 'Back to products',
  backState = null,
  preview = null,
  variant = 'app',
  showWarehouseStock = false,
  showStockQuantity = false,
  showAuditedStock = false,
  showCartActions = false,
  ordersPath = '/dealer/orders',
  showRelatedLinks = false,
  manageSpareLinks = false,
  canEditProductDetails = false,
  canSetInactive = false,
  onInactiveSuccess,
  productsBasePath = '/dealer/catalog',
  sparesBasePath = '/dealer/catalog/spare',
  currentNavState = null,
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const goBack = useCallback(() => {
    if (canNavigateBackInApp()) {
      navigate(-1);
      return;
    }
    if (backState) navigate(backPath, { state: backState });
    else navigate(backPath);
  }, [backPath, backState, navigate]);
  const { addItem, getQuantity } = useCart();
  const { flyToCart } = useCartFly();
  const confirm = useConfirm();
  const [quantity, setQuantity] = useState(1);
  const [addedFlash, setAddedFlash] = useState(false);
  const [product, setProduct] = useState<CatalogProductDetail | CatalogProduct | null>(preview);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [relatedItems, setRelatedItems] = useState<CatalogProduct[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedKind, setRelatedKind] = useState<'spares' | 'products'>('spares');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPool, setEditorPool] = useState<CatalogProduct[]>([]);
  const [editorSaving, setEditorSaving] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageDownloading, setImageDownloading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [productEditMode, setProductEditMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editSku, setEditSku] = useState('');
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [auditItems, setAuditItems] = useState<YesStoreItemDoc[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [cochinRecord, setCochinRecord] = useState<CatalogSiteInventoryDoc | null>(null);
  const [warehousePhotoUrls, setWarehousePhotoUrls] = useState<string[]>([]);
  const [activeGalleryIndex, setActiveGalleryIndex] = useState(0);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);

  const theme = useMemo(
    () => getCategoryTheme(themeIndexFromId(productId)),
    [productId],
  );

  const cardStyle = {
    '--cat-bg': theme.bg,
    '--cat-accent': theme.accent,
    '--cat-badge': theme.badge,
  } as React.CSSProperties;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    void fetchCatalogProductDetail(productId)
      .then(detail => {
        if (!active) return;
        if (!detail.imageUrl && preview?.imageUrl) {
          detail.imageUrl = preview.imageUrl;
        }
        setProduct(detail);
      })
      .catch(err => {
        if (!active) return;
        if (preview) {
          setProduct(preview);
        } else {
          setError(err instanceof Error ? err.message : 'Could not load product.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [productId, preview]);

  useEffect(() => {
    if (!showAuditedStock || !productId) {
      setAuditItems([]);
      return;
    }

    let active = true;
    setAuditLoading(true);
    void listItemsByCatalogProduct(productId)
      .then(items => {
        if (active) setAuditItems(items);
      })
      .catch(() => {
        if (active) setAuditItems([]);
      })
      .finally(() => {
        if (active) setAuditLoading(false);
      });

    return () => {
      active = false;
    };
  }, [showAuditedStock, productId]);

  useEffect(() => {
    if (!showAuditedStock || !productId) {
      setCochinRecord(null);
      return;
    }

    let active = true;
    void getCatalogSiteInventory(productId, 'cochin')
      .then(record => {
        if (active) setCochinRecord(record);
      })
      .catch(() => {
        if (active) setCochinRecord(null);
      });

    return () => {
      active = false;
    };
  }, [showAuditedStock, productId]);

  const activeInventorySites = useMemo(() => {
    if (!product || !showAuditedStock) return [];
    return resolveActiveInventorySites({
      product,
      auditItems,
      cochinRecord,
    });
  }, [product, showAuditedStock, auditItems, cochinRecord]);

  const canEditCochin = showAuditedStock && (user?.role === 'super_admin' || user?.role === 'staff');

  const warehousePhotos = useMemo(
    () => collectWarehouseAuditPhotos(auditItems),
    [auditItems],
  );

  useEffect(() => {
    let active = true;
    void resolveYesStorePhotoUrls(warehousePhotos).then(urls => {
      if (active) setWarehousePhotoUrls(urls);
    });
    return () => {
      active = false;
    };
  }, [warehousePhotos]);

  const galleryUrls = useMemo(() => {
    const primary = product?.imageUrl?.trim() ?? '';
    const urls = primary ? [primary] : [];
    for (const url of warehousePhotoUrls) {
      if (url && !urls.includes(url)) urls.push(url);
    }
    return urls;
  }, [product?.imageUrl, warehousePhotoUrls]);

  useEffect(() => {
    setActiveGalleryIndex(0);
    if (carouselRef.current) carouselRef.current.scrollLeft = 0;
  }, [galleryUrls]);

  const auditTotals = useMemo<InventoryAuditGroupTotals | null>(() => {
    if (!showAuditedStock || !product || auditItems.length === 0) return null;
    return calculateGroupTotals(auditItems, product);
  }, [showAuditedStock, product, auditItems]);

  const summaryAuditedQty = useMemo(() => {
    if (!showAuditedStock || !product) return null;
    let total = 0;
    let hasAny = false;
    if (activeInventorySites.includes('head_office') && auditTotals) {
      total += auditTotals.countedQty;
      hasAny = true;
    }
    if (activeInventorySites.includes('cochin') && cochinRecord) {
      total += catalogSiteInventoryTotalQuantity(cochinRecord);
      hasAny = true;
    }
    if (hasAny) return total;
    return auditTotals?.countedQty ?? null;
  }, [showAuditedStock, product, activeInventorySites, auditTotals, cochinRecord]);

  const summaryDifference = useMemo(() => {
    if (!showAuditedStock || !product || summaryAuditedQty == null) return null;
    return summaryAuditedQty - product.stock;
  }, [showAuditedStock, product, summaryAuditedQty]);

  const auditedStockLabel = useMemo(() => {
    if (summaryAuditedQty == null) return null;
    if (auditTotals?.mode === 'bundle' && activeInventorySites.length === 1 && activeInventorySites[0] === 'head_office') {
      return `${auditTotals.countedQty} complete (${auditTotals.rawCountedQty} parts)`;
    }
    return formatStockQuantity(summaryAuditedQty, product?.unit ?? 'pcs');
  }, [summaryAuditedQty, auditTotals, activeInventorySites, product?.unit]);

  const summaryColumns = useMemo(() => {
    const cols: Array<{
      key: string;
      label: string;
      shortLabel: string;
      tone: 'price' | 'zoho' | 'audited' | 'diff';
      diffState?: 'over' | 'under' | 'match';
    }> = [{ key: 'price', label: 'Dealer price', shortLabel: 'Price', tone: 'price' }];

    if (showStockQuantity) {
      cols.push({ key: 'zoho', label: 'Zoho stock', shortLabel: 'Zoho', tone: 'zoho' });
    }
    if (showAuditedStock) {
      cols.push({ key: 'audited', label: 'Audited stock', shortLabel: 'Audited', tone: 'audited' });
    }
    if (showAuditedStock && summaryDifference != null) {
      const difference = summaryDifference;
      cols.push({
        key: 'diff',
        label: 'Difference',
        shortLabel: 'Diff',
        tone: 'diff',
        diffState: difference > 0 ? 'over' : difference < 0 ? 'under' : 'match',
      });
    }
    return cols;
  }, [showStockQuantity, showAuditedStock, summaryDifference]);

  const stockColumns = useMemo(
    () => summaryColumns.filter(col => col.key !== 'price'),
    [summaryColumns],
  );

  const renderStockValue = (key: string) => {
    if (!product) return null;
    switch (key) {
      case 'zoho':
        return formatStockQuantity(product.stock, product.unit);
      case 'audited':
        return auditLoading ? '…' : auditedStockLabel ?? '—';
      case 'diff':
        return summaryDifference != null
          ? formatQtyDifference(summaryDifference)
          : '—';
      default:
        return null;
    }
  };

  const isCategorizedProduct = product ? hasCatalogCategory(product) : false;
  const isSpareItem = product ? !hasCatalogCategory(product) : false;
  const showLinksSection = showRelatedLinks || manageSpareLinks;

  const loadRelatedLinks = useCallback(async () => {
    if (!product || !showLinksSection) return;
    setRelatedLoading(true);
    setLinkError(null);
    try {
      const response = isCategorizedProduct
        ? await fetchCatalogSpareLinks({ productId: product.id })
        : await fetchCatalogSpareLinks({ spareId: product.id });
      setRelatedKind(response.kind);
      setRelatedItems(response.items);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Could not load related items.');
      setRelatedItems([]);
    } finally {
      setRelatedLoading(false);
    }
  }, [product, showLinksSection, isCategorizedProduct]);

  useEffect(() => {
    void loadRelatedLinks();
  }, [loadRelatedLinks]);

  const openLinkEditor = async () => {
    if (!product) return;
    setLinkError(null);
    try {
      const catalog = await fetchCatalog();
      const pool = isCategorizedProduct
        ? getUncategorizedProducts(catalog.items)
        : getCategorizedProducts(catalog.items);
      setEditorPool(pool);
      setEditorOpen(true);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Could not load catalog for mapping.');
    }
  };

  const handleSaveLinks = async (ids: string[]) => {
    if (!product) return;
    setEditorSaving(true);
    setLinkError(null);
    try {
      if (isCategorizedProduct) {
        await saveCatalogProductSpareLinks(product.id, ids);
      } else {
        await saveCatalogSpareProductLinks(product.id, ids);
      }
      setEditorOpen(false);
      await loadRelatedLinks();
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Could not save mapping.');
    } finally {
      setEditorSaving(false);
    }
  };

  const relatedLinkState = useCallback((item: CatalogProduct): CatalogNavState => {
    if (!product) {
      return { preview: item };
    }
    if (relatedKind === 'spares') {
      return buildSpareNavState(item, {
        origin: 'product',
        parentProduct: product,
        returnCategoryId: product.categoryId ?? undefined,
      });
    }
    return buildProductNavState(item, {
      origin: 'spare',
      parentSpare: product,
      parentSpareNav: currentNavState ?? undefined,
    });
  }, [product, relatedKind, currentNavState]);

  const detail = product as CatalogProductDetail | null;
  const warehousesWithStock = useMemo(
    () => detail?.warehouses?.filter(w => w.warehouseName && w.stock > 0) ?? [],
    [detail?.warehouses],
  );
  const outOfStock = product?.stockStatus === 'out_of_stock';
  const cartQty = product ? getQuantity(product.id) : 0;

  const handleAddToCart = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!product || outOfStock) return;
    if (addItem(product, quantity)) {
      flyToCart(event.currentTarget, { imageUrl: product.imageUrl });
      setAddedFlash(true);
      window.setTimeout(() => setAddedFlash(false), 1500);
    }
  };

  const handleImagePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !product || !productEditMode || !canEditProductDetails) return;

    setImageUploading(true);
    setImageError(null);
    try {
      const imageUrl = await uploadCatalogProductImage(product.id, file);
      const syncedAt = new Date().toISOString();
      setProduct(prev => (prev ? { ...prev, imageUrl, syncedAt } : prev));
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Could not upload image.');
    } finally {
      setImageUploading(false);
    }
  };

  const startProductEdit = () => {
    if (!product || !canEditProductDetails) return;
    setEditName(product.name);
    setEditSku(product.sku ?? '');
    setDetailsError(null);
    setProductEditMode(true);
  };

  const cancelProductEdit = () => {
    setProductEditMode(false);
    setDetailsError(null);
    setEditName('');
    setEditSku('');
  };

  const handleSaveProductDetails = async () => {
    if (!product || !canEditProductDetails || detailsSaving) return;

    const name = editName.trim();
    const sku = editSku.trim();
    if (!name) {
      setDetailsError('Item name is required.');
      return;
    }
    if (!sku) {
      setDetailsError('Item SKU is required.');
      return;
    }

    setDetailsSaving(true);
    setDetailsError(null);
    try {
      const saved = await updateCatalogProductDetails(product.id, { name, sku });
      const syncedAt = new Date().toISOString();
      setProduct(prev => (prev ? { ...prev, name: saved.name, sku: saved.sku, syncedAt } : prev));
      setProductEditMode(false);
    } catch (err) {
      setDetailsError(err instanceof Error ? err.message : 'Could not save item details.');
    } finally {
      setDetailsSaving(false);
    }
  };

  const currentGalleryUrl = galleryUrls[activeGalleryIndex] ?? product?.imageUrl ?? null;

  const handleCarouselScroll = () => {
    const track = carouselRef.current;
    if (!track || galleryUrls.length <= 1) return;
    const slideWidth = track.clientWidth;
    if (slideWidth <= 0) return;
    const index = Math.round(track.scrollLeft / slideWidth);
    setActiveGalleryIndex(Math.min(Math.max(index, 0), galleryUrls.length - 1));
  };

  const scrollToGalleryIndex = (index: number) => {
    const track = carouselRef.current;
    if (!track) return;
    track.scrollTo({ left: index * track.clientWidth, behavior: 'smooth' });
    setActiveGalleryIndex(index);
  };

  const handleImageDownload = async () => {
    if (!product || !currentGalleryUrl) return;
    setImageDownloading(true);
    setImageError(null);
    try {
      await downloadCatalogProductImage(currentGalleryUrl, {
        productName: product.name,
        sku: product.sku,
        productId: product.id,
      });
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Could not download image.');
    } finally {
      setImageDownloading(false);
    }
  };

  const handleSetInactive = async () => {
    if (!product || !canSetInactive || statusUpdating) return;

    const ok = await confirm({
      title: 'Set inactive on Zoho?',
      message: `“${product.name}” will be marked inactive in Zoho and removed from the dealer catalog.`,
      confirmLabel: 'Set inactive',
      destructive: true,
    });
    if (!ok) return;

    setStatusUpdating(true);
    setStatusError(null);
    try {
      await setCatalogProductStatus(product.id, 'inactive');
      onInactiveSuccess?.();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Could not set item inactive on Zoho.');
    } finally {
      setStatusUpdating(false);
    }
  };

  if (error && !product) {
    return (
      <div className={`product-detail-page product-detail-page--${variant}`}>
        <button type="button" className="product-detail-page__back" onClick={goBack}>
          <ArrowLeft size={18} />
          <span>{backLabel}</span>
        </button>
        <div className="product-detail-page__error panel glass">
          <Package size={40} />
          <h2>Product unavailable</h2>
          <p className="text-muted">{error}</p>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className={`product-detail-page product-detail-page--${variant}`}>
        <div className="product-detail-page__loading">
          <div className="loader-ring" />
          <p className="text-muted">Loading product…</p>
        </div>
      </div>
    );
  }

  const specRows = [
    product.categoryName ? { label: 'Category', value: product.categoryName } : null,
    product.unit ? { label: 'Unit', value: product.unit } : null,
    detail?.hsn ? { label: 'HSN', value: detail.hsn } : null,
    detail?.taxName
      ? {
          label: 'Tax',
          value: `${detail.taxName}${detail.taxPercentage ? ` (${detail.taxPercentage}%)` : ''}`,
        }
      : null,
    detail?.preferredVendor ? { label: 'Vendor', value: detail.preferredVendor } : null,
  ].filter((row): row is { label: string; value: string } => Boolean(row));

  return (
    <div className={`product-detail-page product-detail-page--${variant}`} style={cardStyle}>
      <button
        type="button"
        className="product-detail-page__back"
        onClick={goBack}
      >
        <ArrowLeft size={18} />
        <span>{backLabel}</span>
      </button>

      <div className="product-detail-page__layout">
        <div className="product-detail-page__hero">
          <section className="product-detail-page__gallery">
            <div
              className={[
                'product-detail-page__image-stage',
                galleryUrls.length > 1 ? 'product-detail-page__image-stage--carousel' : '',
                canEditProductDetails ? 'product-detail-page__image-stage--editable' : '',
                productEditMode ? 'product-detail-page__image-stage--editing' : '',
              ].filter(Boolean).join(' ')}
            >
              <StockBadge status={product.stockStatus} overlay variant="tile" />
              {canEditProductDetails && (
                <button
                  type="button"
                  className={[
                    'product-detail-page__edit-details-btn',
                    productEditMode ? 'is-active' : '',
                  ].filter(Boolean).join(' ')}
                  title={productEditMode ? 'Editing item details' : 'Edit item details'}
                  aria-label={productEditMode ? 'Editing item details' : 'Edit item details'}
                  aria-pressed={productEditMode}
                  onClick={() => (productEditMode ? cancelProductEdit() : startProductEdit())}
                >
                  {productEditMode ? <X size={16} aria-hidden /> : <Pencil size={16} aria-hidden />}
                </button>
              )}
              {galleryUrls.length > 1 ? (
                <>
                  <div
                    ref={carouselRef}
                    className="product-detail-page__carousel"
                    onScroll={handleCarouselScroll}
                    role="region"
                    aria-label="Product images"
                  >
                    {galleryUrls.map((url, index) => (
                      <div key={`${url}-${index}`} className="product-detail-page__carousel-slide">
                        <CategoryThumbnail src={url} />
                      </div>
                    ))}
                  </div>
                  <span className="product-detail-page__carousel-count" aria-hidden>
                    {activeGalleryIndex + 1}/{galleryUrls.length}
                  </span>
                  <div
                    className="product-detail-page__carousel-dots"
                    role="tablist"
                    aria-label="Image navigation"
                  >
                    {galleryUrls.map((_, index) => (
                      <button
                        key={index}
                        type="button"
                        role="tab"
                        className={[
                          'product-detail-page__carousel-dot',
                          index === activeGalleryIndex ? 'is-active' : '',
                        ].filter(Boolean).join(' ')}
                        aria-label={`Image ${index + 1} of ${galleryUrls.length}`}
                        aria-selected={index === activeGalleryIndex}
                        onClick={() => scrollToGalleryIndex(index)}
                      />
                    ))}
                  </div>
                </>
              ) : galleryUrls.length === 1 ? (
                <CategoryThumbnail src={galleryUrls[0]} />
              ) : (
                <Package size={72} className="product-detail-page__placeholder" aria-hidden />
              )}
            </div>
            {imageError && (
              <p className="product-detail-page__image-error text-sm">{imageError}</p>
            )}
          </section>

          <section className="product-detail-page__basics">
            {product.categoryName && (
              <p className="product-detail-page__breadcrumb">
                <Tag size={13} aria-hidden />
                <span>{product.categoryName}</span>
                <ChevronRight size={14} aria-hidden />
                <span>{isSpareItem ? 'Spare' : 'Product'}</span>
              </p>
            )}

            {!product.categoryName && isSpareItem && (
              <p className="product-detail-page__breadcrumb">
                <Tag size={13} aria-hidden />
                <span>Spare part</span>
              </p>
            )}

            <h1 className="product-detail-page__title">
              {productEditMode ? (
                <input
                  type="text"
                  className="product-detail-page__title-input"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  disabled={detailsSaving}
                  aria-label="Item name"
                />
              ) : (
                formatProductTitle(product.name)
              )}
            </h1>

            {(product.sku || productEditMode) && (
              productEditMode ? (
                <label className="product-detail-page__sku-field">
                  <span className="product-detail-page__sku-label">Model</span>
                  <input
                    type="text"
                    className="product-detail-page__sku-input"
                    value={editSku}
                    onChange={e => setEditSku(e.target.value)}
                    disabled={detailsSaving}
                    aria-label="Item SKU"
                  />
                </label>
              ) : (
                <p className="product-detail-page__sku">Model: {product.sku}</p>
              )
            )}

            {productEditMode && (
              <>
                {detailsError && (
                  <p className="product-detail-page__details-error text-sm">{detailsError}</p>
                )}
                <div className="product-detail-page__details-edit-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={detailsSaving || imageUploading}
                    onClick={() => void handleSaveProductDetails()}
                  >
                    {detailsSaving
                      ? <RefreshCw size={15} className="spin-icon" aria-hidden />
                      : <Save size={15} aria-hidden />}
                    {detailsSaving ? 'Saving…' : 'Save to Zoho'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={detailsSaving || imageUploading}
                    onClick={cancelProductEdit}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}

            {!productEditMode && canSetInactive && (isCategorizedProduct || isSpareItem) && (
              <button
                type="button"
                className="btn btn-secondary btn-sm product-detail-page__inactive-btn product-detail-page__inactive-btn--inline"
                onClick={() => void handleSetInactive()}
                disabled={statusUpdating}
              >
                {statusUpdating
                  ? <RefreshCw size={15} className="spin-icon" aria-hidden />
                  : <Ban size={15} aria-hidden />}
                Set inactive on Zoho
              </button>
            )}
            {statusError && (
              <p className="product-detail-page__status-error text-sm">{statusError}</p>
            )}

            {productEditMode && canEditProductDetails && (
              <div className="product-detail-page__media-actions">
                {currentGalleryUrl && (
                  <button
                    type="button"
                    className="product-detail-page__media-action"
                    title="Download product photo"
                    aria-label="Download product photo"
                    disabled={imageDownloading || imageUploading}
                    onClick={() => void handleImageDownload()}
                  >
                    <span className="product-detail-page__media-action-icon">
                      {imageDownloading
                        ? <RefreshCw size={18} className="spin-icon" aria-hidden />
                        : <Download size={18} aria-hidden />}
                    </span>
                    <span className="product-detail-page__media-action-label">Download</span>
                  </button>
                )}
                <button
                  type="button"
                  className="product-detail-page__media-action"
                  title="Capture or upload product photo"
                  aria-label="Capture or upload product photo"
                  disabled={imageUploading || imageDownloading}
                  onClick={() => imageInputRef.current?.click()}
                >
                  <span className="product-detail-page__media-action-icon">
                    {imageUploading
                      ? <RefreshCw size={18} className="spin-icon" aria-hidden />
                      : <Camera size={18} aria-hidden />}
                  </span>
                  <span className="product-detail-page__media-action-label">Take Photo</span>
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="product-detail-page__image-input"
                  aria-label="Product photo"
                  onChange={e => void handleImagePick(e)}
                />
              </div>
            )}
          </section>
        </div>

        <section className="product-detail-page__main">
          <div className="product-detail-page__summary-panel">
            <div
              className={[
                'product-detail-page__summary-table',
                stockColumns.length === 0 ? 'product-detail-page__summary-table--price-only' : '',
              ].filter(Boolean).join(' ')}
              style={{ '--stock-cols': stockColumns.length } as React.CSSProperties}
            >
              <div className="product-detail-page__summary-price-hero">
                <span className="product-detail-page__summary-price-kicker">
                  <span className="product-detail-page__summary-label-full">Dealer price</span>
                  <span className="product-detail-page__summary-label-short">Price</span>
                </span>
                <div className="product-detail-page__summary-price-amount">
                  <IndianRupee size={22} strokeWidth={2.5} aria-hidden />
                  <span>{formatCurrency(product.rate).replace('₹', '').trim()}</span>
                </div>
                <span className="product-detail-page__summary-gst-pill">+GST</span>
              </div>

              {stockColumns.length > 0 && (
                <>
                  <div className="product-detail-page__summary-stock-labels" role="row">
                    {stockColumns.map(col => (
                      <div
                        key={col.key}
                        role="columnheader"
                        className={[
                          'product-detail-page__summary-cell',
                          'product-detail-page__summary-cell--label',
                          `product-detail-page__summary-cell--${col.tone}`,
                          col.diffState ? `is-${col.diffState}` : '',
                        ].filter(Boolean).join(' ')}
                      >
                        <span className="product-detail-page__summary-label-full">{col.label}</span>
                        <span className="product-detail-page__summary-label-short">{col.shortLabel}</span>
                      </div>
                    ))}
                  </div>
                  <div className="product-detail-page__summary-stock-values" role="row">
                    {stockColumns.map(col => (
                      <div
                        key={col.key}
                        role="cell"
                        className={[
                          'product-detail-page__summary-cell',
                          'product-detail-page__summary-cell--value',
                          `product-detail-page__summary-cell--${col.tone}`,
                          col.diffState ? `is-${col.diffState}` : '',
                        ].filter(Boolean).join(' ')}
                      >
                        {renderStockValue(col.key)}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {loading && showStockQuantity && (
              <p className="product-detail-page__loading-note">Updating Zoho stock…</p>
            )}
          </div>

          {showAuditedStock && activeInventorySites.length > 0 && (
            <div className="product-detail-page__stock-locations">
              <h2 className="product-detail-page__stock-locations-title">Storage locations</h2>
              {activeInventorySites.map(site => (
                <ProductSiteStockLocations
                  key={site}
                  product={product as CatalogProductDetail}
                  siteConfig={CATALOG_INVENTORY_SITE_CONFIG[site]}
                  auditItems={site === 'head_office' ? auditItems : []}
                  cochinRecord={site === 'cochin' ? cochinRecord : null}
                  canEditCochin={canEditCochin}
                  editorUid={user?.uid ?? ''}
                  editorName={user?.displayName}
                  onCochinSaved={setCochinRecord}
                />
              ))}
            </div>
          )}

          {showCartActions && (
            <div className="product-detail-page__cart">
              <div className="product-detail-page__qty" aria-label="Quantity">
                <button
                  type="button"
                  className="product-detail-page__qty-btn"
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  disabled={quantity <= 1}
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <span className="product-detail-page__qty-value">{quantity}</span>
                <button
                  type="button"
                  className="product-detail-page__qty-btn"
                  onClick={() => setQuantity(q => q + 1)}
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                className={`btn btn-primary product-detail-page__add-cart ${addedFlash ? 'product-detail-page__add-cart--added' : ''}`}
                onClick={handleAddToCart}
                disabled={outOfStock}
              >
                <ShoppingCart size={18} />
                {addedFlash ? 'Added to cart' : outOfStock ? 'Out of stock' : 'Add to cart'}
              </button>
              {cartQty > 0 && (
                <button
                  type="button"
                  className="product-detail-page__view-cart"
                  onClick={() => navigate(ordersPath)}
                >
                  View cart ({cartQty})
                </button>
              )}
            </div>
          )}

          {detail?.description && (
            <div className="product-detail-page__section">
              <h2>About this product</h2>
              <p className="product-detail-page__description">{detail.description}</p>
            </div>
          )}

          {specRows.length > 0 && (
            <div className="product-detail-page__section">
              <h2>Product details</h2>
              <dl className="product-detail-page__specs">
                {specRows.map(row => (
                  <div key={row.label} className="product-detail-page__spec-row">
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {showWarehouseStock && warehousesWithStock.length > 0 && (
            <div className="product-detail-page__section">
              <h2>Availability by warehouse</h2>
              <ul className="product-detail-page__warehouses">
                {warehousesWithStock.map(w => (
                  <li key={w.warehouseId}>
                    <span>{w.warehouseName}</span>
                    <strong>
                      {w.stock} {product.unit}
                    </strong>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {showLinksSection && (isCategorizedProduct || isSpareItem) && (
            <>
              <RelatedCatalogItems
                items={relatedItems}
                title={relatedKind === 'spares' ? 'Compatible spares' : 'Compatible products'}
                emptyMessage={
                  relatedKind === 'spares'
                    ? 'No spares mapped yet for this product.'
                    : 'No products mapped yet for this spare.'
                }
                detailBasePath={relatedKind === 'spares' ? sparesBasePath : productsBasePath}
                loading={relatedLoading}
                showStockQuantity={showStockQuantity}
                enableCart={showCartActions && relatedKind === 'spares'}
                getLinkState={relatedLinkState}
                headerAction={
                  manageSpareLinks ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => void openLinkEditor()}
                    >
                      <Link2 size={15} />
                      {relatedKind === 'spares' ? 'Map spares' : 'Map products'}
                    </button>
                  ) : undefined
                }
              />
              {linkError && (
                <p className="related-catalog-section__error text-sm">{linkError}</p>
              )}
            </>
          )}
        </section>
      </div>

      {editorOpen && product && (
        <SpareLinkEditor
          mode={isCategorizedProduct ? 'product' : 'spare'}
          itemName={product.name}
          pool={editorPool}
          selectedIds={relatedItems.map(item => item.id)}
          saving={editorSaving}
          onClose={() => setEditorOpen(false)}
          onSave={handleSaveLinks}
        />
      )}
    </div>
  );
};
