import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  /** Mobile: menu + inline search + action in one row (hide page title). */
  mobileCompactHeader?: boolean;
};

type PageHeaderContextValue = {
  config: PageHeaderConfig;
  headerSlot: React.ReactNode;
  topBarAction: React.ReactNode;
  setPageHeader: (config: PageHeaderConfig) => void;
  setHeaderSlot: (slot: React.ReactNode) => void;
  setTopBarAction: (slot: React.ReactNode) => void;
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
    && a.mobileCompactHeader === b.mobileCompactHeader;
}

const PageHeaderContext = createContext<PageHeaderContextValue | null>(null);

export const PageHeaderProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<PageHeaderConfig>(emptyConfig);
  const [headerSlot, setHeaderSlotState] = useState<React.ReactNode>(null);
  const [topBarAction, setTopBarActionState] = useState<React.ReactNode>(null);

  const setHeaderSlot = useCallback((slot: React.ReactNode) => {
    setHeaderSlotState(prev => (Object.is(prev, slot) ? prev : slot));
  }, []);

  const setTopBarAction = useCallback((slot: React.ReactNode) => {
    setTopBarActionState(prev => (Object.is(prev, slot) ? prev : slot));
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
      topBarAction,
      setPageHeader,
      setHeaderSlot,
      setTopBarAction,
      clearPageHeader,
    }),
    [config, headerSlot, topBarAction, setPageHeader, setHeaderSlot, setTopBarAction, clearPageHeader],
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
      mobileCompactHeader,
    });
    return () => setPageHeader(emptyConfig);
  }, [setPageHeader, enabled, title, subtitle, showBack, onTitleClick, titleExpanded, mobileCompactHeader]);
}

export function usePageHeaderSlot(slot: React.ReactNode | null, enabled = true) {
  const ctx = useContext(PageHeaderContext);
  const setHeaderSlot = ctx?.setHeaderSlot;
  const slotRef = useRef(slot);
  slotRef.current = slot;

  useEffect(() => {
    if (!setHeaderSlot) return undefined;
    return () => setHeaderSlot(null);
  }, [setHeaderSlot]);

  useEffect(() => {
    if (!setHeaderSlot) return;
    setHeaderSlot(enabled ? slotRef.current : null);
  }, [setHeaderSlot, enabled, slot]);
}

export function useTopBarAction(slot: React.ReactNode | null, enabled = true) {
  const ctx = useContext(PageHeaderContext);
  const setTopBarAction = ctx?.setTopBarAction;
  const slotRef = useRef(slot);
  slotRef.current = slot;

  useEffect(() => {
    if (!setTopBarAction) return undefined;
    return () => setTopBarAction(null);
  }, [setTopBarAction]);

  useEffect(() => {
    if (!setTopBarAction) return;
    setTopBarAction(enabled ? slotRef.current : null);
  }, [setTopBarAction, enabled, slot]);
}
