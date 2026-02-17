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
Stage 1 (PO Sent): Email is about sending a Purchase Order to a supplier. Subject contains "PURCHASE ORDER" or "NEW PURCHASE ORDER" + PO number. Body contains phrases like "PLEASE FIND ATTACHED NEW PO", "KINDLY ACKNOWLEDGE THE RECEIPT", "PLEASE SEND US PROFORMA". Sent BY Ganesh International TO the supplier. Has attachment (scanned PO document, JPG or PDF). This is the STARTING stage.

Stage 2 (Proforma Issued): Email contains a Proforma Invoice (PI). Subject contains "PROFORMA INVOICE" or "NEW PROFORMA INVOICE" + PI number + PO number + supplier name. Format example: "NEW PROFORMA INVOICE - PI GI/PI/25-26/I02013 - PO 3004 - JJ SEAFOODS". Body is often EMPTY — all PI info is in the attachment (PDF or scanned JPG). Sent BY Ganesh International. Has attachment with the PI document. PI numbers follow formats like GI/PI/25-26/IXXXXX, PEI/PI/XXX/2025-26, PI/SSI/XXX/25-26, or SLS-XXX.

Stage 3 (Artwork Approved): Email is about artwork or label approval. Subject contains "NEED APPROVAL", "NEED ARTWORK APPROVAL", or "NEED LABELS APPROVAL" + PI number + PO number. These are typically FORWARDED approval chains where the buyer (E. Guillem / Pescados) confirms artwork is OK. Approval phrases: "The artworks are OK", "The labels are OK", "OK, thank you", "encornet is OK". Reply phrases: "Well noted & thanks". The email thread shows the request for approval and the supplier's confirmation.

Stage 4 (Quality Check Done): Email contains QC/inspection results. Keywords: "quality check", "inspection report", "QC certificate", "inspection certificate", "pre-shipment inspection". Often from inspectors like Hansel Fernandez or J B Boda.

Stage 5 (Schedule Confirmed): Email confirms vessel/shipping schedule. Keywords: "vessel schedule", "booking confirmed", "ETD", "shipping schedule", "vessel booking", "container booked", "sailing schedule".

Stage 6 (Draft Documents): Email contains draft shipping documents for review. Keywords: "draft BL", "draft documents", "draft bill of lading", "documents for review", "please check documents".

Stage 7 (Final Documents): Email confirms final/original documents sent. Keywords: "final documents", "original documents", "documents sent", "originals couriered", "BL released".

Stage 8 (DHL Shipped): Email contains DHL/courier tracking info. Keywords: "DHL", "tracking number", "AWB", "airway bill", "courier tracking", "shipped via DHL", "DHL waybill".
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

// Extract PI number from email subject
function extractPINumber(subject: string): string | null {
  const patterns = [
    /GI\/PI\/[\d\-]+\/[A-Za-z0-9]+/i,
    /PEI\/PI\/[A-Za-z0-9]+\/[\d\-]+/i,
    /PI\/SSI\/[A-Za-z0-9]+\/[\d\-]+/i,
    /SLS\-[A-Za-z0-9]+/i,
    /PI[\s\-#:]+([A-Za-z0-9\/-]+)/i,
  ]
  for (const p of patterns) {
    const m = subject.match(p)
    if (m) return m[0]
  }
  return null
}

// Refresh Gmail access token from refresh token
async function refreshGmailToken(refreshToken: string, clientId: string, clientSecret: string): Promise<string | null> {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }),
    })
    const data = await res.json()
    if (data.error) { console.error(`Token refresh failed: ${data.error}`); return null }
    return data.access_token
  } catch (err) { console.error('Token refresh error:', err); return null }
}

// Fetch attachment parts for a Gmail message
async function getAttachmentPartsForMessage(accessToken: string, messageId: string): Promise<{ filename: string; mimeType: string; attachmentId: string; size: number }[]> {
  try {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!res.ok) return []
    const msg = await res.json()
    return extractAttachmentParts(msg.payload)
  } catch (err) { console.error('Failed to fetch message attachments:', err); return [] }
}

