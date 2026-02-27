-- Add Gmail thread_id to synced_emails for conversation-based matching
ALTER TABLE public.synced_emails ADD COLUMN IF NOT EXISTS thread_id TEXT DEFAULT NULL;

-- Index for fast thread lookups
CREATE INDEX IF NOT EXISTS idx_synced_emails_thread_id ON public.synced_emails (thread_id) WHERE thread_id IS NOT NULL;
