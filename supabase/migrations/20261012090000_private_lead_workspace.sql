-- Server-only schema: never expose capital_grow through the Supabase Data API.
create schema capital_grow;
revoke all on schema capital_grow from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'capital_grow_app') then
    create role capital_grow_app login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
end $$;
grant usage on schema capital_grow to capital_grow_app;

create table capital_grow.source_workbooks (
  hash text primary key check (hash ~ '^[0-9a-f]{64}$'),
  content bytea not null,
  created_at timestamptz not null default now()
);
create table capital_grow.workspace (
  id integer primary key check (id = 1),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  revision bigint not null default 0,
  source_hash text references capital_grow.source_workbooks(hash),
  updated_at timestamptz not null default now()
);
create table capital_grow.workspace_versions (
  revision bigint primary key,
  payload jsonb not null,
  source_hash text references capital_grow.source_workbooks(hash),
  committed_at timestamptz not null default now()
);
create table capital_grow.memberships (
  email text primary key check (email = lower(email)),
  auth_user_id uuid unique,
  app_user_id text not null unique,
  name text not null,
  role text not null check (role in ('Admin','Manager','Team Leader','Employee')),
  branch_ids text[] not null default '{}',
  floor_operator boolean not null default false,
  can_export boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table capital_grow.transfers (
  id uuid primary key,
  request_key uuid not null unique,
  request_hash text not null,
  file_name text not null,
  floor text not null,
  operator_id text not null,
  committed_at timestamptz not null,
  payload jsonb not null,
  unique (file_name)
);
create unique index transfers_normalized_file on capital_grow.transfers(lower(btrim(file_name)));
create index transfers_floor_time on capital_grow.transfers(floor,committed_at desc);
create table capital_grow.file_reservations (
  normalized_name text primary key,
  operation_id text not null,
  created_at timestamptz not null default now()
);
create table capital_grow.row_allocations (
  source_key text not null,
  language text not null,
  row_number integer not null check (row_number > 0),
  operation_id text not null,
  primary key(source_key,language,row_number)
);
create index row_allocations_operation on capital_grow.row_allocations(operation_id);
create table capital_grow.security_events (
  id uuid primary key default gen_random_uuid(),
  actor_id text,
  event text not null,
  details jsonb not null default '{}',
  at timestamptz not null default now()
);
create index security_events_time on capital_grow.security_events(at desc);
create table capital_grow.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null
);

-- RLS is defense in depth even if this schema is accidentally exposed later.
do $$ declare item text; begin
  foreach item in array array['source_workbooks','workspace','workspace_versions','memberships','transfers','file_reservations','row_allocations','security_events','rate_limits'] loop
    execute format('alter table capital_grow.%I enable row level security',item);
    execute format('alter table capital_grow.%I force row level security',item);
    execute format('revoke all on capital_grow.%I from public, anon, authenticated',item);
    execute format('create policy app_server_only on capital_grow.%I to capital_grow_app using (true) with check (true)',item);
  end loop;
end $$;
grant select,insert,update on capital_grow.workspace,capital_grow.memberships,capital_grow.rate_limits to capital_grow_app;
grant select,insert on capital_grow.source_workbooks,capital_grow.workspace_versions,capital_grow.transfers,capital_grow.file_reservations,capital_grow.row_allocations,capital_grow.security_events to capital_grow_app;
alter default privileges in schema capital_grow revoke all on tables from public, anon, authenticated;
alter default privileges in schema capital_grow revoke execute on functions from public, anon, authenticated;