// Extract structured PO data from email text using Claude AI
async function extractPODataFromEmail(
  email: any, orderCompany: string, orderSupplier: string
): Promise<{ lineItems: any[], deliveryTerms: string, payment: string, totalKilos: number, totalValue: number } | null> {
  try {
    const emailText = `Subject: ${email.subject || ''}\n\nBody:\n${(email.body_text || '').substring(0, 6000)}`
    if (emailText.length < 30) return null

    const prompt = `You are an expert seafood trading order parser for Ganesh International, a frozen foods trading company.
Extract structured purchase order data from this email.

CRITICAL: Return ONLY valid JSON. No explanation, no markdown, no code fences.

Email text:
${emailText}

Known context:
- Buyer: ${orderCompany || 'Unknown'}
- Supplier: ${orderSupplier || 'Unknown'}

Return this JSON structure:
{
  "lineItems": [
    {
      "product": "string - full product name, start with 'Frozen' (e.g. 'Frozen Cut Squid Skin On')",
      "size": "string - size range (e.g. '20/40', '40/60') or empty string",
      "glaze": "string - glaze percentage (e.g. '25% Glaze') or empty string",
      "glazeMarked": "string - marked/declared glaze if different, or empty string",
      "packing": "string - packing format (e.g. '6 X 1 KG Bag', '10 KG Bulk') or empty string",
      "brand": "string - brand name or empty string",
      "freezing": "string - 'IQF', 'Semi IQF', 'Blast', 'Block', or 'Plate'. Default 'IQF'",
      "cases": "",
      "kilos": "number - total kg (if MT given, multiply by 1000)",
      "pricePerKg": "number - price per kg",
      "currency": "string - 'USD' or 'EUR'. Default 'USD'",
      "total": ""
    }
  ],
  "deliveryTerms": "string - e.g. 'CFR', 'CIF', 'FOB' or empty string",
  "payment": "string - payment terms or empty string",
  "destination": "string - delivery destination or empty string",
  "commission": "string - commission details or empty string"
}

Rules:
- Always prefix product names with "Frozen" if not already
- "07 MT" or "7 MT" = 7000 kg
- Leave "cases" and "total" as empty strings
- If you cannot find line item details, return empty lineItems array
- Spanish terms: calamar=Squid, sepia=Cuttlefish, pulpo=Octopus, gamba=Shrimp, glaseo=Glaze, bolsa=Bag, granel=Bulk`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.error(`[PO-EXTRACT] AI API error: ${res.status} - ${errBody.substring(0, 200)}`)
      return null
    }
    const aiData = await res.json()
    const text = aiData.content?.[0]?.text || ''

    // Parse JSON from response
    let jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    if (!jsonStr.startsWith('{')) {
      const first = jsonStr.indexOf('{')
      const last = jsonStr.lastIndexOf('}')
      if (first !== -1 && last > first) jsonStr = jsonStr.substring(first, last + 1)
    }
    const parsed = JSON.parse(jsonStr)

    const lineItems = Array.isArray(parsed.lineItems) ? parsed.lineItems.map((item: any) => ({
      product: String(item.product || ''),
      size: String(item.size || ''),
      glaze: String(item.glaze || ''),
      glazeMarked: String(item.glazeMarked || ''),
      packing: String(item.packing || ''),
      brand: String(item.brand || ''),
      freezing: String(item.freezing || 'IQF'),
      cases: '',
      kilos: typeof item.kilos === 'number' ? item.kilos : (parseFloat(item.kilos) || 0),
      pricePerKg: typeof item.pricePerKg === 'number' ? item.pricePerKg : (parseFloat(item.pricePerKg) || 0),
      currency: String(item.currency || 'USD'),
      total: '',
    })) : []

    const totalKilos = lineItems.reduce((sum: number, li: any) => sum + (li.kilos || 0), 0)
    const totalValue = lineItems.reduce((sum: number, li: any) => sum + ((li.kilos || 0) * (li.pricePerKg || 0)), 0)

    return {
      lineItems,
      deliveryTerms: String(parsed.deliveryTerms || ''),
      payment: String(parsed.payment || ''),
      totalKilos,
      totalValue: Math.round(totalValue * 100) / 100,
    }
  } catch (err) {
    console.error('PO data extraction error:', err)
    return null
  }
}

