import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'


function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
}

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_MAIL_API_KEY! || process.env.ANTHROPIC_API_KEY!!

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
): Promise<{ lineItems: any[], deliveryTerms: string, payment: string, commission: string, destination: string, totalKilos: number, totalValue: number } | null> {
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
      "cases": 2133,
      "kilos": 12798,
      "pricePerKg": 3.90,
      "currency": "USD",
      "total": 49912.20
    }
  ],
  "deliveryTerms": "CFR",
  "payment": "string - payment terms or empty string",
  "destination": "string - delivery destination or empty string",
  "commission": "string - commission details or empty string"
}

Field notes:
- cases: number of cases/cartons. "250c/s" or "250 c/s" means 250 cases. Cases/Cartons/Ctns are the same thing
- kilos: total weight in kg. "07 MT" or "7 MT" = 7000 kg
- If amounts are in cases (c/s), also estimate kilos: cases * approximate_kg_per_case. If you cannot determine kilos, set kilos to 0

Rules:
- Always prefix product names with "Frozen" if not already
- If you cannot find line item details, return empty lineItems array
- The email may be in Spanish. Spanish terms: calamar=Squid, sepia=Cuttlefish, pulpo=Octopus, gamba=Shrimp/Prawn, glaseo=Glaze, bolsa=Bag, granel=Bulk, caja=Case, contenedor=Container, oferta=Offer
- Spanish size format "U/1" = "Under 1kg", "1/2" = "1-2kg", "2/4" = "2-4kg", "5/7" = "5-7kg", "20/40" = "20-40 pieces/kg"
- Price format "7.30$/kg" or "7.30 USD/kg" — extract as pricePerKg
- If the email is a price negotiation, offer, or counter-offer with product sizes and prices, extract those as line items
- If amounts are in cases (c/s), convert: cases * approximate_kg_per_case. If you cannot determine kilos, set kilos to 0`

    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
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
      cases: typeof item.cases === 'number' ? item.cases : (parseInt(item.cases) || 0),
      kilos: typeof item.kilos === 'number' ? item.kilos : (parseFloat(item.kilos) || 0),
      pricePerKg: typeof item.pricePerKg === 'number' ? item.pricePerKg : (parseFloat(item.pricePerKg) || 0),
      currency: String(item.currency || 'USD'),
      total: typeof item.total === 'number' ? item.total : (parseFloat(item.total) || 0),
    })) : []

    const totalKilos = lineItems.reduce((sum: number, li: any) => sum + (li.kilos || 0), 0)
    const totalValue = lineItems.reduce((sum: number, li: any) => sum + ((li.kilos || 0) * (li.pricePerKg || 0)), 0)

    return {
      lineItems,
      deliveryTerms: String(parsed.deliveryTerms || ''),
      payment: String(parsed.payment || ''),
      commission: String(parsed.commission || ''),
      destination: String(parsed.destination || ''),
      totalKilos,
      totalValue: Math.round(totalValue * 100) / 100,
    }
  } catch (err) {
    console.error('PO data extraction error:', err)
    return null
  }
}

// Retry helper for transient API errors (500, 529)
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, options)
    if (res.ok || (res.status !== 500 && res.status !== 529)) return res
    const waitSec = Math.pow(2, attempt) // 1s, 2s, 4s
    console.log(`[RETRY] API returned ${res.status}, waiting ${waitSec}s (attempt ${attempt + 1}/${maxRetries})`)
    await new Promise(r => setTimeout(r, waitSec * 1000))
  }
  // Final attempt
  return fetch(url, options)
}

// Extract PO data from an image (scanned PO) using Claude vision
async function extractPODataFromImage(
  imageBase64: string, mimeType: string, orderCompany: string, orderSupplier: string
): Promise<{ lineItems: any[], deliveryTerms: string, payment: string, commission: string, destination: string, totalKilos: number, totalValue: number } | null> {
  try {
    const isImage = mimeType.startsWith('image/')
    const isPdf = mimeType.includes('pdf')
    const contentBlock = isImage
      ? { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } }
      : isPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: imageBase64 } }
        : { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } }
    const prompt = `You are an expert seafood trading order parser for Ganesh International.
Extract structured purchase order data from this scanned PO document image.

CRITICAL: Return ONLY valid JSON. No explanation, no markdown, no code fences.

IMPORTANT - BEFORE extracting line items, first scan the ENTIRE document for these fields that typically appear OUTSIDE the product table:
1. Commission - usually labeled "Commission:" near Delivery/Payment section. Examples: "10 Cents per Kg + GST", "2%", "$0.10/kg", "USD 0.05 per kg"
2. Delivery Terms - e.g. "CFR Valencia", "CIF Rotterdam", "FOB Kochi"
3. Payment Terms - e.g. "LC at 75 Days", "Sight DP", "TT Payment"
4. Destination - the port/city name from delivery terms or a separate field
5. Delivery/Shipment date - e.g. "Before 10/03/2026"

Known context:
- Buyer: ${orderCompany || 'Unknown'}
- Supplier: ${orderSupplier || 'Unknown'}

Return this JSON structure:
{
  "lineItems": [
    {
      "product": "string - full product name, start with 'Frozen'",
      "size": "string - size range or empty string",
      "glaze": "string - glaze percentage or empty string",
      "glazeMarked": "string - marked/declared glaze if different, or empty string",
      "packing": "string - packing format or empty string",
      "brand": "string - brand name or empty string",
      "freezing": "string - 'IQF', 'Semi IQF', 'Blast', 'Block', or 'Plate'. Default 'IQF'",
      "cases": 2133,
      "kilos": 12798,
      "pricePerKg": 3.90,
      "currency": "USD",
      "total": 49912.20
    }
  ],
  "deliveryTerms": "CFR Valencia",
  "payment": "LC at 75 Days",
  "destination": "Valencia",
  "commission": "10 Cents per Kg + GST"
}

