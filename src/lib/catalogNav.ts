import type { CatalogProduct } from '../types/catalog';

export type CatalogNavOrigin =
  | 'browse'
  | 'search'
  | 'spares'
  | 'unlinked'
  | 'map'
  | 'product'
  | 'spare';

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
  },
): CatalogNavState {
  const state: CatalogNavState = {
    preview: spare,
    origin: ctx.origin,
  };
  if (ctx.parentProduct) {
    state.parentProductId = ctx.parentProduct.id;
    state.parentProductPreview = ctx.parentProduct;
    state.returnCategoryId = ctx.returnCategoryId ?? ctx.parentProduct.categoryId ?? '';
  }
  if (ctx.searchQuery?.trim()) state.searchQuery = ctx.searchQuery.trim();
  if (ctx.origin === 'unlinked') state.returnView = 'unlinked';
  if (ctx.origin === 'spares') state.returnView = 'spares';
  if (ctx.origin === 'map') state.returnView = 'map';
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

    if (origin === 'spares') {
      return {
        path: catalogListPath(catalogBase, 'spares'),
        state: null,
        label: 'Back to spare parts',
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
