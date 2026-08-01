import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type PageHeaderConfig = {
  title?: string | null;
  subtitle?: string | null;
  showBack?: boolean;
  onBack?: (() => void) | null;
  onTitleClick?: (() => void) | null;
  titleExpanded?: boolean;
  /** Orange uppercase title (e.g. create-SO wizard). */
  accentTitle?: boolean;
  /** Mobile: menu + inline search + action in one row (hide page title). */
  mobileCompactHeader?: boolean;
};

type SlotOwner = object;

type PageHeaderContextValue = {
  config: PageHeaderConfig;
  headerSlot: React.ReactNode;
  titleMeta: React.ReactNode;
  topBarAction: React.ReactNode;
  setPageHeader: (config: PageHeaderConfig) => void;
  setHeaderSlot: (slot: React.ReactNode, owner: SlotOwner) => void;
  clearHeaderSlot: (owner: SlotOwner) => void;
  setTitleMeta: (slot: React.ReactNode, owner: SlotOwner) => void;
  clearTitleMeta: (owner: SlotOwner) => void;
  setTopBarAction: (slot: React.ReactNode, owner: SlotOwner) => void;
  clearTopBarAction: (owner: SlotOwner) => void;
  clearPageHeader: () => void;
};

const emptyConfig: PageHeaderConfig = {
  title: null,
  subtitle: null,
  showBack: false,
  onBack: null,
};

function configsEqual(a: PageHeaderConfig, b: PageHeaderConfig): boolean {
  return a.title === b.title
    && a.subtitle === b.subtitle
    && a.showBack === b.showBack
    && a.onBack === b.onBack
    && a.onTitleClick === b.onTitleClick
    && a.titleExpanded === b.titleExpanded
    && a.accentTitle === b.accentTitle
    && a.mobileCompactHeader === b.mobileCompactHeader;
}

const PageHeaderContext = createContext<PageHeaderContextValue | null>(null);

export const PageHeaderProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<PageHeaderConfig>(emptyConfig);
  const [headerSlot, setHeaderSlotState] = useState<React.ReactNode>(null);
  const [titleMeta, setTitleMetaState] = useState<React.ReactNode>(null);
  const [topBarAction, setTopBarActionState] = useState<React.ReactNode>(null);
  const headerSlotOwnerRef = useRef<SlotOwner | null>(null);
  const titleMetaOwnerRef = useRef<SlotOwner | null>(null);
  const topBarActionOwnerRef = useRef<SlotOwner | null>(null);

  const setHeaderSlot = useCallback((slot: React.ReactNode, owner: SlotOwner) => {
    headerSlotOwnerRef.current = owner;
    setHeaderSlotState(prev => (Object.is(prev, slot) ? prev : slot));
  }, []);

  const clearHeaderSlot = useCallback((owner: SlotOwner) => {
    if (headerSlotOwnerRef.current !== owner) return;
    headerSlotOwnerRef.current = null;
    setHeaderSlotState(null);
  }, []);

  const setTitleMeta = useCallback((slot: React.ReactNode, owner: SlotOwner) => {
    titleMetaOwnerRef.current = owner;
    setTitleMetaState(prev => (Object.is(prev, slot) ? prev : slot));
  }, []);

  const clearTitleMeta = useCallback((owner: SlotOwner) => {
    if (titleMetaOwnerRef.current !== owner) return;
    titleMetaOwnerRef.current = null;
    setTitleMetaState(null);
  }, []);

  const setTopBarAction = useCallback((slot: React.ReactNode, owner: SlotOwner) => {
    topBarActionOwnerRef.current = owner;
    setTopBarActionState(prev => (Object.is(prev, slot) ? prev : slot));
  }, []);

  const clearTopBarAction = useCallback((owner: SlotOwner) => {
    if (topBarActionOwnerRef.current !== owner) return;
    topBarActionOwnerRef.current = null;
    setTopBarActionState(null);
  }, []);

  const setPageHeader = useCallback((next: PageHeaderConfig) => {
    setConfig(prev => (configsEqual(prev, next) ? prev : next));
  }, []);

  const clearPageHeader = useCallback(() => {
    setConfig(prev => (configsEqual(prev, emptyConfig) ? prev : emptyConfig));
  }, []);

  const value = useMemo(
    () => ({
      config,
      headerSlot,
      titleMeta,
      topBarAction,
      setPageHeader,
      setHeaderSlot,
      clearHeaderSlot,
      setTitleMeta,
      clearTitleMeta,
      setTopBarAction,
      clearTopBarAction,
      clearPageHeader,
    }),
    [
      config,
      headerSlot,
      titleMeta,
      topBarAction,
      setPageHeader,
      setHeaderSlot,
      clearHeaderSlot,
      setTitleMeta,
      clearTitleMeta,
      setTopBarAction,
      clearTopBarAction,
      clearPageHeader,
    ],
  );

  return (
    <PageHeaderContext.Provider value={value}>
      {children}
    </PageHeaderContext.Provider>
  );
};

