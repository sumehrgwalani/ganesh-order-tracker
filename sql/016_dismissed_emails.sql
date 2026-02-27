ALTER TABLE public.synced_emails ADD COLUMN IF NOT EXISTS dismissed BOOLEAN DEFAULT false;
