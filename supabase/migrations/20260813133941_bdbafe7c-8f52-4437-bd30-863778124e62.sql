ALTER TABLE public.asset_groups
  ADD COLUMN IF NOT EXISTS consent_holder text,
  ADD COLUMN IF NOT EXISTS consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_note text;