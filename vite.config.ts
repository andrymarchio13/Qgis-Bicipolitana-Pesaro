import { existsSync, readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Il percorso base è configurabile perché su GitHub Pages il sito vive in una
 * sottocartella (`/<nome-repo>/`). In CI viene passato via BASE_PATH.
 */
const base = process.env.BASE_PATH ?? '/';

/**
 * TLS solo su richiesta esplicita (`npm run dev:mobile`).
 *
 * Lo sviluppo normale resta in HTTP: su `localhost` i browser considerano
 * l'origine sicura, quindi anche la geolocalizzazione funziona e non serve
 * alcun certificato. Dal telefono invece si apre l'indirizzo di rete, che
 * origine sicura non è: lì senza HTTPS il browser nega la posizione a
 * prescindere dall'app, e serve il certificato generato da `npm run cert`.
 */
function devHttps(mode: string) {
  if (mode !== 'mobile') return undefined;
  const key = 'certs/dev.key';
  const cert = 'certs/dev.crt';
  if (!existsSync(key) || !existsSync(cert)) {
    throw new Error(
      'Certificati mancanti in certs/. Esegui `npm run cert` prima di `npm run dev:mobile`.',
    );
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

export default defineConfig(({ mode }) => ({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Bicipolitana Pesaro — Navigatore ciclabile',
        short_name: 'Bicipolitana',
        description:
          'Scopri le linee della Bicipolitana di Pesaro e calcola il tuo percorso in bicicletta.',
        lang: 'it',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#0a4a30',
        categories: ['travel', 'navigation', 'maps'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // I dati del progetto sono statici e vanno resi disponibili offline;
        // il grafo di routing supera la soglia predefinita di 2 MB.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        runtimeCaching: [
          {
            // Dati GIS del progetto: prima la cache, aggiornata in background.
            urlPattern: ({ url }) => url.pathname.includes('/data/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'bicipolitana-dati',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Mattonelle della mappa: cache limitata, mai un download massivo.
            urlPattern: ({ url }) =>
              url.host.includes('basemaps.cartocdn.com') || url.host.includes('tile.openstreetmap.org'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'bicipolitana-tiles',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.host.includes('fonts.openmaptiles.org'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'bicipolitana-glyphs',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: { https: devHttps(mode) },
  preview: { https: devHttps(mode) },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
