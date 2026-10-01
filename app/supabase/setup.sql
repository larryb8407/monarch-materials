-- Monarch Materials team database.
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run. Safe to run again.

-- Who may sign in. Only emails listed here can create an account or read any data.
create table if not exists public.team (
  email text primary key check (email = lower(email)),
  name text not null default '',
  role text not null default 'caller' check (role in ('owner', 'caller')),
  added_at timestamptz not null default now()
);
insert into public.team (email, name, role) values ('larryb8407@gmail.com', 'Larry', 'owner')
  on conflict (email) do nothing;

-- Role of the signed-in user: 'owner', 'caller', or null when they are not on the team (or were removed).
create or replace function public.my_role() returns text
  language sql stable security definer set search_path = public
as $$ select role from public.team where email = lower(auth.jwt() ->> 'email') $$;

-- One row per prospect; the app's prospect object (minus calls) lives in data.
create table if not exists public.prospects (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text default lower(auth.jwt() ->> 'email')
);

-- One row per logged call, with who made it.
create table if not exists public.calls (
  id bigint primary key,
  prospect_id bigint not null references public.prospects (id) on delete cascade,
  at bigint not null,
  data jsonb not null,
  by_email text not null default lower(auth.jwt() ->> 'email'),
  by_name text not null default ''
);
create index if not exists calls_prospect_idx on public.calls (prospect_id);

alter table public.team enable row level security;
alter table public.prospects enable row level security;
alter table public.calls enable row level security;

drop policy if exists team_read on public.team;
drop policy if exists team_owner_write on public.team;
create policy team_read on public.team for select to authenticated using (public.my_role() is not null);
create policy team_owner_write on public.team for all to authenticated
  using (public.my_role() = 'owner') with check (public.my_role() = 'owner');

drop policy if exists prospects_team on public.prospects;
create policy prospects_team on public.prospects for all to authenticated
  using (public.my_role() is not null) with check (public.my_role() is not null);

drop policy if exists calls_read on public.calls;
drop policy if exists calls_insert on public.calls;
drop policy if exists calls_owner_change on public.calls;
drop policy if exists calls_owner_delete on public.calls;
create policy calls_read on public.calls for select to authenticated using (public.my_role() is not null);
create policy calls_insert on public.calls for insert to authenticated
  with check (public.my_role() is not null and by_email = lower(auth.jwt() ->> 'email'));
create policy calls_owner_change on public.calls for update to authenticated
  using (public.my_role() = 'owner') with check (public.my_role() = 'owner');
create policy calls_owner_delete on public.calls for delete to authenticated using (public.my_role() = 'owner');

-- Block sign-ups from anyone who is not on the team list.
create or replace function public.gate_signup() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.team where email = lower(new.email)) then
    raise exception 'NOT_ON_TEAM';
  end if;
  return new;
end $$;
drop trigger if exists gate_signup on auth.users;
create trigger gate_signup before insert on auth.users for each row execute function public.gate_signup();

-- Per-person settings kept in the cloud (each person's drive route). Added later; safe to run on its own.
create table if not exists public.user_state (
  email text primary key default lower(auth.jwt() ->> 'email'),
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.user_state enable row level security;
drop policy if exists user_state_own on public.user_state;
create policy user_state_own on public.user_state for all to authenticated
  using (email = lower(auth.jwt() ->> 'email') and public.my_role() is not null)
  with check (email = lower(auth.jwt() ->> 'email') and public.my_role() is not null);

-- Live updates: send prospect and call changes to every signed-in phone right away. Safe to run again.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'prospects') then
    alter publication supabase_realtime add table public.prospects;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'calls') then
    alter publication supabase_realtime add table public.calls;
  end if;
end $$;
