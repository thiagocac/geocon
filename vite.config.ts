import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Garante que a tag <script src="/config.js"> permaneça no HTML
 * compilado para deploy. O Vite, por padrão, remove scripts inline
 * sem type="module"; este plugin injeta a referência após o transform.
 */
function injectRuntimeConfig(): Plugin {
  const TAG = '<script src="/config.js"></script>';
  return {
    name: 'inject-runtime-config',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => {
        // Idempotente: não duplica se a tag já estiver presente.
        if (html.includes(TAG)) return html;
        if (/<script\s/.test(html)) {
          return html.replace(/<script\s/, `${TAG}\n    <script `);
        }
        return html.replace('</head>', `    ${TAG}\n  </head>`);
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), injectRuntimeConfig()],
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor':    ['react', 'react-dom', 'react-router-dom'],
          'query-vendor':    ['@tanstack/react-query'],
          'supabase-vendor': ['@supabase/supabase-js'],
          'icons-vendor':    ['lucide-react'],
          'xlsx-vendor':     ['xlsx'],
        },
      },
    },
  },
  server: { port: 5173, strictPort: false },
  preview: { port: 4173 },
});
