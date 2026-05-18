/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_IDENTITY_HUB_URL?: string;
  readonly VITE_SITE_URL?: string;
  readonly VITE_PRODUCT_NAME?: string;
  readonly VITE_PRODUCT_LONG_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
