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
      // Service-worker pre-cache list. The favicon SVG itself is
      // served as a regular module asset (no need to cache it twice),
      // but the 32×32 PNG fallback ships through the SW so Safari
      // (which keeps reaching for it instead of the SVG, see
      // index.html) gets a fast offline-capable hit. The
      // apple-touch-icon must be reachable at the project subpath for
      // iOS home-screen installs to find it.
      includeAssets: ['apple-touch-icon.png', 'favicon-32x32.png'],
      // The default registration installs the new service worker but
      // keeps the OLD one active until every controlled tab closes.
      // For users who already had a previous SW installed, that meant
      // their old precache (which still pointed at the previous
      // PNG-in-SVG `favicon.svg` and the deleted `favicon.ico`) kept
      // serving stale icons forever, even though the deployed
      // `index.html` already declared the new vector favicon. The
      // user-visible bug was "и фавикон сайта все равно почему-то
      // другой (как пнг)".
      //
      // Three flags fix it:
      //   - `skipWaiting` — the new SW activates as soon as it's
      //     installed instead of waiting for all clients to navigate
      //     away.
      //   - `clientsClaim` — the activated SW immediately takes
      //     control of every existing open tab, so the next request
      //     for `/favicon.svg` (or anything else) is served from the
      //     fresh precache.
      //   - `cleanupOutdatedCaches` — purges the previous precache
      //     keys so the orphan `favicon.ico` / old `favicon.svg`
      //     entries are reclaimed instead of lingering on disk.
      //
      // `autoUpdate` already calls `registration.update()` on every
      // navigation; combined with the three flags above, a single
      // page reload after deployment fully evicts the previous SW.
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
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
