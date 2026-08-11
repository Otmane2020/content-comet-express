-- Google Maps businesses are a separate competitor set from organic domains:
-- a GBP listing can rank repeatedly without owning a crawlable website.
create table if not exists public.local_competitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  identity text not null,
  name text not null,
  domain text,
  place_id text,
  country text not null,
  city text,
  category text,
  rating numeric,
  review_count integer,
  queries_found_for text[] not null default '{}',
  local_pack_positions integer[] not null default '{}',
  recurrence_score numeric not null default 0,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, identity)
);

create index if not exists local_competitors_project_score_idx
  on public.local_competitors (project_id, recurrence_score desc);

grant select, insert, update, delete on public.local_competitors to authenticated;
grant all on public.local_competitors to service_role;
alter table public.local_competitors enable row level security;

create policy "Users manage their own local competitors"
  on public.local_competitors
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