export function usePageHeader() {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) {
    throw new Error('usePageHeader must be used within PageHeaderProvider');
  }
  return ctx;
}

export function useCatalogPageHeader(config: PageHeaderConfig, enabled = true) {
  const ctx = useContext(PageHeaderContext);
  const setPageHeader = ctx?.setPageHeader;
  const {
    title = null,
    subtitle = null,
    showBack = false,
    onBack = null,
    onTitleClick = null,
    titleExpanded = false,
    accentTitle = false,
    mobileCompactHeader = false,
  } = config;
  const onBackRef = useRef(onBack);
  const onTitleClickRef = useRef(onTitleClick);
  onBackRef.current = onBack;
  onTitleClickRef.current = onTitleClick;

  useEffect(() => {
    if (!setPageHeader || !enabled) return undefined;

    if (!title && !showBack && !mobileCompactHeader) {
      setPageHeader(emptyConfig);
      return undefined;
    }

    const stableOnBack = showBack
      ? () => onBackRef.current?.()
      : null;

    const stableOnTitleClick = onTitleClick
      ? () => onTitleClickRef.current?.()
      : null;

    setPageHeader({
      title,
      subtitle,
      showBack,
      onBack: stableOnBack,
      onTitleClick: stableOnTitleClick,
      titleExpanded,
      accentTitle,
      mobileCompactHeader,
    });
    return () => setPageHeader(emptyConfig);
  }, [
    setPageHeader,
    enabled,
    title,
    subtitle,
    showBack,
    onTitleClick,
    titleExpanded,
    accentTitle,
    mobileCompactHeader,
  ]);
}

function useOwnedHeaderSlot(
  setSlot: ((slot: React.ReactNode, owner: SlotOwner) => void) | undefined,
  clearSlot: ((owner: SlotOwner) => void) | undefined,
  slot: React.ReactNode | null,
  enabled: boolean,
) {
  const ownerRef = useRef<SlotOwner | null>(null);
  if (ownerRef.current === null) {
    ownerRef.current = {};
  }
  const owner = ownerRef.current;
  const slotRef = useRef(slot);
  slotRef.current = slot;

  useEffect(() => {
    if (!clearSlot) return undefined;
    return () => clearSlot(owner);
  }, [clearSlot, owner]);

  // Layout effect so controlled header inputs (e.g. catalog search) paint
  // the latest value in the same frame instead of one effect tick behind.
  // Clearing is owner-guarded so a previous page's delayed cleanup cannot
  // wipe the slot after the next page has already claimed it.
  useLayoutEffect(() => {
    if (!setSlot || !clearSlot) return;
    if (enabled) {
      setSlot(slotRef.current, owner);
    } else {
      clearSlot(owner);
    }
  }, [setSlot, clearSlot, enabled, slot, owner]);
}

export function usePageHeaderSlot(slot: React.ReactNode | null, enabled = true) {
  const ctx = useContext(PageHeaderContext);
  useOwnedHeaderSlot(ctx?.setHeaderSlot, ctx?.clearHeaderSlot, slot, enabled);
}

/** Compact pills/badges rendered beside the page title text. */
export function usePageHeaderTitleMeta(slot: React.ReactNode | null, enabled = true) {
  const ctx = useContext(PageHeaderContext);
  useOwnedHeaderSlot(ctx?.setTitleMeta, ctx?.clearTitleMeta, slot, enabled);
}

export function useTopBarAction(slot: React.ReactNode | null, enabled = true) {
  const ctx = useContext(PageHeaderContext);
  useOwnedHeaderSlot(ctx?.setTopBarAction, ctx?.clearTopBarAction, slot, enabled);
}
