import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { Capacitor } from '@capacitor/core';
import './styles/global.css';
import App from './App.jsx';

if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('capacitor-native');
  // Status bar and navigation bar are left at Android defaults (no JS overrides).
  // App Check provider factory is installed natively in MainActivity.java
  // (PlayIntegrity for Play Store installs, Debug for sideload).
}

registerSW({ immediate: true });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
