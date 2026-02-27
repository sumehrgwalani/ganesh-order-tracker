-- Track what the AI originally matched when user corrects it
-- This lets the system learn from mistakes
ALTER TABLE public.synced_emails ADD COLUMN IF NOT EXISTS ai_original_order_id TEXT DEFAULT NULL;
