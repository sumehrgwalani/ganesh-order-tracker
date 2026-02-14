-- ============================================================================
-- Product Catalog Enhancement
-- Adds detailed columns to products table and seeds product data
-- Run this in the Supabase SQL Editor
-- ============================================================================

-- Step 1: Add new columns to products table
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS size TEXT,
  ADD COLUMN IF NOT EXISTS glaze NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS freeze_type TEXT,
  ADD COLUMN IF NOT EXISTS catching_method TEXT,
  ADD COLUMN IF NOT EXISTS markets TEXT,
  ADD COLUMN IF NOT EXISTS product_type TEXT;

-- Step 2: Seed product catalog data
-- Uses the first organization found (Ganesh International)
DO $$
DECLARE
  org UUID;
BEGIN
  SELECT id INTO org FROM public.organizations LIMIT 1;

  -- Clear existing placeholder products
  DELETE FROM public.products WHERE organization_id = org;

  INSERT INTO public.products (organization_id, name, category, product_type, size, glaze, freeze_type, catching_method, markets, is_active) VALUES
  -- ========================
  -- CUTTLEFISH
  -- ========================
  -- Cuttlefish Whole Cleaned - IQF
  (org, 'Cuttlefish Whole Cleaned', 'Cuttlefish', 'Cuttlefish', 'U/1', 0.25, 'IQF', 'Trawler', 'Italy, Portugal', true),
  (org, 'Cuttlefish Whole Cleaned', 'Cuttlefish', 'Cuttlefish', '1/2', 0.25, 'IQF', 'Trawler', 'Italy, Spain, Portugal, France', true),
  (org, 'Cuttlefish Whole Cleaned', 'Cuttlefish', 'Cuttlefish', '2/4', 0.25, 'IQF', 'Trawler', 'Italy, Spain, Portugal, France', true),
  (org, 'Cuttlefish Whole Cleaned', 'Cuttlefish', 'Cuttlefish', '5/7', 0.25, 'IQF', 'Trawler', 'Italy, Spain, Portugal, France', true),
  (org, 'Cuttlefish Whole Cleaned', 'Cuttlefish', 'Cuttlefish', '2/4', 0.25, 'IQF', 'Trawler', 'Italy, Spain, Portugal, France', true),
  (org, 'Cuttlefish Whole Cleaned', 'Cuttlefish', 'Cuttlefish', '5/7', 0.25, 'IQF', 'Trawler', 'Italy, Spain, Portugal, France', true),
  (org, 'Cuttlefish Whole Cleaned', 'Cuttlefish', 'Cuttlefish', '8/12', 0.25, 'IQF', 'Trawler', 'Italy, Spain, Portugal, France', true),
  (org, 'Cuttlefish Whole Cleaned', 'Cuttlefish', 'Cuttlefish', '13/20', 0.25, 'IQF', 'Trawler', 'Italy, Spain, Portugal, France', true),
  (org, 'Cuttlefish Whole Cleaned', 'Cuttlefish', 'Cuttlefish', '20/40', 0.25, 'IQF', 'Trawler', 'Italy, Spain, Portugal, France', true),
  (org, 'Cuttlefish Whole Cleaned', 'Cuttlefish', 'Cuttlefish', '40/60', 0.25, 'IQF', 'Trawler', 'Italy, Spain, France', true),
  -- Cuttlefish Whole Cleaned - Blocks
  (org, 'Cuttlefish Whole Cleaned', 'Cuttlefish', 'Cuttlefish', 'U/1', 0.10, 'Blocks', 'Trawler', 'Italy, Spain', true),
  (org, 'Cuttlefish Whole Cleaned', 'Cuttlefish', 'Cuttlefish', '1/2', 0.10, 'Blocks', 'Trawler', 'Italy, Spain', true),
  (org, 'Cuttlefish Whole Cleaned', 'Cuttlefish', 'Cuttlefish', '2/4', 0.10, 'Blocks', 'Trawler', 'Italy, Spain', true),
  (org, 'Cuttlefish Whole Cleaned', 'Cuttlefish', 'Cuttlefish', '5/7', 0.10, 'Blocks', 'Trawler', 'Italy, Spain', true),
  -- Cuttlefish Skewer
  (org, 'Cuttlefish Skewer', 'Cuttlefish', 'Cuttlefish', '4-5 Pcs/Skewer', 0.25, 'IQF', NULL, NULL, true),
  -- Whole Cleaned Cuttlefish Silk
  (org, 'Whole Cleaned Cuttlefish Silk', 'Cuttlefish', 'Cuttlefish', '5/7', 0.20, 'IQF', NULL, NULL, true),
  -- Whole Cleaned Cuttlefish Bulk
  (org, 'Whole Cleaned Cuttlefish Bulk', 'Cuttlefish', 'Cuttlefish', 'U/1', 0.20, 'IQF', NULL, NULL, true),
  (org, 'Whole Cleaned Cuttlefish Bulk', 'Cuttlefish', 'Cuttlefish', '1/2', 0.20, 'IQF', NULL, NULL, true),
  -- Cuttlefish Roe
  (org, 'Cuttlefish Roe', 'Cuttlefish', 'Cuttlefish', 'Assorted', 0.20, 'IQF', 'Trawler', 'Italy, Spain', true),

  -- ========================
  -- SQUID
  -- ========================
  -- Squid Whole - Blocks - One Day Hook Catch
  (org, 'Squid Whole', 'Squid', 'Squid', 'U/3', 0.10, 'Blocks', 'One Day Hook Catch', 'Italy, Spain', true),
  (org, 'Squid Whole', 'Squid', 'Squid', '3/6', 0.10, 'Blocks', 'One Day Hook Catch', 'Italy, Spain', true),
  (org, 'Squid Whole', 'Squid', 'Squid', '6/10', 0.10, 'Blocks', 'One Day Hook Catch', 'Italy, Spain', true),
  (org, 'Squid Whole', 'Squid', 'Squid', '10/20', 0.10, 'Blocks', 'One Day Hook Catch', 'Italy, Spain', true),
  (org, 'Squid Whole', 'Squid', 'Squid', '20/40', 0.10, 'Blocks', 'One Day Hook Catch', 'Italy, Spain', true),
  -- Squid Whole Cleaned - IQF
  (org, 'Squid Whole Cleaned', 'Squid', 'Squid', 'U/5', 0.25, 'IQF', 'Trawler', 'Italy, Spain, Portugal', true),
  (org, 'Squid Whole Cleaned', 'Squid', 'Squid', 'U/10', 0.25, 'IQF', 'Trawler', 'Italy, Spain, Portugal', true),
  (org, 'Squid Whole Cleaned', 'Squid', 'Squid', '10/20', 0.25, 'IQF', 'Trawler', 'Italy, Spain, Portugal', true),
  (org, 'Squid Whole Cleaned', 'Squid', 'Squid', '20/40', 0.25, 'IQF', 'Trawler', 'Italy, Spain, Portugal', true),
  -- Squid Whole Cleaned - Blocks
  (org, 'Squid Whole Cleaned', 'Squid', 'Squid', 'U/5', 0.20, 'Blocks', 'Trawler', 'Italy, Spain, Portugal', true),
  (org, 'Squid Whole Cleaned', 'Squid', 'Squid', 'U/10', 0.20, 'Blocks', 'Trawler', 'Italy, Spain, Portugal', true),
  (org, 'Squid Whole Cleaned', 'Squid', 'Squid', '10/20', 0.20, 'Blocks', 'Trawler', 'Italy, Spain, Portugal', true),
  (org, 'Squid Whole Cleaned', 'Squid', 'Squid', '20/40', 0.20, 'Blocks', 'Trawler', 'Italy, Spain, Portugal', true),
  -- Baby Squid (packing types in name, freeze is Block Frozen)
  (org, 'Baby Squid - Jumble Blocks', 'Squid', 'Squid', '80/up', 0.10, 'Block Frozen', 'Trawler', 'Spain', true),
  (org, 'Baby Squid - Finger Laid', 'Squid', 'Squid', '80/up', 0.10, 'Block Frozen', 'Trawler', 'Spain', true),
  (org, 'Baby Squid - Tray Pack', 'Squid', 'Squid', '80/up', 0.10, 'Block Frozen', 'Trawler', 'Spain', true),
  (org, 'Baby Squid - Tray Pack Skin Off', 'Squid', 'Squid', '80/up', 0.10, 'Block Frozen', 'Trawler', 'Spain', true),
  -- Baby Squid Pin Bone Out
  (org, 'Baby Squid Pin Bone Out', 'Squid', 'Squid', '80/up', 0.20, 'IQF', 'Trawler', 'Spain', true),
  -- Cut Squid
  (org, 'Cut Squid', 'Squid', 'Squid', '20/40', 0.25, 'IQF', 'Trawler', 'Spain', true),
  (org, 'Cut Squid', 'Squid', 'Squid', '40/60', 0.25, 'IQF', 'Trawler', 'Spain', true),
  -- Squid Whole - Blocks - Trawler
  (org, 'Squid Whole', 'Squid', 'Squid', 'U/3', 0.10, 'Blocks', 'Trawler', 'Italy, Spain, Greece', true),
  (org, 'Squid Whole', 'Squid', 'Squid', '3/6', 0.10, 'Blocks', 'Trawler', 'Italy, Spain, Greece', true),
  (org, 'Squid Whole', 'Squid', 'Squid', '6/10', 0.10, 'Blocks', 'Trawler', 'Italy, Spain, Greece', true),
  (org, 'Squid Whole', 'Squid', 'Squid', '10/20', 0.10, 'Blocks', 'Trawler', 'Italy, Spain, Greece', true),
  (org, 'Squid Whole', 'Squid', 'Squid', '20/40', 0.10, 'Blocks', 'Trawler', 'Italy, Spain', true),
  -- Squid Whole - Blast - One Day Hook Catch
  (org, 'Squid Whole', 'Squid', 'Squid', 'U/3', 0.10, 'Blast', 'One Day Hook Catch', 'Italy, Spain', true),
  (org, 'Squid Whole', 'Squid', 'Squid', '3/6', 0.10, 'Blast', 'One Day Hook Catch', 'Italy, Spain', true),
  (org, 'Squid Whole', 'Squid', 'Squid', '6/10', 0.10, 'Blast', 'One Day Hook Catch', 'Italy, Spain', true),
  (org, 'Squid Whole', 'Squid', 'Squid', '10/20', 0.10, 'Blast', 'One Day Hook Catch', 'Italy, Spain', true),
  (org, 'Squid Whole', 'Squid', 'Squid', '20/40', 0.10, 'Blast', 'One Day Hook Catch', 'Italy, Spain', true),
  -- Whole Squid Loligo Blast
  (org, 'Whole Squid Loligo Blast', 'Squid', 'Squid', 'U/3', 0.10, 'Blast', NULL, NULL, true),
  (org, 'Whole Squid Loligo Blast', 'Squid', 'Squid', '3/6', 0.10, 'Blast', NULL, NULL, true),
  (org, 'Whole Squid Loligo Blast', 'Squid', 'Squid', '6/10', 0.10, 'Blast', NULL, NULL, true),
  (org, 'Whole Squid Loligo Blast', 'Squid', 'Squid', '6/10', 0.00, 'Blocks', NULL, NULL, true),
  -- Cut Squid Skinless
  (org, 'Cut Squid Skinless', 'Squid', 'Squid', '20/40', 0.10, 'IQF', NULL, NULL, true),
  -- BL Squid Rings
  (org, 'BL Squid Rings', 'Squid', 'Squid', '60/up', 0.20, 'IQF', NULL, NULL, true),

  -- ========================
  -- SHRIMP / VANNAMEI
  -- ========================
  -- Vannamei HOSO Cooking Quality
  (org, 'Vannamei HOSO Cooking Quality', 'Shrimp', 'Shrimp', '16/20', 0.00, 'Semi IQF', 'Farmed', 'Spain', true),
  (org, 'Vannamei HOSO Cooking Quality', 'Shrimp', 'Shrimp', '21/30', 0.00, 'Semi IQF', 'Farmed', 'Spain', true),
  (org, 'Vannamei HOSO Cooking Quality', 'Shrimp', 'Shrimp', '31/40', 0.00, 'Semi IQF', 'Farmed', 'Spain', true),
  (org, 'Vannamei HOSO Cooking Quality', 'Shrimp', 'Shrimp', '41/50', 0.00, 'Semi IQF', 'Farmed', 'Spain', true),
  (org, 'Vannamei HOSO Cooking Quality', 'Shrimp', 'Shrimp', '51/60', 0.00, 'Semi IQF', 'Farmed', 'Spain', true),
  (org, 'Vannamei HOSO Cooking Quality', 'Shrimp', 'Shrimp', '61/70', 0.00, 'Semi IQF', 'Farmed', 'Spain', true),
  (org, 'Vannamei HOSO Cooking Quality', 'Shrimp', 'Shrimp', '71/90', 0.00, 'Semi IQF', 'Farmed', 'Spain', true),
  (org, 'Vannamei HOSO Cooking Quality', 'Shrimp', 'Shrimp', '90/120', 0.00, 'Semi IQF', 'Farmed', 'Spain', true),
  -- Vannamei HOSO Retail Quality
  (org, 'Vannamei HOSO Retail Quality', 'Shrimp', 'Shrimp', '16/20', 0.00, 'Semi IQF', 'Farmed', 'Spain', true),
  (org, 'Vannamei HOSO Retail Quality', 'Shrimp', 'Shrimp', '21/30', 0.00, 'Semi IQF', 'Farmed', 'Spain', true),
  (org, 'Vannamei HOSO Retail Quality', 'Shrimp', 'Shrimp', '31/40', 0.00, 'Semi IQF', 'Farmed', 'Spain', true),
  (org, 'Vannamei HOSO Retail Quality', 'Shrimp', 'Shrimp', '41/50', 0.00, 'Semi IQF', 'Farmed', 'Spain', true),
  (org, 'Vannamei HOSO Retail Quality', 'Shrimp', 'Shrimp', '51/60', 0.00, 'Semi IQF', 'Farmed', 'Spain', true),
  (org, 'Vannamei HOSO Retail Quality', 'Shrimp', 'Shrimp', '61/70', 0.00, 'Semi IQF', 'Farmed', 'Spain', true),
  (org, 'Vannamei HOSO Retail Quality', 'Shrimp', 'Shrimp', '71/90', 0.00, 'Semi IQF', 'Farmed', 'Spain', true),
  (org, 'Vannamei HOSO Retail Quality', 'Shrimp', 'Shrimp', '90/120', 0.00, 'Semi IQF', 'Farmed', 'Spain', true),
  -- Vannamei PDTO Raw
  (org, 'Vannamei PDTO Raw', 'Shrimp', 'Shrimp', '16/20', 0.20, 'IQF', 'Farmed', 'USA', true),
  (org, 'Vannamei PDTO Raw', 'Shrimp', 'Shrimp', '21/25', 0.20, 'IQF', 'Farmed', 'USA', true),
  (org, 'Vannamei PDTO Raw', 'Shrimp', 'Shrimp', '26/30', 0.20, 'IQF', 'Farmed', 'USA', true),
  (org, 'Vannamei PDTO Raw', 'Shrimp', 'Shrimp', '31/40', 0.20, 'IQF', 'Farmed', 'USA', true),
  -- Vannamei PUD Raw
  (org, 'Vannamei PUD Raw', 'Shrimp', 'Shrimp', '16/20', 0.20, 'IQF', 'Farmed', 'USA, Spain, Portugal', true),
  (org, 'Vannamei PUD Raw', 'Shrimp', 'Shrimp', '21/25', 0.20, 'IQF', 'Farmed', 'USA, Spain, Portugal', true),
  (org, 'Vannamei PUD Raw', 'Shrimp', 'Shrimp', '26/30', 0.20, 'IQF', 'Farmed', 'USA, Spain, Portugal', true),
  (org, 'Vannamei PUD Raw', 'Shrimp', 'Shrimp', '31/40', 0.20, 'IQF', 'Farmed', 'USA, Spain, Portugal', true),
  (org, 'Vannamei PUD Raw', 'Shrimp', 'Shrimp', '41/50', 0.20, 'IQF', 'Farmed', 'USA, Spain, Portugal', true),
  (org, 'Vannamei PUD Raw', 'Shrimp', 'Shrimp', '51/60', 0.20, 'IQF', 'Farmed', 'USA, Spain, Portugal', true),
  (org, 'Vannamei PUD Raw', 'Shrimp', 'Shrimp', '61/70', 0.20, 'IQF', 'Farmed', 'USA, Spain, Portugal', true),
  (org, 'Vannamei PUD Raw', 'Shrimp', 'Shrimp', '71/80', 0.20, 'IQF', 'Farmed', 'USA, Spain, Portugal', true),
  (org, 'Vannamei PUD Raw', 'Shrimp', 'Shrimp', '80/100', 0.20, 'IQF', 'Farmed', 'USA, Spain, Portugal', true),
  (org, 'Vannamei PUD Raw', 'Shrimp', 'Shrimp', '100/120', 0.20, 'IQF', 'Farmed', 'USA, Spain, Portugal', true),
  -- Vannamei PUD Blanched
  (org, 'Vannamei PUD Blanched', 'Shrimp', 'Shrimp', '16/20', 0.20, 'IQF', 'Farmed', 'USA, Spain, Portugal', true),
  (org, 'Vannamei PUD Blanched', 'Shrimp', 'Shrimp', '21/25', 0.20, 'IQF', 'Farmed', 'USA, Spain, Portugal', true),
  (org, 'Vannamei PUD Blanched', 'Shrimp', 'Shrimp', '26/30', 0.20, 'IQF', 'Farmed', 'USA, Spain, Portugal', true),
  (org, 'Vannamei PUD Blanched', 'Shrimp', 'Shrimp', '31/40', 0.20, 'IQF', 'Farmed', 'USA, Spain, Portugal', true),
  (org, 'Vannamei PUD Blanched', 'Shrimp', 'Shrimp', '41/50', 0.20, 'IQF', 'Farmed', 'USA, Spain, Portugal', true),
  (org, 'Vannamei PUD Blanched', 'Shrimp', 'Shrimp', '51/60', 0.20, 'IQF', 'Farmed', 'USA, Spain, Portugal', true),
  (org, 'Vannamei PUD Blanched', 'Shrimp', 'Shrimp', '61/70', 0.20, 'IQF', 'Farmed', 'USA, Spain, Portugal', true),
  (org, 'Vannamei PUD Blanched', 'Shrimp', 'Shrimp', '71/80', 0.20, 'IQF', 'Farmed', 'USA, Spain, Portugal', true),
  (org, 'Vannamei PUD Blanched', 'Shrimp', 'Shrimp', '80/100', 0.20, 'IQF', 'Farmed', 'USA, Spain, Portugal', true),
  (org, 'Vannamei PUD Blanched', 'Shrimp', 'Shrimp', '100/120', 0.20, 'IQF', 'Farmed', 'USA, Spain, Portugal', true),
  -- Vannamei PDTO Blanched
  (org, 'Vannamei PDTO Blanched', 'Shrimp', 'Shrimp', '16/20', 0.20, 'IQF', 'Farmed', 'USA, Portugal', true),
  (org, 'Vannamei PDTO Blanched', 'Shrimp', 'Shrimp', '21/25', 0.20, 'IQF', 'Farmed', 'USA, Portugal', true),
  (org, 'Vannamei PDTO Blanched', 'Shrimp', 'Shrimp', '26/30', 0.20, 'IQF', 'Farmed', 'USA, Portugal', true),
  (org, 'Vannamei PDTO Blanched', 'Shrimp', 'Shrimp', '31/40', 0.20, 'IQF', 'Farmed', 'USA, Portugal', true),
  -- Headless Brown Blanched
  (org, 'Headless Brown Blanched', 'Shrimp', 'Shrimp', '21/25', 0.30, 'IQF', 'Trawler', 'Algeria', true),
  (org, 'Headless Brown Blanched', 'Shrimp', 'Shrimp', '26/30', 0.30, 'IQF', 'Trawler', 'Algeria', true),
  (org, 'Headless Brown Blanched', 'Shrimp', 'Shrimp', '31/40', 0.30, 'IQF', 'Trawler', 'Algeria', true),
  (org, 'Headless Brown Blanched', 'Shrimp', 'Shrimp', '41/50', 0.30, 'IQF', 'Trawler', 'Algeria', true),
  (org, 'Headless Brown Blanched', 'Shrimp', 'Shrimp', '51/60', 0.30, 'IQF', 'Trawler', 'Algeria', true),
  -- PUD Blanched (generic)
  (org, 'PUD Blanched', 'Shrimp', 'Shrimp', 'Broken', 0.20, 'IQF', 'Trawler', 'Spain, Portugal', true),
  (org, 'PUD Blanched', 'Shrimp', 'Shrimp', '200/300', 0.20, 'IQF', 'Trawler', 'Spain, Portugal', true),
  (org, 'PUD Blanched', 'Shrimp', 'Shrimp', '300/500', 0.20, 'IQF', 'Trawler', 'Spain, Portugal', true),
  (org, 'PUD Blanched', 'Shrimp', 'Shrimp', '100/200', 0.20, 'IQF', 'Trawler', 'Spain, Portugal', true),
  (org, 'PUD Blanched', 'Shrimp', 'Shrimp', '80/120', 0.20, 'IQF', 'Trawler', 'Spain, Portugal', true),
  (org, 'PUD Blanched', 'Shrimp', 'Shrimp', '60/80', 0.20, 'IQF', 'Trawler', 'Spain, Portugal', true),

  -- ========================
  -- FISH
  -- ========================
  (org, 'Koothe Filet', 'Fish', 'Fish', '300/500', 0.15, 'IQF', NULL, NULL, true),
  (org, 'Koothe Filet', 'Fish', 'Fish', '500/up', 0.15, 'IQF', NULL, NULL, true),
  (org, 'Koothe Filet', 'Fish', 'Fish', '1000/2000', 0.15, 'IQF', NULL, NULL, true),
  (org, 'Koothe Filet', 'Fish', 'Fish', '2000/up', 0.15, 'IQF', NULL, NULL, true);

END $$;
