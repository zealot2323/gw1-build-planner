-- GW1 Build Planner: cloud saves.
-- Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
--
-- One row per account, holding the whole save file (the same JSON the app
-- exports: {"version": 1, "characters": [...]}). Row-level security means a
-- signed-in user can only ever read or write their own row, which is what
-- makes it safe for the site to ship Supabase's public key.

create table if not exists public.saves (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.saves enable row level security;

drop policy if exists "read own save"   on public.saves;
drop policy if exists "insert own save" on public.saves;
drop policy if exists "update own save" on public.saves;
drop policy if exists "delete own save" on public.saves;

create policy "read own save"   on public.saves for select using (auth.uid() = user_id);
create policy "insert own save" on public.saves for insert with check (auth.uid() = user_id);
create policy "update own save" on public.saves for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own save" on public.saves for delete using (auth.uid() = user_id);

-- Signed-out visitors get nothing; signed-in users get the table, filtered by the policies above.
revoke all on public.saves from anon;
grant select, insert, update, delete on public.saves to authenticated;
