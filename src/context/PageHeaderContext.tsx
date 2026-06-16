import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

const PageHeaderContext = createContext<PageHeaderContextValue | null>(null);

export const PageHeaderProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<PageHeaderConfig>(emptyConfig);

  const setPageHeader = useCallback((next: PageHeaderConfig) => {
    setConfig(next);
  }, []);

  const clearPageHeader = useCallback(() => {
    setConfig(emptyConfig);
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
  const { title = null, showBack = false, onBack = null } = config;

  useEffect(() => {
    if (!ctx) return undefined;

    const { setPageHeader, clearPageHeader } = ctx;
    if (!title && !showBack) {
      clearPageHeader();
      return undefined;
    }

    setPageHeader({ title, showBack, onBack });
    return () => clearPageHeader();
  }, [ctx, title, showBack, onBack]);
}
