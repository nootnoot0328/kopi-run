-- Kopi Run collaborative prototype schema
-- All browser traffic should go through the run-api Edge Function.
-- Tables are RLS-protected and are intentionally not granted to anon/authenticated.

create extension if not exists pgcrypto;

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  share_token text not null unique,
  runner_key_hash text not null,
  group_name text,
  status text not null default 'OPEN'
    check (status in ('OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED')),
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  drink text not null check (char_length(drink) between 1 and 120),
  edit_token_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_run_id_idx on public.orders(run_id);
create index if not exists runs_share_token_idx on public.runs(share_token);

alter table public.runs enable row level security;
alter table public.orders enable row level security;

revoke all on public.runs from anon, authenticated;
revoke all on public.orders from anon, authenticated;

grant all on public.runs to service_role;
grant all on public.orders to service_role;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

comment on table public.runs is
  'Temporary collaborative Kopi Run sessions. Accessed through the run-api Edge Function.';
comment on table public.orders is
  'Participant orders for a collaborative run. Edit credentials are stored only as hashes.';
