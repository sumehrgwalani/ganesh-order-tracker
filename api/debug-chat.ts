import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing auth' })
    }

    const supabaseUrl = process.env.SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!serviceKey) {
      return res.status(200).json({
        error: 'SUPABASE_SERVICE_ROLE_KEY not set',
        envKeys: Object.keys(process.env).filter(k => k.includes('SUPA'))
      })
    }

    const { organization_id } = req.body || {}

    const supabase = createClient(supabaseUrl, serviceKey)

    // Test 1: count all orders
    const { data: allOrders, error: allErr } = await supabase
      .from('orders')
      .select('id, order_id, organization_id')
      .limit(5)

    // Test 2: count orders for this org
    const { data: orgOrders, error: orgErr } = await supabase
      .from('orders')
      .select('id, order_id')
      .eq('organization_id', organization_id || '1dc7be49-0354-4843-95e3-93b7064d19b9')
      .limit(5)

    // Test 3: with deleted_at filter
    const { data: filteredOrders, error: filtErr } = await supabase
      .from('orders')
      .select('id, order_id')
      .eq('organization_id', organization_id || '1dc7be49-0354-4843-95e3-93b7064d19b9')
      .is('deleted_at', null)
      .limit(5)

    return res.status(200).json({
      organization_id: organization_id || 'not provided',
      test1_all: { count: allOrders?.length, error: allErr?.message, sample: allOrders?.slice(0, 2) },
      test2_org: { count: orgOrders?.length, error: orgErr?.message, sample: orgOrders?.slice(0, 2) },
      test3_filtered: { count: filteredOrders?.length, error: filtErr?.message, sample: filteredOrders?.slice(0, 2) },
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