Field notes:
- product: full product name, always start with "Frozen"
- cases: the number from the Cases/Cartons column. IMPORTANT: Read the actual number from the document, do NOT default to 0
- kilos: total weight in kg. If MT given, multiply by 1000
- pricePerKg: price per kg
- total: the line total dollar/euro amount from the document
- "Cases" and "Cartons" and "Ctns" and "c/s" all mean the same thing
- freezing: 'IQF', 'Semi IQF', 'Blast', 'Block', or 'Plate'. Default 'IQF'
- currency: 'USD' or 'EUR'. Default 'USD'

Rules:
- Always prefix product names with "Frozen" if not already
- "07 MT" or "7 MT" = 7000 kg
- CRITICAL: Extract the Cases/Cartons number from the table. Look for a column labeled Cases, Cartons, Ctns, or similar
- If you cannot read the document clearly or find line item details, return empty lineItems array
- Spanish terms: calamar=Squid, sepia=Cuttlefish, pulpo=Octopus, gamba=Shrimp, cajas=Cases/Cartons
- CRITICAL: Do NOT return empty string for commission if a Commission field exists in the document. Read the exact text next to "Commission:" or "Commission :" label.`

    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            contentBlock,
            { type: 'text', text: prompt }
          ]
        }],
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error(`[PO-VISION] AI API error: ${res.status} ${errText.substring(0, 200)}`)
      return { lineItems: [], deliveryTerms: '', payment: '', commission: '', destination: '', totalKilos: 0, totalValue: 0, _debug: `API ${res.status}: ${errText.substring(0, 100)}` }
    }
    const aiData = await res.json()
    const text = aiData.content?.[0]?.text || ''
    console.log(`[PO-VISION] Raw response (first 300): ${text.substring(0, 300)}`)

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
      cases: typeof item.cases === 'number' ? item.cases : (parseInt(item.cases) || 0),
      kilos: typeof item.kilos === 'number' ? item.kilos : (parseFloat(item.kilos) || 0),
      pricePerKg: typeof item.pricePerKg === 'number' ? item.pricePerKg : (parseFloat(item.pricePerKg) || 0),
      currency: String(item.currency || 'USD'),
      total: typeof item.total === 'number' ? item.total : (parseFloat(item.total) || 0),
    })) : []

    const totalKilos = lineItems.reduce((sum: number, li: any) => sum + (li.kilos || 0), 0)
    const totalValue = lineItems.reduce((sum: number, li: any) => sum + ((li.kilos || 0) * (li.pricePerKg || 0)), 0)

    // Capture the tail of the response where commission/delivery/payment fields live (after lineItems array)
    const tailStart = text.lastIndexOf('"deliveryTerms"')
    const responseTail = tailStart > 0 ? text.substring(tailStart, tailStart + 400) : text.substring(Math.max(0, text.length - 400))
    console.log(`[PO-VISION] Parsed fields: commission="${parsed.commission}", delivery="${parsed.deliveryTerms}", payment="${parsed.payment}", dest="${parsed.destination}"`)
    return { lineItems, deliveryTerms: String(parsed.deliveryTerms || ''), payment: String(parsed.payment || ''), commission: String(parsed.commission || ''), destination: String(parsed.destination || ''), totalKilos, totalValue: Math.round(totalValue * 100) / 100, _rawTail: responseTail }
  } catch (err) {
    console.error('PO vision extraction error:', err)
    return null
  }
}

// Classify a document using vision AI — returns 'po', 'pi', 'artwork', 'shipping', 'certificate', or 'other'
async function classifyDocumentWithVision(
  base64Data: string, mimeType: string
): Promise<string> {
  try {
    const isImage = mimeType.startsWith('image/')
    const isPdf = mimeType.includes('pdf')
    if (!isImage && !isPdf) return 'other'

    const contentBlock = isImage
      ? { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Data } }
      : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } }

    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 30,
        messages: [{
          role: 'user',
          content: [
            contentBlock,
            { type: 'text', text: `What type of trade document is this? Reply with ONLY one word:
