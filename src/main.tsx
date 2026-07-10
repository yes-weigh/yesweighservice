import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import './hr.css';
import './settings.css';
import './yes-store.css';
import App from './App';

const isNative = Capacitor.isNativePlatform();

/**
 * Browser/PWA: keep the service worker (offline + installability).
 * Android APK thin shell: no SW — always load the latest hosting deploy.
 */
if (isNative) {
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.getRegistrations().then(regs => {
      for (const reg of regs) void reg.unregister();
    });
    if ('caches' in window) {
      void caches.keys().then(keys => {
        for (const key of keys) void caches.delete(key);
      });
    }
  }

  // After ~20s in background, reload so a finished GitHub deploy shows up on return.
  let backgroundedAt: number | null = null;
  void CapApp.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) {
      backgroundedAt = Date.now();
      return;
    }
    if (backgroundedAt != null && Date.now() - backgroundedAt >= 20_000) {
      window.location.reload();
    }
    backgroundedAt = null;
  });
} else if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  /** Stale production SW on localhost breaks Vite HMR and causes Workbox noise. */
  void navigator.serviceWorker.getRegistrations().then(regs => {
    for (const reg of regs) void reg.unregister();
  });
} else if (!import.meta.env.DEV) {
  registerSW({ immediate: true });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
