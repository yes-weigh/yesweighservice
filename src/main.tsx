import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './hr.css';
import './yes-store.css';
import App from './App';

/** Stale production SW on localhost breaks Vite HMR and causes Workbox noise. */
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then(regs => {
    for (const reg of regs) void reg.unregister();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
