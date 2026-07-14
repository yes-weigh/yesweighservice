import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Boxes, ClipboardList, LayoutGrid, Layers, QrCode, RefreshCw, Rows3, Search, SlidersHorizontal, X } from 'lucide-react';
import { CatalogSparesFilterSheet } from '../../components/catalog/CatalogSparesFilterSheet';
import { CatalogBrowse } from '../../components/catalog/CatalogBrowse';
import { CatalogUnifiedResults } from '../../components/catalog/CatalogUnifiedResults';
import { SpareGroupingView } from '../../components/catalog/SpareGroupingView';
import { SparePartsRackView } from '../../components/catalog/SparePartsRackView';
import { SpareSkuQrScanner } from '../../components/catalog/SpareSkuQrScanner';
import { SpareLinkEditor } from '../../components/catalog/SpareLinkEditor';
import { WarehouseInventoryAuditList } from '../../components/yesStore/WarehouseInventoryAuditList';
import { InventoryAuditBatchLinkModal } from '../../components/yesStore/InventoryAuditBatchLinkModal';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useCatalogPageHeader, usePageHeaderSlot, useTopBarAction } from '../../context/PageHeaderContext';
import { canViewCatalogStock } from '../../lib/dealerAccess';
import { hasStaffPermission } from '../../lib/staffAccess';
import {
  excludeHiddenCatalogProducts,
  fetchCatalog,
  fetchCatalogSpareLinks,
  fetchSpareLinkIndex,
  getFinishedGoodsForSpareMapping,
  getShopCatalogProducts,
  getShopCatalogCategories,
  getBrowseCatalogProducts,
  getCategoriesForProducts,
  getCatalogSparePartsPool,
  getUnlinkedSpares,
  isSparesExcludedCategory,
  matchesSpareCatalogFilters,
  matchesCategorizedProductFilters,
  matchesSpareLocationFilters,
  matchesSpareAuditStatusFilters,
  matchesSpareStockStatusFilters,
  matchesNcStatusFilters,
  buildCochinAuditedCatalogProductIds,
  buildHeadOfficeAuditedCatalogProductIds,
  catalogProductIsAudited,
  catalogProductAuditVariance,
  catalogProductHasImage,
  catalogProductHasWarehouseStock,
  catalogProductHasPositiveStock,
  catalogProductHasZeroStock,
  catalogProductHasNegativeStock,
  matchesMediaProductFilters,
  MEDIA_PRODUCT_FILTERS,
  type SpareCatalogFilter,
  type CategorizedProductFilter,
  type MediaProductFilter,
  type SpareAuditStatusFilter,
  type SpareStockStatusFilter,
  type SpareWarehouseLocationFilter,
  type NcStatusFilter,
  saveCatalogCategoryOrder,
  saveCatalogCategoryProductOrder,
  applyCategoryProductDisplayOrder,
  saveCatalogSpareProductLinks,
  syncCatalog,
  uploadCatalogCategoryThumbnail,
} from '../../lib/catalog';
import { listAllItems, fetchDisplayNamesForUids, batchUnlinkYesStoreItemsFromCatalog } from '../../lib/yesStore/data';
import { listCochinSiteInventory } from '../../lib/catalogSiteInventory/data';
import { buildAuditedLocationByProductId } from '../../lib/catalogAuditedLocations';
import { listCatalogProductNcSummaries } from '../../lib/catalogNc/data';
import { listCatalogProductIdsWithMediaFiles } from '../../lib/catalogMedia/data';
import type { CatalogSiteInventoryDoc } from '../../types/catalog-site-inventory';
import { reconcileCatalogAuditImagesOnZoho } from '../../lib/yesStore/syncAuditImages';
import { readItemLinkedByName, readItemLinkedByUid, type InventoryAuditLinkedGroup } from '../../lib/yesStore/inventoryAudit';
import { canUseCart } from '../../types';
import type { CatalogCategory, CatalogProduct, CatalogResponse } from '../../types/catalog';
import type { YesStoreItemDoc } from '../../types/yes-store';

type CatalogFocus =
  | 'browse'
  | 'search'
  | 'all-spares'
  | 'unlinked'
  | 'map'
  | 'inventory-audit'
  | 'spare-grouping';

type AdminCatalogSection = 'categories' | 'spares' | 'inventory-audit' | 'spare-grouping';

function parseCatalogFocus(
  section: string | null,
  query: string,
  canSync: boolean,
): CatalogFocus {
  if (section === 'inventory-audit') return 'inventory-audit';
  if (section === 'spare-grouping') return 'spare-grouping';
  if (section === 'spares') return 'all-spares';
  if (section === 'unlinked' && canSync) return 'unlinked';
  if (section === 'map' && canSync) return 'map';
  if (query.trim()) return 'search';
  return 'browse';
}

function parseAdminSection(
  section: string | null,
  query: string,
): AdminCatalogSection | 'search' {
  if (section === 'spares') return 'spares';
  if (section === 'inventory-audit') return 'inventory-audit';
  if (section === 'spare-grouping') return 'spare-grouping';
  if (query.trim()) return 'search';
  return 'categories';
}

function adminSectionToFocus(section: AdminCatalogSection | 'search'): CatalogFocus {
  if (section === 'search') return 'search';
  if (section === 'spares') return 'all-spares';
  if (section === 'inventory-audit') return 'inventory-audit';
  if (section === 'spare-grouping') return 'spare-grouping';
  return 'browse';
}

const FOCUS_LABELS: Record<CatalogFocus, string> = {
  browse: 'Categories',
  search: 'Search results',
  'all-spares': 'Spare parts',
  unlinked: 'Unlinked spares',
  map: 'Map spares to products',
  'inventory-audit': 'Inventory audit',
  'spare-grouping': 'Spare grouping',
};

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= breakpoint);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= breakpoint);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);
  return isMobile;
}

