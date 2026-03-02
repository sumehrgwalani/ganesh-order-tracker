import type { VercelRequest, VercelResponse } from '@vercel/node'
import { setCors, authenticateRequest } from './_utils/shared'

const STAGE_NAMES: Record<number, string> = {
  1: 'Order Confirmed (PO Sent)',
  2: 'Proforma Issued (PI)',
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
    const auth = await authenticateRequest(req, res)
    if (!auth) return
    const { user, supabase } = auth

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'AI not configured.' })
    }

    const { question, organization_id } = req.body || {}
    if (!question || !organization_id) {
      return res.status(400).json({ error: 'Missing question or organization_id' })
    }

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

    // Fetch all orders with history and line items
    let orders: any[] = []
    const { data: orderData, error: orderErr } = await supabase
      .from('orders')
      .select('id, order_id, company, supplier, product, specs, current_stage, awb_number, total_value, total_kilos, delivery_terms, payment_terms, commission, created_at, brand, pi_number, from_location, to_location')
      .eq('organization_id', organization_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (orderErr) {
      // Fallback without deleted_at filter
      console.log('[CHAT] Orders query error, trying fallback:', orderErr.message)
      const { data: fallback } = await supabase
        .from('orders')
        .select('id, order_id, company, supplier, product, specs, current_stage, awb_number, total_value, total_kilos, delivery_terms, payment_terms, commission, created_at, brand, pi_number, from_location, to_location')
        .eq('organization_id', organization_id)
        .order('created_at', { ascending: false })
      orders = fallback || []
    } else {
      orders = orderData || []
    }

    console.log(`[CHAT] Found ${orders.length} orders for org ${organization_id}`)

    const orderIds = orders.map((o: any) => o.id)

    // Fetch order history (email trail) — just subjects and key info, not full bodies
    let history: any[] = []
    if (orderIds.length > 0) {
      const { data: histData } = await supabase
        .from('order_history')
        .select('order_id, stage, from_address, subject, timestamp, has_attachment, attachments')
        .in('order_id', orderIds)
        .order('timestamp', { ascending: false })
      history = histData || []
    }

    // Fetch line items
    let lineItems: any[] = []
    if (orderIds.length > 0) {
      const { data: liData } = await supabase
        .from('order_line_items')
        .select('order_id, product, brand, size, packing, cases, kilos, price_per_kg, currency, total')
        .in('order_id', orderIds)
      lineItems = liData || []
    }

    // Build order context — keep it concise to fit in context window
    const orderSummaries = (orders || []).map((o: any) => {
      const orderHistory = (history || []).filter((h: any) => h.order_id === o.id)
      const orderItems = (lineItems || []).filter((li: any) => li.order_id === o.id)

      let summary = `PO: ${o.order_id} | Company: ${o.company} | Supplier: ${o.supplier} | Product: ${o.product}`
      if (o.specs) summary += ` | Specs: ${o.specs}`
      if (o.brand) summary += ` | Brand: ${o.brand}`
      summary += ` | Stage: ${STAGE_NAMES[o.current_stage] || o.current_stage}`
      if (o.awb_number) summary += ` | DHL/AWB: ${o.awb_number}`
      if (o.total_value) summary += ` | Value: ${o.total_value}`
      if (o.total_kilos) summary += ` | Weight: ${o.total_kilos} kg`
      if (o.delivery_terms) summary += ` | Delivery: ${o.delivery_terms}`
      if (o.payment_terms) summary += ` | Payment: ${o.payment_terms}`
      if (o.pi_number) summary += ` | PI#: ${o.pi_number}`
      if (o.from_location) summary += ` | From: ${o.from_location}`
      if (o.to_location) summary += ` | To: ${o.to_location}`
      if (o.created_at) summary += ` | Date: ${o.created_at.substring(0, 10)}`

      if (orderItems.length > 0) {
        summary += `\n  Line Items:`
        for (const li of orderItems) {
          summary += `\n    - ${li.product || ''}${li.brand ? ' (' + li.brand + ')' : ''} | Size: ${li.size || 'N/A'} | Pack: ${li.packing || 'N/A'} | Cases: ${li.cases || 'N/A'} | Kilos: ${li.kilos || 'N/A'} | Price: ${li.price_per_kg || 'N/A'} ${li.currency || 'USD'}/kg | Total: ${li.total || 'N/A'}`
        }
      }

      if (orderHistory.length > 0) {
        const recentEmails = orderHistory.slice(0, 5)
        summary += `\n  Recent Emails (${orderHistory.length} total):`
        for (const h of recentEmails) {
          const stageName = h.stage ? STAGE_NAMES[h.stage] || `Stage ${h.stage}` : 'Unassigned'
          summary += `\n    - [${stageName}] "${h.subject}" from ${h.from_address} (${h.timestamp?.substring(0, 10) || ''})`
          if (h.has_attachment) summary += ' [has attachment]'
        }
      }

      return summary
    }).join('\n\n')

    const systemPrompt = `You are an AI assistant for Ganesh International, a global frozen seafood trading company. You help the user search through and understand their purchase orders.

Answer the user's question based ONLY on the order data provided below. Be concise and specific. If you can't find the answer in the data, say so.

Format: Use plain text. For lists, use simple dashes. Keep responses short — a few sentences unless the user asks for detail.

IMPORTANT: Always refer to orders by their FULL PO number (e.g. GI/PO/25-26/3038), never shortened forms like "PO 3038". The full PO number is clickable in the UI.

When listing orders, always include the buyer (Company) and supplier after each PO number. For example:
- GI/PO/25-26/3038 — Buyer: ABC Foods, Supplier: XYZ Seafood

ORDER STAGES (1-9):
1=Order Confirmed, 2=Proforma Issued, 3=Artwork in Progress, 4=Artwork Confirmed, 5=Quality Check, 6=Schedule Confirmed, 7=Draft Documents, 8=Final Documents, 9=DHL Number

CURRENT ORDERS DATA:
${orderSummaries || 'No orders found.'}

Total orders: ${(orders || []).length}`

    // Call Claude
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 25000)

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: question }],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!aiRes.ok) {
      const errText = await aiRes.text()
      console.error('[CHAT] AI error:', aiRes.status, errText)
      return res.status(500).json({ error: 'AI request failed. Please try again.' })
    }

    const aiData = await aiRes.json()
    const answer = aiData.content?.[0]?.text || 'No response from AI.'

    // Build PO number → database UUID lookup for linking
    const orderMap: Record<string, string> = {}
    for (const o of orders) {
      if (o.order_id) orderMap[o.order_id] = o.id
    }

    return res.status(200).json({ answer, orderMap })
  } catch (err: any) {
    console.error('[CHAT] Error:', err)
    return res.status(500).json({ error: err.message || 'Something went wrong' })
  }
}
