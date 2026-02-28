import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, x-migration-secret')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const secret = req.headers['x-migration-secret'] || req.query.secret
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Check if table already exists by trying to query it
  const { error: checkErr } = await supabase.from('correction_log').select('id').limit(1)
  if (!checkErr) {
    return res.status(200).json({ message: 'correction_log table already exists!' })
  }

  // Table doesn't exist. Use the Supabase SQL API (available via service role on the /rest/v1/rpc endpoint)
  // Alternative: use the database connection directly via pg protocol
  // Since we can't run raw SQL easily from REST, create a simple helper approach:
  // Deploy a Postgres function first, then call it

  // Actually, let's use the supabase-js postgrest approach:
  // We can't create tables via PostgREST. Instead, let's try a workaround.
  // The Supabase project has a Management API we can call.

  const projectRef = 'xafpskaddcdrtfgbphqj'

  // Use Supabase Management API to run SQL
  // This requires the Supabase access token (not the service role key)
  // Let's try the database HTTP API instead

  try {
    // Try pg-meta endpoint (available in newer Supabase)
    const pgRes = await fetch(`${process.env.SUPABASE_URL}/pg/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        query: `CREATE TABLE IF NOT EXISTS public.correction_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES public.organizations(id),
          order_id TEXT,
          correction_type TEXT NOT NULL,
          filename TEXT,
          from_stage SMALLINT,
          to_stage SMALLINT,
          from_order TEXT,
          to_order TEXT,
          subject TEXT,
          note TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      })
    })
    const pgText = await pgRes.text()

    if (pgRes.ok) {
      // Create index
      await fetch(`${process.env.SUPABASE_URL}/pg/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          query: `CREATE INDEX IF NOT EXISTS idx_correction_log_org_recent ON public.correction_log (organization_id, created_at DESC)`
        })
      })

      // Enable RLS
      await fetch(`${process.env.SUPABASE_URL}/pg/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          query: `ALTER TABLE public.correction_log ENABLE ROW LEVEL SECURITY`
        })
      })

      // Create policies
      await fetch(`${process.env.SUPABASE_URL}/pg/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          query: `CREATE POLICY "correction_log_select" ON public.correction_log FOR SELECT USING (organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()))`
        })
      })

      await fetch(`${process.env.SUPABASE_URL}/pg/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          query: `CREATE POLICY "correction_log_insert" ON public.correction_log FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()))`
        })
      })

      // Service role bypass policy
      await fetch(`${process.env.SUPABASE_URL}/pg/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          query: `CREATE POLICY "correction_log_service" ON public.correction_log FOR ALL USING (true) WITH CHECK (true)`
        })
      })

      return res.status(200).json({ success: true, message: 'Table created via pg/query' })
    }

    return res.status(500).json({
      error: 'pg/query endpoint failed',
      status: pgRes.status,
      body: pgText.substring(0, 500)
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