// Handle PO attachment: download from Gmail, upload to storage, extract data, update order
async function handlePOAttachment(
  supabase: any, accessToken: string, email: any,
  matchedOrderId: string, orderUuid: string, organizationId: string
) {
  try {
    // Step 1: Try to download and upload the attachment (may fail if Gmail token expired)
    let publicUrl: string | null = null
    let attachmentFilename = 'PO_document'
    try {
      const parts = await getAttachmentPartsForMessage(accessToken, email.gmail_id)
      const poPart = pickBestAttachment(parts, scorePOAttachment, email.subject || '')
      if (poPart) {
        const fileData = await downloadAttachment(accessToken, email.gmail_id, poPart.attachmentId)
        if (fileData) {
          publicUrl = await uploadToStorage(supabase, organizationId, matchedOrderId, poPart.filename, fileData, poPart.mimeType)
          attachmentFilename = poPart.filename
        }
      }
    } catch (attachErr) {
      console.log(`PO attachment download failed for ${matchedOrderId}: ${attachErr}`)
    }

    // Step 2: Extract PO data from email body text (works even without attachment)
    const { count: existingLineItems } = await supabase
      .from('order_line_items')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderUuid)

    const { data: orderRow } = await supabase
      .from('orders')
      .select('company, supplier, metadata')
      .eq('id', orderUuid)
      .single()

    let extractedData: any = null
    let extractedCount = 0

    if (!existingLineItems || existingLineItems === 0) {
      extractedData = await extractPODataFromEmail(email, orderRow?.company || '', orderRow?.supplier || '')

      if (extractedData && extractedData.lineItems.length > 0) {
        extractedCount = extractedData.lineItems.length

        // Insert line items
        const lineItemRows = extractedData.lineItems.map((item: any, idx: number) => ({
          order_id: orderUuid,
          product: item.product,
          brand: item.brand || '',
          size: item.size || '',
          glaze: item.glaze || '',
          glaze_marked: item.glazeMarked || '',
          packing: item.packing || '',
          freezing: item.freezing || 'IQF',
          cases: 0,
          kilos: item.kilos || 0,
          price_per_kg: item.pricePerKg || 0,
          currency: item.currency || 'USD',
          total: (item.kilos || 0) * (item.pricePerKg || 0),
          sort_order: idx,
        }))
        const { error: insertErr } = await supabase.from('order_line_items').insert(lineItemRows)
        if (insertErr) console.error(`Line items insert error for ${matchedOrderId}: ${insertErr.message}`)

        // Update order metadata
        const updates: any = {
          metadata: {
            ...(orderRow?.metadata || {}),
            extractedFromEmail: true,
            ...(publicUrl ? { pdfUrl: publicUrl } : {}),
          },
        }
        if (extractedData.deliveryTerms) updates.delivery_terms = extractedData.deliveryTerms
        if (extractedData.payment) updates.payment_terms = extractedData.payment
        if (extractedData.totalKilos > 0) updates.total_kilos = extractedData.totalKilos
        if (extractedData.totalValue > 0) updates.total_value = String(Math.round(extractedData.totalValue * 100) / 100)
        await supabase.from('orders').update(updates).eq('id', orderUuid)
      }
    }

    // Step 3: Update history entry with attachment info
    const { data: historyRows } = await supabase
      .from('order_history')
      .select('id')
      .eq('order_id', orderUuid)
      .eq('stage', 1)
      .order('timestamp', { ascending: false })
      .limit(1)

    if (historyRows && historyRows.length > 0) {
      const richMeta: any = publicUrl
        ? {
            pdfUrl: publicUrl,
            supplier: orderRow?.supplier || '',
            buyer: orderRow?.company || '',
            ...(extractedData ? {
              deliveryTerms: extractedData.deliveryTerms || '',
              payment: extractedData.payment || '',
              totalKilos: extractedData.totalKilos,
              grandTotal: extractedData.totalValue,
              extractedFromEmail: true,
              lineItems: extractedData.lineItems,
            } : {}),
          }
        : (extractedData ? { extractedFromEmail: true, lineItems: extractedData.lineItems } : {})

      if (publicUrl || extractedData) {
        const attachmentEntry = JSON.stringify({ name: attachmentFilename, meta: richMeta })
        await supabase.from('order_history').update({ attachments: [attachmentEntry] }).eq('id', historyRows[0].id)
      }
    }

    return { hasAttachment: !!publicUrl, extracted: extractedCount }
  } catch (err) {
    console.error('PO attachment handling error:', err)
    return { hasAttachment: false, extracted: 0, error: String(err) }
  }
}

