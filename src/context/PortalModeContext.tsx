import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type PortalMode = 'hr' | 'ops' | 'dealer' | 'dealer_staff';

const STORAGE_KEY = 'yesweigh.portalMode';

export const PORTAL_MODE_LABELS: Record<PortalMode, string> = {
  hr: 'HR',
  ops: 'Operations',
  dealer: 'Dealer',
  dealer_staff: 'Dealer staff',
};

type PortalModeContextValue = {
  mode: PortalMode;
  setMode: (mode: PortalMode) => void;
  homePrefix: string;
};

const PortalModeContext = createContext<PortalModeContextValue | null>(null);

function readStoredMode(): PortalMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'hr' || v === 'ops' || v === 'dealer' || v === 'dealer_staff') return v;
  } catch {
    // ignore
  }
  return 'hr';
}

export const PortalModeProvider: React.FC<{ children: React.ReactNode; basePath: string }> = ({
  children,
  basePath,
}) => {
  const [mode, setModeState] = useState<PortalMode>(readStoredMode);

  const setMode = useCallback((next: PortalMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const homePrefix = useMemo(() => {
    if (mode === 'hr') return `${basePath}/hr`;
    if (mode === 'ops') return basePath;
    if (mode === 'dealer') return `${basePath}/preview/dealer`;
    return `${basePath}/preview/dealer-staff`;
  }, [basePath, mode]);

  const value = useMemo(
    () => ({ mode, setMode, homePrefix }),
    [mode, setMode, homePrefix],
  );

  return (
    <PortalModeContext.Provider value={value}>
      {children}
    </PortalModeContext.Provider>
  );
};

export function usePortalMode(): PortalModeContextValue {
  const ctx = useContext(PortalModeContext);
  if (!ctx) {
    return {
      mode: 'ops',
      setMode: () => {},
      homePrefix: '/super-admin',
    };
  }
  return ctx;
}
