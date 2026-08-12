create table public.asset_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  remote_group_id text,
  name text not null,
  group_type text not null default 'AIGC',
  kind text not null default 'aigc',
  verify_status text not null default 'none',
  verify_session_id text,
  verify_h5_link text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, remote_group_id)
);
grant select, insert, update, delete on public.asset_groups to authenticated;
grant all on public.asset_groups to service_role;
create index asset_groups_tenant_idx on public.asset_groups (tenant_id, created_at desc);
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  group_id uuid references public.asset_groups(id) on delete cascade,
  character_id uuid references public.characters(id) on delete set null,
  remote_asset_id text,
  name text not null,
  asset_type text not null default 'image',
  status text not null default 'draft',
  source_url text,
  thumbnail_url text,
  storage_path text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, remote_asset_id)
);
grant select, insert, update, delete on public.assets to authenticated;
grant all on public.assets to service_role;
create index assets_tenant_idx on public.assets (tenant_id, created_at desc);
create index assets_group_idx on public.assets (group_id);
create index assets_character_idx on public.assets (character_id);
alter table public.asset_groups enable row level security;
create policy "tenant asset_groups" on public.asset_groups
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
alter table public.assets enable row level security;
create policy "tenant assets" on public.assets
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
create trigger asset_groups_updated_at
  before update on public.asset_groups
  for each row execute function public.update_updated_at_column();
create trigger assets_updated_at
  before update on public.assets
  for each row execute function public.update_updated_at_column();