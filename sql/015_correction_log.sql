-- Correction log: tracks user corrections to AI classification
-- Used to feed learning examples back into AI prompts
CREATE TABLE IF NOT EXISTS public.correction_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  order_id TEXT,                          -- PO number e.g. "GI/PO/25-26/3020"
  correction_type TEXT NOT NULL,          -- stage_move, order_reassign, email_remove, attachment_delete
  filename TEXT,                          -- for attachment corrections
  from_stage SMALLINT,                    -- original stage
  to_stage SMALLINT,                      -- corrected stage
  from_order TEXT,                        -- for order reassignments
  to_order TEXT,                          -- for order reassignments
  subject TEXT,                           -- email subject for context
  note TEXT,                              -- user's note explaining correction
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup of recent corrections per org
CREATE INDEX IF NOT EXISTS idx_correction_log_org_recent
  ON public.correction_log (organization_id, created_at DESC);

-- RLS
ALTER TABLE public.correction_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read corrections for their org"
  ON public.correction_log FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can insert corrections for their org"
  ON public.correction_log FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
  ));
