/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL. Unset = accounts disabled, saves stay in this browser. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon/publishable key — public by design; row-level security protects the data. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
