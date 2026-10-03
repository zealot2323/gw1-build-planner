-- GW1 Build Planner: GWToolbox completion uploads.
-- Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
--
-- The uploader runs on the player's own machine (a Steam Deck, in the case
-- this was built for) and cannot hold a Supabase session: our auth is
-- magic-link, and row-level security keys off auth.uid(). So the uploader
-- gets a DEVICE TOKEN instead, obtained once by typing a short pairing code
-- shown on the site, and sends that with each upload.
--
-- Rules this file keeps:
--   * The player's machine never holds anything but a token scoped to one
--     action ("replace my completion upload") and revocable from the site.
--   * Only the SHA-256 of a token is stored. A leaked database cannot
--     upload on anyone's behalf.
--   * The uploader posts the file UNCHANGED. Decoding it into characters,
--     skills and maps happens in the app, where the id tables live and the
--     logic is tested — not in SQL.
--   * Nothing here can read or write the saves table. The worst a stolen
--     token can do is replace that account's pending upload.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  label        text not null default 'GWToolbox uploader',
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists devices_user_id_idx on public.devices (user_id);

-- A code is shown on the site and typed into the uploader once. Short life,
-- single use: it is a handoff, not a credential.
create table if not exists public.pairing_codes (
  code       text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- The most recent file from any of the account's devices. One row per user:
-- the file is a complete picture every time, so there is no history to keep.
create table if not exists public.completion_uploads (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  data        jsonb not null,
  device_id   uuid references public.devices (id) on delete set null,
  uploaded_at timestamptz not null default now()
);

alter table public.devices enable row level security;
alter table public.pairing_codes enable row level security;
alter table public.completion_uploads enable row level security;

-- Signed-in users can see and delete their own devices, and read their own
-- upload. Everything else happens through the functions below, which run as
-- the definer precisely because the uploader is not signed in.
drop policy if exists "read own devices"    on public.devices;
drop policy if exists "delete own devices"  on public.devices;
drop policy if exists "read own upload"     on public.completion_uploads;
drop policy if exists "delete own upload"   on public.completion_uploads;

create policy "read own devices"   on public.devices            for select using (auth.uid() = user_id);
create policy "delete own devices" on public.devices            for delete using (auth.uid() = user_id);
create policy "read own upload"    on public.completion_uploads for select using (auth.uid() = user_id);
create policy "delete own upload"  on public.completion_uploads for delete using (auth.uid() = user_id);

revoke all on public.devices, public.pairing_codes, public.completion_uploads from anon, authenticated;
grant select, delete on public.devices to authenticated;
grant select, delete on public.completion_uploads to authenticated;

-- ---------------------------------------------------------------------------
-- Pairing: the site mints a code, the uploader trades it for a token
-- ---------------------------------------------------------------------------

-- No I, O, 0 or 1: this gets read off a screen and typed on a Steam Deck.
create or replace function public.pairing_alphabet()
returns text language sql immutable as $$ select 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' $$;

create or replace function public.create_pairing_code()
returns table (code text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare
  alphabet text := public.pairing_alphabet();
  generated text := '';
  i int;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  -- One live code per account, so an abandoned one cannot be claimed later.
  delete from public.pairing_codes where user_id = auth.uid() or expires_at < now();

  -- From the CSPRNG, not random(): this code grants write access to the
  -- account for as long as it lives. The alphabet is 32 characters and a
  -- byte is 256 values, so taking the byte modulo 32 is unbiased.
  for i in 1..8 loop
    generated := generated || substr(alphabet, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % 32), 1);
  end loop;

  insert into public.pairing_codes (code, user_id, expires_at)
  values (generated, auth.uid(), now() + interval '15 minutes');

  return query select generated, now() + interval '15 minutes';
end;
$$;

-- Called by the uploader, which is anonymous. Returns the token once and
-- never again: only its hash is kept.
create or replace function public.claim_pairing_code(pairing_code text, device_label text default 'GWToolbox uploader')
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  owner uuid;
  token text;
begin
  delete from public.pairing_codes where expires_at < now();

  select user_id into owner from public.pairing_codes
   where code = upper(trim(pairing_code)) and expires_at > now();
  if owner is null then
    raise exception 'that pairing code is not valid any more';
  end if;

  -- Single use: claiming it spends it.
  delete from public.pairing_codes where code = upper(trim(pairing_code));

  token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.devices (user_id, label, token_hash)
  values (owner, coalesce(nullif(trim(device_label), ''), 'GWToolbox uploader'),
          encode(extensions.digest(token, 'sha256'), 'hex'));

  return token;
end;
$$;

-- ---------------------------------------------------------------------------
-- Upload
-- ---------------------------------------------------------------------------

create or replace function public.upload_completion(device_token text, payload jsonb)
returns timestamptz
language plpgsql security definer set search_path = public, extensions as $$
declare
  device public.devices%rowtype;
begin
  select * into device from public.devices
   where token_hash = encode(extensions.digest(device_token, 'sha256'), 'hex');
  if device.id is null then
    raise exception 'unknown device token';
  end if;

  -- character_completion.json is tens of kilobytes. A megabyte is already
  -- something other than that file.
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload must be a JSON object of characters';
  end if;
  if length(payload::text) > 1048576 then
    raise exception 'payload too large';
  end if;

  insert into public.completion_uploads (user_id, data, device_id, uploaded_at)
  values (device.user_id, payload, device.id, now())
  on conflict (user_id) do update
    set data = excluded.data, device_id = excluded.device_id, uploaded_at = excluded.uploaded_at;

  update public.devices set last_used_at = now() where id = device.id;
  return now();
end;
$$;

revoke all on function public.create_pairing_code() from public, anon;
revoke all on function public.claim_pairing_code(text, text) from public;
revoke all on function public.upload_completion(text, jsonb) from public;

grant execute on function public.create_pairing_code() to authenticated;
-- The uploader is anonymous until it has a token; both of these authenticate
-- themselves by what they are given, not by who is calling.
grant execute on function public.claim_pairing_code(text, text) to anon, authenticated;
grant execute on function public.upload_completion(text, jsonb) to anon, authenticated;
