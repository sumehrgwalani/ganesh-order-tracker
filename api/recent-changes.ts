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

    const { organization_id } = req.body || {}
    if (!organization_id) {
      return res.status(400).json({ error: 'Missing organization_id' })
    }

    const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    // Get membership + last sync time
    const { data: membership } = await supabase
      .from('organization_members')
      .select('id, gmail_last_sync')
      .eq('organization_id', organization_id)
      .eq('user_id', user.id)
      .single()
    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this organization' })
    }

    const since = membership.gmail_last_sync || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const lastSyncTime = membership.gmail_last_sync || null

    // 1. New orders created since last sync
    const { data: newOrders } = await supabase
      .from('orders')
      .select('id, order_id, company, supplier, product, current_stage, created_at')
      .eq('organization_id', organization_id)
      .is('deleted_at', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })

    // 2. Orders updated since last sync (stage changes etc)
    const { data: updatedOrders } = await supabase
      .from('orders')
      .select('id, order_id, company, supplier, product, current_stage, updated_at')
      .eq('organization_id', organization_id)
      .is('deleted_at', null)
      .gte('updated_at', since)
      .order('updated_at', { ascending: false })

    const newOrderIds = new Set((newOrders || []).map(o => o.id))
    const pureUpdates = (updatedOrders || []).filter(o => !newOrderIds.has(o.id))

    // 3. New emails since last sync
    const { data: allOrgOrders } = await supabase
      .from('orders')
      .select('id, order_id, company, supplier')
      .eq('organization_id', organization_id)
      .is('deleted_at', null)

    const orgOrderIds = (allOrgOrders || []).map(o => o.id)
    let recentEmails: any[] = []
    const emailOrderMap: Record<string, any> = {}

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
        .limit(100)

      recentEmails = emailData || []
    }

    // === BUILD SUMMARY ===
    const summary: { icon: string; text: string; detail?: string; orderId?: string }[] = []

    // New orders
    if ((newOrders || []).length > 0) {
      const count = newOrders!.length
      const poList = newOrders!.map(o => o.order_id).join(', ')
      summary.push({
        icon: 'new_order',
        text: `${count} new order${count > 1 ? 's' : ''} created`,
        detail: poList,
      })
    }

    // Stage updates — group by stage
    const stageGroups: Record<string, string[]> = {}
    for (const o of pureUpdates) {
      const stageName = STAGE_NAMES[o.current_stage] || `Stage ${o.current_stage}`
      if (!stageGroups[stageName]) stageGroups[stageName] = []
      stageGroups[stageName].push(o.order_id)
    }
    for (const [stage, orders] of Object.entries(stageGroups)) {
      summary.push({
        icon: 'stage_update',
        text: `${orders.length} order${orders.length > 1 ? 's' : ''} moved to ${stage}`,
        detail: orders.join(', '),
      })
    }

    // Emails — group by stage to summarize actions
    const emailsByStage: Record<number, Set<string>> = {}
    const emailsWithAttachments: string[] = []
    const uniqueOrdersEmailed = new Set<string>()

    for (const e of recentEmails) {
      const order = emailOrderMap[e.order_id]
      const poNum = order?.order_id || 'Unknown'
      uniqueOrdersEmailed.add(poNum)

      if (!emailsByStage[e.stage]) emailsByStage[e.stage] = new Set()
      emailsByStage[e.stage].add(poNum)

      if (e.has_attachment) emailsWithAttachments.push(poNum)
    }

    // Summarize emails by stage type
    for (const [stageNum, poSet] of Object.entries(emailsByStage)) {
      const stage = Number(stageNum)
      const stageName = STAGE_NAMES[stage] || `Stage ${stage}`
      const pos = [...poSet]

      let action = ''
      switch (stage) {
        case 1: action = `PO confirmation emails received`; break
        case 2: action = `Proforma invoice emails received`; break
        case 3: action = `Artwork emails received`; break
        case 4: action = `Artwork approval emails received`; break
        case 5: action = `Quality check emails received`; break
        case 6: action = `Schedule confirmation emails received`; break
        case 7: action = `Draft document emails received`; break
        case 8: action = `Final document emails received`; break
        case 9: action = `DHL/AWB tracking emails received`; break
        default: action = `${stageName} emails received`; break
      }

      summary.push({
        icon: 'email',
        text: `${pos.length} ${action}`,
        detail: pos.join(', '),
      })
    }

    // Attachments summary
    if (emailsWithAttachments.length > 0) {
      const unique = [...new Set(emailsWithAttachments)]
      summary.push({
        icon: 'attachment',
        text: `${emailsWithAttachments.length} email${emailsWithAttachments.length > 1 ? 's' : ''} with attachments`,
        detail: unique.join(', '),
      })
    }

    // Total emails
    const totalEmails = recentEmails.length
    const totalOrders = uniqueOrdersEmailed.size

    return res.status(200).json({
      summary,
      stats: {
        newOrders: (newOrders || []).length,
        stageUpdates: pureUpdates.length,
        emailsReceived: totalEmails,
        ordersAffected: totalOrders,
      },
      lastSyncTime,
    })
  } catch (err: any) {
    console.error('[RECENT-CHANGES] Error:', err)
    return res.status(500).json({ error: err.message || 'Something went wrong' })
  }
}