- "po" if it is a Purchase Order (business document with order items, quantities, prices)
- "pi" if it is a Proforma Invoice (business document with invoice/proforma details)
- "artwork" if it is product packaging artwork, label designs, branding materials, box designs
- "shipping" if it is a shipping document, bill of lading, packing list
- "certificate" if it is a certificate of analysis, quality certificate, health certificate
- "other" if none of the above
Reply with ONLY the single word classification.` }
          ]
        }],
      }),
    })

    if (!res.ok) {
      console.log(`[CLASSIFY] Vision API error: ${res.status}`)
      return 'other'
    }
    const data = await res.json()
    const raw = (data.content?.[0]?.text || '').trim().toLowerCase().replace(/[^a-z]/g, '')
    const valid = ['po', 'pi', 'artwork', 'shipping', 'certificate', 'other']
    const classification = valid.includes(raw) ? raw : 'other'
    console.log(`[CLASSIFY] Document classified as: ${classification}`)
    return classification
  } catch (err) {
    console.error('[CLASSIFY] Error:', err)
    return 'other'
  }
}

// Helper: download attachment and return base64 + classification
async function downloadAndClassify(
  accessToken: string, gmailId: string, part: { filename: string; mimeType: string; attachmentId: string; size: number }
): Promise<{ fileData: ArrayBuffer; base64: string; classification: string } | null> {
  const fileData = await downloadAttachment(accessToken, gmailId, part.attachmentId)
  if (!fileData) return null

  // Convert to base64 for vision
  const bytes = new Uint8Array(fileData)
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    for (let j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j])
  }
  const base64 = btoa(binary)
  const classification = await classifyDocumentWithVision(base64, part.mimeType || 'application/pdf')
  return { fileData, base64, classification }
}

// Map AI document classification to order stage number
function classificationToStage(classification: string): number | null {
  switch (classification) {
    case 'po': return 1
    case 'pi': return 2
    case 'artwork': return 3
    case 'certificate': return 4
    case 'shipping': return 5
    default: return null  // 'other' — don't store
  }
}

// Store an attachment in the correct stage's order_history entry
async function storeAttachmentInHistory(
  supabase: any, orderUuid: string, stage: number, filename: string, publicUrl: string, extraMeta?: any
) {
  // Find existing history entry for this stage, or we'll need one
  const { data: historyRows } = await supabase
    .from('order_history')
    .select('id, attachments')
    .eq('order_id', orderUuid)
    .eq('stage', stage)
    .order('timestamp', { ascending: false })
    .limit(1)

  const meta: any = { pdfUrl: publicUrl, ...(extraMeta || {}) }
  const attachmentEntry = JSON.stringify({ name: filename, meta })

  if (historyRows && historyRows.length > 0) {
    // Update existing entry — append or replace attachments
    await supabase.from('order_history').update({
      attachments: [attachmentEntry],
      has_attachment: true,
    }).eq('id', historyRows[0].id)
    console.log(`[STORE] Saved ${filename} to stage ${stage} history (updated existing)`)
  } else {
    // No history entry for this stage yet — create one
    const { data: orderData } = await supabase.from('orders').select('organization_id').eq('id', orderUuid).single()
    await supabase.from('order_history').insert({
      organization_id: orderData?.organization_id,
      order_id: orderUuid,
      stage,
      from_address: 'System',
      subject: `Document auto-filed from email attachment`,
      body: `AI classified ${filename} as stage ${stage} document`,
      timestamp: new Date().toISOString(),
      has_attachment: true,
      attachments: [attachmentEntry],
    })
    console.log(`[STORE] Saved ${filename} to stage ${stage} history (created new entry)`)
  }
}

// Unified attachment processor: classify ALL attachments and store each in the correct stage
async function processEmailAttachments(
  supabase: any, accessToken: string, email: any,
  matchedOrderId: string, orderUuid: string, organizationId: string, userId: string,
  skipExtraction: boolean = false
) {
  try {
    // 1. Get all attachment parts from the email
    const parts = await getAttachmentPartsForMessage(accessToken, email.gmail_id)
    const validParts = parts.filter((p: any) =>
      p.mimeType.includes('pdf') || p.mimeType.includes('image/jpeg') || p.mimeType.includes('image/jpg') || p.mimeType.includes('image/png')
    )
    if (validParts.length === 0) { console.log(`[PROCESS] No valid attachments in email`); return }
    console.log(`[PROCESS] Found ${validParts.length} valid attachments for ${matchedOrderId}`)

    // Track what we found
    let poAttachment: { url: string; filename: string; base64: string; mimeType: string } | null = null
    let foundPI = false

    // 2. For each attachment: download, classify, upload to correct stage
    for (const part of validParts) {
      try {
        const result = await downloadAndClassify(accessToken, email.gmail_id, part)
        if (!result) continue

        const stage = classificationToStage(result.classification)
        if (!stage) {
          console.log(`[PROCESS] Skipping ${part.filename} — classified as "${result.classification}" (no stage mapping)`)
          continue
        }

        console.log(`[PROCESS] ${part.filename} → classified as "${result.classification}" → stage ${stage}`)

        // Upload to storage
        const publicUrl = await uploadToStorage(supabase, organizationId, matchedOrderId, part.filename, result.fileData, part.mimeType)
        if (!publicUrl) continue

        // Store in the correct stage's history entry
        await storeAttachmentInHistory(supabase, orderUuid, stage, part.filename, publicUrl)

        // Track PO attachment for later data extraction
        if (result.classification === 'po') {
          poAttachment = { url: publicUrl, filename: part.filename, base64: result.base64, mimeType: part.mimeType }
        }
        if (result.classification === 'pi') {
          foundPI = true
        }
      } catch (partErr) {
        console.log(`[PROCESS] Error processing ${part.filename}: ${partErr}`)
      }
    }

    // 3. PO post-processing: link PDF and extract line items
    if (poAttachment) {
      const { data: orderRow } = await supabase
        .from('orders')
        .select('company, supplier, metadata')
        .eq('id', orderUuid)
        .single()

      // ALWAYS link the PDF to the order — regardless of line item extraction success
      const currentMeta = orderRow?.metadata || {}
      const { error: metaErr } = await supabase.from('orders')
        .update({ metadata: { ...currentMeta, pdfUrl: poAttachment.url } })
        .eq('id', orderUuid)
      if (metaErr) {
        console.error(`[PROCESS] Failed to set pdfUrl for ${matchedOrderId}: ${metaErr.message}`)
      } else {
        console.log(`[PROCESS] pdfUrl linked for ${matchedOrderId}`)
      }

      // ALWAYS update stage 1 history entry with pdfUrl
      const { data: stage1History } = await supabase.from('order_history').select('id')
        .eq('order_id', orderUuid).eq('stage', 1).order('timestamp', { ascending: false }).limit(1)
      if (stage1History?.[0]) {
        const baseMeta = { pdfUrl: poAttachment.url, supplier: orderRow?.supplier || '', buyer: orderRow?.company || '' }
        const entry = JSON.stringify({ name: poAttachment.filename, meta: baseMeta })
        await supabase.from('order_history').update({ attachments: [entry] }).eq('id', stage1History[0].id)
      }

      // Now attempt line item extraction (separate from PDF linking)
      // skipExtraction=true used by reprocess mode to stay under worker limit
      if (!skipExtraction) {
      // Always extract from PO — if line items already exist, replace them (handles revised POs)
      const { count: existingLineItems } = await supabase
        .from('order_line_items')
        .select('id', { count: 'exact', head: true })
        .eq('order_id', orderUuid)

      {
        let extractedData: any = null
        if (poAttachment.mimeType.startsWith('image/')) {
          extractedData = await extractPODataFromImage(poAttachment.base64, poAttachment.mimeType, orderRow?.company || '', orderRow?.supplier || '')
        }
        if (!extractedData || extractedData.lineItems.length === 0) {
          extractedData = await extractPODataFromEmail(email, orderRow?.company || '', orderRow?.supplier || '')
        }

        if (extractedData && extractedData.lineItems.length > 0) {
          // If line items already exist, delete old ones first (revised PO replaces original)
          if (existingLineItems && existingLineItems > 0) {
            console.log(`[PROCESS] Replacing ${existingLineItems} existing line items with revised PO data`)
            await supabase.from('order_line_items').delete().eq('order_id', orderUuid)
          }

          const lineItemRows = extractedData.lineItems.map((item: any, idx: number) => ({
            order_id: orderUuid, product: item.product, brand: item.brand || '',
            size: item.size || '', glaze: item.glaze || '', glaze_marked: item.glazeMarked || '',
            packing: item.packing || '', freezing: item.freezing || 'IQF', cases: parseInt(item.cases) || 0,
            kilos: item.kilos || 0, price_per_kg: item.pricePerKg || 0,
            currency: item.currency || 'USD', total: Number(item.total) || ((item.kilos || 0) * (item.pricePerKg || 0)), sort_order: idx,
          }))
          const { error: insertErr } = await supabase.from('order_line_items').insert(lineItemRows)
          if (insertErr) console.error(`Line items insert error: ${insertErr.message}`)

          // Update order with extracted delivery/payment/totals
          const updates: any = {
            metadata: { ...currentMeta, extractedFromEmail: true, pdfUrl: poAttachment.url },
          }
          if (extractedData.deliveryTerms) updates.delivery_terms = extractedData.deliveryTerms
          if (extractedData.payment) updates.payment_terms = extractedData.payment
          if (extractedData.commission) updates.commission = extractedData.commission
          if (extractedData.destination) updates.to_location = extractedData.destination
          if (extractedData.totalKilos > 0) updates.total_kilos = extractedData.totalKilos
          if (extractedData.totalValue > 0) updates.total_value = String(Math.round(extractedData.totalValue * 100) / 100)
          await supabase.from('orders').update(updates).eq('id', orderUuid)

          // Enrich stage 1 history with line item data
          if (stage1History?.[0]) {
            const richMeta = {
              pdfUrl: poAttachment.url, supplier: orderRow?.supplier || '', buyer: orderRow?.company || '',
              deliveryTerms: extractedData.deliveryTerms || '', payment: extractedData.payment || '',
              commission: extractedData.commission || '', destination: extractedData.destination || '',
              totalKilos: extractedData.totalKilos, grandTotal: extractedData.totalValue,
              extractedFromEmail: true, lineItems: extractedData.lineItems,
            }
            const entry = JSON.stringify({ name: poAttachment.filename, meta: richMeta })
            await supabase.from('order_history').update({ attachments: [entry] }).eq('id', stage1History[0].id)
          }
          console.log(`[PROCESS] Extracted ${extractedData.lineItems.length} line items from PO${existingLineItems && existingLineItems > 0 ? ' (replaced existing)' : ''}`)
        }
      }
      } else {
        console.log(`[PROCESS] Skipping extraction for ${matchedOrderId} (skipExtraction=true, use bulk-extract later)`)
      }
    }

    // 4. PI post-processing: extract PI number and manage contacts
    if (foundPI) {
      const piNumber = extractPINumber(email.subject)
      if (piNumber) {
        await supabase.from('orders').update({ pi_number: piNumber })
          .eq('order_id', matchedOrderId).eq('organization_id', organizationId)
        console.log(`[PROCESS] Updated PI number: ${piNumber}`)
      }

      // Contact management for PI senders
      const { data: contact } = await supabase.from('contacts').select('id, notes')
        .eq('email', email.from_email).eq('organization_id', organizationId).maybeSingle()

      if (contact) {
        if (piNumber) {
          const formatPrefix = piNumber.split(/[\/\-]/g).slice(0, 2).join('/')
          const currentNotes = contact.notes || ''
          if (!currentNotes.includes(`PI Format: ${formatPrefix}`)) {
            await supabase.from('contacts').update({
              notes: currentNotes ? `${currentNotes}\nPI Format: ${formatPrefix}` : `PI Format: ${formatPrefix}`
            }).eq('id', contact.id)
          }
        }
      } else {
        const { data: orgMembers } = await supabase.from('organization_members')
          .select('email, gmail_email').eq('organization_id', organizationId)
        const orgEmails = (orgMembers || []).flatMap((m: any) => [m.email?.toLowerCase(), m.gmail_email?.toLowerCase()]).filter(Boolean)
        const isOrgEmail = orgEmails.includes(email.from_email?.toLowerCase())

        if (isOrgEmail) {
          const initials = email.from_name.split(' ').map((w: string) => w[0]?.toUpperCase()).join('').slice(0, 2)
          await supabase.from('contacts').upsert({
            organization_id: organizationId, email: email.from_email, name: email.from_name,
            company: email.from_name, role: 'Internal', initials, color: '#3B82F6',
          }, { onConflict: 'email,organization_id' })
        } else {
          await supabase.from('notifications').insert({
            user_id: userId, organization_id: organizationId, type: 'unknown_contact',
            title: 'PI from Unknown Contact',
            message: `${email.from_name} (${email.from_email}) sent a Proforma Invoice for order ${matchedOrderId}. Add to contacts?`,
            data: { from_email: email.from_email, from_name: email.from_name, order_id: matchedOrderId, stage: 2 },
            read: false,
          })
        }
      }
    }

    console.log(`[PROCESS] Done processing attachments for ${matchedOrderId}`)
  } catch (err) {
    console.error('[PROCESS] Attachment processing error:', err)
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') { setCors(res); return res.status(200).end() }

  try {
    // 1) Verify the caller is authenticated via JWT
    const authHeader = (req.headers.authorization || req.headers['Authorization'] as string)
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Missing or invalid authorization header')
    }

    const supabaseUrl = process.env.SUPABASE_URL!!
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!!
    const supabaseAnon = process.env.SUPABASE_ANON_KEY! || supabaseKey

    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) {
      throw new Error('Authentication failed. Please log in again.')
    }

    const reqBody = req.body
    const { organization_id, user_id, mode, batch_size } = reqBody
    // mode: 'pull' = just download emails, 'match' = AI matching batch, 'full' = legacy full sync, 'reprocess' = re-download PI/PO attachments, 'bulk-extract' = extract PO line items
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

        setCors(res)
      return res.status(200).json({
          mode: 'match',
          done: true,
          matched: 0,
          remaining: 0,
          totalEmails: totalCount || 0,
          totalMatched: matchedCount || 0,
        })
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
          const discoveryRes = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-opus-4-6',
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
                  metadata: { created_by: 'email_sync', needsReview: true, stage_reasoning: disc.stage_reasoning || '' },
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
        setCors(res)
      return res.status(200).json({
          mode: 'match',
          done: true,
          matched: 0,
          created: createdOrderCount,
          remaining: 0,
          totalEmails: unmatchedEmails.length,
          totalMatched: 0,
          message: 'No orders could be discovered from emails. Try adding orders manually first.',
        })
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
        const aiRes = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-opus-4-6',
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
                body: email.body_text || summary || `Stage advanced based on email from ${email.from_name}`,
                timestamp: email.date || new Date().toISOString(),
                has_attachment: email.has_attachment || false,
              })

              // Mark as auto-advanced
              await supabase.from('synced_emails').update({ auto_advanced: true }).eq('id', email.id)

              // Handle attachment download for Stage 1 (PO) or Stage 2 (PI)
              if (email.has_attachment) {
                if (!gmailAccessToken && member.gmail_refresh_token) {
                  const { data: settings } = await supabase
                    .from('organization_settings')
                    .select('gmail_client_id')
                    .eq('organization_id', organization_id)
                    .single()
                  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!
                  if (settings?.gmail_client_id && clientSecret) {
                    gmailAccessToken = await refreshGmailToken(member.gmail_refresh_token, settings.gmail_client_id, clientSecret)
                  }
                }
                if (gmailAccessToken) {
                  await processEmailAttachments(supabase, gmailAccessToken, email, matchedOrderId, order.uuid, organization_id, user_id)
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
              body: email.body_text || summary || `Email from ${email.from_name}`,
              timestamp: email.date || new Date().toISOString(),
              has_attachment: email.has_attachment || false,
            })

            // Handle attachments — AI classifies each and stores in the correct stage
            if (email.has_attachment) {
              if (!gmailAccessToken && member.gmail_refresh_token) {
                const { data: settings } = await supabase
                  .from('organization_settings')
                  .select('gmail_client_id')
                  .eq('organization_id', organization_id)
                  .single()
                const clientSecret = process.env.GOOGLE_CLIENT_SECRET!
                if (settings?.gmail_client_id && clientSecret) {
                  gmailAccessToken = await refreshGmailToken(member.gmail_refresh_token, settings.gmail_client_id, clientSecret)
                }
              }
              if (gmailAccessToken) {
                await processEmailAttachments(supabase, gmailAccessToken, email, matchedOrderId, order.uuid, organization_id, user_id)
              }
            }
          }
        }
      }

      // ---- Auto-create orders for unmatched emails with new PO numbers ----
      const existingPOs = new Set(ordersList.map((o: any) => o.id))
      const newPOEmails = new Map<string, any[]>() // po_number -> emails[]

      for (const email of unmatchedEmails) {
        const ai = aiMap.get(email.gmail_id) || {}
        if (ai.matched_order_id) continue // already matched

        // Extract PO number from subject
        const poMatch = email.subject?.match(/(?:PO\s*(?:GI\/PO\/[\d\-]+\/)?|GI\/PO\/[\d\-]+\/)(\d{4})/i)
        if (!poMatch) continue
        const poNum = poMatch[1]
        const fullPO = `GI/PO/25-26/${poNum}`
        if (existingPOs.has(fullPO)) continue

        if (!newPOEmails.has(fullPO)) newPOEmails.set(fullPO, [])
        newPOEmails.get(fullPO)!.push(email)
      }

      if (newPOEmails.size > 0) {
        console.log(`Found ${newPOEmails.size} new PO numbers to auto-create: ${[...newPOEmails.keys()].join(', ')}`)

        for (const [fullPO, emails] of newPOEmails) {
          // Use the earliest email (likely the PO or PI) to extract info
          const refEmail = emails.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())[0]
          const subject = refEmail.subject || ''

          // Extract supplier from subject or To field
          let supplier = 'Unknown'
          // Common patterns: "PO 3046 - Raunaq", "PO 3045 - JJ SEAFOODS"
          const supplierMatch = subject.match(/PO\s*\d{4}\s*[-–]\s*(.+?)(?:\s*$)/i)
          if (supplierMatch) supplier = supplierMatch[1].trim()

          // Extract company (buyer) - usually Pescados or the To address
          const toEmail = refEmail.to_email || ''
          let company = 'Pescados E. Guillem S.L.'
          if (toEmail.includes('eguillem')) company = 'Pescados E. Guillem S.L.'

          // Detect highest stage from all emails for this PO
          let highestStage = 1
          for (const e of emails) {
            const subj = (e.subject || '').toUpperCase()
            if (subj.includes('ARTWORK APPROVAL') || subj.includes('LABELS APPROVAL')) highestStage = Math.max(highestStage, 3)
            else if (subj.includes('PROFORMA INVOICE')) highestStage = Math.max(highestStage, 2)
            else if (subj.includes('PURCHASE ORDER') || subj.includes('NEW PO')) highestStage = Math.max(highestStage, 1)
            else if (subj.includes('QUALITY CHECK') || subj.includes('INSPECTION')) highestStage = Math.max(highestStage, 4)
            else if (subj.includes('SCHEDULE') || subj.includes('VESSEL')) highestStage = Math.max(highestStage, 5)
            else if (subj.includes('DRAFT DOCUMENT') || subj.includes('DRAFT BL') || subj.includes('HC DRAFT')) highestStage = Math.max(highestStage, 6)
            else if (subj.includes('FINAL DOCUMENT') || subj.includes('ORIGINAL DOCUMENT')) highestStage = Math.max(highestStage, 7)
            else if (subj.includes('DHL') || subj.includes('TRACKING')) highestStage = Math.max(highestStage, 8)
          }

          // Calculate skipped stages
          const skippedStages: number[] = []
          for (let s = 2; s < highestStage; s++) {
            const hasEvidence = emails.some((e: any) => {
              const subj = (e.subject || '').toUpperCase()
              if (s === 2) return subj.includes('PROFORMA')
              if (s === 3) return subj.includes('ARTWORK') || subj.includes('LABEL')
              if (s === 4) return subj.includes('QUALITY') || subj.includes('INSPECTION')
              if (s === 5) return subj.includes('SCHEDULE') || subj.includes('VESSEL')
              if (s === 6) return subj.includes('DRAFT')
              if (s === 7) return subj.includes('FINAL') || subj.includes('ORIGINAL')
              return false
            })
            if (!hasEvidence) skippedStages.push(s)
          }

          // Extract product from body if available
          let product = 'Unknown'
          const bodyText = (refEmail.body_text || '').substring(0, 500).toUpperCase()
          if (bodyText.includes('SHRIMP') || bodyText.includes('VANNAMEI') || bodyText.includes('PDTO')) product = 'Frozen Shrimp'
          else if (bodyText.includes('SQUID') || bodyText.includes('CALAMAR')) product = 'Frozen Squid'
          else if (bodyText.includes('CUTTLEFISH')) product = 'Frozen Cuttlefish'
          else if (bodyText.includes('OCTOPUS')) product = 'Frozen Octopus'
          else if (bodyText.includes('FISH')) product = 'Frozen Fish'

          const { data: newOrder, error: createErr } = await supabase
            .from('orders')
            .insert({
              organization_id,
              order_id: fullPO,
              po_number: fullPO,
              company: company,
              supplier: supplier,
              product: product,
              from_location: 'India',
              current_stage: highestStage,
              skipped_stages: skippedStages,
              order_date: new Date(refEmail.date || Date.now()).toISOString().split('T')[0],
              status: 'sent',
              specs: '',
              metadata: { created_by: 'email_sync_auto', needsReview: true },
            })
            .select('id')
            .single()

          if (!createErr && newOrder) {
            createdOrderCount++
            console.log(`Auto-created order ${fullPO} (${supplier}) at stage ${highestStage}`)

            // Add to ordersList so subsequent matching can use it
            ordersList.push({ uuid: newOrder.id, id: fullPO, company, supplier, product, currentStage: highestStage, skippedStages })
            existingPOs.add(fullPO)

            // Log in order_history
            await supabase.from('order_history').insert({
              order_id: newOrder.id,
              organization_id,
              stage: highestStage,
              timestamp: refEmail.date || new Date().toISOString(),
              from_address: 'System (Email Sync)',
              subject: `Order auto-created from email: ${subject}`,
              body: `Order ${fullPO} (${supplier}) auto-created during email sync at stage ${highestStage}`,
            })

            // Match all emails for this PO to the new order
            for (const e of emails) {
              await supabase
                .from('synced_emails')
                .update({ matched_order_id: fullPO, ai_summary: `Auto-matched to newly created order ${fullPO}` })
                .eq('id', e.id)
              matchedCount++
            }
          } else if (createErr) {
            console.error(`Failed to create order ${fullPO}:`, createErr.message)
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

      setCors(res)
      return res.status(200).json({
        mode: 'match',
        done: (remainingCount || 0) === 0,
        matched: matchedCount,
        advanced: advancedCount,
        created: createdOrderCount,
        remaining: remainingCount || 0,
        totalEmails: totalEmails || 0,
        totalMatched: totalMatched || 0,
      })
    }

    // ============================================================
    // MODE: BULK-EXTRACT — Extract PO line items for all orders missing them
    // ============================================================
    if (syncMode === 'bulk-extract') {
      // Accepts order_po (e.g. "GI/PO/25-26/3044") to extract one order
      // Or no order_po to process all orders missing line items (batched)
      // retry=true to retry previously failed orders
      const targetPO = reqBody.order_po as string | undefined
      const retryFailed = reqBody.retry === true
      const forceReextract = reqBody.force === true

      let ordersToProcess: any[] = []

      if (forceReextract && targetPO) {
        // Force mode: re-extract even if line items already exist
        const { data: order } = await supabase
          .from('orders')
          .select('id, order_id, company, supplier')
          .eq('organization_id', organization_id)
          .eq('order_id', targetPO)
          .single()
        if (order) ordersToProcess = [order]
      } else if (retryFailed) {
        // Retry mode: clear extraction_attempted flag and re-process
        const { data } = await supabase
          .from('orders')
          .select('id, order_id, company, supplier, metadata, order_line_items(id)')
          .eq('organization_id', organization_id)
        ordersToProcess = (data || []).filter((o: any) =>
          (!o.order_line_items || o.order_line_items.length === 0)
        )
        // Clear the flag so they get processed fresh
        for (const o of ordersToProcess) {
          if (o.metadata?.extraction_attempted) {
            const newMeta = { ...o.metadata }
            delete newMeta.extraction_attempted
            await supabase.from('orders').update({ metadata: newMeta }).eq('id', o.id)
          }
        }
      } else if (targetPO) {
        // Single order mode
        const { data: order } = await supabase
          .from('orders')
          .select('id, order_id, company, supplier')
          .eq('organization_id', organization_id)
          .eq('po_number', targetPO)
          .single()
        if (order) ordersToProcess = [order]
      } else {
        // Batch mode: find orders with 0 line items via left join, skip already-attempted
        const { data } = await supabase
          .from('orders')
          .select('id, order_id, company, supplier, metadata, order_line_items(id)')
          .eq('organization_id', organization_id)
        ordersToProcess = (data || []).filter((o: any) =>
          (!o.order_line_items || o.order_line_items.length === 0) &&
          !(o.metadata?.extraction_attempted)
        )
      }

      if (ordersToProcess.length === 0) {
        setCors(res)
      return res.status(200).json({ mode: 'bulk-extract', message: targetPO ? 'Order not found' : 'All orders already have line items' })
      }

      // Set up Gmail access for attachment downloads
      let gmailAccessToken: string | null = null
      try {
        if (member.gmail_refresh_token) {
          const { data: settings } = await supabase.from('organization_settings').select('gmail_client_id').eq('organization_id', organization_id).single()
          const clientSecret = process.env.GOOGLE_CLIENT_SECRET!
          if (settings?.gmail_client_id && clientSecret) {
            gmailAccessToken = await refreshGmailToken(member.gmail_refresh_token, settings.gmail_client_id, clientSecret)
          }
        }
      } catch { /* Gmail setup failed, will skip attachment extraction */ }

      const batchLimit = batch_size || 1
      const batch = ordersToProcess.slice(0, batchLimit)
      const results: any[] = []
      let extracted = 0

      for (const order of batch) {
        try {
          // Find emails with attachments for this order (PO scans)
          const { data: emails } = await supabase
            .from('synced_emails')
            .select('id, gmail_id, subject, has_attachment, detected_stage')
            .eq('matched_order_id', order.order_id)
            .eq('organization_id', organization_id)
            .eq('has_attachment', true)
            .limit(20)

          let extractedData: any = null
          let visionDebug: any = { attempted: false }

          if (!gmailAccessToken) {
            results.push({ order: order.order_id, status: 'skip', reason: 'no Gmail access', vision: visionDebug })
            continue
          }

          // Score emails: PO stage (1) = highest, then PI (2), then by subject keywords
          const scored = (emails || []).map((e: any) => {
            let score = 0
            const subj = (e.subject || '').toLowerCase()
            if (e.detected_stage === 1) score += 100
            if (e.detected_stage === 2) score += 80
            if (subj.includes('purchase order') || subj.includes('new po')) score += 50
            if (subj.includes('proforma')) score += 40
            if (subj.includes('payment') || subj.includes('invoice')) score -= 30
            if (subj.includes('artwork') || subj.includes('label') || subj.includes('inspection')) score -= 20
            return { email: e, score }
          }).sort((a: any, b: any) => b.score - a.score)

          visionDebug.emailsWithAttach = scored.length

          const skipClassifyParam = reqBody.skip_classify === true

          // Try up to 3 emails, looking for PO scan attachments
          for (const { email: attachEmail } of scored.slice(0, 3)) {
            if (extractedData && extractedData.lineItems.length > 0) break
            if (!attachEmail.gmail_id) continue
            try {
              visionDebug.attempted = true
              visionDebug.attachGmailId = attachEmail.gmail_id
              const parts = await getAttachmentPartsForMessage(gmailAccessToken, attachEmail.gmail_id)
              visionDebug.partsCount = parts.length

              // Score all valid attachments by filename, then try each
              const isValidType = (m: string) => m.includes('pdf') || m === 'image/jpeg' || m === 'image/png'
              const isSkipImage = (n: string) => n.includes('logo') || n.includes('ean ') || n.startsWith('img (') || n.startsWith('img(') || n.includes('inspection') || n.includes('report')
              // Skip filenames that are clearly NOT purchase orders — saves CPU time
              const isObviouslyNotPO = (n: string) => {
                const lower = n.toLowerCase()
                return /\b(bl|bill of lading|packing list|container loading|boxes declaration|beneficiary|code list|ingredients|health cert|hc \d|plastic declaration|test \d|certificate|coa |fumigation|phyto|weight list|tally sheet|shipping|draft|debit note|credit note|commercial invoice|ci |insurance|manifest|mate.?s receipt|dock receipt|customs|export permit|quota|license)\b/i.test(lower)
              }
              const candidates = parts
                .filter((p: any) => {
                  const fn = (p.filename || '').toLowerCase()
                  const mt = (p.mimeType || '').toLowerCase()
                  if (!isValidType(mt)) return false
                  if (isSkipImage(fn)) return false
                  if (isObviouslyNotPO(fn)) {
                    console.log(`[BULK] Filename-skip: ${p.filename} (obviously not a PO)`)
                    return false
                  }
                  return true
                })
                .map((p: any) => ({ part: p, score: scorePOAttachment(p.filename, attachEmail.subject || '') }))
                .sort((a: any, b: any) => b.score - a.score)

              // Only try top 1 candidate to minimize CPU usage
              for (const { part: chosenPart } of candidates.slice(0, 1)) {
                if (!chosenPart.attachmentId) continue
                visionDebug.chosenPart = { name: chosenPart.filename, mime: chosenPart.mimeType }

                // Auto-skip classify when email subject clearly indicates a PO or PI
                const emailSubjUpper = (attachEmail.subject || '').toUpperCase()
                const skipClassify = skipClassifyParam || emailSubjUpper.includes('PURCHASE ORDER') || emailSubjUpper.includes('NEW PO') || emailSubjUpper.includes('PROFORMA INVOICE') || emailSubjUpper.includes('NEW PROFORMA')

                if (skipClassify) {
                  // Skip classification — download and go straight to extraction
                  console.log(`[BULK] Direct extract (skip classify): ${chosenPart.filename} [subject hint: ${emailSubjUpper.substring(0, 60)}]`)
                  let fileData = await downloadAttachment(gmailAccessToken, attachEmail.gmail_id, chosenPart.attachmentId)
                  if (!fileData) continue
                  visionDebug.downloadedSize = fileData.byteLength
                  const bytes = new Uint8Array(fileData)
                  fileData = null as any // free memory
                  let binary = ''
                  const chunkSize = 8192
                  for (let i = 0; i < bytes.length; i += chunkSize) {
                    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
                    for (let j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j])
                  }
                  let base64 = btoa(binary)
                  binary = '' // free memory
                  const mimeType = chosenPart.mimeType || 'application/pdf'
                  visionDebug.mimeType = mimeType
                  extractedData = await extractPODataFromImage(base64, mimeType, order.company || '', order.supplier || '')
                  base64 = '' // free memory
                  visionDebug.visionResult = extractedData ? extractedData.lineItems.length + ' items' : 'null'
                } else {
                  // Normal flow: classify first, then extract
                  const result = await downloadAndClassify(gmailAccessToken, attachEmail.gmail_id, chosenPart)
                  if (!result) continue
                  visionDebug.downloadedSize = result.fileData.byteLength
                  visionDebug.classification = result.classification

                  if (result.classification !== 'po' && result.classification !== 'other') {
                    console.log(`[BULK] Skipping ${chosenPart.filename} — AI classified as "${result.classification}" (not a PO)`)
                    continue
                  }

                  const mimeType = chosenPart.mimeType || 'application/pdf'
                  visionDebug.mimeType = mimeType
                  extractedData = await extractPODataFromImage(result.base64, mimeType, order.company || '', order.supplier || '')
                  result.base64 = '' // free memory
                  result.fileData = null as any // free memory
                  visionDebug.visionResult = extractedData ? extractedData.lineItems.length + ' items' : 'null'
                }
                if (extractedData && extractedData.lineItems.length > 0) break
              }
            } catch (attErr) {
              visionDebug.error = String(attErr)
            }
          }

          if (!extractedData || extractedData.lineItems.length === 0) {
            // Mark order as extraction attempted so it doesn't get retried
            await supabase.from('orders').update({ metadata: { extraction_attempted: true } }).eq('id', order.id)
            results.push({ order: order.order_id, status: 'skip', reason: 'no PO attachment found', vision: visionDebug })
            continue
          }

          const lineItemRows = extractedData.lineItems.map((item: any, idx: number) => ({
            order_id: order.id,
            product: item.product, brand: item.brand || '', size: item.size || '',
            glaze: item.glaze || '', glaze_marked: item.glazeMarked || '',
            packing: item.packing || '', freezing: item.freezing || 'IQF',
            cases: parseInt(item.cases) || 0, kilos: item.kilos || 0, price_per_kg: item.pricePerKg || 0,
            currency: item.currency || 'USD',
            total: Number(item.total) || ((item.kilos || 0) * (item.pricePerKg || 0)), sort_order: idx,
          }))

          const { error: insertErr } = await supabase.from('order_line_items').insert(lineItemRows)
          if (insertErr) { results.push({ order: order.order_id, status: 'error', reason: insertErr.message }); continue }

          const updates: any = {}
          if (extractedData.deliveryTerms) updates.delivery_terms = extractedData.deliveryTerms
          if (extractedData.payment) updates.payment_terms = extractedData.payment
          if (extractedData.commission) updates.commission = extractedData.commission
          if (extractedData.destination) updates.to_location = extractedData.destination
          if (extractedData.totalKilos > 0) updates.total_kilos = extractedData.totalKilos
          if (extractedData.totalValue > 0) updates.total_value = String(extractedData.totalValue)
          // Don't overwrite the product field — it's set by the user
          if (Object.keys(updates).length > 0) await supabase.from('orders').update(updates).eq('id', order.id)

          extracted++
          results.push({ order: order.order_id, status: 'ok', items: extractedData.lineItems.length, totalKilos: extractedData.totalKilos, totalValue: extractedData.totalValue, commission: extractedData.commission || '', destination: extractedData.destination || '', deliveryTerms: extractedData.deliveryTerms || '', source: 'attachment', _rawTail: extractedData._rawTail || '' })
        } catch (err) {
          results.push({ order: order.order_id, status: 'error', reason: String(err) })
        }
        await delay(300)
      }

      const bulkRemaining = ordersToProcess.length - batch.length
      setCors(res)
      return res.status(200).json({
        mode: 'bulk-extract', done: bulkRemaining === 0, batchProcessed: batch.length, extracted, remaining: bulkRemaining, results
      })
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
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET!
      if (!settings?.gmail_client_id || !clientSecret) throw new Error('Gmail not configured')
      const gmailAccessToken = await refreshGmailToken(member.gmail_refresh_token, settings.gmail_client_id, clientSecret)
      if (!gmailAccessToken) throw new Error('Failed to refresh Gmail token')

      // Process exactly 1 email per call to stay within free-plan CPU limit
      // Frontend auto-loops until done=true
      const { data: emails, error: fetchErr } = await supabase
        .from('synced_emails')
        .select('id, gmail_id, subject, from_name, from_email, date, has_attachment, matched_order_id, detected_stage, body_text')
        .eq('organization_id', organization_id)
        .not('matched_order_id', 'is', null)
        .eq('has_attachment', true)
        .in('detected_stage', [1, 2])
        .eq('attachment_processed', false)
        .order('date', { ascending: true })
        .limit(1)

      if (fetchErr) throw fetchErr

      // Count total remaining (including the one we're about to process)
      const { count: totalRemaining } = await supabase
        .from('synced_emails')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organization_id)
        .not('matched_order_id', 'is', null)
        .eq('has_attachment', true)
        .in('detected_stage', [1, 2])
        .eq('attachment_processed', false)

      if (!emails || emails.length === 0) {
        setCors(res)
      return res.status(200).json({ mode: 'reprocess', done: true, processed: 0, remaining: 0, message: 'All attachments processed' })
      }

      const email = emails[0]
      const { data: orders } = await supabase
        .from('orders')
        .select('id, order_id')
        .eq('organization_id', organization_id)
      const orderMap = new Map((orders || []).map((o: any) => [o.order_id, o.id]))

      const orderUuid = orderMap.get(email.matched_order_id)
      let status = 'skip'
      let error = ''

      if (orderUuid) {
        try {
          await processEmailAttachments(supabase, gmailAccessToken, email, email.matched_order_id, orderUuid, organization_id, user_id, true)
          status = 'ok'
        } catch (err) {
          status = 'error'
          error = String(err)
        }
      }

      // Mark as processed regardless of outcome to avoid infinite retries
      await supabase.from('synced_emails').update({ attachment_processed: true }).eq('id', email.id)

      const remaining = (totalRemaining || 1) - 1
      setCors(res)
      return res.status(200).json({
        mode: 'reprocess', done: remaining === 0, processed: 1, remaining,
        order: email.matched_order_id, stage: email.detected_stage, status, error: error || undefined,
      })
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
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!
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
      setCors(res)
      return res.status(200).json({ mode: syncMode, synced: 0, total: 0 })
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
      setCors(res)
      return res.status(200).json({ mode: syncMode, synced: 0, total: messageIds.length, alreadyHad: existingIds.size })
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

    setCors(res)
      return res.status(200).json({
        mode: syncMode,
        synced: storedCount,
        total: totalStored || 0,
        alreadyHad: existingIds.size,
      })
  } catch (err: any) {
    console.error('Sync error:', err)
    setCors(res)
      return res.status(400).json({ error: err.message })
  }
}