export const CatalogPage: React.FC = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const confirm = useConfirm();
  const isSuperAdmin = user?.role === 'super_admin';
  const isStaff = user?.role === 'staff';
  const isMedia = user?.role === 'media';
  const isMobile = useIsMobile();
  const canSync = user?.role === 'super_admin' || hasStaffPermission(user, 'catalog.sync');
  const canSpareGroup = isSuperAdmin || isStaff;
  const showStockQuantity = canSync || canViewCatalogStock(user);
  const showAuditedLocations = isSuperAdmin || isStaff;

  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [linkedSpareIds, setLinkedSpareIds] = useState<Set<string> | null>(null);
  const [spareCountByProductId, setSpareCountByProductId] = useState<Map<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [linksLoading, setLinksLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  const [linkEditorSpare, setLinkEditorSpare] = useState<CatalogProduct | null>(null);
  const [linkEditorProductIds, setLinkEditorProductIds] = useState<string[]>([]);
  const [linkEditorSaving, setLinkEditorSaving] = useState(false);
  const [auditItems, setAuditItems] = useState<YesStoreItemDoc[]>([]);
  const [cochinInventory, setCochinInventory] = useState<CatalogSiteInventoryDoc[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditAuditorNames, setAuditAuditorNames] = useState<Map<string, string>>(new Map());
  const [batchLinkItems, setBatchLinkItems] = useState<YesStoreItemDoc[] | null>(null);
  const [unlinkingGroupId, setUnlinkingGroupId] = useState<string | null>(null);
  const [spareCatalogFilters, setSpareCatalogFilters] = useState<Set<SpareCatalogFilter>>(() => new Set());
  const [spareStockStatusFilters, setSpareStockStatusFilters] = useState<Set<SpareStockStatusFilter>>(() => new Set());
  const [spareLocationFilters, setSpareLocationFilters] = useState<Set<SpareWarehouseLocationFilter>>(() => new Set());
  const [spareAuditStatusFilters, setSpareAuditStatusFilters] = useState<Set<SpareAuditStatusFilter>>(() => new Set());
  const [sparesFiltersOpen, setSparesFiltersOpen] = useState(false);
  const [spareViewMode, setSpareViewMode] = useState<'items' | 'rack'>('items');
  const [spareQrScannerOpen, setSpareQrScannerOpen] = useState(false);
  const [productCatalogFilters, setProductCatalogFilters] = useState<Set<CategorizedProductFilter>>(() => new Set());
  const [productStockStatusFilters, setProductStockStatusFilters] = useState<Set<SpareStockStatusFilter>>(() => new Set());
  const [productAuditStatusFilters, setProductAuditStatusFilters] = useState<Set<SpareAuditStatusFilter>>(() => new Set());
  const [productNcStatusFilters, setProductNcStatusFilters] = useState<Set<NcStatusFilter>>(() => new Set());
  const [productsFiltersOpen, setProductsFiltersOpen] = useState(false);
  const [openNcQtyByProductId, setOpenNcQtyByProductId] = useState<Map<string, number>>(new Map());
  const [mediaProductFilters, setMediaProductFilters] = useState<Set<MediaProductFilter>>(() => new Set());
  const [productIdsWithMedia, setProductIdsWithMedia] = useState<Set<string>>(() => new Set());
  const [mediaIndexLoading, setMediaIndexLoading] = useState(false);

  const applySpareFilters = useCallback(
    (
      catalogFilters: Set<SpareCatalogFilter | CategorizedProductFilter>,
      stockStatusFilters: Set<SpareStockStatusFilter>,
      locationFilters: Set<SpareWarehouseLocationFilter>,
      auditStatusFilters: Set<SpareAuditStatusFilter>,
      _ncStatusFilters: Set<NcStatusFilter>,
    ) => {
      setSpareCatalogFilters(new Set([...catalogFilters] as SpareCatalogFilter[]));
      setSpareStockStatusFilters(new Set(stockStatusFilters));
      setSpareLocationFilters(new Set(locationFilters));
      setSpareAuditStatusFilters(new Set(auditStatusFilters));
    },
    [],
  );

  const applyProductFilters = useCallback(
    (
      catalogFilters: Set<SpareCatalogFilter | CategorizedProductFilter>,
      stockStatusFilters: Set<SpareStockStatusFilter>,
      _locationFilters: Set<SpareWarehouseLocationFilter>,
      auditStatusFilters: Set<SpareAuditStatusFilter>,
      ncStatusFilters: Set<NcStatusFilter>,
    ) => {
      setProductCatalogFilters(new Set([...catalogFilters] as CategorizedProductFilter[]));
      setProductStockStatusFilters(new Set(stockStatusFilters));
      setProductAuditStatusFilters(new Set(auditStatusFilters));
      setProductNcStatusFilters(new Set(ncStatusFilters));
    },
    [],
  );

  const sectionParam = searchParams.get('section');
  const categoryFromUrl = searchParams.get('category') ?? '';
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') ?? '');
  const adminSection = isSuperAdmin ? parseAdminSection(sectionParam, searchQuery) : null;
  const focus = isSuperAdmin && adminSection
    ? adminSectionToFocus(adminSection)
    : parseCatalogFocus(sectionParam, searchQuery, canSync);
  const isFlatList = focus === 'all-spares' || focus === 'unlinked';
  const isMapBrowse = focus === 'map';

  const loadLinkedSpareIds = useCallback(async () => {
    if (!canSync) return;
    setLinksLoading(true);
    try {
      const index = await fetchSpareLinkIndex();
      setLinkedSpareIds(index.linkedSpareIds);
      setSpareCountByProductId(index.spareCountByProductId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load spare link status.');
    } finally {
      setLinksLoading(false);
    }
  }, [canSync]);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCatalog();
      setCatalog(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load catalog.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!isMedia) return;
    let cancelled = false;
    setMediaIndexLoading(true);
    void listCatalogProductIdsWithMediaFiles()
      .then(ids => {
        if (!cancelled) setProductIdsWithMedia(ids);
      })
      .catch(() => {
        if (!cancelled) setProductIdsWithMedia(new Set());
      })
      .finally(() => {
        if (!cancelled) setMediaIndexLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isMedia]);

  useEffect(() => {
    void loadLinkedSpareIds();
  }, [loadLinkedSpareIds]);

  const loadAuditItems = useCallback(async () => {
    setAuditLoading(true);
    try {
      const [items, cochinRecords, ncSummaries] = await Promise.all([
        listAllItems(null),
        listCochinSiteInventory(),
        listCatalogProductNcSummaries(),
      ]);
      setAuditItems(items);
      setCochinInventory(cochinRecords);
      setOpenNcQtyByProductId(ncSummaries);
      const uids = [
        ...new Set(
          items
            .filter(item => readItemLinkedByUid(item) && !readItemLinkedByName(item))
            .map(item => readItemLinkedByUid(item)!),
        ),
      ];
      if (uids.length) {
        setAuditAuditorNames(await fetchDisplayNamesForUids(uids));
      } else {
        setAuditAuditorNames(new Map());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load inventory audit records.');
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const handleUnlinkGroup = useCallback(
    async (group: InventoryAuditLinkedGroup) => {
      const locationCount = group.items.length;
      const ok = await confirm({
        title: 'Unlink warehouse item?',
        message:
          locationCount > 1
            ? `Remove the Zoho link from all ${locationCount} stock locations for “${group.catalogProductName}”? The warehouse counts stay in Yes Store.`
            : `Remove the Zoho link from “${group.catalogProductName}”? The warehouse count stays in Yes Store.`,
        confirmLabel: 'Unlink',
        destructive: true,
      });
      if (!ok) return;

      setUnlinkingGroupId(group.catalogProductId);
      setError(null);
      const catalogProductId = group.catalogProductId.trim();
      try {
        await batchUnlinkYesStoreItemsFromCatalog(group.items.map(item => item.id));
        try {
          await reconcileCatalogAuditImagesOnZoho(catalogProductId);
        } catch (syncErr) {
          setError(
            syncErr instanceof Error
              ? `Unlinked, but Zoho photo cleanup failed: ${syncErr.message}`
              : 'Unlinked, but Zoho photo cleanup failed.',
          );
          await loadAuditItems();
          return;
        }
        await loadAuditItems();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not unlink warehouse item.');
      } finally {
        setUnlinkingGroupId(null);
      }
    },
    [confirm, loadAuditItems],
  );

  useEffect(() => {
    if (!showAuditedLocations) return;
    if (focus !== 'inventory-audit' && focus !== 'all-spares' && focus !== 'browse') return;
    void loadAuditItems();
  }, [showAuditedLocations, focus, loadAuditItems]);

  const shopProducts = useMemo(
    () => excludeHiddenCatalogProducts(
      getShopCatalogProducts(catalog?.items ?? [], catalog?.categories ?? []),
      catalog?.categories ?? [],
    ),
    [catalog?.items, catalog?.categories],
  );

  const spareParts = useMemo(
    () => getCatalogSparePartsPool(catalog?.items ?? [], catalog?.categories ?? []),
    [catalog?.items, catalog?.categories],
  );

  const hasMediaProductFilters = isMedia && mediaProductFilters.size > 0;

  const mediaFilteredShopProducts = useMemo(() => {
    if (!hasMediaProductFilters) return shopProducts;
    return shopProducts.filter(product => matchesMediaProductFilters(
      product,
      mediaProductFilters,
      productIdsWithMedia,
    ));
  }, [hasMediaProductFilters, shopProducts, mediaProductFilters, productIdsWithMedia]);

  const mediaFilteredSpareParts = useMemo(() => {
    if (!hasMediaProductFilters) return spareParts;
    return spareParts.filter(product => matchesMediaProductFilters(
      product,
      mediaProductFilters,
      productIdsWithMedia,
    ));
  }, [hasMediaProductFilters, spareParts, mediaProductFilters, productIdsWithMedia]);

  const catalogShopProducts = isMedia ? mediaFilteredShopProducts : shopProducts;
  const catalogSpareParts = isMedia ? mediaFilteredSpareParts : spareParts;

  const browseProducts = useMemo(
    () => excludeHiddenCatalogProducts(
      getBrowseCatalogProducts(
        catalogShopProducts,
        catalogSpareParts,
        catalog?.categories ?? [],
        categoryFromUrl,
      ),
      catalog?.categories ?? [],
    ),
    [catalogShopProducts, catalogSpareParts, catalog?.categories, categoryFromUrl],
  );

  const headOfficeAuditedCatalogProductIds = useMemo(
    () => buildHeadOfficeAuditedCatalogProductIds(auditItems),
    [auditItems],
  );

  const cochinAuditedCatalogProductIds = useMemo(
    () => buildCochinAuditedCatalogProductIds(cochinInventory),
    [cochinInventory],
  );

  const auditedLocationByProductId = useMemo(
    () => (showAuditedLocations
      ? buildAuditedLocationByProductId(auditItems, cochinInventory)
      : undefined),
    [showAuditedLocations, auditItems, cochinInventory],
  );

  const catalogCategories = catalog?.categories ?? [];

  const isProductAudited = useCallback(
    (product: CatalogProduct) => catalogProductIsAudited(
      product,
      catalogCategories,
      headOfficeAuditedCatalogProductIds,
      cochinAuditedCatalogProductIds,
    ),
    [
      catalogCategories,
      headOfficeAuditedCatalogProductIds,
      cochinAuditedCatalogProductIds,
    ],
  );

  const hasActiveProductFilters =
    productCatalogFilters.size > 0
    || productStockStatusFilters.size > 0
    || productAuditStatusFilters.size > 0
    || productNcStatusFilters.size > 0;

  const applyProductBrowseFilters = useCallback((items: typeof shopProducts) => {
    if (!isSuperAdmin || !hasActiveProductFilters) return items;
    let next = items;
    if (spareCountByProductId) {
      next = next.filter(product => matchesCategorizedProductFilters(
        product,
        productCatalogFilters,
        spareCountByProductId,
      ));
    }
    next = next.filter(product => matchesSpareStockStatusFilters(product, productStockStatusFilters));
    next = next.filter(product => matchesSpareAuditStatusFilters(
      product,
      productAuditStatusFilters,
      catalogCategories,
      headOfficeAuditedCatalogProductIds,
      cochinAuditedCatalogProductIds,
    ));
    next = next.filter(product => matchesNcStatusFilters(
      product,
      productNcStatusFilters,
      openNcQtyByProductId,
    ));
    return next;
  }, [
    isSuperAdmin,
    hasActiveProductFilters,
    spareCountByProductId,
    productCatalogFilters,
    productStockStatusFilters,
    productAuditStatusFilters,
    productNcStatusFilters,
    catalogCategories,
    headOfficeAuditedCatalogProductIds,
    cochinAuditedCatalogProductIds,
    openNcQtyByProductId,
  ]);

  const filteredBrowseProducts = useMemo(
    () => applyProductBrowseFilters(browseProducts),
    [applyProductBrowseFilters, browseProducts],
  );

  const shopCategories = useMemo(() => {
    const categories = catalog?.categories ?? [];
    if (isMedia) {
      return getShopCatalogCategories(categories, catalogShopProducts, catalogSpareParts, hasMediaProductFilters
        ? {
          filteredShopProducts: catalogShopProducts,
          filteredSpareProducts: catalogSpareParts,
        }
        : undefined);
    }
    if (!isSuperAdmin || !hasActiveProductFilters) {
      return getShopCatalogCategories(categories, shopProducts, spareParts);
    }
    return getShopCatalogCategories(categories, shopProducts, spareParts, {
      filteredShopProducts: applyProductBrowseFilters(shopProducts),
      filteredSpareProducts: applyProductBrowseFilters(spareParts),
    });
  }, [
    catalog?.categories,
    shopProducts,
    spareParts,
    catalogShopProducts,
    catalogSpareParts,
    isMedia,
    hasMediaProductFilters,
    isSuperAdmin,
    hasActiveProductFilters,
    applyProductBrowseFilters,
  ]);

  const filteredSpareParts = useMemo(() => {
    let items = spareParts;
    if (isSuperAdmin && linkedSpareIds) {
      items = items.filter(product => matchesSpareCatalogFilters(product, spareCatalogFilters, linkedSpareIds));
    }
    if (isSuperAdmin) {
      items = items.filter(product => matchesSpareAuditStatusFilters(
        product,
        spareAuditStatusFilters,
        catalogCategories,
        headOfficeAuditedCatalogProductIds,
        cochinAuditedCatalogProductIds,
      ));
      items = items.filter(product => matchesSpareStockStatusFilters(product, spareStockStatusFilters));
      items = items.filter(product => matchesSpareLocationFilters(product, spareLocationFilters));
    }
    return items;
  }, [
    isSuperAdmin,
    spareParts,
    spareCatalogFilters,
    spareStockStatusFilters,
    spareAuditStatusFilters,
    spareLocationFilters,
    linkedSpareIds,
    catalogCategories,
    headOfficeAuditedCatalogProductIds,
    cochinAuditedCatalogProductIds,
  ]);

  const spareCatalogFilterCounts = useMemo(() => {
    const ids = linkedSpareIds ?? new Set<string>();
    const mapped = spareParts.filter(product => ids.has(product.id)).length;
    const all = spareParts.length;
    return {
      unmapped: all - mapped,
      mapped,
      withImage: spareParts.filter(product => catalogProductHasImage(product)).length,
      missingImage: spareParts.filter(product => !catalogProductHasImage(product)).length,
    };
  }, [spareParts, linkedSpareIds]);

  const spareStockStatusFilterCounts = useMemo(() => ({
    withStock: spareParts.filter(product => catalogProductHasPositiveStock(product)).length,
    zeroStock: spareParts.filter(product => catalogProductHasZeroStock(product)).length,
    negativeStock: spareParts.filter(product => catalogProductHasNegativeStock(product)).length,
  }), [spareParts]);

  const spareAuditStatusFilterCounts = useMemo(() => ({
    audited: spareParts.filter(product => isProductAudited(product)).length,
    notAudited: spareParts.filter(product => !isProductAudited(product)).length,
    zeroVariance: spareParts.filter(product => catalogProductAuditVariance(product) === 'zero').length,
    overage: spareParts.filter(product => catalogProductAuditVariance(product) === 'overage').length,
    shortage: spareParts.filter(product => catalogProductAuditVariance(product) === 'shortage').length,
  }), [spareParts, isProductAudited]);

  const spareLocationFilterCounts = useMemo(() => ({
    cochin: spareParts.filter(product => catalogProductHasWarehouseStock(product, 'Cochin')).length,
    headOffice: spareParts.filter(product => catalogProductHasWarehouseStock(product, 'Head Office')).length,
  }), [spareParts]);

  const unlinkedSpares = useMemo(() => {
    if (!linkedSpareIds) return [];
    return getUnlinkedSpares(
      catalog?.items ?? [],
      linkedSpareIds,
      catalog?.categories ?? [],
    );
  }, [catalog?.items, catalog?.categories, linkedSpareIds]);

  const mapProducts = useMemo(
    () => getFinishedGoodsForSpareMapping(catalog?.items ?? [], catalog?.categories ?? []),
    [catalog?.items, catalog?.categories],
  );

  const mapCategories = useMemo(
    () => getCategoriesForProducts(catalog?.categories ?? [], mapProducts)
      .filter(c => !isSparesExcludedCategory(c)),
    [catalog?.categories, mapProducts],
  );

  const productPool = useMemo(
    () => getFinishedGoodsForSpareMapping(catalog?.items ?? [], catalog?.categories ?? []),
    [catalog?.items, catalog?.categories],
  );

  const categoryId = categoryFromUrl;

  const productFilterCountBase = useMemo(() => {
    if (!categoryId) return browseProducts;
    return browseProducts.filter(product => product.categoryId === categoryId);
  }, [browseProducts, categoryId]);

  const productCatalogFilterCounts = useMemo(() => {
    const spareCounts = spareCountByProductId ?? new Map<string, number>();
    const spareMapped = productFilterCountBase.filter(
      product => (spareCounts.get(product.id) ?? 0) > 0,
    ).length;
    const all = productFilterCountBase.length;
    return {
      spareMapped,
      spareNotMapped: all - spareMapped,
      withImage: productFilterCountBase.filter(product => catalogProductHasImage(product)).length,
      missingImage: productFilterCountBase.filter(product => !catalogProductHasImage(product)).length,
    };
  }, [productFilterCountBase, spareCountByProductId]);

  const productStockStatusFilterCounts = useMemo(() => ({
    withStock: productFilterCountBase.filter(product => catalogProductHasPositiveStock(product)).length,
    zeroStock: productFilterCountBase.filter(product => catalogProductHasZeroStock(product)).length,
    negativeStock: productFilterCountBase.filter(product => catalogProductHasNegativeStock(product)).length,
  }), [productFilterCountBase]);

  const productAuditStatusFilterCounts = useMemo(() => ({
    audited: productFilterCountBase.filter(product => isProductAudited(product)).length,
    notAudited: productFilterCountBase.filter(product => !isProductAudited(product)).length,
    zeroVariance: productFilterCountBase.filter(product => catalogProductAuditVariance(product) === 'zero').length,
    overage: productFilterCountBase.filter(product => catalogProductAuditVariance(product) === 'overage').length,
    shortage: productFilterCountBase.filter(product => catalogProductAuditVariance(product) === 'shortage').length,
  }), [productFilterCountBase, isProductAudited]);

  const productNcStatusFilterCounts = useMemo(() => {
    const hasNc = productFilterCountBase.filter(
      product => (openNcQtyByProductId.get(product.id) ?? 0) > 0,
    ).length;
    return {
      hasNc,
      noNc: productFilterCountBase.length - hasNc,
    };
  }, [productFilterCountBase, openNcQtyByProductId]);

  const mediaFilterCountBase = useMemo(
    () => excludeHiddenCatalogProducts(
      getBrowseCatalogProducts(
        shopProducts,
        spareParts,
        catalog?.categories ?? [],
        categoryFromUrl,
      ),
      catalog?.categories ?? [],
    ),
    [shopProducts, spareParts, catalog?.categories, categoryFromUrl],
  );

  const mediaProductFilterCounts = useMemo(() => {
    const withImage = mediaFilterCountBase.filter(product => catalogProductHasImage(product)).length;
    const withMedia = mediaFilterCountBase.filter(product => productIdsWithMedia.has(product.id)).length;
    const all = mediaFilterCountBase.length;
    return {
      withImage,
      missingImage: all - withImage,
      withMedia,
      missingMedia: all - withMedia,
    };
  }, [mediaFilterCountBase, productIdsWithMedia]);

  const toggleMediaProductFilter = useCallback((key: MediaProductFilter) => {
    setMediaProductFilters(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      const trimmed = value.trim();
      if (trimmed) params.set('q', trimmed);
      else params.delete('q');
      return params;
    }, { replace: true });
  }, [setSearchParams]);

  const setCategoryId = useCallback((id: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (id) next.set('category', id);
      else next.delete('category');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setAdminSection = useCallback((next: AdminCatalogSection) => {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      params.delete('q');
      params.delete('category');
      if (next === 'categories') params.delete('section');
      else if (next === 'spares') params.set('section', 'spares');
      else if (next === 'spare-grouping') params.set('section', 'spare-grouping');
      else params.set('section', 'inventory-audit');
      return params;
    }, { replace: true });
    setSearchQuery('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setSearchParams]);

  const setFocus = useCallback((next: CatalogFocus) => {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (next === 'browse' || next === 'search') {
        params.delete('section');
      } else if (next === 'all-spares') {
        params.set('section', 'spares');
      } else if (next === 'inventory-audit') {
        params.set('section', 'inventory-audit');
      } else if (next === 'spare-grouping') {
        params.set('section', 'spare-grouping');
      } else if (next === 'unlinked') {
        params.set('section', 'unlinked');
      } else if (next === 'map') {
        params.set('section', 'map');
      }
      if (next !== 'map') params.delete('category');
      return params;
    }, { replace: true });
    if (next === 'browse') setSearchQuery('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setSearchParams]);

  const clearFocus = useCallback(() => {
    setSearchQuery('');
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      params.delete('section');
      params.delete('category');
      params.delete('q');
      return params;
    }, { replace: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setSearchParams]);

  const handleCategoriesReorder = async (nextCategories: CatalogCategory[]) => {
    const orderById = new Map(nextCategories.map((cat, index) => [cat.id, index]));
    setCatalog(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        categories: prev.categories.map(cat => {
          const order = orderById.get(cat.id);
          return order !== undefined ? { ...cat, displayOrder: order } : cat;
        }),
      };
    });
    try {
      await saveCatalogCategoryOrder(
        nextCategories.map((cat, index) => ({
          id: cat.id,
          name: cat.name,
          displayOrder: index,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save category order.');
      await loadCatalog();
    }
  };

  const handleCategoryProductsReorder = async (
    categoryId: string,
    nextProducts: CatalogProduct[],
  ) => {
    const orderById = new Map(nextProducts.map((product, index) => [product.id, index]));
    setCatalog(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        items: applyCategoryProductDisplayOrder(prev.items, categoryId, orderById),
      };
    });
    try {
      await saveCatalogCategoryProductOrder(
        categoryId,
        nextProducts.map((product, index) => ({
          id: product.id,
          displayOrder: index,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save product order.');
      await loadCatalog();
    }
  };

  const handleCategoryThumbnail = async (
    catId: string,
    categoryName: string,
    file: File,
  ): Promise<string | null> => {
    setError(null);
    try {
      const thumbnailUrl = await uploadCatalogCategoryThumbnail(catId, categoryName, file);
      setCatalog(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          categories: prev.categories.map(cat =>
            cat.id === catId ? { ...cat, thumbnailUrl } : cat,
          ),
        };
      });
      return thumbnailUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Category image upload failed.');
      return null;
    }
  };

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      await syncCatalog();
      await loadCatalog();
      await loadLinkedSpareIds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Catalog sync failed.');
    } finally {
      setSyncing(false);
    }
  }, [loadCatalog, loadLinkedSpareIds]);

  const openLinkEditor = async (spare: CatalogProduct) => {
    setLinkEditorSpare(spare);
    setLinkEditorProductIds([]);
    try {
      const response = await fetchCatalogSpareLinks({ spareId: spare.id });
      setLinkEditorProductIds(response.items.map(item => item.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load existing product links.');
    }
  };

  const handleSaveSpareLinks = async (productIds: string[]) => {
    if (!linkEditorSpare) return;
    setLinkEditorSaving(true);
    setError(null);
    try {
      await saveCatalogSpareProductLinks(linkEditorSpare.id, productIds);
      setLinkEditorSpare(null);
      await loadLinkedSpareIds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save product mapping.');
    } finally {
      setLinkEditorSaving(false);
    }
  };

  const smartBarRef = useRef<HTMLDivElement>(null);

  const showShortcuts = !isSuperAdmin && searchFocused && !searchQuery.trim() && focus === 'browse';
  const showActiveFocus = !isSuperAdmin && focus !== 'browse' && focus !== 'search';
  const showAdminSearch = isSuperAdmin && focus !== 'inventory-audit' && focus !== 'spare-grouping';
  const showHeaderSearch = showAdminSearch || !isSuperAdmin;

  const activeAdminTab: AdminCatalogSection = adminSection === 'search' || !adminSection
    ? 'categories'
    : adminSection;

  useCatalogPageHeader({
    title: showActiveFocus ? FOCUS_LABELS[focus] : null,
    showBack: showActiveFocus || (isSuperAdmin && Boolean(categoryId)),
    onBack: categoryId ? () => setCategoryId('') : clearFocus,
    mobileCompactHeader: isMobile && showHeaderSearch,
  });

  const showSparesFilters = isSuperAdmin && focus === 'all-spares';
  const showProductFilters = isSuperAdmin && focus === 'browse';
  const hasActiveSpareFilters =
    spareCatalogFilters.size > 0
    || spareStockStatusFilters.size > 0
    || spareLocationFilters.size > 0
    || spareAuditStatusFilters.size > 0;

  useEffect(() => {
    if (focus !== 'all-spares') {
      setSparesFiltersOpen(false);
      setSpareViewMode('items');
      setSpareQrScannerOpen(false);
    }
  }, [focus]);

  useEffect(() => {
    if (focus !== 'browse') setProductsFiltersOpen(false);
  }, [focus]);

  const spareProductIds = useMemo(
    () => new Set(spareParts.map(product => product.id)),
    [spareParts],
  );

  const spareCatalogByProductId = useMemo(() => {
    const map = new Map<string, { sku: string; name?: string | null }>();
    for (const product of spareParts) {
      map.set(product.id, {
        sku: product.sku?.trim() || product.id,
        name: product.name,
      });
    }
    return map;
  }, [spareParts]);

  const resolveSpareFromScan = useCallback((raw: string) => {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return null;
    return spareParts.find(product => {
      const sku = product.sku?.trim().toLowerCase();
      if (sku && sku === normalized) return true;
      return product.id.trim().toLowerCase() === normalized;
    }) ?? null;
  }, [spareParts]);

  const handleSpareQrDetected = useCallback((value: string) => {
    const match = resolveSpareFromScan(value);
    if (!match) return false;
    setSpareQrScannerOpen(false);
    navigate(`${pathname}/spare/${match.id}`);
    return true;
  }, [resolveSpareFromScan, navigate, pathname]);

  const sparesFilterButton = useMemo(
    () => (
      <button
        type="button"
        className={[
          'catalog-header-filter-btn',
          sparesFiltersOpen ? 'catalog-header-filter-btn--open' : '',
          hasActiveSpareFilters ? 'catalog-header-filter-btn--active' : '',
        ].filter(Boolean).join(' ')}
        onClick={() => setSparesFiltersOpen(open => !open)}
        aria-expanded={sparesFiltersOpen}
        aria-haspopup="dialog"
        aria-label="Open spare part filters"
        title="Filters"
      >
        <SlidersHorizontal size={20} strokeWidth={2.25} />
      </button>
    ),
    [sparesFiltersOpen, hasActiveSpareFilters],
  );

  const productsFilterButton = useMemo(
    () => (
      <button
        type="button"
        className={[
          'catalog-header-filter-btn',
          productsFiltersOpen ? 'catalog-header-filter-btn--open' : '',
          hasActiveProductFilters ? 'catalog-header-filter-btn--active' : '',
        ].filter(Boolean).join(' ')}
        onClick={() => setProductsFiltersOpen(open => !open)}
        aria-expanded={productsFiltersOpen}
        aria-haspopup="dialog"
        aria-label="Open product filters"
        title="Filters"
      >
        <SlidersHorizontal size={20} strokeWidth={2.25} />
      </button>
    ),
    [productsFiltersOpen, hasActiveProductFilters],
  );

  const syncButton = useMemo(
    () => (canSync ? (
      <button
        type="button"
        className="btn btn-primary catalog-sync-btn zoho-sync-btn catalog-smart-bar__sync"
        disabled={syncing || loading}
        onClick={() => void handleSync()}
        title="Sync from Zoho"
        aria-label="Sync from Zoho"
      >
        <RefreshCw size={16} className={syncing ? 'spin-icon' : undefined} />
        <span className="catalog-smart-bar__sync-label">{syncing ? 'Syncing…' : 'Sync'}</span>
      </button>
    ) : null),
    [canSync, syncing, loading, handleSync],
  );

  const scanQrButton = useMemo(
    () => (
      <button
        type="button"
        className={[
          'catalog-header-filter-btn',
          spareQrScannerOpen ? 'catalog-header-filter-btn--open' : '',
        ].filter(Boolean).join(' ')}
        onClick={() => setSpareQrScannerOpen(true)}
        aria-label="Scan spare SKU QR code"
        title="Scan QR"
      >
        <QrCode size={20} strokeWidth={2.25} />
      </button>
    ),
    [spareQrScannerOpen],
  );

  const rackViewButton = useMemo(
    () => (
      <button
        type="button"
        className={[
          'catalog-header-filter-btn',
          spareViewMode === 'rack' ? 'catalog-header-filter-btn--pressed' : '',
        ].filter(Boolean).join(' ')}
        onClick={() => setSpareViewMode(mode => (mode === 'rack' ? 'items' : 'rack'))}
        aria-label={spareViewMode === 'rack' ? 'Show spare items grid' : 'Show rack view'}
        aria-pressed={spareViewMode === 'rack'}
        title={spareViewMode === 'rack' ? 'Item view' : 'Rack view'}
      >
        <Rows3 size={20} strokeWidth={2.25} />
      </button>
    ),
    [spareViewMode],
  );

  const topBarAction = useMemo(() => {
    if (focus === 'all-spares') {
      return (
        <div className="catalog-header-actions">
          {scanQrButton}
          {rackViewButton}
          {showSparesFilters ? sparesFilterButton : null}
          {!isMobile && syncButton}
        </div>
      );
    }
    const filterButton = showProductFilters ? productsFilterButton : null;
    if (!filterButton) return syncButton;
    if (isMobile) return filterButton;
    return (
      <div className="catalog-header-actions">
        {filterButton}
        {syncButton}
      </div>
    );
  }, [
    focus,
    showSparesFilters,
    showProductFilters,
    isMobile,
    scanQrButton,
    rackViewButton,
    sparesFilterButton,
    productsFilterButton,
    syncButton,
  ]);

  const headerSearch = useMemo(
    () => (
      <div className="catalog-search invoices-header-search">
        <Search size={15} aria-hidden />
        <input
          type="search"
          placeholder={isMobile ? 'Search products, spare parts…' : 'Search products, spare parts, SKU…'}
          value={searchQuery}
          onChange={e => handleSearchChange(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => window.setTimeout(() => setSearchFocused(false), 180)}
          aria-label="Search catalog"
        />
        {searchQuery && (
          <button
            type="button"
            className="invoices-header-search__clear"
            onClick={() => {
              handleSearchChange('');
              if (focus === 'search') {
                if (isSuperAdmin) setAdminSection('categories');
                else setFocus('browse');
              }
            }}
            aria-label="Clear search"
          >
            <X size={16} />
          </button>
        )}
      </div>
    ),
    [searchQuery, handleSearchChange, focus, isSuperAdmin, setAdminSection, setFocus, isMobile],
  );

  usePageHeaderSlot(headerSearch, showHeaderSearch);
  useTopBarAction(
    topBarAction,
    focus === 'all-spares'
      || showSparesFilters
      || showProductFilters
      || Boolean(canSync && showHeaderSearch && !isMobile),
  );

  const hasSmartBarContent = isSuperAdmin
    || canSpareGroup
    || showShortcuts
    || showActiveFocus
    || (canSync && !isSuperAdmin && unlinkedSpares.length > 0 && focus === 'browse' && !showShortcuts);

  const smartBar = hasSmartBarContent ? (
    <div
      ref={smartBarRef}
      className={`catalog-smart-bar spares-mode-bar${isSuperAdmin || canSpareGroup ? ' catalog-smart-bar--admin-tabs' : ''}`}
    >
      {isSuperAdmin && (
        <div className="catalog-section-tabs">
          <div className="spares-mode-toggle spares-mode-toggle--ops" role="tablist" aria-label="Catalog sections">
            <button
              type="button"
              role="tab"
              aria-selected={activeAdminTab === 'categories'}
              className={`spares-mode-toggle__btn ${activeAdminTab === 'categories' ? 'spares-mode-toggle__btn--active' : ''}`}
              onClick={() => setAdminSection('categories')}
            >
              <LayoutGrid size={16} aria-hidden />
              <span className="spares-mode-toggle__label">Categories</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeAdminTab === 'spares'}
              className={`spares-mode-toggle__btn ${activeAdminTab === 'spares' ? 'spares-mode-toggle__btn--active' : ''}`}
              onClick={() => setAdminSection('spares')}
            >
              <Boxes size={16} aria-hidden />
              <span className="spares-mode-toggle__label">Spare parts</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeAdminTab === 'inventory-audit'}
              className={`spares-mode-toggle__btn ${activeAdminTab === 'inventory-audit' ? 'spares-mode-toggle__btn--active' : ''}`}
              onClick={() => setAdminSection('inventory-audit')}
            >
              <ClipboardList size={16} aria-hidden />
              <span className="spares-mode-toggle__label">Inventory audit</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeAdminTab === 'spare-grouping'}
              className={`spares-mode-toggle__btn ${activeAdminTab === 'spare-grouping' ? 'spares-mode-toggle__btn--active' : ''}`}
              onClick={() => setAdminSection('spare-grouping')}
            >
              <Layers size={16} aria-hidden />
              <span className="spares-mode-toggle__label">Spare grouping</span>
            </button>
          </div>
        </div>
      )}

      {canSpareGroup && !isSuperAdmin && (
        <div className="catalog-section-tabs">
          <div className="spares-mode-toggle spares-mode-toggle--ops" role="tablist" aria-label="Catalog sections">
            <button
              type="button"
              role="tab"
              aria-selected={focus === 'browse'}
              className={`spares-mode-toggle__btn ${focus === 'browse' ? 'spares-mode-toggle__btn--active' : ''}`}
              onClick={() => setFocus('browse')}
            >
              <LayoutGrid size={16} aria-hidden />
              <span className="spares-mode-toggle__label">Categories</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={focus === 'spare-grouping'}
              className={`spares-mode-toggle__btn ${focus === 'spare-grouping' ? 'spares-mode-toggle__btn--active' : ''}`}
              onClick={() => setFocus('spare-grouping')}
            >
              <Layers size={16} aria-hidden />
              <span className="spares-mode-toggle__label">Spare grouping</span>
            </button>
          </div>
        </div>
      )}

      {showShortcuts && (
        <div className="catalog-smart-bar__shortcuts" role="list">
          <button
            type="button"
            role="listitem"
            className="catalog-smart-bar__shortcut"
            onMouseDown={e => e.preventDefault()}
            onClick={() => setFocus('all-spares')}
          >
            All spare parts
            <span className="catalog-smart-bar__shortcut-meta">{spareParts.length}</span>
          </button>
          {canSync && unlinkedSpares.length > 0 && (
            <button
              type="button"
              role="listitem"
              className="catalog-smart-bar__shortcut catalog-smart-bar__shortcut--alert"
              onMouseDown={e => e.preventDefault()}
              onClick={() => setFocus('unlinked')}
            >
              Unlinked spares
              <span className="catalog-smart-bar__shortcut-meta">{unlinkedSpares.length}</span>
            </button>
          )}
          {canSync && (
            <button
              type="button"
              role="listitem"
              className="catalog-smart-bar__shortcut"
              onMouseDown={e => e.preventDefault()}
              onClick={() => setFocus('map')}
            >
              Map spares to products
            </button>
          )}
        </div>
      )}

      {showActiveFocus && focus !== 'spare-grouping' && (
        <div className="catalog-smart-bar__active">
          <span>{FOCUS_LABELS[focus]}</span>
          <button type="button" className="catalog-smart-bar__active-clear" onClick={clearFocus}>
            <X size={14} aria-hidden />
            Clear
          </button>
        </div>
      )}

      {canSync && !isSuperAdmin && unlinkedSpares.length > 0 && focus === 'browse' && !showShortcuts && (
        <button
          type="button"
          className="catalog-smart-bar__banner"
          onClick={() => setFocus('unlinked')}
        >
          {unlinkedSpares.length} spare{unlinkedSpares.length === 1 ? '' : 's'} need linking — review
        </button>
      )}
    </div>
  ) : null;

  useEffect(() => {
    const bar = smartBarRef.current;
    const root = document.querySelector('.catalog-page') as HTMLElement | null;
    if (!bar) {
      if (root) root.style.setProperty('--catalog-section-bar-height', '0px');
      return;
    }
    const setBarHeight = () => {
      const height = `${bar.offsetHeight}px`;
      if (root) root.style.setProperty('--catalog-section-bar-height', height);
    };
    setBarHeight();
    const observer = new ResizeObserver(setBarHeight);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [canSync, focus, searchFocused, searchQuery, unlinkedSpares.length, isSuperAdmin, hasSmartBarContent]);

  const flatListSearch = isFlatList ? searchQuery : '';

  if (loading && !catalog) {
    return (
      <div className="page-content fade-in products-page spares-page catalog-page catalog-page--smart">
        <div className="catalog-loading panel glass">
          <div className="loader-ring" />
          <p className="text-muted">Loading catalog…</p>
        </div>
      </div>
    );
  }

  if (error && !catalog) {
    return (
      <div className="page-content fade-in products-page spares-page catalog-page catalog-page--smart">
        <div className="panel glass products-error">
          <AlertCircle size={40} className="products-error-icon" />
          <h2>Could not load catalog</h2>
          <p className="text-muted">{error}</p>
          <div className="products-error-actions">
            <button type="button" className="btn btn-primary" onClick={() => void loadCatalog()}>
              Try again
            </button>
            {canSync && (
              <button type="button" className="btn btn-secondary zoho-sync-btn" onClick={() => void handleSync()}>
                Sync from Zoho
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const pageClass = [
    'page-content fade-in products-page spares-page catalog-page catalog-page--smart',
    isSuperAdmin ? 'catalog-page--admin-tabs' : '',
    isFlatList ? 'catalog-page--flat spares-page--all-spares' : '',
    focus === 'inventory-audit' ? 'catalog-page--inventory-audit' : '',
    focus === 'spare-grouping' ? 'catalog-page--spare-grouping' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={pageClass}>
      {error && (
        <div className="products-inline-error panel glass">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {smartBar}

      {showSparesFilters && (
        <CatalogSparesFilterSheet
          open={sparesFiltersOpen}
          onClose={() => setSparesFiltersOpen(false)}
          spareCatalogFilters={spareCatalogFilters}
          spareStockStatusFilters={spareStockStatusFilters}
          spareLocationFilters={spareLocationFilters}
          spareAuditStatusFilters={spareAuditStatusFilters}
          onApplyFilters={applySpareFilters}
          spareCatalogFilterCounts={spareCatalogFilterCounts}
          spareStockStatusFilterCounts={spareStockStatusFilterCounts}
          spareLocationFilterCounts={spareLocationFilterCounts}
          spareAuditStatusFilterCounts={spareAuditStatusFilterCounts}
        />
      )}

      {showProductFilters && (
        <CatalogSparesFilterSheet
          open={productsFiltersOpen}
          onClose={() => setProductsFiltersOpen(false)}
          variant="products"
          spareCatalogFilters={productCatalogFilters}
          spareStockStatusFilters={productStockStatusFilters}
          spareAuditStatusFilters={productAuditStatusFilters}
          ncStatusFilters={productNcStatusFilters}
          onApplyFilters={applyProductFilters}
          spareCatalogFilterCounts={productCatalogFilterCounts}
          spareStockStatusFilterCounts={productStockStatusFilterCounts}
          spareLocationFilterCounts={spareLocationFilterCounts}
          spareAuditStatusFilterCounts={productAuditStatusFilterCounts}
          ncStatusFilterCounts={productNcStatusFilterCounts}
        />
      )}

      {focus === 'search' && (
        <CatalogUnifiedResults
          query={searchQuery}
          products={catalogShopProducts}
          spares={catalogSpareParts}
          productsBasePath={pathname}
          sparesBasePath={`${pathname}/spare`}
          enableCart={canUseCart(user?.role)}
          showStockQuantity={showStockQuantity}
          unlinkedSpareIds={linkedSpareIds ?? undefined}
          onLinkSpare={canSync ? spare => void openLinkEditor(spare) : undefined}
          isLoading={loading || (isMedia && mediaIndexLoading)}
        />
      )}

      {isMedia && (focus === 'browse' || focus === 'search') && (
        <div className="catalog-media-product-filters panel glass">
          <div className="catalog-media-product-filters__head">
            <p className="catalog-media-product-filters__label">Filter products</p>
            {hasMediaProductFilters && (
              <button
                type="button"
                className="catalog-media-product-filters__clear"
                onClick={() => setMediaProductFilters(new Set())}
              >
                Clear
              </button>
            )}
          </div>
          <div className="catalog-media-product-filters__chips" role="group" aria-label="Media product filters">
            {MEDIA_PRODUCT_FILTERS.map(filter => {
              const active = mediaProductFilters.has(filter.key);
              const count = mediaProductFilterCounts[filter.key];
              return (
                <button
                  key={filter.key}
                  type="button"
                  className={`catalog-inventory-audit__filter-chip${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  disabled={mediaIndexLoading && (filter.key === 'withMedia' || filter.key === 'missingMedia')}
                  onClick={() => toggleMediaProductFilter(filter.key)}
                >
                  {filter.label}
                  <span className="catalog-inventory-audit__filter-chip-count">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {focus === 'browse' && (
        <CatalogBrowse
          products={isSuperAdmin ? filteredBrowseProducts : browseProducts}
          categories={shopCategories}
          isLoading={loading || (isMedia && mediaIndexLoading)}
          showToolbar={false}
          filterMode={canSync ? 'full' : 'minimal'}
          manageCategories={canSync}
          onCategoriesReorder={canSync ? cats => void handleCategoriesReorder(cats) : undefined}
          onCategoryProductsReorder={canSync ? (catId, products) => void handleCategoryProductsReorder(catId, products) : undefined}
          onCategoryThumbnail={canSync ? handleCategoryThumbnail : undefined}
          productsBasePath={pathname}
          enableCart={canUseCart(user?.role)}
          showStockQuantity={showStockQuantity}
          hideFilterBar
          spareLinkCountByProductId={canSync ? spareCountByProductId ?? undefined : undefined}
          openNcQtyByProductId={isSuperAdmin ? openNcQtyByProductId : undefined}
          auditedLocationByProductId={auditedLocationByProductId}
          activeCategoryId={categoryId}
          onActiveCategoryChange={setCategoryId}
          emptyTitle={
            (isSuperAdmin && hasActiveProductFilters) || hasMediaProductFilters
              ? 'No products match the selected filters'
              : undefined
          }
          emptyHint={
            hasMediaProductFilters
              ? 'Try clearing filters or open another category.'
              : isSuperAdmin && hasActiveProductFilters
                ? 'Try clearing filters or run Sync from Zoho to refresh stock.'
                : undefined
          }
        />
      )}

      {isMapBrowse && !isSuperAdmin && (
        <CatalogBrowse
          products={mapProducts}
          categories={mapCategories}
          isLoading={loading || linksLoading}
          showToolbar={false}
          filterMode={canSync ? 'full' : 'minimal'}
          manageCategories={canSync}
          onCategoriesReorder={canSync ? cats => void handleCategoriesReorder(cats) : undefined}
          onCategoryProductsReorder={canSync ? (catId, products) => void handleCategoryProductsReorder(catId, products) : undefined}
          onCategoryThumbnail={canSync ? handleCategoryThumbnail : undefined}
          productsBasePath={`${pathname}/map`}
          enableCart={false}
          showStockQuantity={showStockQuantity}
          spareLinkCountByProductId={spareCountByProductId ?? undefined}
          hideFilterBar
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          simpleCategoryTiles
          activeCategoryId={categoryId}
          onActiveCategoryChange={setCategoryId}
        />
      )}

      {focus === 'unlinked' && !isSuperAdmin && (
        <CatalogBrowse
          products={unlinkedSpares}
          categories={[]}
          isLoading={loading || linksLoading}
          showToolbar={false}
          showCategoryGrid={false}
          flatBrowse
          filterMode="minimal"
          hideFilterBar
          searchQuery={flatListSearch}
          onSearchChange={handleSearchChange}
          productsBasePath={`${pathname}/spare`}
          showStockQuantity={showStockQuantity}
          returnView="unlinked"
          manageItemLabel="Link to products"
          onManageItem={spare => void openLinkEditor(spare)}
          emptyTitle={
            flatListSearch.trim()
              ? 'No unlinked spares match your search'
              : 'All spares are linked'
          }
          emptyHint={
            flatListSearch.trim()
              ? 'Try a different name or SKU.'
              : 'Every spare is mapped to at least one product.'
          }
        />
      )}

      {focus === 'all-spares' && (
        <div className="catalog-spares-page panel glass">
          {spareViewMode === 'rack' ? (
            <SparePartsRackView
              items={auditItems}
              spareProductIds={spareProductIds}
              catalogByProductId={spareCatalogByProductId}
              loading={auditLoading}
              onSkuClick={productId => navigate(`${pathname}/spare/${productId}`)}
            />
          ) : (
            <CatalogBrowse
              products={filteredSpareParts}
              categories={[]}
              isLoading={loading || (isSuperAdmin && linksLoading)}
              showToolbar={false}
              showCategoryGrid={false}
              flatBrowse
              filterMode="minimal"
              hideFilterBar
              searchQuery={flatListSearch}
              onSearchChange={handleSearchChange}
              productsBasePath={`${pathname}/spare`}
              enableCart={canUseCart(user?.role)}
              showStockQuantity={showStockQuantity}
              returnView="spares"
              auditedLocationByProductId={auditedLocationByProductId}
              manageItemLabel={isSuperAdmin && canSync && spareCatalogFilters.has('unmapped') ? 'Link to products' : undefined}
              onManageItem={
                isSuperAdmin && canSync && spareCatalogFilters.has('unmapped')
                  ? spare => void openLinkEditor(spare)
                  : undefined
              }
              emptyTitle={
                isSuperAdmin && hasActiveSpareFilters
                  ? flatListSearch.trim()
                    ? 'No spare parts match your search and filters'
                    : 'No spare parts match the selected filters'
                  : undefined
              }
              emptyHint={
                isSuperAdmin && hasActiveSpareFilters
                  ? 'Try clearing filters or run Sync from Zoho to refresh stock by location.'
                  : undefined
              }
            />
          )}
        </div>
      )}

      {spareQrScannerOpen && (
        <SpareSkuQrScanner
          onDetected={handleSpareQrDetected}
          onClose={() => setSpareQrScannerOpen(false)}
        />
      )}

      {focus === 'inventory-audit' && (
        <div className="catalog-inventory-audit-page panel glass">
          <WarehouseInventoryAuditList
            items={auditItems}
            catalogProducts={catalog?.items}
            auditorNamesByUid={auditAuditorNames}
            loading={auditLoading}
            onRefresh={() => void loadAuditItems()}
            showLinkStatus
            batchLinkEnabled
            showViewToggle
            onBatchLink={setBatchLinkItems}
            onItemClick={item => navigate(`${pathname}/inventory-audit/${item.id}`)}
            onGroupClick={group =>
              navigate(`${pathname}/inventory-audit/linked/${group.catalogProductId}`)
            }
            onUnlinkGroup={isSuperAdmin ? handleUnlinkGroup : undefined}
            unlinkingGroupId={unlinkingGroupId}
          />
        </div>
      )}

      {focus === 'spare-grouping' && canSpareGroup && (
        <SpareGroupingView
          spares={spareParts}
          onAssigned={(productIds, spareGroupId) => {
            setCatalog(prev => {
              if (!prev) return prev;
              const idSet = new Set(productIds);
              return {
                ...prev,
                items: prev.items.map(item =>
                  idSet.has(item.id)
                    ? {
                        ...item,
                        spareGroupId: spareGroupId || undefined,
                      }
                    : item,
                ),
              };
            });
          }}
        />
      )}

      {batchLinkItems && (
        <InventoryAuditBatchLinkModal
          items={batchLinkItems}
          products={catalog?.items ?? []}
          catalogLoading={loading}
          onClose={() => setBatchLinkItems(null)}
          onLinked={catalogProductId => {
            setBatchLinkItems(null);
            void loadAuditItems();
            navigate(`${pathname}/inventory-audit/linked/${catalogProductId}`);
          }}
        />
      )}

      {linkEditorSpare && (
        <SpareLinkEditor
          mode="spare"
          itemName={linkEditorSpare.name}
          pool={productPool}
          selectedIds={linkEditorProductIds}
          saving={linkEditorSaving}
          onClose={() => setLinkEditorSpare(null)}
          onSave={handleSaveSpareLinks}
        />
      )}
    </div>
  );
};
