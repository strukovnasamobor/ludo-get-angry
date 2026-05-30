import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { Capacitor } from '@capacitor/core';
import { FirebaseAppCheck } from '@capacitor-firebase/app-check';
import './styles/global.css';
import App from './App.jsx';

// Wrapped in an async IIFE because Vite's default browser target doesn't
// allow top-level await. Fire-and-forget — App Check init failing is
// non-fatal, and Firebase Auth requests that need a token will just retry
// once the provider is ready.
if (Capacitor.isNativePlatform()) {
  // Marker class scoped to native: CSS can target html.capacitor-native to
  // disable safe-area insets, force fullscreen layout, etc. — without
  // affecting the web/browser PWA where those insets still matter.
  document.documentElement.classList.add('capacitor-native');

  (async () => {
    try {
      await FirebaseAppCheck.initialize({
        provider: 'playIntegrity',
        isTokenAutoRefreshEnabled: true
      });
    } catch (e) {
      console.warn('AppCheck init failed:', e?.message || e);
    }
  })();
}

registerSW({ immediate: true });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
