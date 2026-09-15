/**
 * Supabase client for accounts + cloud saves.
 *
 * Optional by design: with no URL/key configured (local dev, or a deploy
 * before the project exists) this is null and the app runs exactly as
 * before, saving to localStorage. The key is Supabase's public
 * anon/publishable key — safe to ship in a static site, because the
 * `saves` table's row-level security only lets a user touch their own row
 * (see /supabase/schema.sql).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
