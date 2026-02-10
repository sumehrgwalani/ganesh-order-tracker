-- Move Gmail connection to per-user (organization_members)
ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS gmail_refresh_token TEXT DEFAULT NULL;
ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS gmail_email TEXT DEFAULT NULL;
ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS gmail_last_sync TIMESTAMPTZ DEFAULT NULL;

-- Add connected_user_id to synced_emails
ALTER TABLE public.synced_emails ADD COLUMN IF NOT EXISTS connected_user_id UUID REFERENCES auth.users(id);

-- Add RLS policy for email privacy
DROP POLICY IF EXISTS "Users can view synced emails for their org" ON public.synced_emails;
CREATE POLICY "Users can view their own synced emails or shared ones"
  ON public.synced_emails FOR SELECT
  USING (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
    AND (
      connected_user_id = auth.uid()
      OR from_email IN (SELECT email FROM public.organization_members WHERE organization_id = synced_emails.organization_id AND user_id = auth.uid())
      OR to_email IN (SELECT email FROM public.organization_members WHERE organization_id = synced_emails.organization_id AND user_id = auth.uid())
    )
  );
