-- Gmail Integration: Add columns to organization_settings and create synced_emails table

-- 1) Add Gmail OAuth fields to organization_settings
ALTER TABLE public.organization_settings ADD COLUMN IF NOT EXISTS gmail_refresh_token TEXT DEFAULT NULL;
ALTER TABLE public.organization_settings ADD COLUMN IF NOT EXISTS gmail_email TEXT DEFAULT NULL;
ALTER TABLE public.organization_settings ADD COLUMN IF NOT EXISTS gmail_last_sync TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE public.organization_settings ADD COLUMN IF NOT EXISTS gmail_client_id TEXT DEFAULT NULL;

-- 2) Create synced_emails table
CREATE TABLE IF NOT EXISTS public.synced_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  gmail_id TEXT NOT NULL,
  from_email TEXT,
  from_name TEXT,
  to_email TEXT,
  subject TEXT,
  body_text TEXT,
  date TIMESTAMPTZ,
  has_attachment BOOLEAN DEFAULT false,
  matched_order_id TEXT,
  detected_stage INTEGER,
  ai_summary TEXT,
  auto_advanced BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, gmail_id)
);

-- 3) RLS policies for synced_emails
ALTER TABLE public.synced_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view synced emails for their org"
  ON public.synced_emails FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can insert synced emails for their org"
  ON public.synced_emails FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can update synced emails for their org"
  ON public.synced_emails FOR UPDATE
  USING (organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
  ));

-- 4) Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_synced_emails_org ON public.synced_emails(organization_id);
CREATE INDEX IF NOT EXISTS idx_synced_emails_order ON public.synced_emails(matched_order_id);
CREATE INDEX IF NOT EXISTS idx_synced_emails_date ON public.synced_emails(date DESC);
