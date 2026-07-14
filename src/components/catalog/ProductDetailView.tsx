import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { canNavigateBackInApp } from '../../lib/navigation';
import {
  ArrowLeft,
  Ban,
  Camera,
  ChevronRight,
  Download,
  FileText,
  ImagePlus,
  IndianRupee,
  Package,
  Pencil,
  RefreshCw,
  Save,
  ShoppingCart,
  Tag,
  Trash2,
  Upload,
  Printer,
  Share2,
  X,
} from 'lucide-react';
import {
  downloadCatalogProductImage,
  fetchCatalog,
  fetchCatalogProductDetail,
  fetchCatalogSpareLinks,
  assignProductCategory,
  formatCurrencyWhole,
  formatStockQuantity,
  getFinishedGoodsForSpareMapping,
  getSparesForSpareMapping,
  hasCatalogCategory,
  isCatalogSparePartProduct,
  saveCatalogProductSpareLinks,
  saveCatalogSpareProductLinks,
  setCatalogProductStatus,
  updateCatalogProductDetails,
  updateCatalogProductOverlays,
  uploadCatalogProductImage,
  deleteCatalogProductImage,
} from '../../lib/catalog';
import {
  loadApprovalNumberOptions,
  loadModelNumbers,
  loadMrpRules,
  loadSpareGroups,
  type CatalogSpareGroupOption,
} from '../../lib/catalogProductSettings';
import {
  calculateProductMrpInclGst,
  resolveMrpGroupRule,
} from '../../lib/catalogMrp';
import type { CatalogApprovalNumberOption } from '../../constants/catalogProductSettings';
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
import type { CatalogProduct, CatalogProductDetail, CatalogCategory } from '../../types/catalog';
import { useAuth } from '../../context/AuthContext';
import { getCatalogSiteInventory } from '../../lib/catalogSiteInventory/data';
import {
  CATALOG_INVENTORY_SITE_CONFIG,
  resolveActiveInventorySites,
} from '../../lib/catalogInventorySites';
import { ProductDetailTabs, DEALER_PRODUCT_DETAIL_TABS, type ProductDetailTabId } from './ProductDetailTabs';
import { ProductPackageInfo } from './ProductPackageInfo';
import type { ProductNcExistingLocation } from './ProductNcPanel';
import { ProductOpenNcTile } from './ProductOpenNcTile';
import { ProductSiteStockLocations } from './ProductSiteStockLocations';
import { resolveAdjustedAuditDisplay } from '../../lib/catalogProductAudit/display';
import { getCatalogProductNc } from '../../lib/catalogNc/data';
import {
  catalogSiteInventoryTotalQuantity,
  getCatalogSiteInventoryLocations,
  type CatalogSiteInventoryDoc,
} from '../../types/catalog-site-inventory';
import type { CatalogNcDoc } from '../../types/catalog-nc';
import { formatNcLocationLabel, ncLocationKey } from '../../types/catalog-nc';
import type { YesStoreItemDoc } from '../../types/yes-store';
import {
  buildProductNavState,
  buildSpareNavState,
  isSparePartsListOrigin,
  normalizeCatalogOrigin,
  type CatalogNavState,
} from '../../lib/catalogNav';
import {
  BinLabelPrintDialog,
  productPackLabelFieldsFromCatalog,
} from './BinLabelPrintDialog';
import type { BinLabelFields } from '../../lib/localPrinterLabel';
import { ProductWhatsAppShareDialog } from './ProductWhatsAppShareDialog';
import { CategoryThumbnail } from './CategoryThumbnail';
import { SpareLinkEditor } from './SpareLinkEditor';
import { StockBadge } from './StockBadge';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';

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
  isSpareDetail?: boolean;
  showWarehouseStock?: boolean;
  showStockQuantity?: boolean;
  showAuditedStock?: boolean;
  showCartActions?: boolean;
  ordersPath?: string;
  showRelatedLinks?: boolean;
  manageSpareLinks?: boolean;
  canEditProductDetails?: boolean;
  canEditProductImages?: boolean;
  canSetInactive?: boolean;
  onInactiveSuccess?: () => void;
  productsBasePath?: string;
  sparesBasePath?: string;
  currentNavState?: CatalogNavState | null;
  visibleTabs?: readonly ProductDetailTabId[];
  canWriteMedia?: boolean;
  mediaActorUid?: string;
  mediaActorName?: string | null;
}> = ({
  productId,
  backPath,
  backLabel = 'Back to products',
  backState = null,
  preview = null,
  variant = 'app',
  isSpareDetail = false,
  showWarehouseStock = false,
  showStockQuantity = false,
  showAuditedStock = false,
  showCartActions = false,
  ordersPath = '/dealer/orders',
  showRelatedLinks = false,
  manageSpareLinks = false,
  canEditProductDetails = false,
  canEditProductImages,
  canSetInactive = false,
  onInactiveSuccess,
  productsBasePath = '/dealer/catalog',
  sparesBasePath = '/dealer/catalog/spare',
  currentNavState = null,
  visibleTabs,
  canWriteMedia = false,
  mediaActorUid = '',
  mediaActorName = null,
}) => {
  const editImages = canEditProductImages ?? canEditProductDetails;
  const canEnterProductEdit = editImages || canEditProductDetails;
  const navigate = useNavigate();
  const { user } = useAuth();
  const goBack = useCallback(() => {
    const origin = normalizeCatalogOrigin(currentNavState);
    // Spare list/rack/QR: restore explicit context instead of blind history back.
    if (isSparePartsListOrigin(origin) || origin === 'unlinked') {
      if (backState) navigate(backPath, { state: backState });
      else navigate(backPath);
      return;
    }
    if (canNavigateBackInApp()) {
      navigate(-1);
      return;
    }
    if (backState) navigate(backPath, { state: backState });
    else navigate(backPath);
  }, [backPath, backState, navigate, currentNavState]);
  const { addItem, getQuantity } = useCart();
  const { flyToCart } = useCartFly();
  const confirm = useConfirm();
  const [quantityText, setQuantityText] = useState('1');
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
  const [imageDeleting, setImageDeleting] = useState(false);
  const [imageDownloading, setImageDownloading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [productEditMode, setProductEditMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editSku, setEditSku] = useState('');
  const [editRate, setEditRate] = useState('');
  const [editMrpOverride, setEditMrpOverride] = useState('');
  const [applyingMrpEquation, setApplyingMrpEquation] = useState(false);
  const [editModelNumber, setEditModelNumber] = useState('');
  const [editApprovalNumber, setEditApprovalNumber] = useState('');
  const [editSpareGroupId, setEditSpareGroupId] = useState('');
  const [modelNumberOptions, setModelNumberOptions] = useState<string[]>([]);
  const [approvalNumberOptions, setApprovalNumberOptions] = useState<CatalogApprovalNumberOption[]>([]);
  const [spareGroupOptions, setSpareGroupOptions] = useState<CatalogSpareGroupOption[]>([]);
  const [optionListsLoading, setOptionListsLoading] = useState(false);
  const [editCategoryId, setEditCategoryId] = useState('');
  const [categoryOptions, setCategoryOptions] = useState<CatalogCategory[]>([]);
  const [catalogCategories, setCatalogCategories] = useState<CatalogCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [auditItems, setAuditItems] = useState<YesStoreItemDoc[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [cochinRecord, setCochinRecord] = useState<CatalogSiteInventoryDoc | null>(null);
  const [ncDoc, setNcDoc] = useState<CatalogNcDoc | null>(null);
  const [detailTab, setDetailTab] = useState<ProductDetailTabId | undefined>(undefined);
  const [ncFocusLineId, setNcFocusLineId] = useState<string | null>(null);
  const [warehousePhotoUrls, setWarehousePhotoUrls] = useState<string[]>([]);
  const [activeGalleryIndex, setActiveGalleryIndex] = useState(0);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const addImageInputRef = useRef<HTMLInputElement>(null);
  const captureInputRef = useRef<HTMLInputElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [titleInView, setTitleInView] = useState(true);
  const [printLabelFields, setPrintLabelFields] = useState<BinLabelFields | null>(null);
  const [whatsappShareOpen, setWhatsappShareOpen] = useState(false);

  const scrolledHeaderTitle = useMemo(() => {
    if (variant !== 'app' || titleInView || !product) return null;
    return formatProductTitle(productEditMode ? editName || product.name : product.name);
  }, [variant, titleInView, product, productEditMode, editName]);

  useCatalogPageHeader({
    title: scrolledHeaderTitle,
    showBack: variant === 'app',
    onBack: goBack,
  }, variant === 'app');

  useEffect(() => {
    if (variant !== 'app') return undefined;
    const node = titleRef.current;
    if (!node) return undefined;

    const headerHeight = getComputedStyle(document.documentElement)
      .getPropertyValue('--header-height')
      .trim() || '72px';
    const observer = new IntersectionObserver(
      ([entry]) => setTitleInView(entry.isIntersecting),
      { root: null, rootMargin: `-${headerHeight} 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [variant, product?.id, productEditMode]);

  useEffect(() => {
    setTitleInView(true);
  }, [product?.id]);

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
    let active = true;
    void fetchCatalog()
      .then(data => {
        if (active) setCatalogCategories(data.categories ?? []);
      })
      .catch(() => {
        if (active) setCatalogCategories([]);
      });
    return () => {
      active = false;
    };
  }, [productId]);

  const spareClassificationCategories = useMemo((): CatalogCategory[] => {
    if (categoryOptions.length > 0) return categoryOptions;
    if (catalogCategories.length > 0) return catalogCategories;
    if (!product?.categoryId) return [];
    return [{
      id: product.categoryId,
      name: product.categoryName ?? '',
      productCount: 0,
      displayOrder: 0,
      thumbnailUrl: null,
    }];
  }, [categoryOptions, catalogCategories, product?.categoryId, product?.categoryName]);

  const isSpareItem = product
    ? isCatalogSparePartProduct(product, spareClassificationCategories)
    : false;
  const isCategorizedProduct = Boolean(
    product && hasCatalogCategory(product) && !isSpareItem,
  );

  useEffect(() => {
    if (!isSpareItem) {
      setSpareGroupOptions([]);
      return;
    }
    let active = true;
    void loadSpareGroups()
      .then(groups => {
        if (active) setSpareGroupOptions(groups);
      })
      .catch(() => {
        if (active) setSpareGroupOptions([]);
      });
    return () => {
      active = false;
    };
  }, [isSpareItem, productId]);

  useEffect(() => {
    if (!isCategorizedProduct) {
      setApprovalNumberOptions([]);
      return;
    }
    let active = true;
    void loadApprovalNumberOptions()
      .then(approvals => {
        if (active) setApprovalNumberOptions(approvals);
      })
      .catch(() => {
        if (active) setApprovalNumberOptions([]);
      });
    return () => {
      active = false;
    };
  }, [isCategorizedProduct, productId]);

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

  useEffect(() => {
    if (!showAuditedStock || !productId) {
      setNcDoc(null);
      return;
    }
    let active = true;
    void getCatalogProductNc(productId)
      .then(data => {
        if (active) setNcDoc(data);
      })
      .catch(() => {
        if (active) setNcDoc(null);
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
  const canEditHeadOffice = canEditCochin;

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
    const productUrls = (product?.imageUrls?.length
      ? product.imageUrls
      : (product?.imageUrl?.trim() ? [product.imageUrl.trim()] : [])
    ).filter(Boolean);
    const urls = [...productUrls];
    for (const url of warehousePhotoUrls) {
      if (url && !urls.includes(url)) urls.push(url);
    }
    return urls;
  }, [product?.imageUrl, product?.imageUrls, warehousePhotoUrls]);

  useEffect(() => {
    setActiveGalleryIndex(0);
    if (carouselRef.current) carouselRef.current.scrollLeft = 0;
  }, [galleryUrls]);

  const auditTotals = useMemo<InventoryAuditGroupTotals | null>(() => {
    if (!showAuditedStock || !product || auditItems.length === 0) return null;
    return calculateGroupTotals(auditItems, product);
  }, [showAuditedStock, product, auditItems]);

  const livePhysicalQty = useMemo(() => {
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

  const adjustedAudit = useMemo(
    () => resolveAdjustedAuditDisplay({
      currentZohoQty: product?.stock ?? null,
      snapshot: product?.auditSnapshot ?? null,
      livePhysicalQty,
    }),
    [product?.stock, product?.auditSnapshot, livePhysicalQty],
  );

  const summaryAuditedQty = showAuditedStock ? adjustedAudit.displayAuditedQty : null;
  const summaryDifference = showAuditedStock ? adjustedAudit.displayDifference : null;

  const auditedStockLabel = useMemo(() => {
    if (summaryAuditedQty == null) return null;
    if (
      adjustedAudit.hasAuditSnapshot
      && auditTotals?.mode === 'bundle'
      && activeInventorySites.length === 1
      && activeInventorySites[0] === 'head_office'
    ) {
      const physicalAtAudit = adjustedAudit.physicalQtyAtAudit ?? summaryAuditedQty;
      return `${physicalAtAudit} complete (${auditTotals.rawCountedQty} parts)`;
    }
    return formatStockQuantity(summaryAuditedQty, product?.unit ?? 'pcs');
  }, [
    summaryAuditedQty,
    adjustedAudit.hasAuditSnapshot,
    adjustedAudit.physicalQtyAtAudit,
    auditTotals,
    activeInventorySites,
    product?.unit,
  ]);

  const scrollToNcSection = useCallback((lineId?: string | null) => {
    setNcFocusLineId(lineId ?? null);
    setDetailTab('nc');
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        document.getElementById('product-detail-tab-panel-nc')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }, 50);
    });
  }, []);

  const handleDetailTabChange = useCallback((tab: ProductDetailTabId) => {
    if (tab !== 'nc') setNcFocusLineId(null);
    setDetailTab(tab);
  }, []);

  const summaryNcQty = showAuditedStock ? (ncDoc?.openNcQty ?? 0) : null;

  const ncExistingLocations = useMemo((): ProductNcExistingLocation[] => {
    const locations: ProductNcExistingLocation[] = [];
    for (const row of getCatalogSiteInventoryLocations(cochinRecord)) {
      const location = {
        site: 'cochin' as const,
        zoneId: row.zoneId.trim().toLowerCase(),
        zoneRowNumber: row.zoneRowNumber,
      };
      locations.push({
        key: ncLocationKey(location),
        site: 'cochin',
        label: formatNcLocationLabel(location),
        auditedQty: row.quantity,
        location,
      });
    }
    const headOffice = new Map<string, ProductNcExistingLocation>();
    for (const item of auditItems) {
      const location = {
        site: 'head_office' as const,
        rackId: item.rackId.trim().toLowerCase(),
        rowNumber: item.rowNumber,
        binNumber: item.binNumber,
      };
      const key = ncLocationKey(location);
      const existing = headOffice.get(key);
      if (existing) {
        existing.auditedQty += item.quantity ?? 0;
      } else {
        headOffice.set(key, {
          key,
          site: 'head_office',
          label: formatNcLocationLabel(location),
          auditedQty: item.quantity ?? 0,
          location,
        });
      }
    }
    locations.push(...headOffice.values());
    return locations;
  }, [cochinRecord, auditItems]);

  const summaryColumns = useMemo(() => {
    const cols: Array<{
      key: string;
      label: string;
      shortLabel: string;
      tone: 'zoho' | 'audited' | 'diff' | 'nc';
      diffState?: 'over' | 'under' | 'match';
    }> = [];

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
    if (showStockQuantity || showAuditedStock) {
      cols.push({ key: 'nc', label: 'NC', shortLabel: 'NC', tone: 'nc' });
    }
    return cols;
  }, [showStockQuantity, showAuditedStock, summaryDifference]);

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
      case 'nc':
        return summaryNcQty == null ? '0' : String(summaryNcQty);
      default:
        return null;
    }
  };


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
      const categories = catalog.categories ?? [];
      const pool = isCategorizedProduct
        ? getSparesForSpareMapping(catalog.items, categories)
        : getFinishedGoodsForSpareMapping(catalog.items, categories);
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

  const parseQuantity = useCallback((value: string) => Math.max(1, parseInt(value, 10) || 1), []);

  const bumpQuantity = useCallback((delta: number) => {
    setQuantityText(current => String(Math.max(1, parseQuantity(current) + delta)));
  }, [parseQuantity]);

  const commitQuantityText = useCallback(() => {
    setQuantityText(current => String(parseQuantity(current)));
  }, [parseQuantity]);

  useEffect(() => {
    setQuantityText('1');
  }, [productId]);

  const handleAddToCart = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!product || outOfStock) return;
    const quantity = parseQuantity(quantityText);
    setQuantityText(String(quantity));
    if (addItem(product, quantity)) {
      flyToCart(event.currentTarget, { imageUrl: product.imageUrl });
      setAddedFlash(true);
      window.setTimeout(() => setAddedFlash(false), 1500);
    }
  };

  const handleImagePick = async (
    event: React.ChangeEvent<HTMLInputElement>,
    mode: 'replace' | 'add' = 'replace',
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !product || !productEditMode || !editImages) return;

    setImageUploading(true);
    setImageError(null);
    try {
      const result = await uploadCatalogProductImage(product.id, file, mode);
      const syncedAt = new Date().toISOString();
      setProduct(prev => (prev ? {
        ...prev,
        imageUrl: result.imageUrl,
        imageUrls: result.imageUrls,
        imageDocs: result.imageDocs,
        syncedAt,
      } : prev));
      setActiveGalleryIndex(mode === 'add' ? Math.max(0, result.imageUrls.length - 1) : 0);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Could not upload image.');
    } finally {
      setImageUploading(false);
    }
  };

  const handleImageDelete = async () => {
    if (!product || !productEditMode || !editImages) return;

    const productUrlCount = (product.imageUrls?.length
      ? product.imageUrls.length
      : (product.imageUrl ? 1 : 0));
    if (productUrlCount <= 0) return;

    // Only delete product images (not warehouse audit slides appended after).
    const index = Math.min(activeGalleryIndex, productUrlCount - 1);
    const isPrimary = index === 0;
    const galleryDoc = !isPrimary
      ? product.imageDocs?.[index - 1]
      : undefined;

    const ok = await confirm({
      title: isPrimary ? 'Delete main photo?' : 'Delete gallery photo?',
      message: isPrimary
        ? 'This removes the main catalog photo from Zoho and the app. Other gallery photos stay. Warehouse audit photos are not affected.'
        : 'This removes this gallery photo from Zoho and the app. Warehouse audit photos are not affected.',
      confirmLabel: 'Delete photo',
      destructive: true,
    });
    if (!ok) return;

    setImageDeleting(true);
    setImageError(null);
    try {
      const result = await deleteCatalogProductImage(
        product.id,
        galleryDoc?.documentId ? { documentId: galleryDoc.documentId } : {},
      );
      const syncedAt = new Date().toISOString();
      setProduct(prev => (prev ? {
        ...prev,
        imageUrl: result.imageUrl,
        imageUrls: result.imageUrls,
        imageDocs: result.imageDocs,
        syncedAt,
      } : prev));
      setActiveGalleryIndex(0);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Could not delete image.');
    } finally {
      setImageDeleting(false);
    }
  };

  const imageBusy = imageUploading || imageDeleting || imageDownloading;

  const startProductEdit = () => {
    if (!product || !canEnterProductEdit) return;
    setEditName(product.name);
    setEditSku(product.sku ?? '');
    setEditRate(String(product.rate ?? ''));
    setEditMrpOverride(
      product.mrpOverride != null && Number(product.mrpOverride) > 0
        ? String(product.mrpOverride)
        : '',
    );
    setEditModelNumber(product.modelNumber ?? '');
    setEditApprovalNumber(product.approvalNumber ?? '');
    setEditSpareGroupId(product.spareGroupId ?? '');
    setEditCategoryId(product.categoryId ?? '');
    setDetailsError(null);
    setStatusError(null);
    setProductEditMode(true);
  };

  const cancelProductEdit = () => {
    setProductEditMode(false);
    setDetailsError(null);
    setStatusError(null);
    setEditName('');
    setEditSku('');
    setEditRate('');
    setEditMrpOverride('');
    setApplyingMrpEquation(false);
    setEditModelNumber('');
    setEditApprovalNumber('');
    setEditSpareGroupId('');
    setEditCategoryId('');
    setCategoryOptions([]);
    setModelNumberOptions([]);
    setApprovalNumberOptions([]);
    setSpareGroupOptions([]);
  };

  const applyMrpEquation = async () => {
    if (!product || detailsSaving || applyingMrpEquation) return;
    const rate = Number(editRate);
    if (!Number.isFinite(rate) || rate < 0) {
      setDetailsError('Enter a valid price before applying the MRP equation.');
      return;
    }
    setApplyingMrpEquation(true);
    setDetailsError(null);
    try {
      const rules = await loadMrpRules();
      const selected = categoryOptions.find(cat => cat.id === editCategoryId);
      const categories = categoryOptions.length > 0
        ? categoryOptions
        : spareClassificationCategories;
      const groupRule = resolveMrpGroupRule(
        {
          categoryId: editCategoryId || product.categoryId,
          categoryName: selected?.name ?? product.categoryName,
        },
        rules,
        categories,
      );
      const mrp = calculateProductMrpInclGst(rate, product.taxPercentage, groupRule);
      setEditMrpOverride(String(mrp));
    } catch (err) {
      setDetailsError(err instanceof Error ? err.message : 'Could not apply MRP equation.');
    } finally {
      setApplyingMrpEquation(false);
    }
  };

  useEffect(() => {
    if (!productEditMode || !canEditProductDetails) return;

    let active = true;
    setCategoriesLoading(true);
    setOptionListsLoading(true);
    void fetchCatalog()
      .then(data => {
        if (!active) return;
        const sorted = [...data.categories]
          .filter(cat => cat.id)
          .sort((a, b) => {
            const orderDiff = a.displayOrder - b.displayOrder;
            if (orderDiff !== 0) return orderDiff;
            return a.name.localeCompare(b.name);
          });
        setCategoryOptions(sorted);
      })
      .catch(() => {
        if (active) setCategoryOptions([]);
      })
      .finally(() => {
        if (active) setCategoriesLoading(false);
      });

    if (isCategorizedProduct) {
      void Promise.all([loadModelNumbers(), loadApprovalNumberOptions()])
        .then(([models, approvals]) => {
          if (!active) return;
          setModelNumberOptions(models);
          setApprovalNumberOptions(approvals);
        })
        .catch(() => {
          if (!active) return;
          setModelNumberOptions([]);
          setApprovalNumberOptions([]);
        })
        .finally(() => {
          if (active) setOptionListsLoading(false);
        });
    } else if (isSpareItem) {
      void loadSpareGroups()
        .then(groups => {
          if (!active) return;
          setSpareGroupOptions(groups);
        })
        .catch(() => {
          if (active) setSpareGroupOptions([]);
        })
        .finally(() => {
          if (active) setOptionListsLoading(false);
        });
    } else {
      setModelNumberOptions([]);
      setApprovalNumberOptions([]);
      setSpareGroupOptions([]);
      setOptionListsLoading(false);
    }

    return () => {
      active = false;
    };
  }, [productEditMode, canEditProductDetails, isCategorizedProduct, isSpareItem]);

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

    const rate = Number(editRate);
    if (!Number.isFinite(rate) || rate < 0) {
      setDetailsError('Price must be a valid number.');
      return;
    }

    let mrpOverride: number | null = null;
    const mrpRaw = editMrpOverride.trim();
    if (mrpRaw) {
      const mrp = Number(mrpRaw);
      if (!Number.isFinite(mrp) || mrp < 0) {
        setDetailsError('MRP must be a valid number (or leave blank).');
        return;
      }
      mrpOverride = mrp === 0 ? null : Math.round(mrp * 100) / 100;
    }

    // Model / approval are shop products only. Spare group is spares only.
    const modelNumber = isCategorizedProduct
      ? (editModelNumber.trim() || null)
      : undefined;
    const approvalNumber = isCategorizedProduct
      ? (editApprovalNumber.trim() || null)
      : undefined;
    const spareGroupId = isSpareItem
      ? (editSpareGroupId.trim() || null)
      : undefined;

    const nextCategoryId = editCategoryId.trim();
    const categoryChanged = nextCategoryId !== (product.categoryId ?? '');
    let nextCategoryName = product.categoryName ?? null;

    if (categoryChanged) {
      if (!nextCategoryId) {
        setDetailsError('Category is required.');
        return;
      }
      const selected = categoryOptions.find(cat => cat.id === nextCategoryId);
      if (!selected) {
        setDetailsError('Select a valid category.');
        return;
      }
      nextCategoryName = selected.name;
    }

    const roundedRate = Math.round(rate * 100) / 100;
    const prevMrp = product.mrpOverride != null && Number(product.mrpOverride) > 0
      ? Math.round(Number(product.mrpOverride) * 100) / 100
      : null;
    const zohoFieldsChanged = name !== product.name
      || sku !== (product.sku ?? '')
      || roundedRate !== Number(product.rate ?? 0)
      || mrpOverride !== prevMrp;
    const overlayFieldsChanged = (
      modelNumber !== undefined
      && modelNumber !== (product.modelNumber ?? null)
    ) || (
      approvalNumber !== undefined
      && approvalNumber !== (product.approvalNumber ?? null)
    ) || (
      spareGroupId !== undefined
      && spareGroupId !== (product.spareGroupId ?? null)
    );

    if (!zohoFieldsChanged && !overlayFieldsChanged && !categoryChanged) {
      setProductEditMode(false);
      return;
    }

    setDetailsSaving(true);
    setDetailsError(null);
    try {
      if (categoryChanged && nextCategoryId && nextCategoryName) {
        await assignProductCategory(product.id, nextCategoryId, nextCategoryName);
      }

      const applyOverlayLocally = (
        overlays: {
          modelNumber?: string | null;
          approvalNumber?: string | null;
          spareGroupId?: string | null;
        },
      ) => {
        setProduct(prev => (
          prev
            ? {
                ...prev,
                ...(modelNumber !== undefined
                  ? { modelNumber: overlays.modelNumber ?? modelNumber }
                  : {}),
                ...(approvalNumber !== undefined
                  ? { approvalNumber: overlays.approvalNumber ?? approvalNumber }
                  : {}),
                ...(spareGroupId !== undefined
                  ? { spareGroupId: overlays.spareGroupId ?? spareGroupId }
                  : {}),
                syncedAt: new Date().toISOString(),
                ...(categoryChanged
                  ? { categoryId: nextCategoryId, categoryName: nextCategoryName }
                  : {}),
              }
            : prev
        ));
      };

      if (zohoFieldsChanged) {
        try {
          const saved = await updateCatalogProductDetails(product.id, {
            name,
            sku,
            rate: roundedRate,
            mrpOverride,
            ...(modelNumber !== undefined ? { modelNumber } : {}),
            ...(approvalNumber !== undefined ? { approvalNumber } : {}),
          });
          const syncedAt = new Date().toISOString();
          setProduct(prev => (
            prev
              ? {
                  ...prev,
                  name: saved.name,
                  sku: saved.sku,
                  rate: saved.rate ?? roundedRate,
                  mrpOverride: saved.mrpOverride ?? mrpOverride,
                  ...(modelNumber !== undefined
                    ? { modelNumber: saved.modelNumber ?? modelNumber }
                    : {}),
                  ...(approvalNumber !== undefined
                    ? { approvalNumber: saved.approvalNumber ?? approvalNumber }
                    : {}),
                  syncedAt,
                  ...(categoryChanged
                    ? { categoryId: nextCategoryId, categoryName: nextCategoryName }
                    : {}),
                }
              : prev
          ));
        } catch (zohoErr) {
          // Zoho rate-limit / outage: still persist Firebase-only fields.
          if (overlayFieldsChanged) {
            const overlays = await updateCatalogProductOverlays(product.id, {
              ...(modelNumber !== undefined ? { modelNumber } : {}),
              ...(approvalNumber !== undefined ? { approvalNumber } : {}),
              ...(spareGroupId !== undefined ? { spareGroupId } : {}),
            });
            applyOverlayLocally(overlays);
            setDetailsError(
              `${zohoErr instanceof Error ? zohoErr.message : 'Zoho update failed.'} `
              + 'App-only fields were saved.',
            );
            setModelNumberOptions([]);
            setApprovalNumberOptions([]);
            setSpareGroupOptions([]);
            return;
          }
          throw zohoErr;
        }
      } else if (overlayFieldsChanged) {
        const overlays = await updateCatalogProductOverlays(product.id, {
          ...(modelNumber !== undefined ? { modelNumber } : {}),
          ...(approvalNumber !== undefined ? { approvalNumber } : {}),
          ...(spareGroupId !== undefined ? { spareGroupId } : {}),
        });
        applyOverlayLocally(overlays);
      } else if (categoryChanged) {
        setProduct(prev => (
          prev
            ? {
                ...prev,
                categoryId: nextCategoryId,
                categoryName: nextCategoryName,
                syncedAt: new Date().toISOString(),
              }
            : prev
        ));
      }

      setProductEditMode(false);
      setEditCategoryId('');
      setCategoryOptions([]);
      setModelNumberOptions([]);
      setApprovalNumberOptions([]);
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
    if (!product || !canSetInactive || !productEditMode || statusUpdating) return;

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
        {variant === 'public' && (
          <button type="button" className="product-detail-page__back" onClick={goBack}>
            <ArrowLeft size={18} />
            <span>{backLabel}</span>
          </button>
        )}
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
      {variant === 'public' && (
        <button type="button" className="product-detail-page__back" onClick={goBack}>
          <ArrowLeft size={18} />
          <span>{backLabel}</span>
        </button>
      )}

      <div className="product-detail-page__layout">
        <div className="product-detail-page__hero">
          <section className="product-detail-page__gallery">
            <div
              className={[
                'product-detail-page__image-stage',
                galleryUrls.length > 1 ? 'product-detail-page__image-stage--carousel' : '',
                canEnterProductEdit ? 'product-detail-page__image-stage--editable' : '',
                productEditMode ? 'product-detail-page__image-stage--editing' : '',
              ].filter(Boolean).join(' ')}
            >
              {showStockQuantity && (
                <StockBadge status={product.stockStatus} overlay variant="tile" />
              )}
              <div className="product-detail-page__hero-actions">
                {!productEditMode && (
                  <button
                    type="button"
                    className="product-detail-page__edit-details-btn product-detail-page__whatsapp-btn"
                    title="Share product image"
                    aria-label="Share product image"
                    onClick={() => setWhatsappShareOpen(true)}
                  >
                    <Share2 size={16} />
                  </button>
                )}
                {canEnterProductEdit && (
                  <button
                    type="button"
                    className={[
                      'product-detail-page__edit-details-btn',
                      productEditMode ? 'is-active' : '',
                    ].filter(Boolean).join(' ')}
                    title={productEditMode ? 'Done editing' : (canEditProductDetails ? 'Edit item details' : 'Edit product image')}
                    aria-label={productEditMode ? 'Done editing' : (canEditProductDetails ? 'Edit item details' : 'Edit product image')}
                    aria-pressed={productEditMode}
                    onClick={() => (productEditMode ? cancelProductEdit() : startProductEdit())}
                  >
                    {productEditMode ? <X size={16} aria-hidden /> : <Pencil size={16} aria-hidden />}
                  </button>
                )}
              </div>
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
              {productEditMode && editImages && (
                <div className="product-detail-page__image-actions">
                  {galleryUrls.length > 0 && (
                    <button
                      type="button"
                      className="product-detail-page__image-action"
                      title="Download photo"
                      aria-label="Download photo"
                      disabled={imageBusy}
                      onClick={() => void handleImageDownload()}
                    >
                      {imageDownloading
                        ? <RefreshCw size={18} className="spin-icon" aria-hidden />
                        : <Download size={18} aria-hidden />}
                    </button>
                  )}
                  <button
                    type="button"
                    className="product-detail-page__image-action"
                    title="Replace main photo"
                    aria-label="Replace main photo"
                    disabled={imageBusy}
                    onClick={() => imageInputRef.current?.click()}
                  >
                    {imageUploading
                      ? <RefreshCw size={18} className="spin-icon" aria-hidden />
                      : <Upload size={18} aria-hidden />}
                  </button>
                  <button
                    type="button"
                    className="product-detail-page__image-action"
                    title="Add photo"
                    aria-label="Add photo"
                    disabled={imageBusy}
                    onClick={() => addImageInputRef.current?.click()}
                  >
                    <ImagePlus size={18} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="product-detail-page__image-action"
                    title="Capture and add photo"
                    aria-label="Capture and add photo"
                    disabled={imageBusy}
                    onClick={() => captureInputRef.current?.click()}
                  >
                    <Camera size={18} aria-hidden />
                  </button>
                  {galleryUrls.length > 0 && (
                    <button
                      type="button"
                      className="product-detail-page__image-action product-detail-page__image-action--danger"
                      title="Delete current photo"
                      aria-label="Delete current photo"
                      disabled={imageBusy}
                      onClick={() => void handleImageDelete()}
                    >
                      {imageDeleting
                        ? <RefreshCw size={18} className="spin-icon" aria-hidden />
                        : <Trash2 size={18} aria-hidden />}
                    </button>
                  )}
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="product-detail-page__image-input"
                    aria-label="Replace main photo"
                    onChange={e => void handleImagePick(e, 'replace')}
                  />
                  <input
                    ref={addImageInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="product-detail-page__image-input"
                    aria-label="Add photo"
                    onChange={e => void handleImagePick(e, 'add')}
                  />
                  <input
                    ref={captureInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="product-detail-page__image-input"
                    aria-label="Capture and add photo"
                    onChange={e => void handleImagePick(e, 'add')}
                  />
                </div>
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

            <div className="product-detail-page__title-row">
              <h1 ref={titleRef} className="product-detail-page__title">
                {productEditMode && canEditProductDetails ? (
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
              {!productEditMode && (canEditProductDetails || showAuditedStock) && (
                <button
                  type="button"
                  className="product-detail-page__title-print"
                  title="Print product label"
                  aria-label={
                    isCategorizedProduct
                      ? 'Print product label'
                      : 'Print Genuine Spare product label'
                  }
                  onClick={() => {
                    void productPackLabelFieldsFromCatalog(product, user?.displayName).then(
                      setPrintLabelFields,
                    );
                  }}
                >
                  <Printer size={16} aria-hidden />
                </button>
              )}
              {!productEditMode && (showStockQuantity || showCartActions) && (
                <div className="product-detail-page__title-price" aria-label="Dealer price">
                  <div className="product-detail-page__title-price-amount">
                    <IndianRupee size={16} strokeWidth={2.5} aria-hidden />
                    <span>{formatCurrencyWhole(product.rate).replace('₹', '').trim()}</span>
                  </div>
                  <span className="product-detail-page__title-price-gst">+GST</span>
                </div>
              )}
              {productEditMode && canEditProductDetails && (
                <label className="product-detail-page__title-price product-detail-page__title-price--edit">
                  <span className="product-detail-page__sku-label">Price</span>
                  <div className="product-detail-page__title-price-amount">
                    <IndianRupee size={16} strokeWidth={2.5} aria-hidden />
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      className="product-detail-page__rate-input"
                      value={editRate}
                      onChange={e => setEditRate(e.target.value)}
                      disabled={detailsSaving}
                      aria-label="Dealer price"
                    />
                  </div>
                  <span className="product-detail-page__title-price-gst">+GST</span>
                </label>
              )}
            </div>

            {(product.sku || (productEditMode && canEditProductDetails)) && (
              productEditMode && canEditProductDetails ? (
                <div className="product-detail-page__sku-mrp-row">
                  <label className="product-detail-page__sku-field">
                    <span className="product-detail-page__sku-label">SKU</span>
                    <input
                      type="text"
                      className="product-detail-page__sku-input"
                      value={editSku}
                      onChange={e => setEditSku(e.target.value)}
                      disabled={detailsSaving}
                      aria-label="Item SKU"
                    />
                  </label>
                  <div className="product-detail-page__title-price product-detail-page__title-price--edit">
                    <div className="product-detail-page__mrp-heading">
                      <span className="product-detail-page__sku-label">MRP</span>
                      <button
                        type="button"
                        className="product-detail-page__mrp-equation-link"
                        disabled={detailsSaving || applyingMrpEquation}
                        onClick={() => void applyMrpEquation()}
                        title="Fill MRP from Product settings equation for this product or spare"
                      >
                        {applyingMrpEquation ? 'Applying…' : 'Apply equation'}
                      </button>
                    </div>
                    <label className="product-detail-page__title-price-amount">
                      <IndianRupee size={16} strokeWidth={2.5} aria-hidden />
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        className="product-detail-page__rate-input"
                        value={editMrpOverride}
                        onChange={e => setEditMrpOverride(e.target.value)}
                        disabled={detailsSaving || applyingMrpEquation}
                        aria-label="MRP"
                      />
                    </label>
                  </div>
                </div>
              ) : (
                <p className="product-detail-page__sku">SKU: {product.sku}</p>
              )
            )}

            {productEditMode && canEditProductDetails && (
              <label className="product-detail-page__sku-field product-detail-page__category-field">
                <span className="product-detail-page__sku-label">Category</span>
                <select
                  className="product-detail-page__category-select"
                  value={editCategoryId}
                  onChange={e => setEditCategoryId(e.target.value)}
                  disabled={detailsSaving || categoriesLoading}
                  aria-label="Item category"
                >
                  <option value="">
                    {categoriesLoading ? 'Loading categories…' : 'Select category'}
                  </option>
                  {categoryOptions.map(cat => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {productEditMode && canEditProductDetails && (isCategorizedProduct || isSpareItem) && (
              <div className="product-detail-page__extra-fields">
                {isCategorizedProduct && (
                  <>
                    <label className="product-detail-page__sku-field">
                      <span className="product-detail-page__sku-label">Model number</span>
                      <select
                        className="product-detail-page__category-select"
                        value={editModelNumber}
                        onChange={e => setEditModelNumber(e.target.value)}
                        disabled={detailsSaving || optionListsLoading}
                        aria-label="Model number"
                      >
                        <option value="">
                          {optionListsLoading ? 'Loading…' : 'None'}
                        </option>
                        {modelNumberOptions.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                        {editModelNumber
                          && !modelNumberOptions.includes(editModelNumber) && (
                          <option value={editModelNumber}>{editModelNumber}</option>
                        )}
                      </select>
                    </label>
                    <label className="product-detail-page__sku-field">
                      <span className="product-detail-page__sku-label">Approval number</span>
                      <select
                        className="product-detail-page__category-select"
                        value={editApprovalNumber}
                        onChange={e => setEditApprovalNumber(e.target.value)}
                        disabled={detailsSaving || optionListsLoading}
                        aria-label="Approval number"
                      >
                        <option value="">
                          {optionListsLoading ? 'Loading…' : 'None'}
                        </option>
                        {approvalNumberOptions.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.value}</option>
                        ))}
                        {editApprovalNumber
                          && !approvalNumberOptions.some(opt => opt.value === editApprovalNumber) && (
                          <option value={editApprovalNumber}>{editApprovalNumber}</option>
                        )}
                      </select>
                      {(() => {
                        const selected = approvalNumberOptions.find(
                          opt => opt.value === editApprovalNumber,
                        );
                        if (!selected?.pdfUrl) return null;
                        return (
                          <a
                            href={selected.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="product-detail-page__approval-pdf-link"
                          >
                            <FileText size={14} aria-hidden />
                            {selected.pdfFileName || 'View approval PDF'}
                          </a>
                        );
                      })()}
                    </label>
                  </>
                )}
                {isSpareItem && (
                  <label className="product-detail-page__sku-field">
                    <span className="product-detail-page__sku-label">Spare group</span>
                    <select
                      className="product-detail-page__category-select"
                      value={editSpareGroupId}
                      onChange={e => setEditSpareGroupId(e.target.value)}
                      disabled={detailsSaving || optionListsLoading}
                      aria-label="Spare group"
                    >
                      <option value="">
                        {optionListsLoading ? 'Loading…' : 'Unassigned'}
                      </option>
                      {spareGroupOptions.map(opt => (
                        <option key={opt.id} value={opt.id}>{opt.name}</option>
                      ))}
                      {editSpareGroupId
                        && !spareGroupOptions.some(opt => opt.id === editSpareGroupId) && (
                        <option value={editSpareGroupId}>{editSpareGroupId}</option>
                      )}
                    </select>
                  </label>
                )}
              </div>
            )}

            {!productEditMode && (
              <div className="product-detail-page__meta-chips">
                {product.mrpOverride != null && Number(product.mrpOverride) > 0 && (
                  <p className="product-detail-page__sku">
                    MRP: ₹ {Number(product.mrpOverride).toFixed(2)}
                  </p>
                )}
                {isCategorizedProduct && product.modelNumber && (
                  <p className="product-detail-page__sku">Model: {product.modelNumber}</p>
                )}
                {isCategorizedProduct && product.approvalNumber && (
                  <p className="product-detail-page__sku">
                    Approval: {product.approvalNumber}
                    {(() => {
                      const selected = approvalNumberOptions.find(
                        opt => opt.value === product.approvalNumber,
                      );
                      if (!selected?.pdfUrl) return null;
                      return (
                        <>
                          {' · '}
                          <a
                            href={selected.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="product-detail-page__approval-pdf-link"
                          >
                            PDF
                          </a>
                        </>
                      );
                    })()}
                  </p>
                )}
                {isSpareItem && (
                  <p className="product-detail-page__sku">
                    Group:{' '}
                    {spareGroupOptions.find(g => g.id === product.spareGroupId)?.name
                      || product.spareGroupId
                      || 'Unassigned'}
                  </p>
                )}
              </div>
            )}

            {productEditMode && canEditProductDetails && (
              <>
                {detailsError && (
                  <p className="product-detail-page__details-error text-sm">{detailsError}</p>
                )}
                {statusError && (
                  <p className="product-detail-page__status-error text-sm">{statusError}</p>
                )}
                <div className="product-detail-page__details-edit-actions">
                  <div className="product-detail-page__details-edit-actions-row">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm product-detail-page__details-edit-save"
                      disabled={detailsSaving || imageBusy || categoriesLoading}
                      onClick={() => void handleSaveProductDetails()}
                    >
                      {detailsSaving
                        ? <RefreshCw size={15} className="spin-icon" aria-hidden />
                        : <Save size={15} aria-hidden />}
                      {detailsSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm product-detail-page__details-edit-cancel"
                      disabled={detailsSaving || imageBusy}
                      onClick={cancelProductEdit}
                    >
                      Cancel
                    </button>
                  </div>
                  {canSetInactive && (isCategorizedProduct || isSpareItem) && (
                    <button
                      type="button"
                      className="btn btn-sm product-detail-page__inactive-btn product-detail-page__details-edit-inactive"
                      onClick={() => void handleSetInactive()}
                      disabled={statusUpdating || detailsSaving || imageBusy}
                    >
                      {statusUpdating
                        ? <RefreshCw size={15} className="spin-icon" aria-hidden />
                        : <Ban size={15} aria-hidden />}
                      Set inactive on Zoho
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        </div>

        <section className="product-detail-page__main">
          {summaryColumns.length > 0 && (
            <div className="product-detail-page__summary-panel">
              <div
                className="product-detail-page__summary-table"
                style={{ '--stock-cols': summaryColumns.length } as React.CSSProperties}
                role="table"
                aria-label="Stock summary"
              >
                <div className="product-detail-page__summary-stock-labels" role="row">
                  {summaryColumns.map(col => (
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
                  {summaryColumns.map(col => (
                    <div
                      key={col.key}
                      role="cell"
                      className={[
                        'product-detail-page__summary-cell',
                        'product-detail-page__summary-cell--value',
                        `product-detail-page__summary-cell--${col.tone}`,
                        col.diffState ? `is-${col.diffState}` : '',
                        col.key === 'nc' && showAuditedStock ? 'product-detail-page__summary-cell--nc-action' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={col.key === 'nc' && showAuditedStock ? () => scrollToNcSection() : undefined}
                      onKeyDown={col.key === 'nc' && showAuditedStock ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          scrollToNcSection();
                        }
                      } : undefined}
                      tabIndex={col.key === 'nc' && showAuditedStock ? 0 : undefined}
                      title={col.key === 'nc' ? 'Open Non-Conformance' : undefined}
                    >
                      {renderStockValue(col.key)}
                    </div>
                  ))}
                </div>
              </div>

              {loading && showStockQuantity && (
                <p className="product-detail-page__loading-note">Updating Zoho stock…</p>
              )}
            </div>
          )}

          {showAuditedStock && activeInventorySites.length > 0 && product && (
            <div className="product-detail-page__stock-locations product-detail-page__stock-locations--summary">
              {activeInventorySites.map(site => (
                <ProductSiteStockLocations
                  key={site}
                  product={product as CatalogProductDetail}
                  siteConfig={CATALOG_INVENTORY_SITE_CONFIG[site]}
                  auditItems={site === 'head_office' ? auditItems : []}
                  cochinRecord={site === 'cochin' ? cochinRecord : null}
                  canEditCochin={canEditCochin}
                  canEditHeadOffice={canEditHeadOffice}
                  editorUid={user?.uid ?? ''}
                  editorName={user?.displayName}
                  onCochinSaved={setCochinRecord}
                  onHeadOfficeSaved={setAuditItems}
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
                  onClick={() => bumpQuantity(-1)}
                  disabled={parseQuantity(quantityText) <= 1}
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="product-detail-page__qty-input"
                  value={quantityText}
                  onChange={e => {
                    const value = e.target.value;
                    if (value === '' || /^\d+$/.test(value)) {
                      setQuantityText(value);
                    }
                  }}
                  onBlur={commitQuantityText}
                  onFocus={e => e.target.select()}
                  aria-label="Quantity"
                />
                <button
                  type="button"
                  className="product-detail-page__qty-btn"
                  onClick={() => bumpQuantity(1)}
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

          {showAuditedStock && (
            <ProductOpenNcTile
              product={product}
              categories={spareClassificationCategories}
              ncDoc={ncDoc}
              existingLocations={ncExistingLocations}
              canAdd={canEditCochin}
              actorUid={user?.uid ?? ''}
              actorName={user?.displayName}
              onNcChange={setNcDoc}
              onOpenNcTab={scrollToNcSection}
            />
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

          {variant !== 'public' && product && (
            <div className="product-detail-page__tabbed-area">
            {showAuditedStock && !isSpareDetail && !isSpareItem && (
              <ProductPackageInfo
                product={product}
                packageInfo={product.packageInfo}
                canEdit={canEditProductDetails}
                onPackageInfoChange={info => {
                  setProduct(prev => (prev ? { ...prev, packageInfo: info } : prev));
                }}
              />
            )}
            <ProductDetailTabs
              product={product}
              activeTab={detailTab}
              onActiveTabChange={handleDetailTabChange}
              visibleTabs={
                visibleTabs
                ?? (showCartActions ? DEALER_PRODUCT_DETAIL_TABS : undefined)
              }
              showSpareTab={showLinksSection && (isCategorizedProduct || isSpareItem)}
              showAuditTab={showAuditedStock}
              showNcTab={showAuditedStock}
              ncCategories={spareClassificationCategories}
              canEditNc={canEditCochin}
              canWipeNc={user?.role === 'super_admin'}
              ncActorUid={user?.uid ?? ''}
              ncActorName={user?.displayName}
              ncExistingLocations={ncExistingLocations}
              onNcChange={setNcDoc}
              ncFocusLineId={ncFocusLineId}
              relatedItems={relatedItems}
              relatedKind={relatedKind}
              relatedLoading={relatedLoading}
              linkError={linkError}
              manageSpareLinks={manageSpareLinks}
              showStockQuantity={showStockQuantity}
              showCartActions={showCartActions}
              productsBasePath={productsBasePath ?? backPath}
              sparesBasePath={sparesBasePath ?? `${backPath}/spare`}
              onOpenLinkEditor={() => void openLinkEditor()}
              relatedLinkState={relatedLinkState}
              livePhysicalQty={livePhysicalQty}
              canEditProductDetails={canEditProductDetails}
              canWriteMedia={canWriteMedia}
              mediaActorUid={mediaActorUid}
              mediaActorName={mediaActorName}
              onAuditSnapshotChange={snapshot => {
                setProduct(prev => (prev ? { ...prev, auditSnapshot: snapshot } : prev));
              }}
            />
            </div>
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

      {printLabelFields && (
        <BinLabelPrintDialog
          fields={printLabelFields}
          layoutId={isCategorizedProduct ? 'catalog-product' : 'genuine-spare-product'}
          onClose={() => setPrintLabelFields(null)}
        />
      )}

      {whatsappShareOpen && product && (
        <ProductWhatsAppShareDialog
          product={product}
          imageUrl={currentGalleryUrl}
          imageIndex={activeGalleryIndex}
          imageCount={Math.max(1, galleryUrls.length)}
          onClose={() => setWhatsappShareOpen(false)}
        />
      )}
    </div>
  );
};
