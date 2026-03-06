-- 020: Add company_name and contact_name to organization_settings
-- These replace hardcoded "Ganesh International" throughout the codebase,
-- making the app multi-tenant so other trading companies can use it.

ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS company_name TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_name TEXT DEFAULT '';
