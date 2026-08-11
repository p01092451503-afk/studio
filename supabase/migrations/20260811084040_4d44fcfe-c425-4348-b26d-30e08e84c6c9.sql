CREATE TABLE public.library_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  character_id uuid REFERENCES public.characters(id) ON DELETE SET NULL,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'image',
  cover_path text NOT NULL,
  frame_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_path text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX library_assets_tenant_idx ON public.library_assets (tenant_id, created_at DESC);
CREATE INDEX library_assets_character_idx ON public.library_assets (character_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_assets TO authenticated;
GRANT ALL ON public.library_assets TO service_role;

ALTER TABLE public.library_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant library assets" ON public.library_assets
FOR ALL TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_library_assets_updated_at
BEFORE UPDATE ON public.library_assets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();