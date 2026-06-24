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
    && a.titleExpanded === b.titleExpanded;
}

const PageHeaderContext = createContext<PageHeaderContextValue | null>(null);

export const PageHeaderProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<PageHeaderConfig>(emptyConfig);
  const [headerSlot, setHeaderSlot] = useState<React.ReactNode>(null);
  const [topBarAction, setTopBarAction] = useState<React.ReactNode>(null);

  const setPageHeader = useCallback((next: PageHeaderConfig) => {
    setConfig(prev => (configsEqual(prev, next) ? prev : next));
  }, []);

  const clearPageHeader = useCallback(() => {
    setConfig(prev => (configsEqual(prev, emptyConfig) ? prev : emptyConfig));
    setHeaderSlot(null);
    setTopBarAction(null);
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
    [config, headerSlot, topBarAction, setPageHeader, clearPageHeader],
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

export function useCatalogPageHeader(config: PageHeaderConfig) {
  const ctx = useContext(PageHeaderContext);
  const setPageHeader = ctx?.setPageHeader;
  const clearPageHeader = ctx?.clearPageHeader;
  const { title = null, subtitle = null, showBack = false, onBack = null, onTitleClick = null, titleExpanded = false } = config;
  const onBackRef = useRef(onBack);
  const onTitleClickRef = useRef(onTitleClick);
  onBackRef.current = onBack;
  onTitleClickRef.current = onTitleClick;

  useEffect(() => {
    if (!setPageHeader || !clearPageHeader) return undefined;

    if (!title && !showBack) {
      clearPageHeader();
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
    });
    return () => clearPageHeader();
  }, [setPageHeader, clearPageHeader, title, subtitle, showBack, onTitleClick, titleExpanded]);
}

export function usePageHeaderSlot(slot: React.ReactNode | null, enabled = true) {
  const ctx = useContext(PageHeaderContext);
  const setHeaderSlot = ctx?.setHeaderSlot;

  useEffect(() => {
    if (!setHeaderSlot) return undefined;
    setHeaderSlot(enabled ? slot : null);
    return () => setHeaderSlot(null);
  }, [setHeaderSlot, enabled, slot]);
}

export function useTopBarAction(slot: React.ReactNode | null, enabled = true) {
  const ctx = useContext(PageHeaderContext);
  const setTopBarAction = ctx?.setTopBarAction;

  useEffect(() => {
    if (!setTopBarAction) return undefined;
    setTopBarAction(enabled ? slot : null);
    return () => setTopBarAction(null);
  }, [setTopBarAction, enabled, slot]);
}
