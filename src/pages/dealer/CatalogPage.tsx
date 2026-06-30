import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Boxes, ClipboardList, LayoutGrid, RefreshCw, Search, X } from 'lucide-react';
import { CatalogBrowse } from '../../components/catalog/CatalogBrowse';
import { CatalogUnifiedResults } from '../../components/catalog/CatalogUnifiedResults';
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
  getCategorizedProducts,
  getShopCatalogProducts,
  getCategoriesForProducts,
  getCatalogSparePartsPool,
  getUnlinkedSpares,
  isSparesExcludedCategory,
  SPARE_WAREHOUSE_LOCATION_FILTERS,
  catalogProductHasWarehouseStock,
  type SpareWarehouseLocationFilter,
  saveCatalogCategoryOrder,
  saveCatalogSpareProductLinks,
  syncCatalog,
  uploadCatalogCategoryThumbnail,
} from '../../lib/catalog';
import { listAllItems, fetchDisplayNamesForUids, batchUnlinkYesStoreItemsFromCatalog } from '../../lib/yesStore/data';
import { reconcileCatalogAuditImagesOnZoho } from '../../lib/yesStore/syncAuditImages';
import { readItemLinkedByName, readItemLinkedByUid, type InventoryAuditLinkedGroup } from '../../lib/yesStore/inventoryAudit';
import { canUseCart } from '../../types';
import type { CatalogCategory, CatalogProduct, CatalogResponse } from '../../types/catalog';
import type { YesStoreItemDoc } from '../../types/yes-store';

type CatalogFocus = 'browse' | 'search' | 'all-spares' | 'unlinked' | 'map' | 'inventory-audit';

type AdminCatalogSection = 'categories' | 'spares' | 'inventory-audit';

type SpareProductMapFilter = 'unmapped' | 'mapped' | 'all';

function parseCatalogFocus(
  section: string | null,
  query: string,
  canSync: boolean,
): CatalogFocus {
  if (section === 'inventory-audit') return 'inventory-audit';
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
  if (query.trim()) return 'search';
  return 'categories';
}

function adminSectionToFocus(section: AdminCatalogSection | 'search'): CatalogFocus {
  if (section === 'search') return 'search';
  if (section === 'spares') return 'all-spares';
  if (section === 'inventory-audit') return 'inventory-audit';
  return 'browse';
}

