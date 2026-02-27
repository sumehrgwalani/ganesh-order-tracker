-- Add confidence scoring for AI matches
ALTER TABLE public.synced_emails ADD COLUMN IF NOT EXISTS ai_confidence TEXT DEFAULT NULL;
-- For low-confidence matches: store suggested order without actually linking
ALTER TABLE public.synced_emails ADD COLUMN IF NOT EXISTS ai_suggested_order_id TEXT DEFAULT NULL;
