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
        // Default `globPatterns` is `**/*.{js,css,html,ico,png,svg,webp,...}`
        // which already covers the vite-emitted hashed bundles, the
        // PWA icons, and `index.html`. Keep it explicit so future
        // additions to `dist/` (e.g. fonts, mp3s for the silent-loop
        // gapless trick) get included automatically.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webp,woff2,woff,ttf}'],
        // SPA navigation fallback. Without this, the SW only matches
        // exact precached URLs — a deep link like `/bratan-music/album/123`
        // misses precache and tries the network; if the device is
        // offline the request fails outright and the PWA shows an
        // empty / "no internet" screen. Pointing all navigation
        // requests at the precached `index.html` lets React Router
        // take over and render the correct page from cached state.
        // We deny-list API endpoints so worker calls (which the SW
        // shouldn't intercept as navigations) keep their normal
        // network-only behaviour.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [
          /^\/?api\//,
          /^\/?worker\//,
          // Auth + WebSocket upgrade paths. The first is the FE-side
          // auth handshake against the worker; the second covers any
          // future WS routes (rooms / live status). Both must NOT be
          // shadowed by an `index.html` fallback.
          /^\/?auth\//,
          /^\/?ws\//,
        ],
        // Runtime caching: cover artwork (Tidal CDN) + the worker's
        // public read endpoints. Lets the home / library / artist
        // pages render with cover art on a cold offline open after
        // they've been visited online once. `StaleWhileRevalidate`
        // serves the cached response immediately and refreshes the
        // cache in the background when online — perfect for covers
        // (occasional changes are fine, the visible content is what
        // matters). The catalog API uses `NetworkFirst` with a 5s
        // timeout fallback to cache so online users still see fresh
        // data, but offline users get the last-known response.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\.(?:png|jpg|jpeg|webp|gif|svg)$/i.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'bratan-images',
              expiration: { maxEntries: 240, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.hostname.endsWith('tidal.com') || url.hostname.endsWith('tidalhifi.com'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'bratan-tidal-covers',
              expiration: { maxEntries: 240, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
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
