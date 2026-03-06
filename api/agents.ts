import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// ===== CONSTANTS =====

const ALLOWED_ORIGIN = 'https://ganesh-order-tracker.vercel.app'
const ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929'

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

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
}

// ===== AI HELPER =====

async function callAI(apiKey: string, prompt: string, systemPrompt: string, maxTokens: number = 1500): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 55000)
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) {
      const errText = await res.text()
      console.error('[AGENTS] AI error:', res.status, errText)
      throw new Error('AI request failed')
    }
    const data = await res.json()
    return data.content?.[0]?.text || ''
  } catch (err) {
    clearTimeout(timeout)
    throw err
  }
}

// ===== MODE 1: FOLLOW-UP AGENT =====

async function runFollowUpAgent(supabase: any, orgId: string, apiKey: string, companyName: string, orgType: string) {
  console.log('[AGENTS] Running follow-up agent')

  // Fetch active orders (stage < 9, not deleted)
  const { data: orders } = await supabase
    .from('orders')
    .select('id, order_id, company, supplier, product, current_stage, created_at, payment_terms, delivery_terms')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .lt('current_stage', 9)

  if (!orders || orders.length === 0) {
    console.log('[AGENTS] No active orders for follow-up')
    return { processed: 0 }
  }

  const orderIds = orders.map((o: any) => o.id)

  // Get latest email timestamp per order from order_history
  const { data: history } = await supabase
    .from('order_history')
    .select('order_id, timestamp, from_address, subject')
    .in('order_id', orderIds)
    .order('timestamp', { ascending: false })

  // Build map: order_id -> latest email info
  const latestEmail: Record<string, { timestamp: string; from: string; subject: string }> = {}
  for (const h of (history || [])) {
    if (!latestEmail[h.order_id]) {
      latestEmail[h.order_id] = { timestamp: h.timestamp, from: h.from_address, subject: h.subject }
    }
  }

  // Find stalled orders: last email > 3 days ago AND stage < 7 (pre-shipping)
  const now = Date.now()
  const THREE_DAYS = 3 * 24 * 60 * 60 * 1000
  const stalledOrders = orders.filter((o: any) => {
    if (o.current_stage >= 7) return false // shipping phase, less urgent
    const last = latestEmail[o.id]
    if (!last) return true // no emails at all = definitely stalled
    const daysSince = now - new Date(last.timestamp).getTime()
    return daysSince > THREE_DAYS
  })

  if (stalledOrders.length === 0) {
    console.log('[AGENTS] No stalled orders found')
    return { processed: 0 }
  }

  // Build context for AI
  const orderSummaries = stalledOrders.slice(0, 15).map((o: any) => {
    const last = latestEmail[o.id]
    const daysSince = last ? Math.floor((now - new Date(last.timestamp).getTime()) / (24 * 60 * 60 * 1000)) : 'unknown'
    return `PO: ${o.order_id} | Company: ${o.company} | Supplier: ${o.supplier} | Product: ${o.product} | Stage: ${STAGE_NAMES[o.current_stage] || o.current_stage} | Days since last email: ${daysSince}${last ? ` | Last email: "${last.subject}" from ${last.from}` : ' | No emails on record'}`
  }).join('\n')

  const roleDesc = orgType === 'buyer' ? 'a buyer/importer' : orgType === 'supplier' ? 'a supplier/exporter' : 'an intermediary trader'
  const systemPrompt = `You are an assistant for ${companyName}, ${roleDesc} in the global frozen foods trade. You help identify orders that need follow-up and draft short professional follow-up emails.`

  const prompt = `These orders have gone quiet (no email activity for 3+ days). For each order, provide:
1. A short title (max 80 chars) summarizing the issue
2. A brief explanation of what follow-up is needed
3. A draft email subject and body to send as follow-up

STALLED ORDERS:
${orderSummaries}

Respond as JSON array:
[{
  "po_number": "...",
  "title": "...",
  "body": "...",
  "priority": "high|medium|low",
  "draft_subject": "...",
  "draft_body": "...",
  "recipient_role": "supplier|buyer|both"
}]

Priority guide: high = stage 1-3 stalled 5+ days, medium = stage 4-5 stalled 3+ days, low = stage 6.
Keep draft emails concise (3-5 sentences), professional, and specific to the order context.`

  const aiResponse = await callAI(apiKey, prompt, systemPrompt, 2000)

  // Parse AI response
  let insights: any[] = []
  try {
    const jsonMatch = aiResponse.match(/\[[\s\S]*\]/)
    if (jsonMatch) insights = JSON.parse(jsonMatch[0])
  } catch (e) {
    console.error('[AGENTS] Failed to parse follow-up response:', e)
    return { processed: 0, error: 'parse_failed' }
  }

  // Clear old follow-up insights for this org (keep last 24h only)
  await supabase
    .from('agent_insights')
    .delete()
    .eq('organization_id', orgId)
    .eq('agent_type', 'follow_up')
    .lt('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString())

  // Build order_id lookup
  const poToUuid: Record<string, string> = {}
  for (const o of orders) poToUuid[o.order_id] = o.id

  // Insert new insights
  let insertCount = 0
  for (const insight of insights) {
    const orderId = poToUuid[insight.po_number]
    if (!orderId) continue

    // Find supplier contact email for this order
    const order = orders.find((o: any) => o.order_id === insight.po_number)
    const recipients = order ? [latestEmail[orderId]?.from].filter(Boolean) : []

    await supabase.from('agent_insights').insert({
      organization_id: orgId,
      agent_type: 'follow_up',
      order_id: orderId,
      title: insight.title || `Follow up on ${insight.po_number}`,
      body: insight.body || 'This order needs attention.',
      priority: insight.priority || 'medium',
      action_type: 'send_email',
      action_data: {
        draft_subject: insight.draft_subject || `Follow up: ${insight.po_number}`,
        draft_body: insight.draft_body || '',
        recipients,
        po_number: insight.po_number,
      },
    })
    insertCount++
  }

  console.log(`[AGENTS] Follow-up: ${insertCount} insights created for ${stalledOrders.length} stalled orders`)
  return { processed: insertCount }
}

// ===== MODE 2: SMART COMPOSE =====

async function runComposeAgent(supabase: any, orgId: string, apiKey: string, companyName: string, orgType: string, orderId: string, intent: string) {
  console.log(`[AGENTS] Running compose agent for order ${orderId}, intent: ${intent}`)

  // Fetch order details
  const { data: order } = await supabase
    .from('orders')
    .select('id, order_id, company, supplier, product, specs, current_stage, payment_terms, delivery_terms, commission, brand, pi_number, from_location, to_location, total_value, total_kilos')
    .eq('id', orderId)
    .eq('organization_id', orgId)
    .single()

  if (!order) throw new Error('Order not found')

  // Fetch recent email history
  const { data: history } = await supabase
    .from('order_history')
    .select('stage, from_address, subject, body, timestamp')
    .eq('order_id', orderId)
    .order('timestamp', { ascending: false })
    .limit(5)

  // Fetch contacts for this order's supplier/company
  const { data: contacts } = await supabase
    .from('contacts')
    .select('email, name, company, role')
    .eq('organization_id', orgId)
    .or(`company.ilike.%${order.supplier}%,company.ilike.%${order.company}%`)
    .limit(5)

  const emailTrail = (history || []).map((h: any) =>
    `[${STAGE_NAMES[h.stage] || 'Unknown'}] "${h.subject}" from ${h.from_address} (${h.timestamp?.substring(0, 10)})\n  Body preview: ${(h.body || '').substring(0, 200)}`
  ).join('\n')

  const contactList = (contacts || []).map((c: any) => `${c.name} <${c.email}> (${c.company}, ${c.role || 'unknown role'})`).join('\n')

  const roleDesc = orgType === 'buyer' ? 'a buyer/importer' : orgType === 'supplier' ? 'a supplier/exporter' : 'an intermediary trader'
  const systemPrompt = `You are an email drafting assistant for ${companyName}, ${roleDesc} in global frozen foods trade. Write concise, professional trade emails.`

  const prompt = `Draft an email for this order. Intent: "${intent}"

ORDER DETAILS:
PO: ${order.order_id} | Company: ${order.company} | Supplier: ${order.supplier}
Product: ${order.product}${order.specs ? ' | Specs: ' + order.specs : ''}${order.brand ? ' | Brand: ' + order.brand : ''}
Stage: ${STAGE_NAMES[order.current_stage] || order.current_stage}
${order.payment_terms ? 'Payment: ' + order.payment_terms : ''}${order.delivery_terms ? ' | Delivery: ' + order.delivery_terms : ''}
${order.total_value ? 'Value: ' + order.total_value : ''}${order.total_kilos ? ' | Weight: ' + order.total_kilos + ' kg' : ''}
${order.from_location ? 'From: ' + order.from_location : ''}${order.to_location ? ' → To: ' + order.to_location : ''}

RECENT EMAILS:
${emailTrail || 'No email history'}

KNOWN CONTACTS:
${contactList || 'No contacts found'}

Respond as JSON:
{"subject": "...", "body": "...", "suggested_recipients": ["email1@example.com"]}

Rules:
- Keep body to 3-7 sentences
- Be specific: reference PO number, product, relevant dates
- Professional but not overly formal
- Don't include signature (user adds their own)`

  const aiResponse = await callAI(apiKey, prompt, systemPrompt, 1000)

  try {
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0])
      return { subject: result.subject, body: result.body, suggested_recipients: result.suggested_recipients || [] }
    }
  } catch (e) {
    console.error('[AGENTS] Failed to parse compose response:', e)
  }
  return { subject: '', body: '', error: 'parse_failed' }
}

