import { createClient } from 'npm:@supabase/supabase-js@2'

const ALLOWED_ORIGIN = 'https://sumehrgwalani.github.io'

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_MAIL_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY')!

// Helper: delay between API calls to avoid rate limiting
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Validate UUID format
function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
}

// Stage definitions for AI prompt
const STAGE_TRIGGERS = `
Stage 1 → 2 (Proforma Issued): Email contains or references a "proforma invoice", "PI", or proforma document. Often from the supplier.
Stage 2 → 3 (Artwork Approved): Email says artwork is approved/confirmed/ok. Keywords: "artwork approved", "artwork ok", "artwork confirmed", "label approved", "artwork is ok".
Stage 3 → 4 (Quality Check Done): Email contains QC/inspection results. Keywords: "quality check", "inspection report", "QC certificate", "inspection certificate". Often from inspectors like Hansel Fernandez or J B Boda.
Stage 4 → 5 (Schedule Confirmed): Email confirms vessel/shipping schedule. Keywords: "vessel schedule", "booking confirmed", "ETD", "shipping schedule", "vessel booking", "container booked".
Stage 5 → 6 (Draft Documents): Email contains draft shipping documents for review. Keywords: "draft BL", "draft documents", "draft bill of lading", "documents for review", "please check documents".
Stage 6 → 7 (Final Documents): Email confirms final/original documents sent. Keywords: "final documents", "original documents", "documents sent", "originals couriered", "BL released".
Stage 7 → 8 (DHL Shipped): Email contains DHL/courier tracking info. Keywords: "DHL", "tracking number", "AWB", "airway bill", "courier tracking", "shipped via DHL", "DHL waybill".
`

// Decode base64url encoded Gmail message body
function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/')
  try {
    return atob(base64)
  } catch {
    return ''
  }
}

// Extract plain text body from Gmail message payload
function extractBody(payload: any): string {
  if (!payload) return ''

  // Simple text/plain part
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data)
  }

  // Multipart: look through parts
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data)
      }
      // Recurse into nested multipart
      if (part.parts) {
        const nested = extractBody(part)
        if (nested) return nested
      }
    }
    // Fallback to text/html if no plain text
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = decodeBase64Url(part.body.data)
        return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      }
    }
  }

  return ''
}

// Get header value from Gmail message headers
function getHeader(headers: any[], name: string): string {
  const h = headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase())
  return h?.value || ''
}

// Extract name from email "Name <email@example.com>" format
function extractName(emailStr: string): string {
  const match = emailStr.match(/^"?([^"<]+)"?\s*</)
  return match ? match[1].trim() : emailStr.split('@')[0]
}

function extractEmail(emailStr: string): string {
  const match = emailStr.match(/<([^>]+)>/)
  return match ? match[1] : emailStr
}

// Check if a filename is an inline email image (logos, signatures, etc.)
function isInlineImage(filename: string): boolean {
  const lower = filename.toLowerCase()
  if (/^image\d{0,3}\.(jpg|jpeg|png|gif)$/.test(lower)) return true
  if (/^outlook-.*\.(jpg|jpeg|png|gif)$/.test(lower)) return true
  return false
}

// Extract attachment parts from Gmail message payload (skips inline images)
function extractAttachmentParts(payload: any): { filename: string; mimeType: string; attachmentId: string; size: number }[] {
  const parts: any[] = []
  function walk(p: any) {
    if (p.filename && p.filename.length > 0 && p.body?.attachmentId && !isInlineImage(p.filename)) {
      parts.push({ filename: p.filename, mimeType: p.mimeType || 'application/octet-stream', attachmentId: p.body.attachmentId, size: p.body.size || 0 })
    }
    if (p.parts) p.parts.forEach(walk)
  }
  if (payload) walk(payload)
  return parts
}

// Download attachment data from Gmail API
async function downloadAttachment(accessToken: string, messageId: string, attachmentId: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!res.ok) { console.error(`Attachment download failed: ${res.status}`); return null }
    const data = await res.json()
    if (!data.data) return null
    const b64 = data.data.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch (err) { console.error('Attachment download error:', err); return null }
}

