-- Fix: allow new users to create their first organization and add themselves as members
-- The original policies required users to already be members, creating a chicken-and-egg problem

-- Allow any authenticated user to create an organization
DROP POLICY IF EXISTS "organizations_insert_policy" ON public.organizations;
CREATE POLICY "organizations_insert_policy"
  ON public.organizations
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Allow any authenticated user to add themselves as a member (user_id must match their own)
DROP POLICY IF EXISTS "organization_members_insert_policy" ON public.organization_members;
CREATE POLICY "organization_members_insert_policy"
  ON public.organization_members
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Also fix the SELECT policy so new users can see their membership right after creating it
DROP POLICY IF EXISTS "organization_members_select_policy" ON public.organization_members;
CREATE POLICY "organization_members_select_policy"
  ON public.organization_members
  FOR SELECT
  USING (user_id = auth.uid());