// ===== MODE 3: PAYMENT TRACKER =====

async function runPaymentAgent(supabase: any, orgId: string, apiKey: string, companyName: string, orgType: string) {
  console.log('[AGENTS] Running payment tracker agent')

  // Fetch active orders with payment terms
  const { data: orders } = await supabase
    .from('orders')
    .select('id, order_id, company, supplier, product, current_stage, payment_terms, delivery_terms, total_value, created_at')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .lt('current_stage', 9)
    .not('payment_terms', 'is', null)

  if (!orders || orders.length === 0) {
    console.log('[AGENTS] No orders with payment terms')
    return { processed: 0 }
  }

  // Get key dates from order history (BL date = stage 8, shipment = stage 6)
  const orderIds = orders.map((o: any) => o.id)
  const { data: history } = await supabase
    .from('order_history')
    .select('order_id, stage, timestamp')
    .in('order_id', orderIds)
    .in('stage', [6, 7, 8, 9])
    .order('timestamp', { ascending: true })

  // Build date map per order
  const stageDates: Record<string, Record<number, string>> = {}
  for (const h of (history || [])) {
    if (!stageDates[h.order_id]) stageDates[h.order_id] = {}
    stageDates[h.order_id][h.stage] = h.timestamp
  }

  const orderSummaries = orders.map((o: any) => {
    const dates = stageDates[o.id] || {}
    let dateInfo = ''
    if (dates[8]) dateInfo += ` | Final docs date: ${new Date(dates[8]).toISOString().substring(0, 10)}`
    if (dates[6]) dateInfo += ` | Schedule date: ${new Date(dates[6]).toISOString().substring(0, 10)}`
    return `PO: ${o.order_id} | Company: ${o.company} | Supplier: ${o.supplier} | Value: ${o.total_value || 'unknown'} | Stage: ${STAGE_NAMES[o.current_stage] || o.current_stage} | Payment terms: ${o.payment_terms} | Order created: ${o.created_at?.substring(0, 10)}${dateInfo}`
  }).join('\n')

  const roleDesc = orgType === 'buyer' ? 'a buyer/importer' : orgType === 'supplier' ? 'a supplier/exporter' : 'an intermediary trader'
  const systemPrompt = `You are a payment tracking assistant for ${companyName}, ${roleDesc} in frozen foods trade. Today is ${new Date().toISOString().substring(0, 10)}.`

  const prompt = `Analyze these orders and identify payment deadlines or risks.

ORDERS WITH PAYMENT TERMS:
${orderSummaries}

Common payment terms in frozen foods trade:
- "TT before shipment" = must pay before stage 6
- "30 days from BL date" = pay within 30 days of final docs (stage 8)
- "LC at sight" = letter of credit needed before shipment
- "CAD" = cash against documents
- "TT against copy docs" = pay when draft docs received (stage 7)

For each order with a payment concern, respond as JSON array:
[{
  "po_number": "...",
  "title": "...",
  "body": "...",
  "priority": "high|medium|low",
  "deadline_status": "overdue|due_this_week|due_next_week|upcoming|needs_lc"
}]

Priority: high = overdue or due this week, medium = due next week or LC needed, low = upcoming.
If no payment concerns, return empty array [].`

  const aiResponse = await callAI(apiKey, prompt, systemPrompt, 1500)

  let insights: any[] = []
  try {
    const jsonMatch = aiResponse.match(/\[[\s\S]*\]/)
    if (jsonMatch) insights = JSON.parse(jsonMatch[0])
  } catch (e) {
    console.error('[AGENTS] Failed to parse payment response:', e)
    return { processed: 0, error: 'parse_failed' }
  }

  // Clear old payment insights
  const now = Date.now()
  await supabase
    .from('agent_insights')
    .delete()
    .eq('organization_id', orgId)
    .eq('agent_type', 'payment')
    .lt('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString())

  const poToUuid: Record<string, string> = {}
  for (const o of orders) poToUuid[o.order_id] = o.id

  let insertCount = 0
  for (const insight of insights) {
    const oid = poToUuid[insight.po_number]
    if (!oid) continue
    await supabase.from('agent_insights').insert({
      organization_id: orgId,
      agent_type: 'payment',
      order_id: oid,
      title: insight.title || `Payment: ${insight.po_number}`,
      body: insight.body || '',
      priority: insight.priority || 'medium',
      action_type: 'review_order',
      action_data: { po_number: insight.po_number, deadline_status: insight.deadline_status },
    })
    insertCount++
  }

  console.log(`[AGENTS] Payment: ${insertCount} insights created`)
  return { processed: insertCount }
}

// ===== MODE 4: SUPPLIER SCORING =====

async function runSupplierScoreAgent(supabase: any, orgId: string, apiKey: string, companyName: string, orgType: string) {
  console.log('[AGENTS] Running supplier scoring agent')

  // Fetch orders from last 6 months grouped by supplier
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()
  const { data: orders } = await supabase
    .from('orders')
    .select('id, order_id, company, supplier, product, current_stage, created_at')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .gte('created_at', sixMonthsAgo)

  if (!orders || orders.length === 0) {
    console.log('[AGENTS] No recent orders for scoring')
    return { processed: 0 }
  }

  // Group by supplier
  const supplierOrders: Record<string, any[]> = {}
  for (const o of orders) {
    const key = o.supplier || 'Unknown'
    if (!supplierOrders[key]) supplierOrders[key] = []
    supplierOrders[key].push(o)
  }

  // Get order history for timing analysis
  const orderIds = orders.map((o: any) => o.id)
  const { data: history } = await supabase
    .from('order_history')
    .select('order_id, stage, timestamp')
    .in('order_id', orderIds)
    .order('timestamp', { ascending: true })

  // Get corrections
  const { data: corrections } = await supabase
    .from('correction_log')
    .select('order_id, correction_type')
    .in('order_id', orderIds)

  // Build supplier metrics
  const supplierMetrics = Object.entries(supplierOrders).map(([supplier, ords]) => {
    const totalOrders = ords.length
    const completed = ords.filter((o: any) => o.current_stage >= 9).length
    const correctionCount = (corrections || []).filter((c: any) => ords.some((o: any) => o.id === c.order_id)).length

    // Calculate average days from stage 1 to current stage
    let totalDays = 0
    let daysCount = 0
    for (const o of ords) {
      const orderHistory = (history || []).filter((h: any) => h.order_id === o.id)
      if (orderHistory.length >= 2) {
        const first = new Date(orderHistory[0].timestamp).getTime()
        const last = new Date(orderHistory[orderHistory.length - 1].timestamp).getTime()
        totalDays += (last - first) / (24 * 60 * 60 * 1000)
        daysCount++
      }
    }
    const avgDays = daysCount > 0 ? Math.round(totalDays / daysCount) : 'N/A'

    return `Supplier: ${supplier} | Orders: ${totalOrders} | Completed: ${completed} | Corrections: ${correctionCount} | Avg days in pipeline: ${avgDays}`
  }).join('\n')

  const systemPrompt = `You are a supplier performance analyst for ${companyName}, a frozen foods trading company.`

  const prompt = `Rate these suppliers based on their performance metrics.

SUPPLIER METRICS (last 6 months):
${supplierMetrics}

For each supplier, provide a 1-5 star rating and a one-line assessment.

Scoring guide:
- 5 stars: Fast, reliable, no corrections needed
- 4 stars: Generally good, minor issues
- 3 stars: Average, some delays or corrections
- 2 stars: Below average, frequent issues
- 1 star: Poor performance, major concerns

Respond as JSON array:
[{"supplier": "...", "stars": 4, "assessment": "...", "strength": "...", "weakness": "..."}]`

  const aiResponse = await callAI(apiKey, prompt, systemPrompt, 1500)

  let scores: any[] = []
  try {
    const jsonMatch = aiResponse.match(/\[[\s\S]*\]/)
    if (jsonMatch) scores = JSON.parse(jsonMatch[0])
  } catch (e) {
    console.error('[AGENTS] Failed to parse supplier score response:', e)
    return { processed: 0, error: 'parse_failed' }
  }

  // Clear old supplier scores
  await supabase
    .from('agent_insights')
    .delete()
    .eq('organization_id', orgId)
    .eq('agent_type', 'supplier_score')

  let insertCount = 0
  for (const score of scores) {
    await supabase.from('agent_insights').insert({
      organization_id: orgId,
      agent_type: 'supplier_score',
      order_id: null,
      title: `${score.supplier}: ${'★'.repeat(score.stars || 3)}${'☆'.repeat(5 - (score.stars || 3))}`,
      body: `${score.assessment || ''}\nStrength: ${score.strength || 'N/A'}\nWeakness: ${score.weakness || 'N/A'}`,
      priority: score.stars <= 2 ? 'high' : score.stars <= 3 ? 'medium' : 'low',
      action_type: 'info',
      action_data: { supplier: score.supplier, stars: score.stars },
    })
    insertCount++
  }

  console.log(`[AGENTS] Supplier scores: ${insertCount} scorecards created`)
  return { processed: insertCount }
}

// ===== MODE 5: DAILY BRIEFING =====

async function runBriefingAgent(supabase: any, orgId: string, apiKey: string, companyName: string, orgType: string) {
  console.log('[AGENTS] Running daily briefing agent')

  const today = new Date()
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  const yesterdayISO = yesterday.toISOString()

  // Gather data
  const { data: allOrders } = await supabase
    .from('orders')
    .select('id, order_id, company, supplier, product, current_stage, created_at, updated_at')
    .eq('organization_id', orgId)
    .is('deleted_at', null)

  const orders = allOrders || []
  const newOrders = orders.filter((o: any) => o.created_at >= yesterdayISO)
  const updatedOrders = orders.filter((o: any) => o.updated_at >= yesterdayISO && o.created_at < yesterdayISO)
  const activeOrders = orders.filter((o: any) => o.current_stage < 9)

  // Get stalled orders (no activity 3+ days)
  const orderIds = activeOrders.map((o: any) => o.id)
  let stalledCount = 0
  if (orderIds.length > 0) {
    const { data: history } = await supabase
      .from('order_history')
      .select('order_id, timestamp')
      .in('order_id', orderIds)
      .order('timestamp', { ascending: false })

    const latestTimestamp: Record<string, string> = {}
    for (const h of (history || [])) {
      if (!latestTimestamp[h.order_id]) latestTimestamp[h.order_id] = h.timestamp
    }
    const THREE_DAYS = 3 * 24 * 60 * 60 * 1000
    stalledCount = activeOrders.filter((o: any) => {
      const last = latestTimestamp[o.id]
      return !last || (Date.now() - new Date(last).getTime()) > THREE_DAYS
    }).length
  }

  // Unmatched emails
  const { data: unmatchedEmails, count: unmatchedCount } = await supabase
    .from('synced_emails')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .is('matched_order_id', null)
    .is('user_linked_order_id', null)
    .eq('dismissed', false)
    .eq('reviewed', false)

  // Get existing follow-up and payment insights
  const { data: existingInsights } = await supabase
    .from('agent_insights')
    .select('agent_type, priority')
    .eq('organization_id', orgId)
    .eq('dismissed', false)
    .in('agent_type', ['follow_up', 'payment'])
    .gte('created_at', yesterdayISO)

  const highPriorityCount = (existingInsights || []).filter((i: any) => i.priority === 'high').length

  const briefingData = `TODAY'S SNAPSHOT (${today.toISOString().substring(0, 10)}):
- Total active orders: ${activeOrders.length}
- New orders (last 24h): ${newOrders.length}${newOrders.length > 0 ? ' — ' + newOrders.map((o: any) => `${o.order_id} (${o.supplier})`).join(', ') : ''}
- Orders updated (last 24h): ${updatedOrders.length}${updatedOrders.length > 0 ? ' — ' + updatedOrders.map((o: any) => `${o.order_id} moved to ${STAGE_NAMES[o.current_stage] || 'Stage ' + o.current_stage}`).join(', ') : ''}
- Stalled orders (3+ days no activity): ${stalledCount}
- Unmatched emails in mailbox: ${unmatchedCount || 0}
- High priority action items: ${highPriorityCount}

STAGE DISTRIBUTION:
${Object.entries(
    activeOrders.reduce((acc: Record<string, number>, o: any) => {
      const stage = STAGE_NAMES[o.current_stage] || `Stage ${o.current_stage}`
      acc[stage] = (acc[stage] || 0) + 1
      return acc
    }, {})
  ).map(([stage, count]) => `  ${stage}: ${count}`).join('\n')}`

  const roleDesc = orgType === 'buyer' ? 'a buyer/importer' : orgType === 'supplier' ? 'a supplier/exporter' : 'an intermediary trader'
  const systemPrompt = `You are a daily briefing assistant for ${companyName}, ${roleDesc} in global frozen foods trade. Write concise, actionable morning briefings.`

  const prompt = `Generate a daily briefing based on this data.

${briefingData}

Format your response as a brief morning summary (150-250 words max). Include:
1. Key headline (what's most important today)
2. What happened (new orders, stage changes)
3. What needs attention (stalled orders, unmatched emails, payment deadlines)
4. Top 3 action items for today

Keep it conversational but focused. No fluff.`

  const aiResponse = await callAI(apiKey, prompt, systemPrompt, 1500)

  // Clear old briefings (keep only latest)
  await supabase
    .from('agent_insights')
    .delete()
    .eq('organization_id', orgId)
    .eq('agent_type', 'briefing')

  // Insert new briefing
  await supabase.from('agent_insights').insert({
    organization_id: orgId,
    agent_type: 'briefing',
    order_id: null,
    title: `Daily Briefing — ${today.toISOString().substring(0, 10)}`,
    body: aiResponse,
    priority: highPriorityCount > 0 ? 'high' : stalledCount > 2 ? 'medium' : 'low',
    action_type: 'info',
    action_data: {
      active_orders: activeOrders.length,
      new_orders: newOrders.length,
      stalled: stalledCount,
      unmatched_emails: unmatchedCount || 0,
    },
  })

  // Also create a notification
  // Find org members to notify
  const { data: members } = await supabase
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', orgId)

  for (const member of (members || [])) {
    await supabase.from('notifications').insert({
      user_id: member.user_id,
      organization_id: orgId,
      type: 'order_update',
      title: 'Daily Briefing Ready',
      message: `${activeOrders.length} active orders, ${stalledCount} need attention, ${newOrders.length} new today.`,
      data: { agent_type: 'briefing' },
    })
  }

  console.log('[AGENTS] Daily briefing created')
  return { processed: 1 }
}

// ===== MAIN HANDLER =====

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    // Auth
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

    const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'AI not configured' })
    }

    const { organization_id, mode, order_id, intent: rawIntent } = req.body || {}
    if (!organization_id || !mode) {
      return res.status(400).json({ error: 'Missing organization_id or mode' })
    }

    // Whitelist valid intents to prevent prompt injection
    const VALID_INTENTS = ['follow_up', 'request_pi', 'request_docs', 'schedule_inquiry', 'payment_reminder', 'general']
    const intent = VALID_INTENTS.includes(rawIntent) ? rawIntent : 'follow_up'

    // Verify membership
    const { data: membership } = await supabase
      .from('organization_members')
      .select('id')
      .eq('organization_id', organization_id)
      .eq('user_id', user.id)
      .single()
    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this organization' })
    }

    // Get org settings
    const { data: settings } = await supabase
      .from('organization_settings')
      .select('company_name, organization_type')
      .eq('organization_id', organization_id)
      .single()

    const companyName = settings?.company_name || 'Trading Company'
    const orgType = settings?.organization_type || 'intermediary'

    let result: any

    switch (mode) {
      case 'follow_up':
        result = await runFollowUpAgent(supabase, organization_id, apiKey, companyName, orgType)
        break
      case 'compose':
        if (!order_id) return res.status(400).json({ error: 'Missing order_id for compose mode' })
        result = await runComposeAgent(supabase, organization_id, apiKey, companyName, orgType, order_id, intent || 'follow_up')
        break
      case 'payment':
        result = await runPaymentAgent(supabase, organization_id, apiKey, companyName, orgType)
        break
      case 'supplier_score':
        result = await runSupplierScoreAgent(supabase, organization_id, apiKey, companyName, orgType)
        break
      case 'briefing':
        result = await runBriefingAgent(supabase, organization_id, apiKey, companyName, orgType)
        break
      default:
        return res.status(400).json({ error: `Unknown mode: ${mode}` })
    }

    return res.status(200).json({ success: true, mode, ...result })
  } catch (err: any) {
    console.error('[AGENTS] Error:', err)
    return res.status(500).json({ error: err.message || 'Agent failed' })
  }
}
