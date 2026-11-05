create table if not exists capital_grow.pipeline_imports (
 id uuid primary key,
 confirmation_token text not null unique,
 created_at timestamptz not null default now(),
 absorbed boolean not null default false,
 batch jsonb not null,
 leads jsonb not null,
 operations jsonb not null,
 audit jsonb not null
);
alter table capital_grow.pipeline_imports enable row level security;
revoke all on capital_grow.pipeline_imports from public,anon,authenticated;
grant select,insert,update on capital_grow.pipeline_imports to capital_grow_app;
drop policy if exists pipeline_imports_private on capital_grow.pipeline_imports;
create policy pipeline_imports_private on capital_grow.pipeline_imports to capital_grow_app using(true) with check(true);
create or replace view capital_grow.workspace_read with (security_invoker=true) as
select w.id,w.revision,w.source_hash,w.updated_at,
w.payload || jsonb_build_object(
 'batches',coalesce((select jsonb_agg(p.batch order by p.created_at desc,p.id) from capital_grow.pipeline_imports p where not p.absorbed),'[]'::jsonb)||coalesce(w.payload->'batches','[]'::jsonb),
 'leads',coalesce(w.payload->'leads','[]'::jsonb)||coalesce((select jsonb_agg(x.item order by p.created_at,p.id,x.n) from capital_grow.pipeline_imports p cross join lateral jsonb_array_elements(p.leads) with ordinality as x(item,n) where not p.absorbed),'[]'::jsonb),
 'operations',coalesce(w.payload->'operations','[]'::jsonb)||coalesce((select jsonb_agg(x.item order by p.created_at,p.id,x.n) from capital_grow.pipeline_imports p cross join lateral jsonb_array_elements(p.operations) with ordinality as x(item,n) where not p.absorbed),'[]'::jsonb),
 'audit',coalesce((select jsonb_agg(x.item order by p.created_at desc,p.id,x.n) from capital_grow.pipeline_imports p cross join lateral jsonb_array_elements(p.audit) with ordinality as x(item,n) where not p.absorbed),'[]'::jsonb)||coalesce(w.payload->'audit','[]'::jsonb)
) as payload from capital_grow.workspace w;
grant select on capital_grow.workspace_read to capital_grow_app;
