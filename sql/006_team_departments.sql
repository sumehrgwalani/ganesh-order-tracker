-- 006: Team Departments & Invitations
-- Adds department structure and invitation system for team management

-- ============================================================================
-- DEPARTMENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, slug)
);

-- ============================================================================
-- ADD DEPARTMENT COLUMN TO ORGANIZATION_MEMBERS
-- ============================================================================
ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL;

-- ============================================================================
-- INVITATIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  role TEXT DEFAULT 'member',
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '7 days'),
  UNIQUE(organization_id, email, status)
);

-- ============================================================================
-- RLS - departments
-- ============================================================================
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "departments_select_policy"
  ON public.departments FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "departments_insert_policy"
  ON public.departments FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "departments_update_policy"
  ON public.departments FOR UPDATE
  USING (organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
  ))
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "departments_delete_policy"
  ON public.departments FOR DELETE
  USING (organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
  ));

-- ============================================================================
-- RLS - invitations
-- ============================================================================
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- Org members can view invitations for their org
CREATE POLICY "invitations_select_policy"
  ON public.invitations FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
  ));

-- Org members can create invitations
CREATE POLICY "invitations_insert_policy"
  ON public.invitations FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
  ));

-- Org members can update invitations (cancel, etc.)
CREATE POLICY "invitations_update_policy"
  ON public.invitations FOR UPDATE
  USING (organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
  ));

-- Anyone authenticated can read invitations by their own email (for accepting)
CREATE POLICY "invitations_select_by_email"
  ON public.invitations FOR SELECT
  USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
    AND status = 'pending'
  );

-- Anyone authenticated can accept their own invitation
CREATE POLICY "invitations_accept_own"
  ON public.invitations FOR UPDATE
  USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
    AND status = 'pending'
  );

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_departments_organization_id ON public.departments(organization_id);
CREATE INDEX IF NOT EXISTS idx_invitations_organization_id ON public.invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON public.invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON public.invitations(token);
CREATE INDEX IF NOT EXISTS idx_organization_members_department_id ON public.organization_members(department_id);

-- ============================================================================
-- SEED DEFAULT DEPARTMENTS for existing "With The Tide" org
-- ============================================================================
INSERT INTO public.departments (organization_id, name, slug, description)
SELECT o.id, d.name, d.slug, d.description
FROM public.organizations o
CROSS JOIN (VALUES
  ('Purchase', 'purchase', 'Creates POs, manages suppliers and procurement'),
  ('Sales', 'sales', 'Handles inquiries, manages buyers and clients'),
  ('Accounts', 'accounts', 'Tracks order values, payments, and financials'),
  ('Documentation & Artwork', 'docs-artwork', 'Manages artwork approvals, shipping docs, and labelling')
) AS d(name, slug, description)
WHERE o.slug = 'with-the-tide'
ON CONFLICT (organization_id, slug) DO NOTHING;

-- ============================================================================
-- FUNCTION: Auto-create default departments for new organizations
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_default_departments()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.departments (organization_id, name, slug, description) VALUES
    (NEW.id, 'Purchase', 'purchase', 'Creates POs, manages suppliers and procurement'),
    (NEW.id, 'Sales', 'sales', 'Handles inquiries, manages buyers and clients'),
    (NEW.id, 'Accounts', 'accounts', 'Tracks order values, payments, and financials'),
    (NEW.id, 'Documentation & Artwork', 'docs-artwork', 'Manages artwork approvals, shipping docs, and labelling');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: run after a new org is created
DROP TRIGGER IF EXISTS trg_create_default_departments ON public.organizations;
CREATE TRIGGER trg_create_default_departments
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.create_default_departments();