// Upload file to Supabase Storage and return public URL
async function uploadToStorage(supabase: any, orgId: string, poNumber: string, filename: string, data: Uint8Array, mimeType: string): Promise<string | null> {
  try {
    const path = `${orgId}/${poNumber}/${filename}`
    const { error: uploadErr } = await supabase.storage.from('po-documents').upload(path, data, { contentType: mimeType, upsert: true })
    if (uploadErr) { console.error(`Upload error for ${filename}:`, uploadErr.message); return null }
    const { data: urlData } = supabase.storage.from('po-documents').getPublicUrl(path)
    return urlData?.publicUrl || null
  } catch (err) { console.error('Upload error:', err); return null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1) Verify the caller is authenticated via JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Missing or invalid authorization header')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY') || supabaseKey

    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) {
      throw new Error('Authentication failed. Please log in again.')
    }

    const { organization_id, user_id, mode } = await req.json()
    // mode: 'pull' = just download emails, 'match' = AI matching batch, 'full' = legacy full sync
    const syncMode = mode || 'full'
    if (!organization_id || !user_id) throw new Error('Missing organization_id or user_id')

    if (!isValidUUID(organization_id) || !isValidUUID(user_id)) {
      throw new Error('Invalid organization or user ID format')
    }

    if (user.id !== user_id) {
      throw new Error('You can only sync emails for your own account')
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Verify membership and get Gmail tokens
    const { data: member, error: memberError } = await supabase
      .from('organization_members')
      .select('gmail_refresh_token, gmail_email, gmail_last_sync')
      .eq('user_id', user_id)
      .eq('organization_id', organization_id)
      .single()

    if (memberError || !member) {
      throw new Error('You are not a member of this organization')
    }

    // ============================================================
    // MODE: MATCH — AI matching of already-stored emails in batches
    // ============================================================
    if (syncMode === 'match') {
      // Get unmatched emails (no matched_order_id and no user_linked_order_id)
      const { data: unmatchedEmails, error: fetchErr } = await supabase
        .from('synced_emails')
        .select('*')
        .eq('organization_id', organization_id)
        .is('matched_order_id', null)
        .is('user_linked_order_id', null)
        .order('date', { ascending: true })
        .limit(15) // Process 15 at a time for accuracy

      if (fetchErr) throw fetchErr
      if (!unmatchedEmails || unmatchedEmails.length === 0) {
        // Count total to report completion
        const { count: totalCount } = await supabase
          .from('synced_emails')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', organization_id)
        const { count: matchedCount } = await supabase
          .from('synced_emails')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', organization_id)
          .not('matched_order_id', 'is', null)

        return new Response(JSON.stringify({
          mode: 'match',
          done: true,
          matched: 0,
          remaining: 0,
          totalEmails: totalCount || 0,
          totalMatched: matchedCount || 0,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      // Get current orders
      const { data: orders } = await supabase
        .from('orders')
        .select('id, order_id, company, supplier, product, current_stage, skipped_stages')
        .eq('organization_id', organization_id)

      let ordersList = (orders || []).map((o: any) => ({
        uuid: o.id,
        id: o.order_id,
        company: o.company,
        supplier: o.supplier,
        product: o.product,
        currentStage: o.current_stage,
        skippedStages: o.skipped_stages || [],
      }))

      // Get product catalog
      let catalogSection = ''
      try {
        const { data: products } = await supabase
          .from('products')
          .select('name, size, glaze, freeze_type, markets')
          .eq('organization_id', organization_id)
          .eq('is_active', true)

        if (products && products.length > 0) {
          const grouped = new Map<string, { sizes: Set<string>, glazes: Set<string>, freezes: Set<string> }>()
          for (const p of products) {
            if (!grouped.has(p.name)) grouped.set(p.name, { sizes: new Set(), glazes: new Set(), freezes: new Set() })
            const g = grouped.get(p.name)!
            if (p.size) g.sizes.add(p.size)
            if (p.glaze != null) g.glazes.add(Math.round(p.glaze * 100) + '%')
            if (p.freeze_type) g.freezes.add(p.freeze_type)
          }
          const catalogText = Array.from(grouped).map(([name, attrs]) => {
            const parts = [name]
            if (attrs.sizes.size > 0) parts.push(`Sizes: ${[...attrs.sizes].join(', ')}`)
            if (attrs.glazes.size > 0) parts.push(`Glaze: ${[...attrs.glazes].join(', ')}`)
            if (attrs.freezes.size > 0) parts.push(`Freeze: ${[...attrs.freezes].join(', ')}`)
            return parts.join(' | ')
          }).join('\n')
          catalogSection = `\nPRODUCT CATALOG:\n${catalogText}\n`
        }
      } catch (err) { console.error('Could not fetch product catalog:', err) }

      // Fetch user corrections for AI learning
      let correctionExamples = ''
      try {
        const { data: corrections } = await supabase
          .from('synced_emails')
          .select('subject, from_email, user_linked_order_id')
          .eq('organization_id', organization_id)
          .not('user_linked_at', 'is', null)
          .order('user_linked_at', { ascending: false })
          .limit(10)

        if (corrections && corrections.length > 0) {
          const linkedOrderIds = corrections.map((c: any) => c.user_linked_order_id).filter(Boolean)
          const { data: linkedOrders } = await supabase.from('orders').select('id, order_id, company, product').in('id', linkedOrderIds)
          const orderMap: Record<string, any> = {}
          for (const o of linkedOrders || []) orderMap[o.id] = o
          const examples = corrections.map((c: any) => {
            const order = orderMap[c.user_linked_order_id]
            const orderLabel = order ? `${order.order_id} (${order.company} - ${order.product})` : c.user_linked_order_id
            return `- Email from "${c.from_email}" with subject "${c.subject}" was manually linked to order ${orderLabel}`
          }).join('\n')
          correctionExamples = `\nRECENT USER CORRECTIONS (learn from these):\n${examples}\n`
        }
      } catch (err) { console.error('Failed to fetch corrections:', err) }

      // If no orders exist yet, run discovery mode first
      let createdOrderCount = 0
      if (ordersList.length === 0) {
        console.log('No orders found — running discovery from emails...')

        const discoveryPrompt = `You are an AI assistant for a frozen seafood trading company called Ganesh International (based in India).
Analyze these emails and identify all distinct purchase orders you can find.
${catalogSection}
EMAILS:
${unmatchedEmails.map((e: any, i: number) => `
--- Email ${i + 1} ---
From: ${e.from_name} <${e.from_email}>
To: ${e.to_email}
Subject: ${e.subject}
Date: ${e.date}
Has Attachment: ${e.has_attachment}
Body (first 4000 chars): ${(e.body_text || '').substring(0, 4000)}
`).join('\n')}

For each distinct purchase order you can identify, extract:
- po_number: The PO/reference number (look for patterns like "GI/PO/...", "PO-...", or any order reference)
- company: The buyer company name
- supplier: The supplier/seller company name
- product: Main product being traded
- from_location: Where goods ship FROM
- highest_stage: The HIGHEST stage this order has reached based on ALL email evidence (1-8)
- skipped_stages: Array of stage numbers that were SKIPPED (no email evidence found for them). For example, if an order went from stage 1 directly to stage 3 with no evidence of stage 2, skipped_stages would be [2].
- stage_reasoning: Brief explanation

STAGE DEFINITIONS:
${STAGE_TRIGGERS}

Stage 1 = Order Confirmed (PO exists/was sent)
Stage 8 = DHL Shipped (DHL tracking number shared)

IMPORTANT RULES FOR SKIPPED STAGES:
- It's common for some stages to be skipped or happen without email evidence
- If you see evidence of stage 5 but nothing for stages 3 and 4, set highest_stage to 5 and skipped_stages to [3, 4]
- The order should be set to the HIGHEST confirmed stage, not limited to sequential advancement
- Only include stages as "skipped" if they are BETWEEN stage 1 and the highest_stage

RULES:
- Only include orders where you found a clear PO number or order reference
- Be PRECISE with company names — similar names are DIFFERENT entities
- Every field MUST be filled with real data from the emails
- Each order should appear only once (deduplicate by PO number)
- Ganesh International is usually the buyer/trading company — the supplier is the factory/producer
- Return VALID JSON only, no markdown

Return a JSON array:
[{ "po_number": "...", "company": "...", "supplier": "...", "product": "...", "from_location": "...", "highest_stage": 1, "skipped_stages": [], "stage_reasoning": "..." }]

If no purchase orders found, return: []`

        try {
          const discoveryRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-5-20250929',
              max_tokens: 4000,
              messages: [{ role: 'user', content: discoveryPrompt }],
            }),
          })
          if (discoveryRes.ok) {
            const discoveryData = await discoveryRes.json()
            const discoveryText = discoveryData.content?.[0]?.text || '[]'
            const jsonMatch = discoveryText.match(/\[[\s\S]*\]/)
            const discoveredOrders = jsonMatch ? JSON.parse(jsonMatch[0]) : []

            // Deduplicate by PO number — keep highest stage
            const poMap = new Map<string, any>()
            for (const order of discoveredOrders) {
              if (!order.po_number) continue
              const existing = poMap.get(order.po_number)
              if (!existing || (order.highest_stage || 1) > (existing.highest_stage || 1)) {
                poMap.set(order.po_number, order)
              }
            }

            for (const disc of poMap.values()) {
              const { data: newOrder, error: createErr } = await supabase
                .from('orders')
                .insert({
                  organization_id,
                  order_id: disc.po_number,
                  po_number: disc.po_number,
                  company: disc.company || 'Unknown',
                  supplier: disc.supplier || 'Unknown',
                  product: disc.product || 'Unknown',
                  from_location: disc.from_location || 'India',
                  current_stage: disc.highest_stage || 1,
                  skipped_stages: disc.skipped_stages || [],
                  order_date: new Date().toISOString().split('T')[0],
                  status: 'sent',
                  specs: '',
                  metadata: { created_by: 'email_sync', stage_reasoning: disc.stage_reasoning || '' },
                })
                .select('id')
                .single()

              if (!createErr && newOrder) {
                createdOrderCount++
                await supabase.from('order_history').insert({
                  order_id: newOrder.id,
                  organization_id,
                  stage: disc.highest_stage || 1,
                  timestamp: new Date().toISOString(),
                  from_address: 'System (Email Sync)',
                  subject: `Order discovered from emails — Stage ${disc.highest_stage || 1}`,
                  body: disc.stage_reasoning || `Order ${disc.po_number} discovered during email sync`,
                })
              }
            }

            // Re-fetch orders
            if (createdOrderCount > 0) {
              const { data: freshOrders } = await supabase
                .from('orders')
                .select('id, order_id, company, supplier, product, current_stage, skipped_stages')
                .eq('organization_id', organization_id)
              ordersList = (freshOrders || []).map((o: any) => ({
                uuid: o.id,
                id: o.order_id,
                company: o.company,
                supplier: o.supplier,
                product: o.product,
                currentStage: o.current_stage,
                skippedStages: o.skipped_stages || [],
              }))
            }
          }
        } catch (err: any) {
          console.error('Discovery error:', err.message)
        }
      }

      // Now run AI matching on the unmatched emails
      if (ordersList.length === 0) {
        // Still no orders after discovery — stop to avoid infinite loop
        console.log('No orders found after discovery attempt. Stopping match loop.')
        return new Response(JSON.stringify({
          mode: 'match',
          done: true,
          matched: 0,
          created: createdOrderCount,
          remaining: 0,
          totalEmails: unmatchedEmails.length,
          totalMatched: 0,
          message: 'No orders could be discovered from emails. Try adding orders manually first.',
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const aiPrompt = `You are an AI assistant for a frozen seafood trading company. Match these emails to existing purchase orders.
${catalogSection}
ACTIVE ORDERS:
${JSON.stringify(ordersList, null, 2)}

STAGE DEFINITIONS:
${STAGE_TRIGGERS}
${correctionExamples}
EMAILS TO MATCH:
${unmatchedEmails.map((e: any, i: number) => `
--- Email ${i + 1} ---
Gmail ID: ${e.gmail_id}
From: ${e.from_name} <${e.from_email}>
To: ${e.to_email}
Subject: ${e.subject}
Date: ${e.date}
Has Attachment: ${e.has_attachment}
Body (first 4000 chars): ${(e.body_text || '').substring(0, 4000)}
`).join('\n')}

For each email, determine:
1. Which order it matches (by PO number, company, supplier, or product). Use the order "id" field (PO number).
2. What stage this email represents (the stage the email is evidence of, regardless of current order stage).
3. A brief summary.

CRITICAL RULES FOR STAGE DETECTION:
- The detected_stage is the stage this email provides EVIDENCE for — it can be ANY stage, not just current+1.
- If an email shows evidence of stage 6 but the order is at stage 3, still report detected_stage as 6.
- Sometimes steps get skipped in real trade — that's OK. The system will handle marking skipped stages.
- If no order matches, set matched_order_id to null.
- If no stage is detected, set detected_stage to null.
- Return VALID JSON only, no markdown.

Return a JSON array:
[{ "gmail_id": "...", "matched_order_id": "PO-NUMBER or null", "detected_stage": 3 or null, "summary": "Brief explanation" }]`

      let aiResults: any[] = []
      try {
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 4000,
            messages: [{ role: 'user', content: aiPrompt }],
          }),
        })
        if (aiRes.ok) {
          const aiData = await aiRes.json()
          const aiText = aiData.content?.[0]?.text || '[]'
          const jsonMatch = aiText.match(/\[[\s\S]*\]/)
          aiResults = jsonMatch ? JSON.parse(jsonMatch[0]) : []
        } else {
          console.error(`AI match error: ${aiRes.status}`)
        }
      } catch (err) {
        console.error('AI matching error:', err)
      }

      // Process results
      const aiMap = new Map(aiResults.map((r: any) => [r.gmail_id, r]))
      let matchedCount = 0
      let advancedCount = 0

      for (const email of unmatchedEmails) {
        const ai = aiMap.get(email.gmail_id) || {}
        const matchedOrderId = ai.matched_order_id || null
        const detectedStage = ai.detected_stage || null
        const summary = ai.summary || null

        if (!matchedOrderId) continue // Skip unmatched

        // Update the synced_email with match info
        await supabase
          .from('synced_emails')
          .update({
            matched_order_id: matchedOrderId,
            detected_stage: detectedStage,
            ai_summary: summary,
          })
          .eq('id', email.id)

        matchedCount++

        // Handle stage advancement with skip support
        if (detectedStage) {
          const order = ordersList.find((o: any) => o.id === matchedOrderId)
          if (order && detectedStage > order.currentStage) {
            // Calculate skipped stages
            const newSkipped = [...(order.skippedStages || [])]
            for (let s = order.currentStage + 1; s < detectedStage; s++) {
              if (!newSkipped.includes(s)) newSkipped.push(s)
            }

            // Advance to the detected stage
            const { error: stageError } = await supabase
              .from('orders')
              .update({
                current_stage: detectedStage,
                skipped_stages: newSkipped,
              })
              .eq('order_id', matchedOrderId)
              .eq('organization_id', organization_id)

            if (!stageError) {
              advancedCount++
              // Update local copy so next emails in batch see new stage
              order.currentStage = detectedStage
              order.skippedStages = newSkipped

              // Log in order_history
              await supabase.from('order_history').insert({
                organization_id,
                order_id: order.uuid,
                stage: detectedStage,
                from_address: `${email.from_name} <${email.from_email}>`,
                subject: `Auto-advanced: ${email.subject}`,
                body: summary || `Stage advanced based on email from ${email.from_name}`,
                timestamp: email.date || new Date().toISOString(),
                has_attachment: email.has_attachment || false,
              })

              // Mark as auto-advanced
              await supabase.from('synced_emails').update({ auto_advanced: true }).eq('id', email.id)
            }
          } else if (order) {
            // Email matches an order but doesn't advance stage — still log in history
            await supabase.from('order_history').insert({
              organization_id,
              order_id: order.uuid,
              stage: detectedStage,
              from_address: `${email.from_name} <${email.from_email}>`,
              subject: email.subject,
              body: summary || `Email from ${email.from_name}`,
              timestamp: email.date || new Date().toISOString(),
              has_attachment: email.has_attachment || false,
            })
          }
        }
      }

      // Count remaining unmatched
      const { count: remainingCount } = await supabase
        .from('synced_emails')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organization_id)
        .is('matched_order_id', null)
        .is('user_linked_order_id', null)

      const { count: totalEmails } = await supabase
        .from('synced_emails')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organization_id)

      const { count: totalMatched } = await supabase
        .from('synced_emails')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organization_id)
        .not('matched_order_id', 'is', null)

      return new Response(JSON.stringify({
        mode: 'match',
        done: (remainingCount || 0) === 0,
        matched: matchedCount,
        advanced: advancedCount,
        created: createdOrderCount,
        remaining: remainingCount || 0,
        totalEmails: totalEmails || 0,
        totalMatched: totalMatched || 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ============================================================
    // MODE: PULL — Just download emails from Gmail, no AI matching
    // ============================================================
    if (!member.gmail_refresh_token) {
      throw new Error('Gmail not connected. Please connect Gmail in Settings first.')
    }

    // Get org settings for client_id
    const { data: settings, error: settingsError } = await supabase
      .from('organization_settings')
      .select('gmail_client_id')
      .eq('organization_id', organization_id)
      .single()

    if (settingsError || !settings?.gmail_client_id) {
      throw new Error('Google Client ID not configured.')
    }

    // Refresh access token
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
    if (!clientSecret) throw new Error('client_secret is missing')

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: member.gmail_refresh_token,
        client_id: settings.gmail_client_id,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }),
    })
    const tokenData = await tokenRes.json()
    if (tokenData.error) throw new Error(`Token refresh failed: ${tokenData.error_description || tokenData.error}`)
    const accessToken = tokenData.access_token

    // For pull mode: always do deep sync (6 months)
    const isPull = syncMode === 'pull'
    const lookbackDays = isPull ? 180 : 7
    const emailLimit = isPull ? 500 : 50
    const lastSync = isPull
      ? new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
      : member.gmail_last_sync
        ? new Date(member.gmail_last_sync)
        : new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)

    const afterEpoch = Math.floor(lastSync.getTime() / 1000)
    const query = `after:${afterEpoch}`

    console.log(`${syncMode.toUpperCase()} mode: lookback ${lookbackDays}d, limit ${emailLimit}`)

    // Fetch message IDs from Gmail (paginate)
    let messageIds: string[] = []
    let pageToken: string | undefined = undefined
    do {
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${emailLimit}` + (pageToken ? `&pageToken=${pageToken}` : '')
      const listRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      const listData = await listRes.json()
      const ids = (listData.messages || []).map((m: any) => m.id)
      messageIds = messageIds.concat(ids)
      pageToken = listData.nextPageToken
    } while (pageToken && messageIds.length < emailLimit)
    messageIds = messageIds.slice(0, emailLimit)

    if (messageIds.length === 0) {
      await supabase.from('organization_members').update({ gmail_last_sync: new Date().toISOString() }).eq('user_id', user_id).eq('organization_id', organization_id)
      return new Response(JSON.stringify({ mode: syncMode, synced: 0, total: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Check which emails we already have
    const { data: existingEmails } = await supabase
      .from('synced_emails')
      .select('gmail_id')
      .eq('organization_id', organization_id)
      .eq('connected_user_id', user_id)
      .in('gmail_id', messageIds)

    const existingIds = new Set((existingEmails || []).map((e: any) => e.gmail_id))
    const newMessageIds = messageIds.filter((id: string) => !existingIds.has(id))

    if (newMessageIds.length === 0) {
      await supabase.from('organization_members').update({ gmail_last_sync: new Date().toISOString() }).eq('user_id', user_id).eq('organization_id', organization_id)
      return new Response(JSON.stringify({ mode: syncMode, synced: 0, total: messageIds.length, alreadyHad: existingIds.size }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Fetch full content of new messages (in batches of 10)
    const toFetch = newMessageIds.slice(0, emailLimit)
    const emails: any[] = []
    const BATCH_SIZE = 10

    for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
      const batch = toFetch.slice(i, i + BATCH_SIZE)
      const batchResults = await Promise.all(
        batch.map(async (msgId: string) => {
          const msgRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          )
          const msg = await msgRes.json()
          const headers = msg.payload?.headers || []
          const body = extractBody(msg.payload)
          const attachmentParts = extractAttachmentParts(msg.payload)

          return {
            gmail_id: msgId,
            from_email: extractEmail(getHeader(headers, 'From')),
            from_name: extractName(getHeader(headers, 'From')),
            to_email: extractEmail(getHeader(headers, 'To')),
            subject: getHeader(headers, 'Subject'),
            body_text: body.substring(0, 5000),
            date: getHeader(headers, 'Date'),
            has_attachment: attachmentParts.length > 0,
          }
        })
      )
      emails.push(...batchResults)
    }
    console.log(`Fetched ${emails.length} new emails from Gmail`)

    // Store emails in DB (no AI matching in pull mode)
    let storedCount = 0
    for (const email of emails) {
      const { error: insertError } = await supabase
        .from('synced_emails')
        .upsert({
          organization_id,
          gmail_id: email.gmail_id,
          from_email: email.from_email,
          from_name: email.from_name,
          to_email: email.to_email,
          subject: email.subject,
          body_text: email.body_text,
          date: new Date(email.date).toISOString(),
          has_attachment: email.has_attachment,
          matched_order_id: null,
          detected_stage: null,
          ai_summary: null,
          auto_advanced: false,
          connected_user_id: user_id,
        }, { onConflict: 'organization_id,gmail_id' })

      if (!insertError) storedCount++
    }

    // Update last sync time
    await supabase.from('organization_members').update({ gmail_last_sync: new Date().toISOString() }).eq('user_id', user_id).eq('organization_id', organization_id)

    // Count total stored emails
    const { count: totalStored } = await supabase
      .from('synced_emails')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organization_id)

    return new Response(
      JSON.stringify({
        mode: syncMode,
        synced: storedCount,
        total: totalStored || 0,
        alreadyHad: existingIds.size,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('Sync error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
