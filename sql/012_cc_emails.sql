-- Add CC email addresses to synced_emails for better supplier matching
ALTER TABLE public.synced_emails ADD COLUMN IF NOT EXISTS cc_emails TEXT DEFAULT NULL;
