import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  base: '/bratan-music/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Service-worker pre-cache list. Only PWA-shaped assets — the
      // favicon is SVG and is served as a regular module asset, no
      // need to cache it twice. `favicon.ico` is intentionally absent
      // because the project no longer ships one (favicon is strictly
      // SVG per the product brief).
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'BRATAN MUSIC',
        short_name: 'BRATAN',
        description: 'Музыкальный стриминговый сервис',
        // Mirrors `--color-accent` (light) — the same accent purple the
        // rest of the app uses across buttons / splash / loader. PWA
        // splash uses theme_color for the OS status bar tint and
        // background_color for the launch surface; the legacy
        // Spotify-green / off-black pair was the source of the
        // "лого зелёного цвета а не акцентного" feedback.
        theme_color: '#5E6AD2',
        background_color: '#0a0a0c',
        display: 'standalone',
        scope: '/bratan-music/',
        start_url: '/bratan-music/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
      },
    },
  },
});
