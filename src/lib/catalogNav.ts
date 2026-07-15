import type { CatalogProduct } from '../types/catalog';

export type CatalogNavOrigin =
  | 'browse'
  | 'search'
  | 'spares'
  | 'spares-rack'
  | 'spares-qr'
  | 'unlinked'
  | 'map'
  | 'product'
  | 'spare';

export type SpareCatalogViewMode = 'items' | 'rack';

export interface SpareListFiltersSnapshot {
  catalog: string[];
  stockStatus: string[];
  location: string[];
  auditStatus: string[];
}

export interface CatalogNavState {
  preview?: CatalogProduct;
  origin?: CatalogNavOrigin;
  /** @deprecated prefer origin */
  returnView?: string;
  parentProductId?: string;
  parentProductPreview?: CatalogProduct;
  parentSpareId?: string;
  parentSparePreview?: CatalogProduct;
  /** Full nav stack to restore when backing from a child of a spare detail */
  parentSpareNav?: CatalogNavState;
  returnCategoryId?: string;
  searchQuery?: string;
  backTo?: string;
  backToState?: CatalogNavState | null;
  /** Restore spare-parts list vs rack view after detail back. */
  spareViewMode?: SpareCatalogViewMode;
  /** Product/SKU to emphasize after returning to spare list or rack. */
  focusProductId?: string;
  /** Unlinked audit item to emphasize on rack after returning from inventory audit. */
  focusAuditItemId?: string;
  /** Rack letter to restore when returning from rack-view SKU tap. */
  focusRackId?: string | null;
  /** Spare list filters to restore after detail back. */
  spareFilters?: SpareListFiltersSnapshot;
}

export interface SpareReturnFocus {
  /** Linked catalog product to emphasize (SKU tile). */
  productId?: string;
  /** Unlinked (or just-visited) YesStore audit item to emphasize. */
  auditItemId?: string;
  origin: CatalogNavOrigin;
  viewMode: SpareCatalogViewMode;
  rackId?: string | null;
  searchQuery?: string;
  spareFilters?: SpareListFiltersSnapshot;
  savedAt: number;
}

const SPARE_RETURN_FOCUS_KEY = 'yesweigh.catalog.spareReturnFocus';

