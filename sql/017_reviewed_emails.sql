-- Add reviewed column to synced_emails for the "Reviewed" tab
-- Reviewed emails are skipped during sync (not re-parsed by AI)
ALTER TABLE public.synced_emails ADD COLUMN IF NOT EXISTS reviewed BOOLEAN DEFAULT false;
