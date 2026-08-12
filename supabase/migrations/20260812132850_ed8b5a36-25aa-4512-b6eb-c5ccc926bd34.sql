-- characters
drop policy "tenant characters" on public.characters;
create policy "tenant characters" on public.characters for all to authenticated
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

-- character_images
drop policy "tenant character images" on public.character_images;
create policy "tenant character images" on public.character_images for all to authenticated
  using (exists (select 1 from characters c where c.id = character_images.character_id and c.tenant_id = current_tenant_id()))
  with check (exists (select 1 from characters c where c.id = character_images.character_id and c.tenant_id = current_tenant_id()));

-- projects
drop policy "tenant projects" on public.projects;
create policy "tenant projects" on public.projects for all to authenticated
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

-- project_cast
drop policy "tenant project_cast" on public.project_cast;
create policy "tenant project_cast" on public.project_cast for all to authenticated
  using (exists (select 1 from projects p where p.id = project_cast.project_id and p.tenant_id = current_tenant_id()))
  with check (exists (select 1 from projects p where p.id = project_cast.project_id and p.tenant_id = current_tenant_id()));

-- episodes
drop policy "tenant episodes" on public.episodes;
create policy "tenant episodes" on public.episodes for all to authenticated
  using (exists (select 1 from projects p where p.id = episodes.project_id and p.tenant_id = current_tenant_id()))
  with check (exists (select 1 from projects p where p.id = episodes.project_id and p.tenant_id = current_tenant_id()));

-- panels
drop policy "tenant panels" on public.panels;
create policy "tenant panels" on public.panels for all to authenticated
  using (exists (select 1 from episodes e join projects p on p.id = e.project_id where e.id = panels.episode_id and p.tenant_id = current_tenant_id()))
  with check (exists (select 1 from episodes e join projects p on p.id = e.project_id where e.id = panels.episode_id and p.tenant_id = current_tenant_id()));

-- generations
drop policy "tenant generations" on public.generations;
create policy "tenant generations" on public.generations for all to authenticated
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

-- generation_results
drop policy "tenant results" on public.generation_results;
create policy "tenant results" on public.generation_results for all to authenticated
  using (exists (select 1 from generations g where g.id = generation_results.generation_id and g.tenant_id = current_tenant_id()))
  with check (exists (select 1 from generations g where g.id = generation_results.generation_id and g.tenant_id = current_tenant_id()));

-- usage_events
drop policy "tenant usage" on public.usage_events;
create policy "tenant usage" on public.usage_events for select to authenticated
  using (tenant_id = current_tenant_id());

-- presets
drop policy "read presets" on public.presets;
create policy "read presets" on public.presets for select to authenticated
  using (tenant_id is null or tenant_id = current_tenant_id());

-- profiles
drop policy "own profile" on public.profiles;
create policy "own profile" on public.profiles for select to authenticated
  using (id = auth.uid());

-- tenants
drop policy "own tenant" on public.tenants;
create policy "own tenant" on public.tenants for select to authenticated
  using (id = current_tenant_id());

-- anon 권한 회수 (정책이 모두 authenticated 전용)
revoke all on public.characters, public.character_images, public.projects, public.project_cast,
  public.episodes, public.panels, public.generations, public.generation_results,
  public.usage_events, public.presets, public.profiles, public.tenants from anon;