// Handle PI attachment: download from Gmail, upload to storage, update order
async function handlePIAttachment(
  supabase: any, accessToken: string, email: any,
  matchedOrderId: string, orderUuid: string, organizationId: string, userId: string
) {
  try {
    // 1. Get attachment parts and pick the most likely PI document
    const parts = await getAttachmentPartsForMessage(accessToken, email.gmail_id)
    const piPart = pickBestAttachment(parts, scorePIAttachment, email.subject || '')
    if (!piPart) { console.log('No PDF/image attachment found for PI email'); return }

    // 2. Download the attachment binary
    const fileData = await downloadAttachment(accessToken, email.gmail_id, piPart.attachmentId)
    if (!fileData) { console.log('Failed to download PI attachment'); return }

    // 3. Upload to Supabase Storage
    const publicUrl = await uploadToStorage(supabase, organizationId, matchedOrderId, piPart.filename, fileData, piPart.mimeType)
    if (!publicUrl) { console.log('Failed to upload PI attachment'); return }
    console.log(`PI attachment uploaded: ${publicUrl}`)

    // 4. Update the order_history entry with the attachment URL
    // Find the most recent history entry for this order at stage 2
    const { data: historyRows } = await supabase
      .from('order_history')
      .select('id')
      .eq('order_id', orderUuid)
      .eq('stage', 2)
      .order('timestamp', { ascending: false })
      .limit(1)

    if (historyRows && historyRows.length > 0) {
      const attachmentEntry = JSON.stringify({ name: piPart.filename, meta: { pdfUrl: publicUrl } })
      await supabase
        .from('order_history')
        .update({ attachments: [attachmentEntry] })
        .eq('id', historyRows[0].id)
    }

    // 5. Extract PI number and update the order
    const piNumber = extractPINumber(email.subject)
    if (piNumber) {
      await supabase
        .from('orders')
        .update({ pi_number: piNumber })
        .eq('order_id', matchedOrderId)
        .eq('organization_id', organizationId)
      console.log(`Updated PI number: ${piNumber} for order ${matchedOrderId}`)
    }

    // 6. Check if sender is a known contact
    const { data: contact } = await supabase
      .from('contacts')
      .select('id, notes')
      .eq('email', email.from_email)
      .eq('organization_id', organizationId)
      .maybeSingle()

    if (contact) {
      // Known contact — track PI format in notes
      if (piNumber) {
        const formatPrefix = piNumber.split(/[\/\-]/g).slice(0, 2).join('/')
        const currentNotes = contact.notes || ''
        if (!currentNotes.includes(`PI Format: ${formatPrefix}`)) {
          const newNotes = currentNotes
            ? `${currentNotes}\nPI Format: ${formatPrefix}`
            : `PI Format: ${formatPrefix}`
          await supabase
            .from('contacts')
            .update({ notes: newNotes })
            .eq('id', contact.id)
        }
      }
    } else {
      // Check if sender is an org member (e.g. your own company email) before flagging as unknown
      const { data: orgMembers } = await supabase
        .from('organization_members')
        .select('gmail_email')
        .eq('organization_id', organizationId)

      const orgEmails = (orgMembers || []).map((m: any) => m.gmail_email?.toLowerCase()).filter(Boolean)
      const isOrgEmail = orgEmails.includes(email.from_email?.toLowerCase())

      if (isOrgEmail) {
        // Auto-add org member as contact
        const initials = email.from_name.split(' ').map((w: string) => w[0]?.toUpperCase()).join('').slice(0, 2)
        await supabase.from('contacts').upsert({
          organization_id: organizationId,
          email: email.from_email,
          name: email.from_name,
          company: email.from_name,
          role: 'Internal',
          initials,
          color: '#3B82F6',
        }, { onConflict: 'email,organization_id' })
        console.log(`Auto-added org member as contact: ${email.from_email}`)
      } else {
        // Unknown external contact — create notification
        await supabase.from('notifications').insert({
          user_id: userId,
          organization_id: organizationId,
          type: 'unknown_contact',
          title: 'PI from Unknown Contact',
          message: `${email.from_name} (${email.from_email}) sent a Proforma Invoice for order ${matchedOrderId}. Add to contacts?`,
          data: { from_email: email.from_email, from_name: email.from_name, order_id: matchedOrderId, stage: 2 },
          read: false,
        })
        console.log(`Notification created for unknown contact: ${email.from_email}`)
      }
    }
  } catch (err) {
    console.error('PI attachment handling error:', err)
  }
}