export function rememberSpareReturnFocus(focus: Omit<SpareReturnFocus, 'savedAt'>): void {
  try {
    const payload: SpareReturnFocus = { ...focus, savedAt: Date.now() };
    sessionStorage.setItem(SPARE_RETURN_FOCUS_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / private mode
  }
}

export function peekSpareReturnFocus(maxAgeMs = 30 * 60 * 1000): SpareReturnFocus | null {
  try {
    const raw = sessionStorage.getItem(SPARE_RETURN_FOCUS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SpareReturnFocus;
    if (!parsed?.origin) return null;
    if (!parsed.productId && !parsed.auditItemId) return null;
    if (Date.now() - Number(parsed.savedAt || 0) > maxAgeMs) {
      sessionStorage.removeItem(SPARE_RETURN_FOCUS_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearSpareReturnFocus(): void {
  try {
    sessionStorage.removeItem(SPARE_RETURN_FOCUS_KEY);
  } catch {
    // ignore
  }
}

export function normalizeCatalogOrigin(
  state?: CatalogNavState | null,
): CatalogNavOrigin | undefined {
  if (!state) return undefined;
  if (state.origin) return state.origin;
  if (state.returnView === 'unlinked') return 'unlinked';
  if (state.returnView === 'spares') return 'spares';
  if (state.returnView === 'map') return 'map';
  return undefined;
}

export function buildProductNavState(
  product: CatalogProduct,
  ctx: {
    origin: CatalogNavOrigin;
    returnCategoryId?: string;
    parentSpare?: CatalogProduct;
    parentSpareNav?: CatalogNavState;
    searchQuery?: string;
  },
): CatalogNavState {
  const state: CatalogNavState = {
    preview: product,
    origin: ctx.origin,
    returnCategoryId: ctx.returnCategoryId ?? product.categoryId ?? '',
  };
  if (ctx.parentSpare) {
    state.parentSpareId = ctx.parentSpare.id;
    state.parentSparePreview = ctx.parentSpare;
    state.parentSpareNav = ctx.parentSpareNav;
  }
  if (ctx.searchQuery?.trim()) state.searchQuery = ctx.searchQuery.trim();
  return state;
}

export function buildSpareNavState(
  spare: CatalogProduct,
  ctx: {
    origin: CatalogNavOrigin;
    parentProduct?: CatalogProduct;
    returnCategoryId?: string;
    searchQuery?: string;
    spareViewMode?: SpareCatalogViewMode;
    focusRackId?: string | null;
    spareFilters?: SpareListFiltersSnapshot;
  },
): CatalogNavState {
  const state: CatalogNavState = {
    preview: spare,
    origin: ctx.origin,
    focusProductId: spare.id,
  };
  if (ctx.parentProduct) {
    state.parentProductId = ctx.parentProduct.id;
    state.parentProductPreview = ctx.parentProduct;
    state.returnCategoryId = ctx.returnCategoryId ?? ctx.parentProduct.categoryId ?? '';
  }
  if (ctx.searchQuery?.trim()) state.searchQuery = ctx.searchQuery.trim();
  if (ctx.spareViewMode) state.spareViewMode = ctx.spareViewMode;
  if (ctx.focusRackId) state.focusRackId = ctx.focusRackId;
  if (ctx.spareFilters) state.spareFilters = ctx.spareFilters;
  if (ctx.origin === 'unlinked') state.returnView = 'unlinked';
  if (ctx.origin === 'spares' || ctx.origin === 'spares-rack' || ctx.origin === 'spares-qr') {
    state.returnView = 'spares';
    state.spareViewMode = ctx.spareViewMode
      ?? (ctx.origin === 'spares-rack' ? 'rack' : 'items');
  }
  if (ctx.origin === 'map') state.returnView = 'map';

  if (ctx.origin === 'spares' || ctx.origin === 'spares-rack' || ctx.origin === 'spares-qr') {
    rememberSpareReturnFocus({
      productId: spare.id,
      origin: ctx.origin,
      viewMode: state.spareViewMode ?? 'items',
      rackId: ctx.focusRackId ?? null,
      searchQuery: state.searchQuery,
      spareFilters: ctx.spareFilters,
    });
  }

  return state;
}

function catalogListPath(
  catalogBase: string,
  section: 'spares' | 'unlinked',
): string {
  return `${catalogBase}?section=${section}`;
}

function catalogSearchPath(catalogBase: string, query?: string): string {
  const q = query?.trim();
  return q ? `${catalogBase}?q=${encodeURIComponent(q)}` : catalogBase;
}

function sparePartsBackState(navState: CatalogNavState | null | undefined): CatalogNavState {
  const focus = peekSpareReturnFocus();
  const origin = normalizeCatalogOrigin(navState) ?? focus?.origin ?? 'spares';
  return {
    origin: origin === 'spares-rack' || origin === 'spares-qr' ? origin : 'spares',
    returnView: 'spares',
    spareViewMode: navState?.spareViewMode
      ?? focus?.viewMode
      ?? (origin === 'spares-rack' ? 'rack' : 'items'),
    focusProductId: navState?.focusProductId ?? focus?.productId,
    focusAuditItemId: navState?.focusAuditItemId ?? focus?.auditItemId,
    focusRackId: navState?.focusRackId ?? focus?.rackId ?? null,
    searchQuery: navState?.searchQuery ?? focus?.searchQuery,
    spareFilters: navState?.spareFilters ?? focus?.spareFilters,
  };
}

export function resolveCatalogBack(
  catalogBase: string,
  navState: CatalogNavState | null | undefined,
  itemKind: 'product' | 'spare',
  isPublic = false,
): { path: string; state: CatalogNavState | null; label: string } {
  if (isPublic) {
    return { path: '/oc', state: null, label: 'Back to catalog' };
  }

  if (navState?.backTo) {
    return {
      path: navState.backTo,
      state: navState.backToState ?? null,
      label: backLabelForPath(navState.backTo, catalogBase, itemKind),
    };
  }

  if (itemKind === 'spare') {
    const origin = normalizeCatalogOrigin(navState);

    if (origin === 'product' && navState?.parentProductId) {
      return {
        path: `${catalogBase}/${navState.parentProductId}`,
        state: buildProductNavState(
          navState.parentProductPreview ?? { id: navState.parentProductId } as CatalogProduct,
          {
            origin: 'browse',
            returnCategoryId: navState.returnCategoryId,
          },
        ),
        label: 'Back to product',
      };
    }

    if (origin === 'map' && navState?.parentProductId) {
      return {
        path: `${catalogBase}/map/${navState.parentProductId}`,
        state: {
          preview: navState.parentProductPreview,
          returnCategoryId: navState.returnCategoryId ?? '',
        },
        label: 'Back to product',
      };
    }

    if (origin === 'unlinked') {
      return {
        path: catalogListPath(catalogBase, 'unlinked'),
        state: null,
        label: 'Back to unlinked spares',
      };
    }

    if (origin === 'spares' || origin === 'spares-rack' || origin === 'spares-qr') {
      const restored = sparePartsBackState(navState);
      return {
        path: catalogListPath(catalogBase, 'spares'),
        state: restored,
        label: origin === 'spares-rack' ? 'Back to rack view' : 'Back to spare parts',
      };
    }

    if (origin === 'search') {
      return {
        path: catalogSearchPath(catalogBase, navState?.searchQuery),
        state: null,
        label: 'Back to search',
      };
    }

    if (navState?.parentProductId) {
      return {
        path: `${catalogBase}/map/${navState.parentProductId}`,
        state: {
          preview: navState.parentProductPreview,
          returnCategoryId: navState.returnCategoryId ?? '',
        },
        label: 'Back to product',
      };
    }

    const focus = peekSpareReturnFocus();
    if (focus) {
      return {
        path: catalogListPath(catalogBase, 'spares'),
        state: sparePartsBackState(navState),
        label: focus.viewMode === 'rack' ? 'Back to rack view' : 'Back to spare parts',
      };
    }

    return {
      path: catalogListPath(catalogBase, 'spares'),
      state: null,
      label: 'Back to spare parts',
    };
  }

  if (navState?.parentSpareId) {
    const spareState = navState.parentSpareNav ?? buildSpareNavState(
      navState.parentSparePreview ?? { id: navState.parentSpareId } as CatalogProduct,
      { origin: 'browse' },
    );
    return {
      path: `${catalogBase}/spare/${navState.parentSpareId}`,
      state: spareState,
      label: 'Back to spare',
    };
  }

  const origin = normalizeCatalogOrigin(navState);

  if (navState?.returnCategoryId) {
    return {
      path: `${catalogBase}?category=${encodeURIComponent(navState.returnCategoryId)}`,
      state: null,
      label: 'Back to catalog',
    };
  }

  if (origin === 'search') {
    return {
      path: catalogSearchPath(catalogBase, navState?.searchQuery),
      state: null,
      label: 'Back to catalog',
    };
  }

  return { path: catalogBase, state: null, label: 'Back to catalog' };
}

function backLabelForPath(path: string, _catalogBase: string, itemKind: 'product' | 'spare'): string {
  if (path.includes('/map/')) return 'Back to product';
  if (path.includes('/spare/')) return 'Back to spare';
  if (path.includes('section=unlinked')) return 'Back to unlinked spares';
  if (path.includes('section=spares')) return 'Back to spare parts';
  if (itemKind === 'spare') return 'Back to product';
  return 'Back to catalog';
}

export function catalogOriginFromReturnView(returnView?: string): CatalogNavOrigin {
  if (returnView === 'unlinked') return 'unlinked';
  if (returnView === 'spares') return 'spares';
  if (returnView === 'map') return 'map';
  return 'browse';
}

/** Origins that should restore spare-parts list/rack context on back. */
export function isSparePartsListOrigin(origin?: CatalogNavOrigin | null): boolean {
  return origin === 'spares'
    || origin === 'spares-rack'
    || origin === 'spares-qr';
}
