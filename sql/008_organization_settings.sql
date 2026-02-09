-- 008: Organization Settings table + extend organization_members with user preferences

-- Organization-wide settings (one row per org)
CREATE TABLE IF NOT EXISTS public.organization_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Organization Info
  logo_url TEXT,
  address TEXT,
  city TEXT,
  country TEXT,
  phone TEXT,
  gst_number TEXT,
  tax_id TEXT,

  -- Currency & Formatting
  default_currency TEXT DEFAULT 'USD',
  weight_unit TEXT DEFAULT 'kg',
  date_format TEXT DEFAULT 'DD/MM/YYYY',

  -- Email Configuration
  email_provider TEXT, -- 'smtp', 'sendgrid', 'resend', or null
  smtp_host TEXT,
  smtp_port INTEGER DEFAULT 587,
  smtp_username TEXT,
  smtp_password TEXT,
  smtp_from_email TEXT,
  smtp_use_tls BOOLEAN DEFAULT true,
  api_key TEXT, -- for SendGrid/Resend

  -- Notification Defaults
  notify_new_order BOOLEAN DEFAULT true,
  notify_order_updated BOOLEAN DEFAULT true,
  notify_stage_changed BOOLEAN DEFAULT true,
  notify_new_inquiry BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.organization_settings ENABLE ROW LEVEL SECURITY;

-- All org members can read settings
CREATE POLICY "org_settings_select" ON public.organization_settings
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
    )
  );

-- Only owners can insert settings
CREATE POLICY "org_settings_insert" ON public.organization_settings
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Only owners can update settings
CREATE POLICY "org_settings_update" ON public.organization_settings
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid() AND role = 'owner'
    )
  ) WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Index
CREATE INDEX IF NOT EXISTS idx_org_settings_org_id ON public.organization_settings(organization_id);

-- Extend organization_members with user preferences
ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS notify_new_order BOOLEAN;
ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS notify_order_updated BOOLEAN;
ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS notify_stage_changed BOOLEAN;
ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS notify_new_inquiry BOOLEAN;

-- Auto-create settings row when a new org is created (trigger)
CREATE OR REPLACE FUNCTION public.auto_create_org_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.organization_settings (organization_id)
  VALUES (NEW.id)
  ON CONFLICT (organization_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_create_org_settings ON public.organizations;
CREATE TRIGGER trg_auto_create_org_settings
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_org_settings();

-- Create settings rows for existing organizations that don't have one
INSERT INTO public.organization_settings (organization_id)
SELECT id FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.organization_settings os WHERE os.organization_id = o.id
)
ON CONFLICT (organization_id) DO NOTHING;
