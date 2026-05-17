import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png', 'i18n/en.json', 'i18n/hr.json'],
      workbox: {
        // Don't hijack Firebase Auth's reserved paths with the SPA fallback —
        // the popup needs the real /__/auth/handler served by Firebase Hosting.
        navigateFallbackDenylist: [/^\/__\//],
      },
      manifest: {
        id: "hr.strukovnasamobor.ludo_get_angry",
        name: 'Ludo Get Angry',
        short_name: 'Ludo Get Angry',
        theme_color: '#1a1a2e',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
    }),
  ],
  build: {
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,  // Set to true in production
        drop_debugger: true,  // Set to true in production
      },
    },
  },
})