// Score an attachment to determine how likely it is to be a PI document
function scorePIAttachment(filename: string, subject: string): number {
  const lower = filename.toLowerCase()
  let score = 0
  // Strong PI indicators in filename
  if (/proforma/i.test(lower)) score += 10
  if (/\bpi\b/i.test(lower)) score += 8
  if (/invoice/i.test(lower)) score += 5
  // Order number in filename is a good sign
  const poMatch = subject.match(/\b(\d{4})\b/)
  if (poMatch && lower.includes(poMatch[1])) score += 3
  // Penalize non-PI documents
  if (/spec|specification|coa|certificate|analysis/i.test(lower)) score -= 10
  if (/label|artwork|design|logo/i.test(lower)) score -= 8
  if (/packing|shipping|bill.*lading|bl\b/i.test(lower)) score -= 5
  if (/photo|image\d/i.test(lower)) score -= 5
  // PDFs are more likely to be PI documents than images
  if (lower.endsWith('.pdf')) score += 2
  return score
}

// Score an attachment to determine how likely it is to be a PO document
function scorePOAttachment(filename: string, subject: string): number {
  const lower = filename.toLowerCase()
  let score = 0
  // Strong PO indicators
  if (/purchase.*order/i.test(lower)) score += 10
  if (/\bpo\b/i.test(lower)) score += 8
  // Order number in filename
  const poMatch = subject.match(/\b(\d{4})\b/)
  if (poMatch && lower.includes(poMatch[1])) score += 3
  // Penalize non-PO documents
  if (/spec|specification|coa|certificate|analysis/i.test(lower)) score -= 10
  if (/proforma|invoice|\bpi\b/i.test(lower)) score -= 5
  if (/label|artwork|design|logo/i.test(lower)) score -= 8
  if (/photo|image\d/i.test(lower)) score -= 5
  // PDFs and scanned JPGs are common for PO
  if (lower.endsWith('.pdf')) score += 2
  return score
}

