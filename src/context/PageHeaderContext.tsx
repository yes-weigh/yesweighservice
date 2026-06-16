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
  showBack?: boolean;
  onBack?: (() => void) | null;
};

type PageHeaderContextValue = {
  config: PageHeaderConfig;
  setPageHeader: (config: PageHeaderConfig) => void;
  clearPageHeader: () => void;
};

const emptyConfig: PageHeaderConfig = {
  title: null,
  showBack: false,
  onBack: null,
};

function configsEqual(a: PageHeaderConfig, b: PageHeaderConfig): boolean {
  return a.title === b.title
    && a.showBack === b.showBack
    && a.onBack === b.onBack;
}

const PageHeaderContext = createContext<PageHeaderContextValue | null>(null);

export const PageHeaderProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<PageHeaderConfig>(emptyConfig);

  const setPageHeader = useCallback((next: PageHeaderConfig) => {
    setConfig(prev => (configsEqual(prev, next) ? prev : next));
  }, []);

  const clearPageHeader = useCallback(() => {
    setConfig(prev => (configsEqual(prev, emptyConfig) ? prev : emptyConfig));
  }, []);

  const value = useMemo(
    () => ({ config, setPageHeader, clearPageHeader }),
    [config, setPageHeader, clearPageHeader],
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
  const { title = null, showBack = false, onBack = null } = config;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!setPageHeader || !clearPageHeader) return undefined;

    if (!title && !showBack) {
      clearPageHeader();
      return undefined;
    }

    const stableOnBack = showBack
      ? () => onBackRef.current?.()
      : null;

    setPageHeader({ title, showBack, onBack: stableOnBack });
    return () => clearPageHeader();
  }, [setPageHeader, clearPageHeader, title, showBack]);
}
