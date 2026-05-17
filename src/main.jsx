import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './styles/global.css';
import App from './App.jsx';
import { firebaseReady } from '../firebase';

registerSW({ immediate: true });

// Wait for App Check to have its first token before mounting React.
// Otherwise the first Firestore operation can open a WebChannel session
// without an App Check token, and every write fails rules that require
// `request.app != null` for the lifetime of that session.
await firebaseReady;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
