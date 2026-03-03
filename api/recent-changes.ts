import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const ALLOWED_ORIGIN = 'https://ganesh-order-tracker.vercel.app'
function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
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

const DOC_STAGE_NAMES: Record<number, string> = {
  1: 'PO',
  2: 'Proforma Invoice',
  3: 'Artwork',
  4: 'Artwork Approval',
  5: 'Quality Check',
  6: 'Schedule',
  7: 'Draft',
  8: 'Final Document',
  9: 'DHL/AWB',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    // Auth
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing authorization' })
    const supabaseUrl = process.env.SUPABASE_URL!
    const supabaseAnon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
    const userClient = createClient(supabaseUrl, supabaseAnon, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return res.status(401).json({ error: 'Authentication failed. Please log in again.' })
    const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    const { organization_id } = req.body || {}
    if (!organization_id) {
      return res.status(400).json({ error: 'Missing organization_id' })
    }

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

    // Get all org orders for lookups
    const { data: allOrgOrders } = await supabase
      .from('orders')
      .select('id, order_id, company, supplier, product, current_stage, delivery_terms, payment_terms, commission, created_at, updated_at')
      .eq('organization_id', organization_id)
      .is('deleted_at', null)

    const orgOrderIds = (allOrgOrders || []).map(o => o.id)
    const poToId: Record<string, string> = {}
    const idToPo: Record<string, string> = {}
    for (const o of (allOrgOrders || [])) {
      poToId[o.order_id] = o.id
      idToPo[o.id] = o.order_id
    }

    // === QUERY 1: New orders created since last sync ===
    const newOrders = (allOrgOrders || []).filter(o => o.created_at >= since)
    const newOrderIds = new Set(newOrders.map(o => o.id))

    // === QUERY 2: Orders that advanced stage (updated but not new) ===
    const pureUpdates = (allOrgOrders || []).filter(o => !newOrderIds.has(o.id) && o.updated_at >= since)

    // === QUERY 3: Line items extracted since last sync ===
    let lineItemsByOrder: Record<string, number> = {}
    if (orgOrderIds.length > 0) {
      const { data: recentLineItems } = await supabase
        .from('order_line_items')
        .select('id, order_id')
        .in('order_id', orgOrderIds)
        .gte('created_at', since)

      for (const li of (recentLineItems || [])) {
        const po = idToPo[li.order_id]
        if (po) lineItemsByOrder[po] = (lineItemsByOrder[po] || 0) + 1
      }
    }

    // === QUERY 4: Documents stored since last sync (order_history with attachments) ===
    let docsByStage: Record<number, Set<string>> = {}
    let totalDocsStored = 0
    if (orgOrderIds.length > 0) {
      const { data: recentDocs } = await supabase
        .from('order_history')
        .select('id, order_id, stage, attachments')
        .in('order_id', orgOrderIds)
        .gte('created_at', since)
        .not('attachments', 'is', null)
        .limit(200)

      for (const doc of (recentDocs || [])) {
        // Only count entries that actually have attachments
        if (!doc.attachments || (Array.isArray(doc.attachments) && doc.attachments.length === 0)) continue
        const po = idToPo[doc.order_id]
        if (!po) continue
        if (!docsByStage[doc.stage]) docsByStage[doc.stage] = new Set()
        docsByStage[doc.stage].add(po)
        totalDocsStored++
      }
    }

    // === QUERY 5: Orders with details updated (delivery terms, payment, supplier, commission filled) ===
    // These are orders that were updated since last sync and have key fields filled
    const detailsUpdated: { po: string; id: string; fields: string[] }[] = []
    for (const o of pureUpdates) {
      const fields: string[] = []
      if (o.delivery_terms) fields.push('delivery terms')
      if (o.payment_terms) fields.push('payment')
      if (o.supplier && o.supplier !== 'Unknown') fields.push('supplier')
      if (o.commission) fields.push('commission')
      if (fields.length > 0) {
        detailsUpdated.push({ po: o.order_id, id: o.id, fields })
      }
    }

    // === QUERY 6: Total emails processed (for stats bar) ===
    let totalEmails = 0
    let ordersWithEmails = new Set<string>()
    if (orgOrderIds.length > 0) {
      const { data: emailData } = await supabase
        .from('order_history')
        .select('id, order_id')
        .in('order_id', orgOrderIds)
        .gte('created_at', since)
        .limit(200)

      totalEmails = (emailData || []).length
      for (const e of (emailData || [])) {
        const po = idToPo[e.order_id]
        if (po) ordersWithEmails.add(po)
      }
    }

    // === BUILD SUMMARY ===
    const summary: { icon: string; text: string; detail?: string; detailLinks?: { po: string; id: string }[] }[] = []

    // 1. New orders
    if (newOrders.length > 0) {
      const links = newOrders.map(o => ({ po: o.order_id, id: o.id }))
      summary.push({
        icon: 'new_order',
        text: `${newOrders.length} new order${newOrders.length > 1 ? 's' : ''} created`,
        detail: links.map(l => l.po).join(', '),
        detailLinks: links,
      })
    }

    // 2. Stage advances — group by stage
    const stageGroups: Record<string, { po: string; id: string }[]> = {}
    for (const o of pureUpdates) {
      const stageName = STAGE_NAMES[o.current_stage] || `Stage ${o.current_stage}`
      if (!stageGroups[stageName]) stageGroups[stageName] = []
      // Avoid duplicates
      if (!stageGroups[stageName].some(x => x.id === o.id)) {
        stageGroups[stageName].push({ po: o.order_id, id: o.id })
      }
    }
    for (const [stage, orders] of Object.entries(stageGroups)) {
      summary.push({
        icon: 'stage_update',
        text: `${orders.length} order${orders.length > 1 ? 's' : ''} advanced to ${stage}`,
        detail: orders.map(o => o.po).join(', '),
        detailLinks: orders,
      })
    }

    // 3. Line items extracted
    const lineItemOrders = Object.keys(lineItemsByOrder)
    if (lineItemOrders.length > 0) {
      const totalItems = Object.values(lineItemsByOrder).reduce((a, b) => a + b, 0)
      const links = lineItemOrders.map(po => ({ po, id: poToId[po] || '' })).filter(l => l.id)
      summary.push({
        icon: 'line_items',
        text: `${totalItems} line item${totalItems > 1 ? 's' : ''} extracted for ${lineItemOrders.length} order${lineItemOrders.length > 1 ? 's' : ''}`,
        detail: lineItemOrders.map(po => `${po} (${lineItemsByOrder[po]} items)`).join(', '),
        detailLinks: links,
      })
    }

    // 4. Documents stored — group by doc type
    for (const [stageNum, poSet] of Object.entries(docsByStage)) {
      const stage = Number(stageNum)
      const docName = DOC_STAGE_NAMES[stage] || `Stage ${stage}`
      const pos = [...poSet]
      const links = pos.map(po => ({ po, id: poToId[po] || '' })).filter(l => l.id)
      summary.push({
        icon: 'document',
        text: `${pos.length} ${docName} document${pos.length > 1 ? 's' : ''} stored`,
        detail: pos.join(', '),
        detailLinks: links,
      })
    }

    // 5. Order details updated
    if (detailsUpdated.length > 0) {
      const links = detailsUpdated.map(d => ({ po: d.po, id: d.id }))
      summary.push({
        icon: 'details_updated',
        text: `Details updated for ${detailsUpdated.length} order${detailsUpdated.length > 1 ? 's' : ''}`,
        detail: detailsUpdated.map(d => `${d.po} (${d.fields.join(', ')})`).join('; '),
        detailLinks: links,
      })
    }

    // 6. Email processing count (just for the stats bar, not a summary item)
    if (totalEmails > 0 && summary.length === 0) {
      // If nothing else to show but emails were processed, show a simple message
      summary.push({
        icon: 'email',
        text: `${totalEmails} email${totalEmails > 1 ? 's' : ''} processed across ${ordersWithEmails.size} order${ordersWithEmails.size > 1 ? 's' : ''}`,
      })
    }

    return res.status(200).json({
      summary,
      stats: {
        newOrders: newOrders.length,
        stageUpdates: pureUpdates.length,
        emailsProcessed: totalEmails,
        ordersAffected: ordersWithEmails.size,
        docsStored: totalDocsStored,
        lineItemsExtracted: Object.values(lineItemsByOrder).reduce((a, b) => a + b, 0),
      },
      lastSyncTime,
    })
  } catch (err: any) {
    console.error('[RECENT-CHANGES] Error:', err)
    return res.status(500).json({ error: err.message || 'Something went wrong' })
  }
}
