-- Add new stage 4 (Artwork Confirmed) between Artwork in Progress (3) and Quality Check (old 4, now 5)
-- Shift all existing stages >= 4 up by 1

-- 1. Bump current_stage in orders
UPDATE public.orders SET current_stage = current_stage + 1 WHERE current_stage >= 4;

-- 2. Bump stage in order_history
UPDATE public.order_history SET stage = stage + 1 WHERE stage >= 4;

-- 3. Update skipped_stages arrays: shift each element >= 4 by +1
UPDATE public.orders
SET skipped_stages = (
  SELECT array_agg(CASE WHEN elem >= 4 THEN elem + 1 ELSE elem END ORDER BY elem)
  FROM unnest(skipped_stages) AS elem
)
WHERE skipped_stages IS NOT NULL AND array_length(skipped_stages, 1) > 0;

-- 4. Bump detected_stage in synced_emails
UPDATE public.synced_emails SET detected_stage = detected_stage + 1 WHERE detected_stage >= 4 AND detected_stage IS NOT NULL;
