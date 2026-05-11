-- Run this once in Supabase Dashboard > SQL Editor.
create table if not exists public.sk_rankings (
  id bigserial primary key,
  player_name text not null default 'PLAYER' check (char_length(player_name) between 1 and 16),
  rank text not null check (rank in ('S', 'A', 'B', 'C', 'D')),
  total integer not null check (total >= 0 and total <= 10000000),
  kills integer not null check (kills >= 0 and kills <= 100000),
  boss_kills integer not null check (boss_kills >= 0 and boss_kills <= 1000),
  earned integer not null check (earned >= 0 and earned <= 10000000),
  phase integer not null check (phase >= 1 and phase <= 999),
  survived_sec integer not null check (survived_sec >= 0 and survived_sec <= 86400),
  cleared boolean not null default false,
  client_run_id text unique,
  created_at timestamptz not null default now()
);

create index if not exists sk_rankings_total_idx
  on public.sk_rankings (total desc, survived_sec desc, created_at asc);

alter table public.sk_rankings enable row level security;

drop policy if exists "sk_rankings_select_public" on public.sk_rankings;
create policy "sk_rankings_select_public"
  on public.sk_rankings
  for select
  to anon
  using (true);

drop policy if exists "sk_rankings_insert_public" on public.sk_rankings;
create policy "sk_rankings_insert_public"
  on public.sk_rankings
  for insert
  to anon
  with check (true);
