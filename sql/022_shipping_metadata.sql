-- Add shipping metadata columns to orders table
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS container_number TEXT,
  ADD COLUMN IF NOT EXISTS seal_number TEXT,
  ADD COLUMN IF NOT EXISTS vessel_name TEXT,
  ADD COLUMN IF NOT EXISTS bl_number TEXT,
  ADD COLUMN IF NOT EXISTS shipping_line TEXT,
  ADD COLUMN IF NOT EXISTS etd DATE,
  ADD COLUMN IF NOT EXISTS eta DATE;