// Pick the best attachment from a list using a scoring function
function pickBestAttachment(
  parts: { filename: string; mimeType: string; attachmentId: string; size: number }[],
  scoreFn: (filename: string, subject: string) => number,
  subject: string
): { filename: string; mimeType: string; attachmentId: string; size: number } | undefined {
  const validParts = parts.filter(p =>
    p.mimeType.includes('pdf') || p.mimeType.includes('image/jpeg') || p.mimeType.includes('image/jpg') || p.mimeType.includes('image/png')
  )
  if (validParts.length === 0) return undefined
  // Score each and pick the best, but skip if score is too low (e.g. spec sheets)
  const scored = validParts.map(p => ({ part: p, score: scoreFn(p.filename, subject) }))
  scored.sort((a, b) => b.score - a.score)
  console.log(`Attachment scoring: ${scored.map(s => `${s.part.filename}=${s.score}`).join(', ')}`)
  // If best score is negative, it's likely not a real PI/PO document — skip it
  if (scored[0].score < -3) {
    console.log(`Skipping attachment ${scored[0].part.filename} — score too low (${scored[0].score})`)
    return undefined
  }
  return scored[0].part
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

    const { organization_id, user_id, mode, batch_size } = await req.json()
    // mode: 'pull' = just download emails, 'match' = AI matching batch, 'full' = legacy full sync, 'reprocess' = re-download PI/PO attachments
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
      // Lazy Gmail token — only refreshed when PI attachment needs downloading
      let gmailAccessToken: string | null = null

      // Get unprocessed emails (no matched_order_id, no user_linked_order_id, and no ai_summary yet)
      const { data: unmatchedEmails, error: fetchErr } = await supabase
        .from('synced_emails')
        .select('*')
        .eq('organization_id', organization_id)
        .is('matched_order_id', null)
        .is('user_linked_order_id', null)
        .is('ai_summary', null)
        .order('date', { ascending: true })
        .limit(5) // Small batches for high accuracy — prevents AI from mixing up emails

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

      const aiPrompt = `You are an AI assistant for a frozen seafood trading company called Ganesh International. Match each email below to an existing purchase order.
${catalogSection}
ACTIVE ORDERS:
${JSON.stringify(ordersList, null, 2)}

STAGE DEFINITIONS:
${STAGE_TRIGGERS}
${correctionExamples}
EMAILS TO MATCH:
${unmatchedEmails.map((e: any, i: number) => `
=== EMAIL #${i + 1} ===
GMAIL_ID: "${e.gmail_id}"
From: ${e.from_name} <${e.from_email}>
To: ${e.to_email}
Subject: ${e.subject}
Date: ${e.date}
Has Attachment: ${e.has_attachment}
Body (first 4000 chars): ${(e.body_text || '').substring(0, 4000)}
=== END EMAIL #${i + 1} ===
`).join('\n')}

INSTRUCTIONS — Process each email ONE AT A TIME:
For each email above, determine:
1. Which order it matches (by PO number, company, supplier, or product references in the email body/subject). Use the order "id" field (PO number like "GI/PO/...").
2. What stage this email represents (the stage the email is evidence of).
3. A brief summary of what THIS specific email is about. The summary MUST describe the actual content of THIS email — its subject and body — not any other email.

ACCURACY RULES — READ CAREFULLY:
- You MUST copy the GMAIL_ID exactly from each email header above. Do NOT swap or mix up IDs between emails.
- The "summary" field must describe the content of the email with THAT gmail_id — not any other email.
- Process each email independently. Do not let information from one email bleed into another.
- If an email is about banking, compliance, or non-trade matters, set matched_order_id to null.
- If no order matches, set matched_order_id to null.
- If no stage is detected, set detected_stage to null.

STAGE RULES:
- detected_stage is the stage this email provides EVIDENCE for — it can be ANY stage, not just current+1.
- Sometimes steps get skipped in real trade — that's OK.

Return VALID JSON only, no markdown fences. Return exactly ${unmatchedEmails.length} results, one per email, in the same order:
[{ "gmail_id": "EXACT_ID_FROM_ABOVE", "matched_order_id": "PO-NUMBER or null", "detected_stage": 3 or null, "summary": "What THIS specific email is about" }]`

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

      // Validate: only keep results whose gmail_id actually matches an email we sent
      const validGmailIds = new Set(unmatchedEmails.map((e: any) => e.gmail_id))
      aiResults = aiResults.filter((r: any) => {
        if (!validGmailIds.has(r.gmail_id)) {
          console.warn(`AI returned unknown gmail_id: ${r.gmail_id} — skipping`)
          return false
        }
        return true
      })

      // Process results
      const aiMap = new Map(aiResults.map((r: any) => [r.gmail_id, r]))
      let matchedCount = 0
      let advancedCount = 0

      for (const email of unmatchedEmails) {
        const ai = aiMap.get(email.gmail_id) || {}
        const matchedOrderId = ai.matched_order_id || null
        const detectedStage = ai.detected_stage || null
        const summary = ai.summary || null

        if (!matchedOrderId) {
          // Still save the AI summary so this email won't be re-processed
          if (summary) {
            await supabase
              .from('synced_emails')
              .update({ ai_summary: summary })
              .eq('id', email.id)
          } else {
            // Set a placeholder summary so we don't reprocess
            await supabase
              .from('synced_emails')
              .update({ ai_summary: 'No order match found' })
              .eq('id', email.id)
          }
          continue
        }

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

              // Handle attachment download for Stage 1 (PO) or Stage 2 (PI)
              if ((detectedStage === 1 || detectedStage === 2) && email.has_attachment) {
                if (!gmailAccessToken && member.gmail_refresh_token) {
                  const { data: settings } = await supabase
                    .from('organization_settings')
                    .select('gmail_client_id')
                    .eq('organization_id', organization_id)
                    .single()
                  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
                  if (settings?.gmail_client_id && clientSecret) {
                    gmailAccessToken = await refreshGmailToken(member.gmail_refresh_token, settings.gmail_client_id, clientSecret)
                  }
                }
                if (gmailAccessToken) {
                  if (detectedStage === 1) {
                    await handlePOAttachment(supabase, gmailAccessToken, email, matchedOrderId, order.uuid, organization_id)
                  } else {
                    await handlePIAttachment(supabase, gmailAccessToken, email, matchedOrderId, order.uuid, organization_id, user_id)
                  }
                }
              }
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

            // Handle attachment for Stage 1 or 2 even if order already past that stage
            if ((detectedStage === 1 || detectedStage === 2) && email.has_attachment) {
              if (!gmailAccessToken && member.gmail_refresh_token) {
                const { data: settings } = await supabase
                  .from('organization_settings')
                  .select('gmail_client_id')
                  .eq('organization_id', organization_id)
                  .single()
                const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
                if (settings?.gmail_client_id && clientSecret) {
                  gmailAccessToken = await refreshGmailToken(member.gmail_refresh_token, settings.gmail_client_id, clientSecret)
                }
              }
              if (gmailAccessToken) {
                if (detectedStage === 1) {
                  await handlePOAttachment(supabase, gmailAccessToken, email, matchedOrderId, order.uuid, organization_id)
                } else {
                  await handlePIAttachment(supabase, gmailAccessToken, email, matchedOrderId, order.uuid, organization_id, user_id)
                }
              }
            }
          }
        }
      }

      // Count remaining unprocessed (no match AND no summary yet)
      const { count: remainingCount } = await supabase
        .from('synced_emails')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organization_id)
        .is('matched_order_id', null)
        .is('user_linked_order_id', null)
        .is('ai_summary', null)

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
    // MODE: BULK-EXTRACT — Extract PO line items for all orders missing them
    // ============================================================
    if (syncMode === 'bulk-extract') {
      // Accepts order_po (e.g. "GI/PO/25-26/3044") to extract one order
      // Or no order_po to process all orders missing line items (batched)
      const targetPO = body.order_po as string | undefined

      let ordersToProcess: any[] = []

      if (targetPO) {
        // Single order mode
        const { data: order } = await supabase
          .from('orders')
          .select('id, order_id, company, supplier')
          .eq('organization_id', organization_id)
          .eq('po_number', targetPO)
          .single()
        if (order) ordersToProcess = [order]
      } else {
        // Batch mode: find orders with 0 line items via left join
        const { data } = await supabase
          .from('orders')
          .select('id, order_id, company, supplier, order_line_items(id)')
          .eq('organization_id', organization_id)
        ordersToProcess = (data || []).filter((o: any) => !o.order_line_items || o.order_line_items.length === 0)
      }

      if (ordersToProcess.length === 0) {
        return new Response(JSON.stringify({ mode: 'bulk-extract', message: targetPO ? 'Order not found' : 'All orders already have line items' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const batchLimit = batch_size || 3
      const batch = ordersToProcess.slice(0, batchLimit)
      const results: any[] = []
      let extracted = 0

      for (const order of batch) {
        try {
          // Find emails matched to this order, pick longest body
          const { data: emails } = await supabase
            .from('synced_emails')
            .select('id, subject, body_text, from_name, from_email')
            .eq('matched_order_id', order.order_id)
            .eq('organization_id', organization_id)
            .not('body_text', 'is', null)
            .limit(10)

          let bestEmail = null
          let maxLen = 0
          for (const e of (emails || [])) {
            const len = (e.body_text || '').length
            if (len > maxLen) { maxLen = len; bestEmail = e }
          }

          if (!bestEmail || maxLen < 100) {
            results.push({ order: order.order_id, status: 'skip', reason: 'no email with enough body text', maxLen })
            continue
          }

          const extractedData = await extractPODataFromEmail(bestEmail, order.company || '', order.supplier || '')
          if (!extractedData || extractedData.lineItems.length === 0) {
            results.push({ order: order.order_id, status: 'skip', reason: 'no line items extracted', bodyLen: maxLen })
            continue
          }

          const lineItemRows = extractedData.lineItems.map((item: any, idx: number) => ({
            order_id: order.id,
            product: item.product, brand: item.brand || '', size: item.size || '',
            glaze: item.glaze || '', glaze_marked: item.glazeMarked || '',
            packing: item.packing || '', freezing: item.freezing || 'IQF',
            cases: 0, kilos: item.kilos || 0, price_per_kg: item.pricePerKg || 0,
            currency: item.currency || 'USD',
            total: (item.kilos || 0) * (item.pricePerKg || 0), sort_order: idx,
          }))

          const { error: insertErr } = await supabase.from('order_line_items').insert(lineItemRows)
          if (insertErr) { results.push({ order: order.order_id, status: 'error', reason: insertErr.message }); continue }

          const updates: any = {}
          if (extractedData.deliveryTerms) updates.delivery_terms = extractedData.deliveryTerms
          if (extractedData.payment) updates.payment_terms = extractedData.payment
          if (extractedData.totalKilos > 0) updates.total_kilos = extractedData.totalKilos
          if (extractedData.totalValue > 0) updates.total_value = String(extractedData.totalValue)
          if (extractedData.lineItems.length > 0) updates.product = extractedData.lineItems.map((li: any) => li.product).filter(Boolean).join(', ')
          if (Object.keys(updates).length > 0) await supabase.from('orders').update(updates).eq('id', order.id)

          extracted++
          results.push({ order: order.order_id, status: 'ok', items: extractedData.lineItems.length, totalKilos: extractedData.totalKilos, totalValue: extractedData.totalValue })
        } catch (err) {
          results.push({ order: order.order_id, status: 'error', reason: String(err) })
        }
        await delay(300)
      }

      return new Response(JSON.stringify({
        mode: 'bulk-extract', batchProcessed: batch.length, extracted, remaining: ordersToProcess.length - batch.length, results
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ============================================================
    // MODE: REPROCESS — Re-download PI/PO attachments for matched emails
    // ============================================================
    if (syncMode === 'reprocess') {
      if (!member.gmail_refresh_token) throw new Error('Gmail not connected')
      const { data: settings } = await supabase
        .from('organization_settings')
        .select('gmail_client_id')
        .eq('organization_id', organization_id)
        .single()
      const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
      if (!settings?.gmail_client_id || !clientSecret) throw new Error('Gmail not configured')
      const gmailAccessToken = await refreshGmailToken(member.gmail_refresh_token, settings.gmail_client_id, clientSecret)
      if (!gmailAccessToken) throw new Error('Failed to refresh Gmail token')

      const reprocessLimit = batch_size || 10
      const { data: emails, error: fetchErr } = await supabase
        .from('synced_emails')
        .select('id, gmail_id, subject, from_name, from_email, date, has_attachment, matched_order_id, detected_stage, body_text')
        .eq('organization_id', organization_id)
        .not('matched_order_id', 'is', null)
        .eq('has_attachment', true)
        .in('detected_stage', [1, 2])
        .eq('attachment_processed', false)
        .order('date', { ascending: true })
        .limit(reprocessLimit)

      if (fetchErr) throw fetchErr
      if (!emails || emails.length === 0) {
        return new Response(JSON.stringify({ mode: 'reprocess', processed: 0, message: 'No PI/PO emails with attachments found' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const { data: orders } = await supabase
        .from('orders')
        .select('id, order_id')
        .eq('organization_id', organization_id)
      const orderMap = new Map((orders || []).map((o: any) => [o.order_id, o.id]))

      let processed = 0, piCount = 0, poCount = 0
      const results: any[] = []

      for (const email of emails) {
        const orderUuid = orderMap.get(email.matched_order_id)
        if (!orderUuid) continue
        try {
          let debugInfo: any = null
          if (email.detected_stage === 1) {
            debugInfo = await handlePOAttachment(supabase, gmailAccessToken, email, email.matched_order_id, orderUuid, organization_id)
            poCount++
          } else {
            await handlePIAttachment(supabase, gmailAccessToken, email, email.matched_order_id, orderUuid, organization_id, user_id)
            piCount++
          }
          processed++
          results.push({ order: email.matched_order_id, stage: email.detected_stage, status: 'ok', debugInfo })
          // Mark as processed so we don't re-download next batch
          await supabase.from('synced_emails').update({ attachment_processed: true }).eq('id', email.id)
        } catch (err) {
          results.push({ order: email.matched_order_id, stage: email.detected_stage, status: 'error', error: String(err) })
          // Mark as processed even on error to avoid infinite retries
          await supabase.from('synced_emails').update({ attachment_processed: true }).eq('id', email.id)
        }
        await delay(200)
      }

      return new Response(JSON.stringify({
        mode: 'reprocess', totalFound: emails.length, processed, poAttachments: poCount, piAttachments: piCount, results,
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
