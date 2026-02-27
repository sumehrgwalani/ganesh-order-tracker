import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow with CRON_SECRET for safety
  const secret = req.headers['x-cron-secret'] || req.query.secret
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Add cc_emails column to synced_emails
  const { error } = await supabase.rpc('exec_sql', {
    query: 'ALTER TABLE public.synced_emails ADD COLUMN IF NOT EXISTS cc_emails TEXT DEFAULT NULL'
  })

  // If RPC doesn't exist, try direct approach - just test if column exists
  if (error) {
    // Try selecting the column to check if it already exists
    const { error: testError } = await supabase
      .from('synced_emails')
      .select('cc_emails')
      .limit(1)

    if (!testError) {
      return res.status(200).json({ message: 'Column cc_emails already exists' })
    }

    return res.status(200).json({
      message: 'Please run this SQL in Supabase dashboard: ALTER TABLE public.synced_emails ADD COLUMN IF NOT EXISTS cc_emails TEXT DEFAULT NULL',
      error: error.message
    })
  }

  return res.status(200).json({ message: 'Migration complete: cc_emails column added' })
}
