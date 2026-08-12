-- ─────────────────────────────────────────────────────────────
-- BytePlus 자산고(Asset Library) 프로덕션화 — DB 미러
--
-- 진단 콘솔(asset-lab)은 라이브 API 왕복만 하고 상태를 저장하지 않았다.
-- 정식화의 첫 단계로 자산고의 "그룹 → 자산" 계층을 테넌트 단위로 미러링한다.
-- BytePlus 원격 상태가 소스 오브 트루스이고, 아래 테이블은 목록/연결/캐싱 레이어다.
-- ─────────────────────────────────────────────────────────────

-- ── 1. 자산 그룹 (원격 AssetGroup 미러) ───────────────────────
create table public.asset_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- BytePlus 가 발급한 원격 GroupId. 로컬 생성 후 입고 전이면 null 가능.
  remote_group_id text,
  name text not null,
  group_type text not null default 'AIGC',
  -- 'digital_human' 는 실사 인증이 필요한 인물 그룹, 'aigc' 는 일반 참조 자산 그룹.
  kind text not null default 'aigc',
  -- 실사 인증 상태: none | pending | verified | failed
  verify_status text not null default 'none',
  -- 실사 인증 세션 식별자 및 QR(H5) 링크 (4단계).
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

-- ── 2. 자산 (원격 Asset 미러) ─────────────────────────────────
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  group_id uuid references public.asset_groups(id) on delete cascade,
  -- 선택적으로 캐릭터에 연결 (자산 → 캐릭터 identity 매핑).
  character_id uuid references public.characters(id) on delete set null,
  -- BytePlus 가 발급한 asset ID. asset://<remote_asset_id> 로 영상 생성에 참조된다.
  remote_asset_id text,
  name text not null,
  -- 'image' | 'video' | 'audio'
  asset_type text not null default 'image',
  -- 입고 상태: draft(로컬만) | ingesting | ready | failed
  status text not null default 'draft',
  -- 입고 원본이 된 공개 URL (재시도/감사용).
  source_url text,
  -- 원격 썸네일/원본 URL 캐시 (만료 가능, 미리보기용).
  thumbnail_url text,
  -- tenant 비공개 스토리지로 임포트한 경우의 경로 (character-refs 버킷).
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

-- ── 3. RLS (테넌트 격리 — 기존 컨벤션과 동일) ──────────────────
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

-- ── 4. updated_at 자동 갱신 트리거 ────────────────────────────
-- (update_updated_at_column 함수는 library_assets 마이그레이션에서 이미 생성됨)
create trigger asset_groups_updated_at
  before update on public.asset_groups
  for each row execute function public.update_updated_at_column();

create trigger assets_updated_at
  before update on public.assets
  for each row execute function public.update_updated_at_column();
