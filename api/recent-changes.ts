import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://ganesh-order-tracker.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function setCors(res: VercelResponse) {
  for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v)
}

const STAGE_NAMES: Record<number, string> = {
  1: 'Order Confirmed',
  2: 'Proforma Issued',
  3: 'Artwork in Progress',
  4: 'Artwork Confirmed',
  5: 'Quality Check',
  6: 'Schedule Confirmed',
  7: 'Draft Documents',
  8: 'Final Documents',
  9: 'DHL Number',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization' })
    }

    const supabaseUrl = process.env.SUPABASE_URL!
    const supabaseAnon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) {
      return res.status(401).json({ error: 'Authentication failed' })
    }

    const { organization_id, since } = req.body || {}
    if (!organization_id || !since) {
      return res.status(400).json({ error: 'Missing organization_id or since' })
    }

    const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    // Verify org membership
    const { data: membership } = await supabase
      .from('organization_members')
      .select('id')
      .eq('organization_id', organization_id)
      .eq('user_id', user.id)
      .single()
    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this organization' })
    }

    // 1. New orders created since last login
    const { data: newOrders } = await supabase
      .from('orders')
      .select('id, order_id, company, supplier, product, current_stage, created_at')
      .eq('organization_id', organization_id)
      .is('deleted_at', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })

    // 2. Orders updated since last login
    const { data: updatedOrders } = await supabase
      .from('orders')
      .select('id, order_id, company, supplier, product, current_stage, updated_at')
      .eq('organization_id', organization_id)
      .is('deleted_at', null)
      .gte('updated_at', since)
      .order('updated_at', { ascending: false })

    // Filter out orders that were also new (avoid duplicates)
    const newOrderIds = new Set((newOrders || []).map(o => o.id))
    const pureUpdates = (updatedOrders || []).filter(o => !newOrderIds.has(o.id))

    // 3. New emails/history since last login
    // order_history doesn't have organization_id, so get all org order IDs first
    const { data: allOrgOrders } = await supabase
      .from('orders')
      .select('id, order_id, company, supplier')
      .eq('organization_id', organization_id)
      .is('deleted_at', null)

    const orgOrderIds = (allOrgOrders || []).map(o => o.id)
    let recentEmails: any[] = []
    let emailOrderMap: Record<string, any> = {}

    if (orgOrderIds.length > 0) {
      for (const o of (allOrgOrders || [])) {
        emailOrderMap[o.id] = { order_id: o.order_id, company: o.company, supplier: o.supplier }
      }

      const { data: emailData } = await supabase
        .from('order_history')
        .select('id, order_id, stage, subject, from_address, timestamp, has_attachment')
        .in('order_id', orgOrderIds)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(50)

      recentEmails = emailData || []
    }

    const changes = {
      newOrders: (newOrders || []).map(o => ({
        orderId: o.order_id,
        company: o.company,
        supplier: o.supplier,
        product: o.product,
        stage: STAGE_NAMES[o.current_stage] || `Stage ${o.current_stage}`,
        timestamp: o.created_at,
      })),
      stageUpdates: pureUpdates.map(o => ({
        orderId: o.order_id,
        company: o.company,
        supplier: o.supplier,
        product: o.product,
        stage: STAGE_NAMES[o.current_stage] || `Stage ${o.current_stage}`,
        timestamp: o.updated_at,
      })),
      newEmails: (recentEmails || []).map(e => {
        const order = emailOrderMap[e.order_id]
        return {
          orderId: order?.order_id || 'Unknown',
          company: order?.company || '',
          supplier: order?.supplier || '',
          stage: STAGE_NAMES[e.stage] || `Stage ${e.stage}`,
          subject: e.subject,
          from: e.from_address,
          timestamp: e.timestamp,
          hasAttachment: e.has_attachment,
        }
      }),
    }

    const totalChanges = changes.newOrders.length + changes.stageUpdates.length + changes.newEmails.length

    return res.status(200).json({ changes, totalChanges })
  } catch (err: any) {
    console.error('[RECENT-CHANGES] Error:', err)
    return res.status(500).json({ error: err.message || 'Something went wrong' })
  }
}
