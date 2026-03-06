-- Add organization_type to support different business structures:
-- 'buyer' = buys directly from suppliers
-- 'intermediary' = brokers between buyers and suppliers (default)
-- 'supplier' = sells to buyers

ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS organization_type TEXT DEFAULT 'intermediary';

-- Set existing org to intermediary
UPDATE public.organization_settings
SET organization_type = 'intermediary'
WHERE organization_id = '1dc7be49-0354-4843-95e3-93b7064d19b9';
