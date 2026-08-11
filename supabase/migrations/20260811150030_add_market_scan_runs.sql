create table if not exists public.market_scan_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  website_url text not null,
  locale text not null,
  competitors_count integer not null default 0,
  keywords_count integer not null default 0,
  diagnostics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.market_scan_runs enable row level security;

create policy "Users can read their own market scan history"
on public.market_scan_runs
for select
to authenticated
using ((select auth.uid()) = user_id);

create index if not exists market_scan_runs_user_created_idx
on public.market_scan_runs (user_id, created_at desc);
