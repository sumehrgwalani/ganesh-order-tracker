import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGIN = 'https://sumehrgwalani.github.io'

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_MAIL_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY')!

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
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: member.gmail_refresh_token,
        client_id: settings.gmail_client_id,
        grant_type: 'refresh_token',
      }),
    })
    const tokenData = await tokenRes.json()
    if (tokenData.error) throw new Error(`Token refresh failed: ${tokenData.error_description || tokenData.error}`)
    const accessToken = tokenData.access_token

    // 7) Build Gmail search query
    // On first sync (no last_sync), use 3-month lookback
    // On subsequent syncs, use time since last sync
    const lastSync = member.gmail_last_sync
      ? new Date(member.gmail_last_sync)
      : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    const afterEpoch = Math.floor(lastSync.getTime() / 1000)
    const query = `after:${afterEpoch}`

    // 8) Fetch message list from Gmail
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const listData = await listRes.json()
    const messageIds = (listData.messages || []).map((m: any) => m.id)

    if (messageIds.length === 0) {
      // Update last sync time even if no new emails
      await supabase.from('organization_members').update({ gmail_last_sync: new Date().toISOString() }).eq('user_id', user_id).eq('organization_id', organization_id)
      return new Response(JSON.stringify({ synced: 0, advanced: 0, emails: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 9) Check which emails we already have
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

    // 10) Fetch full content of new messages (limit to 20 per sync)
    const toFetch = newMessageIds.slice(0, 20)
    const emails: any[] = []

    for (const msgId of toFetch) {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const msg = await msgRes.json()
      const headers = msg.payload?.headers || []
      const body = extractBody(msg.payload)
      const hasAttachment = (msg.payload?.parts || []).some((p: any) => p.filename && p.filename.length > 0)

      emails.push({
        gmail_id: msgId,
        from_email: extractEmail(getHeader(headers, 'From')),
        from_name: extractName(getHeader(headers, 'From')),
        to_email: extractEmail(getHeader(headers, 'To')),
        subject: getHeader(headers, 'Subject'),
        body_text: body.substring(0, 5000), // Limit body size
        date: getHeader(headers, 'Date'),
        has_attachment: hasAttachment,
      })
    }

    // 11) Get active orders for AI matching
    const { data: orders } = await supabase
      .from('orders')
      .select('order_id, company, supplier, product, current_stage')
      .eq('organization_id', organization_id)

    const ordersList = (orders || []).map((o: any) => ({
      id: o.order_id,
      company: o.company,
      supplier: o.supplier,
      product: o.product,
      currentStage: o.current_stage,
    }))

    // 12) AI Analysis — send emails + orders to Claude for matching
    const aiPrompt = `You are an AI assistant for a frozen seafood trading company. Analyze these emails and match them to existing purchase orders.

ACTIVE ORDERS:
${JSON.stringify(ordersList, null, 2)}

STAGE TRIGGER DEFINITIONS:
${STAGE_TRIGGERS}

NEW EMAILS TO ANALYZE:
${emails.map((e, i) => `
--- Email ${i + 1} ---
Gmail ID: ${e.gmail_id}
From: ${e.from_name} <${e.from_email}>
To: ${e.to_email}
Subject: ${e.subject}
Date: ${e.date}
Has Attachment: ${e.has_attachment}
Body (first 2000 chars): ${e.body_text.substring(0, 2000)}
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
          model: 'claude-opus-4-5-20251101',
          max_tokens: 4000,
          messages: [{ role: 'user', content: aiPrompt }],
        }),
      })
      const aiData = await aiRes.json()
      const aiText = aiData.content?.[0]?.text || '[]'
      // Parse JSON from AI response (handle potential markdown wrapping)
      const jsonMatch = aiText.match(/\[[\s\S]*\]/)
      aiResults = jsonMatch ? JSON.parse(jsonMatch[0]) : []
    } catch (aiErr) {
      console.error('AI analysis failed:', aiErr)
      // Continue without AI results — emails still get stored
    }

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

            // Log stage change in order_history
            await supabase.from('order_history').insert({
              organization_id,
              order_id: matchedOrderId,
              stage: detectedStage,
              from_address: `${email.from_name} <${email.from_email}>`,
              subject: `Auto-advanced: ${email.subject}`,
              body: summary || `Stage advanced based on email from ${email.from_name}`,
              timestamp: new Date().toISOString(),
            })

            // Create in-app notification
            // Get all org members to notify
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