const FOCUS_LABELS: Record<CatalogFocus, string> = {
  browse: 'Categories',
  search: 'Search results',
  'all-spares': 'Spare parts',
  unlinked: 'Unlinked spares',
  map: 'Map spares to products',
  'inventory-audit': 'Inventory audit',
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
  const isMobile = useIsMobile();
  const canSync = user?.role === 'super_admin' || hasStaffPermission(user, 'catalog.sync');
  const showStockQuantity = canSync || canViewCatalogStock(user);

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
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditAuditorNames, setAuditAuditorNames] = useState<Map<string, string>>(new Map());
  const [batchLinkItems, setBatchLinkItems] = useState<YesStoreItemDoc[] | null>(null);
  const [unlinkingGroupId, setUnlinkingGroupId] = useState<string | null>(null);
  const [spareMapFilter, setSpareMapFilter] = useState<SpareProductMapFilter>('all');
  const [spareLocationFilter, setSpareLocationFilter] = useState<SpareWarehouseLocationFilter>('all');

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
    void loadLinkedSpareIds();
  }, [loadLinkedSpareIds]);

  const loadAuditItems = useCallback(async () => {
    setAuditLoading(true);
    try {
      const items = await listAllItems();
      setAuditItems(items);
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
    if (!isSuperAdmin || focus !== 'inventory-audit') return;
    void loadAuditItems();
  }, [isSuperAdmin, focus, loadAuditItems]);

  const shopProducts = useMemo(
    () => excludeHiddenCatalogProducts(
      getShopCatalogProducts(catalog?.items ?? [], catalog?.categories ?? []),
      catalog?.categories ?? [],
    ),
    [catalog?.items, catalog?.categories],
  );

  const shopCategories = useMemo(
    () => getCategoriesForProducts(catalog?.categories ?? [], shopProducts),
    [catalog?.categories, shopProducts],
  );

  const spareParts = useMemo(
    () => getCatalogSparePartsPool(catalog?.items ?? [], catalog?.categories ?? []),
    [catalog?.items, catalog?.categories],
  );

  const filteredSpareParts = useMemo(() => {
    let items = spareParts;
    if (isSuperAdmin && linkedSpareIds) {
      if (spareMapFilter === 'mapped') {
        items = items.filter(product => linkedSpareIds.has(product.id));
      } else if (spareMapFilter === 'unmapped') {
        items = items.filter(product => !linkedSpareIds.has(product.id));
      }
    }
    if (isSuperAdmin && spareLocationFilter !== 'all') {
      const location = SPARE_WAREHOUSE_LOCATION_FILTERS.find(option => option.key === spareLocationFilter);
      if (location?.warehouseName) {
        items = items.filter(product => catalogProductHasWarehouseStock(product, location.warehouseName));
      }
    }
    return items;
  }, [isSuperAdmin, spareParts, spareMapFilter, spareLocationFilter, linkedSpareIds]);

  const spareMapFilterCounts = useMemo(() => {
    const ids = linkedSpareIds ?? new Set<string>();
    const mapped = spareParts.filter(product => ids.has(product.id)).length;
    const all = spareParts.length;
    return { all, mapped, unmapped: all - mapped };
  }, [spareParts, linkedSpareIds]);

  const spareLocationFilterCounts = useMemo(() => ({
    all: spareParts.length,
    cochin: spareParts.filter(product => catalogProductHasWarehouseStock(product, 'Cochin')).length,
    headOffice: spareParts.filter(product => catalogProductHasWarehouseStock(product, 'Head Office')).length,
  }), [spareParts]);

  const unlinkedSpares = useMemo(() => {
    if (!linkedSpareIds) return [];
    return getUnlinkedSpares(catalog?.items ?? [], linkedSpareIds);
  }, [catalog?.items, linkedSpareIds]);

  const mapProducts = useMemo(
    () => getCategorizedProducts(catalog?.items ?? [])
      .filter(p => {
        const cat = catalog?.categories?.find(c => c.id === p.categoryId);
        return !cat || !isSparesExcludedCategory(cat);
      }),
    [catalog?.items, catalog?.categories],
  );

  const mapCategories = useMemo(
    () => getCategoriesForProducts(catalog?.categories ?? [], mapProducts)
      .filter(c => !isSparesExcludedCategory(c)),
    [catalog?.categories, mapProducts],
  );

  const productPool = useMemo(
    () => getCategorizedProducts(catalog?.items ?? []),
    [catalog?.items],
  );

  const categoryId = categoryFromUrl;

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
  const showAdminSearch = isSuperAdmin && focus !== 'inventory-audit';
  const showHeaderSearch = showAdminSearch || !isSuperAdmin;

  const activeAdminTab: AdminCatalogSection = adminSection === 'search' || !adminSection
    ? 'categories'
    : adminSection;

  useCatalogPageHeader({
    title: showActiveFocus ? FOCUS_LABELS[focus] : null,
    showBack: showActiveFocus || (isSuperAdmin && Boolean(categoryId)),
    onBack: categoryId ? () => setCategoryId('') : clearFocus,
  });

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

  const headerSearch = useMemo(
    () => {
      const searchField = (
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
      );

      if (isMobile && canSync && showHeaderSearch) {
        return (
          <div className="catalog-header-toolbar">
            {searchField}
            <div className="catalog-header-toolbar__action">{syncButton}</div>
          </div>
        );
      }

      return searchField;
    },
    [
      searchQuery,
      handleSearchChange,
      focus,
      isSuperAdmin,
      setAdminSection,
      setFocus,
      isMobile,
      canSync,
      showHeaderSearch,
      syncButton,
    ],
  );

  usePageHeaderSlot(headerSearch, showHeaderSearch);
  useTopBarAction(syncButton, Boolean(canSync && showHeaderSearch && !isMobile));

  const hasSmartBarContent = isSuperAdmin
    || showShortcuts
    || showActiveFocus
    || (canSync && !isSuperAdmin && unlinkedSpares.length > 0 && focus === 'browse' && !showShortcuts);

  const smartBar = hasSmartBarContent ? (
    <div
      ref={smartBarRef}
      className={`catalog-smart-bar spares-mode-bar${isSuperAdmin ? ' catalog-smart-bar--admin-tabs' : ''}`}
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

      {showActiveFocus && (
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

      {focus === 'search' && (
        <CatalogUnifiedResults
          query={searchQuery}
          products={shopProducts}
          spares={spareParts}
          productsBasePath={pathname}
          sparesBasePath={`${pathname}/spare`}
          enableCart={canUseCart(user?.role)}
          showStockQuantity={showStockQuantity}
          unlinkedSpareIds={linkedSpareIds ?? undefined}
          onLinkSpare={canSync ? spare => void openLinkEditor(spare) : undefined}
          isLoading={loading}
        />
      )}

      {focus === 'browse' && (
        <CatalogBrowse
          products={shopProducts}
          categories={shopCategories}
          isLoading={loading}
          showToolbar={false}
          filterMode={canSync ? 'full' : 'minimal'}
          manageCategories={canSync}
          onCategoriesReorder={canSync ? cats => void handleCategoriesReorder(cats) : undefined}
          onCategoryThumbnail={canSync ? handleCategoryThumbnail : undefined}
          productsBasePath={pathname}
          enableCart={canUseCart(user?.role)}
          showStockQuantity={showStockQuantity}
          hideFilterBar
          spareLinkCountByProductId={canSync ? spareCountByProductId ?? undefined : undefined}
          activeCategoryId={categoryId}
          onActiveCategoryChange={setCategoryId}
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
            manageItemLabel={isSuperAdmin && canSync && spareMapFilter === 'unmapped' ? 'Link to products' : undefined}
            onManageItem={
              isSuperAdmin && canSync && spareMapFilter === 'unmapped'
                ? spare => void openLinkEditor(spare)
                : undefined
            }
            listHeaderExtra={
              isSuperAdmin ? (
                <div className="catalog-spares-filters">
                  <div
                    className="catalog-inventory-audit__filters catalog-spares-map-filters"
                    role="tablist"
                    aria-label="Spare-to-product mapping filter"
                  >
                    {(['unmapped', 'mapped', 'all'] as const).map(option => {
                      const count = spareMapFilterCounts[option];
                      const label =
                        option === 'all' ? 'All' : option === 'mapped' ? 'Mapped' : 'Unmapped';
                      return (
                        <button
                          key={option}
                          type="button"
                          role="tab"
                          aria-selected={spareMapFilter === option}
                          className={`catalog-inventory-audit__filter-chip${spareMapFilter === option ? ' is-active' : ''}`}
                          onClick={() => setSpareMapFilter(option)}
                        >
                          {label}
                          <span className="catalog-inventory-audit__filter-chip-count">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div
                    className="catalog-inventory-audit__filters catalog-spares-location-filters"
                    role="tablist"
                    aria-label="Warehouse location filter"
                  >
                    {SPARE_WAREHOUSE_LOCATION_FILTERS.map(option => {
                      const count = spareLocationFilterCounts[option.key];
                      return (
                        <button
                          key={option.key}
                          type="button"
                          role="tab"
                          aria-selected={spareLocationFilter === option.key}
                          className={`catalog-inventory-audit__filter-chip${spareLocationFilter === option.key ? ' is-active' : ''}`}
                          onClick={() => setSpareLocationFilter(option.key)}
                        >
                          {option.label}
                          <span className="catalog-inventory-audit__filter-chip-count">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : undefined
            }
            emptyTitle={
              isSuperAdmin && spareLocationFilter !== 'all'
                ? flatListSearch.trim()
                  ? `No spare parts at ${SPARE_WAREHOUSE_LOCATION_FILTERS.find(o => o.key === spareLocationFilter)?.label ?? 'this location'} match your search`
                  : `No spare parts in stock at ${SPARE_WAREHOUSE_LOCATION_FILTERS.find(o => o.key === spareLocationFilter)?.label ?? 'this location'}`
                : isSuperAdmin && spareMapFilter === 'mapped'
                ? flatListSearch.trim()
                  ? 'No mapped spare parts match your search'
                  : 'No spare parts mapped to products yet'
                : isSuperAdmin && spareMapFilter === 'unmapped'
                  ? flatListSearch.trim()
                    ? 'No unmapped spare parts match your search'
                    : 'All spare parts are mapped to products'
                  : undefined
            }
            emptyHint={
              isSuperAdmin && spareLocationFilter !== 'all' && spareLocationFilterCounts[spareLocationFilter] === 0
                ? 'Run Sync from Zoho to refresh warehouse stock by location.'
                : isSuperAdmin && spareMapFilter === 'mapped'
                ? 'Map spares from a product detail page or the Unmapped filter.'
                : isSuperAdmin && spareMapFilter === 'unmapped'
                  ? 'Open a spare to map it to compatible products.'
                  : undefined
            }
          />
        </div>
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
