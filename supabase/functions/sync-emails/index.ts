import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
  // Match image001.jpg, image.png, image003.jpeg etc.
  if (/^image\d{0,3}\.(jpg|jpeg|png|gif)$/.test(lower)) return true
  // Match Outlook-xxxxxx.png (Outlook signature images)
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
    // Gmail returns base64url — convert to standard base64 then to bytes
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

serve(async (req) => {
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

    // Create a client with the user's JWT to verify their identity
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) {
      throw new Error('Authentication failed. Please log in again.')
    }

    const { organization_id, user_id } = await req.json()
    if (!organization_id || !user_id) throw new Error('Missing organization_id or user_id')

    // 2) Validate input formats
    if (!isValidUUID(organization_id) || !isValidUUID(user_id)) {
      throw new Error('Invalid organization or user ID format')
    }

    // 3) Verify the authenticated user matches the claimed user_id
    if (user.id !== user_id) {
      throw new Error('You can only sync emails for your own account')
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // 4) Verify the user is a member of this organization AND get their Gmail tokens
    const { data: member, error: memberError } = await supabase
      .from('organization_members')
      .select('gmail_refresh_token, gmail_email, gmail_last_sync')
      .eq('user_id', user_id)
      .eq('organization_id', organization_id)
      .single()

    if (memberError || !member) {
      throw new Error('You are not a member of this organization')
    }

    if (!member.gmail_refresh_token) {
      throw new Error('Gmail not connected. Please connect Gmail in Settings first.')
    }

    // 5) Get org settings to retrieve client_id
    const { data: settings, error: settingsError } = await supabase
      .from('organization_settings')
      .select('gmail_client_id')
      .eq('organization_id', organization_id)
      .single()

    if (settingsError || !settings?.gmail_client_id) {
      throw new Error('Google Client ID not configured. Please ask the admin to set it up.')
    }

    // 6) Refresh the access token
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

    // 7) Check if this is an onboarding sync (no orders yet) to set email limits
    const { count: orderCount } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organization_id)
    const isOnboarding = (orderCount || 0) === 0
    const gmailMaxResults = isOnboarding ? 500 : 50
    const emailProcessLimit = isOnboarding ? 500 : 20
    console.log(`Sync mode: ${isOnboarding ? 'ONBOARDING (limit 500)' : 'DAILY (limit 20)'}`)

    // 8) Build Gmail search query
    // On first sync (no last_sync), use 2-month lookback
    // On subsequent syncs, use time since last sync
    const lastSync = member.gmail_last_sync
      ? new Date(member.gmail_last_sync)
      : new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    const afterEpoch = Math.floor(lastSync.getTime() / 1000)
    const query = `after:${afterEpoch}`

    // 9) Fetch message list from Gmail (paginate for onboarding to get up to 500)
    let messageIds: string[] = []
    let pageToken: string | undefined = undefined
    do {
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${gmailMaxResults}` + (pageToken ? `&pageToken=${pageToken}` : '')
      const listRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      const listData = await listRes.json()
      const ids = (listData.messages || []).map((m: any) => m.id)
      messageIds = messageIds.concat(ids)
      pageToken = listData.nextPageToken
      // Stop if we've reached our limit or no more pages
    } while (pageToken && messageIds.length < emailProcessLimit)
    // Cap at the limit
    messageIds = messageIds.slice(0, emailProcessLimit)

    if (messageIds.length === 0) {
      // Update last sync time even if no new emails
      await supabase.from('organization_members').update({ gmail_last_sync: new Date().toISOString() }).eq('user_id', user_id).eq('organization_id', organization_id)
      return new Response(JSON.stringify({ synced: 0, advanced: 0, emails: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 10) Check which emails we already have
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
      return new Response(JSON.stringify({ synced: 0, advanced: 0, emails: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 11) Fetch full content of new messages (in parallel batches of 10 for speed)
    const toFetch = newMessageIds.slice(0, emailProcessLimit)
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
          const hasAttachment = attachmentParts.length > 0

          return {
            gmail_id: msgId,
            from_email: extractEmail(getHeader(headers, 'From')),
            from_name: extractName(getHeader(headers, 'From')),
            to_email: extractEmail(getHeader(headers, 'To')),
            subject: getHeader(headers, 'Subject'),
            body_text: body.substring(0, 5000),
            date: getHeader(headers, 'Date'),
            has_attachment: hasAttachment,
            attachment_parts: attachmentParts,
          }
        })
      )
      emails.push(...batchResults)
    }
    console.log(`Fetched ${emails.length} emails`)

    // 11) Get active orders for AI matching
    const { data: orders } = await supabase
      .from('orders')
      .select('id, order_id, company, supplier, product, current_stage')
      .eq('organization_id', organization_id)

    let ordersList = (orders || []).map((o: any) => ({
      uuid: o.id,
      id: o.order_id,
      company: o.company,
      supplier: o.supplier,
      product: o.product,
      currentStage: o.current_stage,
    }))

    // 11b) ONBOARDING MODE — if no orders exist, discover them from emails
    let createdOrderCount = 0
    if (ordersList.length === 0) {
      console.log('Onboarding mode: no orders found, running discovery...')

      // Process emails in batches of 50 so Claude can handle them
      const DISCOVERY_BATCH = 50
      const allDiscovered: any[] = []

      for (let b = 0; b < emails.length; b += DISCOVERY_BATCH) {
        const emailBatch = emails.slice(b, b + DISCOVERY_BATCH)
        console.log(`Discovery batch ${Math.floor(b / DISCOVERY_BATCH) + 1}: emails ${b + 1}-${b + emailBatch.length}`)

        const discoveryPrompt = `You are an AI assistant for a frozen seafood trading company called Ganesh International (based in India).
Analyze these emails and identify all distinct purchase orders you can find.

EMAILS:
${emailBatch.map((e: any, i: number) => `
--- Email ${i + 1} ---
From: ${e.from_name} <${e.from_email}>
To: ${e.to_email}
Subject: ${e.subject}
Date: ${e.date}
Has Attachment: ${e.has_attachment}
Body (first 4000 chars): ${e.body_text.substring(0, 4000)}
`).join('\n')}

For each distinct purchase order you can identify, extract:
- po_number: The PO/reference number (look for patterns like "GI/PO/...", "PO-...", or any order reference number)
- company: The buyer company name (the customer buying the goods)
- supplier: The supplier/seller company name (the one producing/shipping the goods)
- product: Main product being traded (e.g. "Frozen Shrimp PDTO", "Frozen Squid Rings")
- from_location: Where the goods ship FROM (usually India, Vietnam, China, etc.)
- current_stage: What stage this order has reached (1-8) based on the email evidence
- stage_reasoning: Brief explanation of why you chose that stage

STAGE DEFINITIONS:
${STAGE_TRIGGERS}

Stage 1 = Order Confirmed (PO exists/was sent)
Stage 8 = DHL Shipped (DHL tracking number shared)

RULES:
- Only include orders where you found a clear PO number or order reference in the emails
- Be PRECISE with company names. Companies with similar names are DIFFERENT entities (e.g. "Silver Seafoods" and "Silver Star Seafoods" are two separate companies — never merge or confuse them). Always use the exact name as written in the emails.
- Every field (company, supplier, product) MUST be filled with real data from the emails. Look across ALL emails for each PO to build the most complete picture. If you truly cannot determine company, supplier, or product for an order, skip it entirely — do not return orders with "Unknown" fields.
- If you can't determine the stage, default to 1
- Each order should appear only once (deduplicate by PO number)
- Ganesh International is usually the buyer/trading company — the supplier is the factory or producer
- Return VALID JSON only, no markdown wrapping

Return a JSON array:
[{ "po_number": "...", "company": "...", "supplier": "...", "product": "...", "from_location": "...", "current_stage": 1, "stage_reasoning": "..." }]

If no purchase orders can be identified, return an empty array: []`

        try {
          const discoveryRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-opus-4-5-20251101',
              max_tokens: 4000,
              messages: [{ role: 'user', content: discoveryPrompt }],
            }),
          })
          if (!discoveryRes.ok) {
            console.error(`  Discovery API error: ${discoveryRes.status} ${discoveryRes.statusText}`)
            const errBody = await discoveryRes.text()
            console.error(`  Response: ${errBody.substring(0, 500)}`)
          } else {
            const discoveryData = await discoveryRes.json()
            const discoveryText = discoveryData.content?.[0]?.text || '[]'
            const jsonMatch = discoveryText.match(/\[[\s\S]*\]/)
            const batchOrders = jsonMatch ? JSON.parse(jsonMatch[0]) : []
            console.log(`  Batch found ${batchOrders.length} orders`)
            allDiscovered.push(...batchOrders)
          }
        } catch (batchErr: any) {
          console.error(`  Discovery batch error:`, batchErr.message)
        }
        // Rate limit protection: wait 2s between discovery batches
        if (b + DISCOVERY_BATCH < emails.length) await delay(2000)
      }

      // Deduplicate by PO number — keep the one with the highest stage
      const poMap = new Map<string, any>()
      for (const order of allDiscovered) {
        if (!order.po_number) continue
        const existing = poMap.get(order.po_number)
        if (!existing || (order.current_stage || 1) > (existing.current_stage || 1)) {
          poMap.set(order.po_number, order)
        }
      }
      const discoveredOrders = Array.from(poMap.values())
      console.log(`Discovery found ${discoveredOrders.length} unique orders from ${allDiscovered.length} total`)

      // Create each discovered order in the database
      for (const disc of discoveredOrders) {
        if (!disc.po_number) continue

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
            current_stage: disc.current_stage || 1,
            order_date: new Date().toISOString().split('T')[0],
            status: 'sent',
            specs: '',
            metadata: { created_by: 'onboarding_sync', stage_reasoning: disc.stage_reasoning || '' },
          })
          .select('id')
          .single()

        if (createErr) {
          console.error(`Failed to create order ${disc.po_number}:`, createErr.message)
          continue
        }

        createdOrderCount++

        // Add history entry
        if (newOrder) {
          await supabase.from('order_history').insert({
            order_id: newOrder.id,
            organization_id,
            stage: disc.current_stage || 1,
            timestamp: new Date().toISOString(),
            from_address: 'System (Onboarding Sync)',
            subject: 'Order discovered from email history',
            body: disc.stage_reasoning || `Order ${disc.po_number} discovered during onboarding sync`,
          })
        }
      }

      // Re-fetch orders so the matching prompt below has them
      if (createdOrderCount > 0) {
        const { data: freshOrders } = await supabase
          .from('orders')
          .select('id, order_id, company, supplier, product, current_stage')
          .eq('organization_id', organization_id)

        ordersList = (freshOrders || []).map((o: any) => ({
          uuid: o.id,
          id: o.order_id,
          company: o.company,
          supplier: o.supplier,
          product: o.product,
          currentStage: o.current_stage,
        }))
      }
    }

    // 12) AI Analysis — send emails + orders to Claude for matching (in batches of 50)
    const MATCH_BATCH = 50
    let aiResults: any[] = []

    for (let b = 0; b < emails.length; b += MATCH_BATCH) {
      const emailBatch = emails.slice(b, b + MATCH_BATCH)
      console.log(`Matching batch ${Math.floor(b / MATCH_BATCH) + 1}: emails ${b + 1}-${b + emailBatch.length}`)

      const aiPrompt = `You are an AI assistant for a frozen seafood trading company. Analyze these emails and match them to existing purchase orders.

ACTIVE ORDERS:
${JSON.stringify(ordersList, null, 2)}

STAGE TRIGGER DEFINITIONS:
${STAGE_TRIGGERS}

NEW EMAILS TO ANALYZE:
${emailBatch.map((e: any, i: number) => `
--- Email ${i + 1} ---
Gmail ID: ${e.gmail_id}
From: ${e.from_name} <${e.from_email}>
To: ${e.to_email}
Subject: ${e.subject}
Date: ${e.date}
Has Attachment: ${e.has_attachment}
Body (first 4000 chars): ${e.body_text.substring(0, 4000)}
`).join('\n')}

For each email, determine:
1. Which order it matches (by PO number in subject/body, company name, supplier name, or product). Use the order "id" field.
2. What stage it should advance to (only if it clearly triggers a stage transition AND the order's currentStage is exactly one below the detected stage).
3. A brief summary of what this email means for the order.

IMPORTANT RULES:
- Only suggest a stage advance if you are CONFIDENT the email is a clear trigger.
- The detected_stage should be the NEW stage the order should move TO (not the current one).
- Only advance by one stage at a time (e.g. if order is at stage 2, only advance to 3, not to 5).
- If no order matches or no stage trigger is found, set matched_order_id and detected_stage to null.
- Return VALID JSON only, no markdown.

Return a JSON array with one object per email:
[
  {
    "gmail_id": "...",
    "matched_order_id": "PO-NUMBER or null",
    "detected_stage": 3 or null,
    "summary": "Brief explanation"
  }
]`

      try {
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-opus-4-5-20251101',
            max_tokens: 4000,
            messages: [{ role: 'user', content: aiPrompt }],
          }),
        })
        if (!aiRes.ok) {
          console.error(`Matching API error: ${aiRes.status} ${aiRes.statusText}`)
          const errBody = await aiRes.text()
          console.error(`  Response: ${errBody.substring(0, 500)}`)
        } else {
          const aiData = await aiRes.json()
          const aiText = aiData.content?.[0]?.text || '[]'
          const jsonMatch = aiText.match(/\[[\s\S]*\]/)
          const batchResults = jsonMatch ? JSON.parse(jsonMatch[0]) : []
          aiResults.push(...batchResults)
        }
      } catch (aiErr) {
        console.error(`Matching batch error:`, aiErr)
      }
      // Rate limit protection: wait 1s between matching batches
      if (b + MATCH_BATCH < emails.length) await delay(1000)
    }
    console.log(`AI matching complete: ${aiResults.length} results`)

    // Build lookup from gmail_id to AI result
    const aiMap = new Map(aiResults.map((r: any) => [r.gmail_id, r]))

    // 13) Store emails and process auto-advances
    const storedEmails: any[] = []
    let advancedCount = 0

    for (const email of emails) {
      const ai = aiMap.get(email.gmail_id) || {}
      const matchedOrderId = ai.matched_order_id || null
      const detectedStage = ai.detected_stage || null
      const summary = ai.summary || null

      // Download attachments if this email matches an order and has files
      let uploadedAttachments: any[] = []
      if (matchedOrderId && email.attachment_parts?.length > 0) {
        for (const part of email.attachment_parts) {
          if (part.size > 10 * 1024 * 1024) { console.log(`Skipping large attachment: ${part.filename} (${part.size} bytes)`); continue }
          const fileData = await downloadAttachment(accessToken, email.gmail_id, part.attachmentId)
          if (!fileData) continue
          const publicUrl = await uploadToStorage(supabase, organization_id, matchedOrderId, part.filename, fileData, part.mimeType)
          if (publicUrl) {
            uploadedAttachments.push(JSON.stringify({ name: part.filename, meta: { pdfUrl: publicUrl, mimeType: part.mimeType } }))
          }
        }
        if (uploadedAttachments.length > 0) console.log(`Uploaded ${uploadedAttachments.length} attachments for ${matchedOrderId}`)
      }

      // Check if we should auto-advance
      let autoAdvanced = false
      if (matchedOrderId && detectedStage) {
        const order = ordersList.find((o: any) => o.id === matchedOrderId)
        if (order && order.currentStage === detectedStage - 1) {
          // Auto-advance the order
          const { error: stageError } = await supabase
            .from('orders')
            .update({ current_stage: detectedStage })
            .eq('order_id', matchedOrderId)
            .eq('organization_id', organization_id)

          if (!stageError) {
            autoAdvanced = true
            advancedCount++

            // Log stage change in order_history (use UUID, not PO number)
            await supabase.from('order_history').insert({
              organization_id,
              order_id: order.uuid,
              stage: detectedStage,
              from_address: `${email.from_name} <${email.from_email}>`,
              subject: `Auto-advanced: ${email.subject}`,
              body: summary || `Stage advanced based on email from ${email.from_name}`,
              timestamp: new Date().toISOString(),
              has_attachment: uploadedAttachments.length > 0,
              attachments: uploadedAttachments.length > 0 ? uploadedAttachments : null,
            })

            // Create in-app notification
            const { data: members } = await supabase
              .from('organization_members')
              .select('user_id')
              .eq('organization_id', organization_id)

            for (const member of (members || [])) {
              await supabase.from('notifications').insert({
                user_id: member.user_id,
                organization_id,
                type: 'order_update',
                title: `Order ${matchedOrderId} advanced to Stage ${detectedStage}`,
                message: summary,
                data: { orderId: matchedOrderId, newStage: detectedStage, emailGmailId: email.gmail_id },
              })
            }
          }
        }
      }

      // For matched emails that didn't advance but have attachments, still save them
      if (matchedOrderId && !autoAdvanced && uploadedAttachments.length > 0) {
        const order = ordersList.find((o: any) => o.id === matchedOrderId)
        if (order) {
          await supabase.from('order_history').insert({
            organization_id,
            order_id: order.uuid,
            stage: detectedStage || order.currentStage,
            from_address: `${email.from_name} <${email.from_email}>`,
            subject: email.subject,
            body: summary || `Email attachment from ${email.from_name}`,
            timestamp: new Date().toISOString(),
            has_attachment: true,
            attachments: uploadedAttachments,
          })
        }
      }

      // Store email in synced_emails with connected_user_id
      const { data: inserted, error: insertError } = await supabase
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
          matched_order_id: matchedOrderId,
          detected_stage: detectedStage,
          ai_summary: summary,
          auto_advanced: autoAdvanced,
          connected_user_id: user_id,
        }, { onConflict: 'organization_id,gmail_id' })
        .select()
        .single()

      if (!insertError && inserted) {
        storedEmails.push(inserted)
      }
    }

    // 14) Update last sync time in organization_members (per-user)
    await supabase
      .from('organization_members')
      .update({ gmail_last_sync: new Date().toISOString() })
      .eq('user_id', user_id)
      .eq('organization_id', organization_id)

    return new Response(
      JSON.stringify({
        synced: storedEmails.length,
        advanced: advancedCount,
        created: createdOrderCount,
        emails: storedEmails,
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
