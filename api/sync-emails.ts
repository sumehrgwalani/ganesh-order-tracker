import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'


function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', 'https://ganesh-order-tracker.vercel.app')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
}

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_MAIL_API_KEY! || process.env.ANTHROPIC_API_KEY!

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

Stage 3 (Artwork in Progress): Email is about artwork, labels, or design review/approval. Subject contains "NEED APPROVAL", "NEED ARTWORK APPROVAL", "NEED LABELS APPROVAL", "REQUEST FOR ARTWORK", "label", "design", or "artwork" + PI number + PO number. These are typically back-and-forth approval chains where designs are sent, reviewed, revised, and approved. Approval phrases: "The artworks are OK", "The labels are OK", "OK, thank you", "encornet is OK". Reply phrases: "Well noted & thanks". Also includes initial artwork requests and revision emails.

Stage 4 (Artwork Confirmed): Email confirms artwork/label approval by the buyer. Keywords: "artwork approved", "artwork confirmed", "labels approved", "artworks are OK", "labels are OK", "design approved", "artwork ok". This is the final approval — distinct from the back-and-forth in Stage 3.

Stage 5 (Quality Check Done): Email contains QC/inspection results. Keywords: "quality check", "inspection report", "QC certificate", "inspection certificate", "pre-shipment inspection". Often from inspectors like Hansel Fernandez or J B Boda.

Stage 6 (Schedule Confirmed): Email confirms vessel/shipping schedule. Keywords: "vessel schedule", "booking confirmed", "ETD", "shipping schedule", "vessel booking", "container booked", "sailing schedule".

Stage 7 (Draft Documents): Email contains draft shipping documents for review. Keywords: "draft BL", "draft documents", "draft bill of lading", "documents for review", "please check documents".

Stage 8 (Final Documents): Email confirms final/original documents sent. Keywords: "final documents", "original documents", "documents sent", "originals couriered", "BL released".

Stage 9 (DHL Shipped): Email contains DHL/courier tracking info. Keywords: "DHL", "tracking number", "AWB", "airway bill", "courier tracking", "shipped via DHL", "DHL waybill".
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

// Extract all email addresses from a header like CC (can have multiple comma-separated entries)
function extractAllEmails(headerStr: string): string[] {
  if (!headerStr) return []
  const emails: string[] = []
  // Match all <email> patterns
  const angleMatches = headerStr.matchAll(/<([^>]+)>/g)
  for (const m of angleMatches) emails.push(m[1].toLowerCase())
  // If no angle brackets, try splitting by comma and trimming
  if (emails.length === 0) {
    for (const part of headerStr.split(',')) {
      const trimmed = part.trim().toLowerCase()
      if (trimmed.includes('@')) emails.push(trimmed)
    }
  }
  return emails
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
): Promise<{ lineItems: any[], deliveryTerms: string, payment: string, commission: string, destination: string, totalKilos: number, totalValue: number, supplier?: string } | null> {
  try {
    const isImage = mimeType.startsWith('image/')
    const isPdf = mimeType.includes('pdf')
    const contentBlock = isImage
      ? { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } }
      : isPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: imageBase64 } }
        : { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } }
    const prompt = `You are an expert seafood trading order parser for Ganesh International.
Extract structured purchase order data from this scanned PO document.

CRITICAL: Return ONLY valid JSON. No explanation, no markdown, no code fences.

STEP 1 - Find the SUPPLIER name:
- Look at the TOP of the document for the supplier/seller/vendor name
- It is usually the company the PO is addressed TO (not Ganesh International who is the buyer)
- Common supplier names: JJ SEAFOODS, RAUNAQ, AMULYA, J.L. INTERNATIONAL, SILVER SEAFOOD, etc.
- The supplier address block is usually on the left side, often labeled "To:" or "M/s" or just the first company name that isn't Ganesh International

STEP 2 - Scan the document for these fields (typically BELOW the product table):
1. Commission - labeled "Commission:" Examples: "10 Cents per Kg + GST", "2%", "$0.10/kg"
2. Delivery Terms - e.g. "CFR Valencia", "CIF Rotterdam", "FOB Kochi"
3. Payment Terms - e.g. "LC at 75 Days", "Sight DP", "TT Payment"
4. Destination - the port/city from delivery terms
5. Delivery/Shipment date - e.g. "Before 10/03/2026"

STEP 3 - Extract EVERY row from the product table. For each row read ALL columns carefully.

DOCUMENT FORMATS — the document may use different table layouts:

FORMAT A (explicit columns): Table has columns like Product, Size, Cases/Ctns, Qty(Kgs), Rate/Price, Amount/Total.
Read each column directly to get cases, kilos, price, and total.

FORMAT B (grouped product with size rows): A product header with packing info, followed by size rows:
  Product: Frozen Squid Whole Cleaned, IQF
  Packing: 6 x 1 Kg with 25% Glaze, Printed Bag
  Size      Quantity     Price/kg
  10/20     900          6.00
  20/40     500          4.60
Each size row is a SEPARATE line item. They all share the same product name, packing, and glaze from the header above.

AMBIGUOUS QUANTITY COLUMNS — CRITICAL:
Columns labeled "Assortment", "Quantity", "Qty", or unlabeled numeric columns can mean EITHER cartons OR kilos.
When the meaning is unclear, you MUST determine which by using this rule:
- A standard 40ft container holds 17,000–22,000 kg of frozen seafood.
- Try BOTH interpretations for the quantity column:
  Interpretation A (cartons): kilos = quantity × kg_per_case from packing (e.g. "6x1kg" = 6 kg/case)
  Interpretation B (kilos directly): kilos = quantity as-is
- Sum total kilos across ALL line items for each interpretation.
- Pick the interpretation where the grand total kilos falls closest to the 17,000–22,000 kg range.
- Example: packing is "6x1kg", quantities are 900, 500, 1500, 400 = 3,300 total
  As cartons: 3,300 × 6 = 19,800 kg (in container range) ← CORRECT
  As kilos: 3,300 kg (way too low) ← WRONG

Calculate for each line item:
- If quantity = cartons: kilos = cases × kg_per_case, total = kilos × pricePerKg
- If quantity = kilos: cases = kilos / kg_per_case (round to nearest whole number), total = kilos × pricePerKg

Known context:
- Buyer: ${orderCompany || 'Unknown'}

Return this JSON structure:
{
  "supplier": "The supplier/seller company name from the document",
  "quantityInterpretation": "cartons or kilos — which interpretation you chose and why (brief)",
  "lineItems": [
    {
      "product": "full product name, start with 'Frozen'",
      "size": "size range or empty string",
      "glaze": "glaze percentage or empty string",
      "glazeMarked": "marked/declared glaze if different, or empty string",
      "packing": "packing format or empty string",
      "brand": "brand name or empty string",
      "freezing": "'IQF', 'Semi IQF', 'Blast', 'Block', or 'Plate'. Default 'IQF'",
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
- supplier: The company this PO is sent TO (not Ganesh International). Read from document header.
- product: full product name, always start with "Frozen". Include the processing style (e.g. "Whole Cleaned", "PDTO", "Rings and Tentacles").
- cases: MUST be a number > 0. Read from Cases/Cartons/Ctns/Cajas/c/s/Assortment column.
- kilos: total weight in kg. If MT given, multiply by 1000. Derive from cases × kg_per_case if not explicit.
- pricePerKg: price per kilogram. MUST be a number > 0. Read from Rate/Price/Precio column.
- total: line total amount. MUST be a number > 0. Read from Amount/Total/Importe column. If missing, calculate as kilos × pricePerKg.
- "Cases", "Cartons", "Ctns", "c/s", "Cajas", "Assortment" can all mean carton counts — use the container sanity check above.
- freezing: 'IQF', 'Semi IQF', 'Blast', 'Block', or 'Plate'. Default 'IQF'
- currency: 'USD' or 'EUR'. Default 'USD'

Rules:
- Always prefix product names with "Frozen" if not already
- "07 MT" or "7 MT" = 7000 kg
- NEVER return 0 for cases, kilos, pricePerKg, or total — read these numbers from the document
- If you cannot read the document clearly, return empty lineItems array
- Spanish terms: calamar=Squid, sepia=Cuttlefish, pulpo=Octopus, gamba=Shrimp, cajas=Cases/Cartons
- CRITICAL: Do NOT return empty string for commission if a Commission field exists in the document.
- When a product header has multiple size rows, create one line item PER size row, all sharing the same product name, packing, and glaze.`

    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5-20251101',
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
      return { lineItems: [], deliveryTerms: '', payment: '', commission: '', destination: '', totalKilos: 0, totalValue: 0 }
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

    // --- Container sanity check ---
    // A 40ft container holds ~17,000-22,000 kg of frozen seafood.
    // If total kilos is way off, the AI likely misinterpreted cartons vs kilos.

    // Extract kg_per_case from packing (e.g. "6 x 1 Kg" = 6, "10 x 1kg" = 10, "6x2kg" = 12)
    const extractKgPerCase = (packing: string): number => {
      const m = packing.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*kg/i)
      if (m) return parseInt(m[1]) * parseFloat(m[2])
      return 0
    }

    let totalKilos = lineItems.reduce((sum: number, li: any) => sum + (li.kilos || 0), 0)
    const hasPackingInfo = lineItems.some((li: any) => extractKgPerCase(li.packing) > 0)

    // Check if kilos seem too low (AI treated carton counts as kilos)
    if (totalKilos > 0 && totalKilos < 5000 && hasPackingInfo) {
      const recalcItems = lineItems.map((li: any) => {
        const kgPerCase = extractKgPerCase(li.packing)
        if (kgPerCase > 0 && li.kilos < 5000) {
          return li.kilos * kgPerCase // treat current "kilos" as carton count
        }
        return li.kilos
      })
      const recalcTotal = recalcItems.reduce((s: number, k: number) => s + k, 0)
      if (recalcTotal >= 10000 && recalcTotal <= 30000) {
        console.log(`[PO-VISION] Container sanity check: total ${totalKilos}kg too low, recalculating as cartons → ${recalcTotal}kg`)
        lineItems.forEach((li: any) => {
          const kgPerCase = extractKgPerCase(li.packing)
          if (kgPerCase > 0 && li.kilos < 5000) {
            li.cases = li.kilos // the "kilos" were actually carton counts
            li.kilos = li.cases * kgPerCase
            li.total = li.kilos * li.pricePerKg
          }
        })
        totalKilos = lineItems.reduce((sum: number, li: any) => sum + (li.kilos || 0), 0)
      }
    }

    // Check if kilos seem too high (AI multiplied by packing when quantity was already kilos)
    if (totalKilos > 50000 && hasPackingInfo) {
      const recalcItems = lineItems.map((li: any) => {
        const kgPerCase = extractKgPerCase(li.packing)
        if (kgPerCase > 0) return li.kilos / kgPerCase
        return li.kilos
      })
      const recalcTotal = recalcItems.reduce((s: number, k: number) => s + k, 0)
      if (recalcTotal >= 10000 && recalcTotal <= 30000) {
        console.log(`[PO-VISION] Container sanity check: total ${totalKilos}kg too high, dividing by packing → ${recalcTotal}kg`)
        lineItems.forEach((li: any) => {
          const kgPerCase = extractKgPerCase(li.packing)
          if (kgPerCase > 0) {
            li.kilos = Math.round(li.kilos / kgPerCase)
            li.cases = Math.round(li.kilos / kgPerCase)
            li.total = li.kilos * li.pricePerKg
          }
        })
        totalKilos = lineItems.reduce((sum: number, li: any) => sum + (li.kilos || 0), 0)
      }
    }

    const totalValue = lineItems.reduce((sum: number, li: any) => sum + ((li.kilos || 0) * (li.pricePerKg || 0)), 0)

    let commission = String(parsed.commission || '')
    const deliveryTerms = String(parsed.deliveryTerms || '')
    const payment = String(parsed.payment || '')
    const destination = String(parsed.destination || '')

    const quantityNote = parsed.quantityInterpretation ? String(parsed.quantityInterpretation) : ''
    const supplier = String(parsed.supplier || '')
    console.log(`[PO-VISION] Final: supplier="${supplier}", totalKilos=${totalKilos}, quantityInterpretation="${quantityNote}", commission="${commission}", delivery="${deliveryTerms}", payment="${payment}", dest="${destination}"`)
    return { lineItems, deliveryTerms, payment, commission, destination, totalKilos, totalValue: Math.round(totalValue * 100) / 100, supplier }
  } catch (err) {
    console.error('PO vision extraction error:', err)
    return null
  }
}

// Classify a document using vision AI — returns classification and whether the API call actually succeeded
async function classifyDocumentWithVision(
  base64Data: string, mimeType: string
): Promise<{ classification: string; apiFailed: boolean }> {
  try {
    const isImage = mimeType.startsWith('image/')
    const isPdf = mimeType.includes('pdf')
    if (!isImage && !isPdf) return { classification: 'other', apiFailed: false }

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
- "po" if it is a Purchase Order (business document with order items, quantities, prices sent TO a supplier)
- "pi" if it is a Proforma Invoice (invoice FROM a supplier with product details, quantities, prices)
- "commission" if it is a Commission Invoice (invoice for brokerage/commission fees, mentions "commission", IGST on commission, or agent fees — NOT a product invoice)
- "artwork" if it is product packaging artwork, label designs, branding materials, box designs
- "shipping" if it is a shipping document, bill of lading, packing list
- "finaldoc" if it is a final/original trade document: code list, boxes declaration, packing list with container/seal numbers, health certificate for export, or bill of lading copy
- "certificate" if it is a certificate of analysis, quality certificate, health certificate
- "other" if none of the above
Reply with ONLY the single word classification.` }
          ]
        }],
      }),
    })

    if (!res.ok) {
      console.log(`[CLASSIFY] Vision API error: ${res.status}`)
      return { classification: 'other', apiFailed: true }
    }
    const data = await res.json()
    const raw = (data.content?.[0]?.text || '').trim().toLowerCase().replace(/[^a-z]/g, '')
    const valid = ['po', 'pi', 'commission', 'artwork', 'shipping', 'finaldoc', 'certificate', 'other']
    const classification = valid.includes(raw) ? raw : 'other'
    console.log(`[CLASSIFY] Document classified as: ${classification}`)
    return { classification, apiFailed: false }
  } catch (err) {
    console.error('[CLASSIFY] Error:', err)
    return { classification: 'other', apiFailed: true }
  }
}

// Helper: download attachment and return base64 + classification
async function downloadAndClassify(
  accessToken: string, gmailId: string, part: { filename: string; mimeType: string; attachmentId: string; size: number }
): Promise<{ fileData: ArrayBuffer; base64: string; classification: string; apiFailed: boolean } | null> {
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
  const { classification, apiFailed } = await classifyDocumentWithVision(base64, part.mimeType || 'application/pdf')
  return { fileData, base64, classification, apiFailed }
}

// Map AI document classification to order stage number
function classificationToStage(classification: string): number | null {
  switch (classification) {
    case 'po': return 1
    case 'pi': return 2
    case 'artwork': return 3
    case 'certificate': return 5
    case 'shipping': return 6
    case 'finaldoc': return 8
    default: return null  // 'other', 'commission' — don't store
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
    const existing = historyRows[0].attachments || []

    // Dedup check: skip if a file with the same name already exists on this entry
    const alreadyExists = existing.some((entry: string) => {
      try {
        const parsed = JSON.parse(entry)
        return parsed.name === filename
      } catch { return false }
    })
    if (alreadyExists) {
      console.log(`[STORE] Skipping ${filename} — already exists on stage ${stage} history`)
      return
    }

    // Append to existing attachments instead of replacing
    const updated = [...existing, attachmentEntry]
    await supabase.from('order_history').update({
      attachments: updated,
      has_attachment: true,
    }).eq('id', historyRows[0].id)
    console.log(`[STORE] Saved ${filename} to stage ${stage} history (appended to existing, now ${updated.length} files)`)
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
): Promise<{ filesStored: number; noValidParts: boolean }> {
  try {
    // 1. Get all attachment parts from the email
    const parts = await getAttachmentPartsForMessage(accessToken, email.gmail_id)
    const validParts = parts.filter((p: any) =>
      p.mimeType.includes('pdf') || p.mimeType.includes('image/jpeg') || p.mimeType.includes('image/jpg') || p.mimeType.includes('image/png')
    )
    if (validParts.length === 0) { console.log(`[PROCESS] No valid attachments in email`); return { filesStored: 0, noValidParts: true } }
    console.log(`[PROCESS] Found ${validParts.length} valid attachments for ${matchedOrderId}`)

    // Track what we found
    let poAttachment: { url: string; filename: string; base64: string; mimeType: string } | null = null
    let foundPI = false
    let filesStored = 0

    // 2. For each attachment: download, classify, upload to correct stage
    for (const part of validParts) {
      try {
        const result = await downloadAndClassify(accessToken, email.gmail_id, part)
        if (!result) { console.log(`[PROCESS] Download failed for ${part.filename}`); continue }

        let classification = result.classification

        // If AI classification failed (returned 'other' due to API error/credits),
        // fall back to the email's detected_stage so we still store the file
        if (classification === 'other' && result.apiFailed && email.detected_stage) {
          const stageToClass: Record<number, string> = { 1: 'po', 2: 'pi', 3: 'artwork', 4: 'artwork', 5: 'certificate', 6: 'shipping', 7: 'finaldoc', 8: 'finaldoc' }
          const fallback = stageToClass[email.detected_stage]
          if (fallback) {
            console.log(`[PROCESS] AI classification failed for ${part.filename}, using detected_stage ${email.detected_stage} → ${fallback}`)
            classification = fallback
          }
        }

        // Filename-based override: catch commission invoices the AI might miss
        const fnLower = (part.filename || '').toLowerCase()
        if ((fnLower.includes('commission') || fnLower.includes('brokerage')) && classification !== 'commission') {
          console.log(`[PROCESS] Overriding "${classification}" → "commission" for ${part.filename} (filename match)`)
          classification = 'commission'
        }

        // If email is Final Documents (stage 8) — detected from stored stage OR subject keywords —
        // force all attachments to finaldoc regardless of AI classification
        const subjLower = (email.subject || '').toLowerCase()
        const isFinalDocEmail = email.detected_stage === 8 ||
          subjLower.includes('original document') || subjLower.includes('original copies') ||
          subjLower.includes('final doc')
        if (isFinalDocEmail && classification !== 'commission') {
          if (classification !== 'finaldoc') {
            console.log(`[PROCESS] Overriding "${classification}" → "finaldoc" for ${part.filename} (Final Documents email: "${(email.subject || '').substring(0, 60)}")`)
            classification = 'finaldoc'
          }
        }

        const stage = classificationToStage(classification)
        if (!stage) {
          console.log(`[PROCESS] Skipping ${part.filename} — classified as "${classification}" (no stage mapping)`)
          continue
        }

        console.log(`[PROCESS] ${part.filename} → classified as "${classification}" → stage ${stage}`)

        // Upload to storage
        const publicUrl = await uploadToStorage(supabase, organizationId, matchedOrderId, part.filename, result.fileData, part.mimeType)
        if (!publicUrl) continue

        // Store in the correct stage's history entry
        await storeAttachmentInHistory(supabase, orderUuid, stage, part.filename, publicUrl)
        filesStored++

        // Track PO attachment for later data extraction
        if (classification === 'po') {
          poAttachment = { url: publicUrl, filename: part.filename, base64: result.base64, mimeType: part.mimeType }
        }
        if (classification === 'pi') {
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
        .select('company, supplier, metadata, delivery_terms, payment_terms, commission, to_location, total_kilos, total_value')
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
      // SAFETY: Never re-extract if order already has line items — prevents data loss
      if (!skipExtraction) {
        // Check if order already has line items
        const { count: existingItemCount } = await supabase.from('order_line_items')
          .select('id', { count: 'exact', head: true }).eq('order_id', orderUuid)

        if (existingItemCount && existingItemCount > 0) {
          console.log(`[PROCESS] Skipping extraction for ${matchedOrderId} — already has ${existingItemCount} line items`)
        } else {
        let extractedData: any = null
        // Try vision extraction for both images AND PDFs (not just images)
        if (poAttachment.mimeType.startsWith('image/') || poAttachment.mimeType.includes('pdf')) {
          extractedData = await extractPODataFromImage(poAttachment.base64, poAttachment.mimeType, orderRow?.company || '', orderRow?.supplier || '')
        }
        // DON'T fall back to email text extraction when we have a PO attachment.
        // Email text produces unreliable data (wrong products, missing prices).
        // Better to leave line items empty so bulk-extract can retry from the stored PDF later.
        if (!extractedData || extractedData.lineItems.length === 0) {
          console.log(`[PROCESS] Vision extraction failed for ${matchedOrderId} — skipping email text fallback (stored PDF will be retried by bulk-extract)`)
        }

        if (extractedData && extractedData.lineItems.length > 0) {
          const lineItemRows = extractedData.lineItems.map((item: any, idx: number) => ({
            order_id: orderUuid, product: item.product, brand: item.brand || '',
            size: item.size || '', glaze: item.glaze || '', glaze_marked: item.glazeMarked || '',
            packing: item.packing || '', freezing: item.freezing || 'IQF', cases: parseInt(item.cases) || 0,
            kilos: item.kilos || 0, price_per_kg: item.pricePerKg || 0,
            currency: item.currency || 'USD', total: Number(item.total) || ((item.kilos || 0) * (item.pricePerKg || 0)), sort_order: idx,
          }))
          const { error: insertErr } = await supabase.from('order_line_items').insert(lineItemRows)
          if (insertErr) console.error(`Line items insert error: ${insertErr.message}`)

          // Update order with extracted delivery/payment/totals — only fill empty fields, never overwrite
          const updates: any = {
            metadata: { ...currentMeta, extractedFromEmail: true, pdfUrl: poAttachment.url },
          }
          if (extractedData.deliveryTerms && !orderRow?.delivery_terms) updates.delivery_terms = extractedData.deliveryTerms
          if (extractedData.payment && !orderRow?.payment_terms) updates.payment_terms = extractedData.payment
          if (extractedData.commission && !orderRow?.commission) updates.commission = extractedData.commission
          if (extractedData.destination && !orderRow?.to_location) updates.to_location = extractedData.destination
          if (extractedData.totalKilos > 0 && !orderRow?.total_kilos) updates.total_kilos = extractedData.totalKilos
          if (extractedData.totalValue > 0 && !orderRow?.total_value) updates.total_value = String(Math.round(extractedData.totalValue * 100) / 100)
          // Update product from PO extraction — replaces generic keyword guesses with the real name
          if (extractedData.lineItems.length > 0) {
            const mainProduct = extractedData.lineItems[0].product
            if (mainProduct && mainProduct !== 'Unknown') {
              const genericNames = ['Unknown', 'Frozen Shrimp', 'Frozen Squid', 'Frozen Cuttlefish', 'Frozen Octopus', 'Frozen Fish']
              if (!orderRow?.product || genericNames.includes(orderRow.product)) {
                updates.product = mainProduct
                console.log(`[PROCESS] Updated product for ${matchedOrderId}: "${orderRow?.product}" → "${mainProduct}"`)
              }
            }
          }
          // Update supplier from PO extraction if currently unknown
          if (extractedData.supplier && extractedData.supplier !== 'Unknown' && extractedData.supplier !== 'Ganesh International') {
            if (!orderRow?.supplier || orderRow.supplier === 'Unknown') {
              updates.supplier = extractedData.supplier
              console.log(`[PROCESS] Updated supplier for ${matchedOrderId}: "${extractedData.supplier}"`)
            }
          }
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
          console.log(`[PROCESS] Extracted ${extractedData.lineItems.length} line items from PO`)
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

    console.log(`[PROCESS] Done processing attachments for ${matchedOrderId} — ${filesStored} files stored`)
    return { filesStored, noValidParts: false }
  } catch (err) {
    console.error('[PROCESS] Attachment processing error:', err)
    throw err  // Re-throw so caller knows it failed
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

    const supabaseUrl = process.env.SUPABASE_URL!
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
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
    // mode: 'pull' = just download emails, 'match' = AI matching batch, 'full' = legacy full sync, 'reprocess' = re-download PI/PO attachments, 'bulk-extract' = extract PO line items, 'recover' = targeted Gmail search for orders missing data
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
      // Skip dismissed emails (newsletters, non-order emails marked by user)
      const { data: unmatchedEmails, error: fetchErr } = await supabase
        .from('synced_emails')
        .select('*')
        .eq('organization_id', organization_id)
        .is('matched_order_id', null)
        .is('user_linked_order_id', null)
        .is('ai_summary', null)
        .neq('dismissed', true)
        .neq('reviewed', true)
        .order('date', { ascending: true })
        .limit(15) // Larger batches — 300s timeout allows more per call

      if (fetchErr) throw fetchErr

      // ===== AUTO-DISMISS: learn from user dismissals =====
      // If a sender has been dismissed 2+ times, auto-dismiss their future emails
      if (unmatchedEmails && unmatchedEmails.length > 0) {
        const { data: dismissedSenders } = await supabase
          .from('synced_emails')
          .select('from_email')
          .eq('organization_id', organization_id)
          .eq('dismissed', true)

        if (dismissedSenders && dismissedSenders.length > 0) {
          // Count dismissals per sender
          const dismissCount = new Map<string, number>()
          for (const d of dismissedSenders) {
            const addr = (d.from_email || '').toLowerCase()
            if (addr) dismissCount.set(addr, (dismissCount.get(addr) || 0) + 1)
          }

          // Build blocklist: senders with 2+ dismissals
          const blocklist = new Set<string>()
          for (const [addr, count] of dismissCount) {
            if (count >= 2) blocklist.add(addr)
          }

          if (blocklist.size > 0) {
            const toAutoDismiss = unmatchedEmails.filter(
              (e: any) => blocklist.has((e.from_email || '').toLowerCase())
            )
            if (toAutoDismiss.length > 0) {
              const ids = toAutoDismiss.map((e: any) => e.id)
              await supabase
                .from('synced_emails')
                .update({ dismissed: true, ai_summary: 'Auto-dismissed: sender previously dismissed multiple times' })
                .in('id', ids)
              console.log(`[AUTO-DISMISS] Dismissed ${toAutoDismiss.length} emails from blocked senders: ${[...blocklist].join(', ')}`)

              // Remove auto-dismissed from the batch
              const dismissedIds = new Set(ids)
              unmatchedEmails.splice(0, unmatchedEmails.length, ...unmatchedEmails.filter((e: any) => !dismissedIds.has(e.id)))
            }
          }
        }
      }

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
      const correctionBoosts = new Map<string, string>() // sender email → correct order_id
      try {
        const { data: corrections } = await supabase
          .from('synced_emails')
          .select('subject, from_email, user_linked_order_id, ai_original_order_id, matched_order_id')
          .eq('organization_id', organization_id)
          .not('user_linked_at', 'is', null)
          .order('user_linked_at', { ascending: false })
          .limit(15)

        if (corrections && corrections.length > 0) {
          // Collect all order IDs we need to look up (both correct and wrong ones)
          const allOrderIds = corrections.flatMap((c: any) => [c.user_linked_order_id, c.ai_original_order_id, c.matched_order_id]).filter(Boolean)
          const uniqueIds = [...new Set(allOrderIds)]
          const { data: linkedOrders } = await supabase.from('orders').select('id, order_id, company, supplier, product').in('id', uniqueIds)
          const orderMap: Record<string, any> = {}
          for (const o of linkedOrders || []) orderMap[o.id] = o

          const examples = corrections.map((c: any) => {
            const correctOrder = orderMap[c.user_linked_order_id]
            const correctLabel = correctOrder ? `${correctOrder.order_id} (${correctOrder.supplier} - ${correctOrder.product})` : c.user_linked_order_id
            const wrongId = c.ai_original_order_id || c.matched_order_id
            const wrongOrder = wrongId ? orderMap[wrongId] : null
            if (wrongOrder) {
              return `- Email from "${c.from_email}" subject "${c.subject}" → AI wrongly matched to ${wrongOrder.order_id} (${wrongOrder.supplier}), user corrected to ${correctLabel}`
            }
            return `- Email from "${c.from_email}" subject "${c.subject}" → user linked to ${correctLabel}`
          }).join('\n')
          correctionExamples = `\nRECENT USER CORRECTIONS — LEARN FROM THESE MISTAKES:\nWhen you see similar emails from the same sender, match them to the CORRECT order the user chose, NOT the wrong one.\n${examples}\n`

          // Also build sender→order correction map for pre-filter boosting
          for (const c of corrections) {
            if (c.from_email && c.user_linked_order_id) {
              const correctOrder = orderMap[c.user_linked_order_id]
              if (correctOrder) {
                correctionBoosts.set(c.from_email.toLowerCase(), correctOrder.id)
              }
            }
          }
        }
      } catch (err) { console.error('Failed to fetch corrections:', err) }

      // If no orders exist yet, try regex discovery first (scan ALL emails for PO numbers)
      let createdOrderCount = 0
      if (ordersList.length === 0) {
        console.log('No orders found — trying regex discovery first...')
        // Scan ALL emails (not just the 5-email batch) for PO numbers
        const { data: allEmails } = await supabase
          .from('synced_emails')
          .select('id, subject, body_text, from_email, from_name')
          .eq('organization_id', organization_id)
          .limit(500)

        const discoveredPOs = new Map<string, { subject: string, from_name: string, from_email: string }>()
        const poPatterns = [
          /PO\s*(?:GI\/PO\/\d{2}-\d{2}\/)?(3\d{3})/gi,
          /GI\/PO\/\d{2}-\d{2}\/(3\d{3})/gi,
          /(?:purchase\s+order|PO)\s*#?\s*(3\d{3})/gi,
          /(3\d{3})\s*(?:eguillem|guillem|label|artwork)/gi,
        ]
        // Collect ALL emails per PO (not just the first match)
        const discoveredPOEmails = new Map<string, any[]>()
        for (const email of (allEmails || [])) {
          const searchText = `${email.subject || ''} ${(email.body_text || '').substring(0, 2000)}`
          for (const pattern of poPatterns) {
            let match
            while ((match = pattern.exec(searchText)) !== null) {
              const shortPO = match[1]
              if (!discoveredPOs.has(shortPO)) {
                discoveredPOs.set(shortPO, { subject: email.subject || '', from_name: email.from_name || '', from_email: email.from_email || '' })
              }
              if (!discoveredPOEmails.has(shortPO)) discoveredPOEmails.set(shortPO, [])
              const emailList = discoveredPOEmails.get(shortPO)!
              if (!emailList.some((e: any) => e.id === email.id)) emailList.push(email)
            }
          }
        }

        if (discoveredPOs.size > 0) {
          console.log(`[REGEX DISCOVERY] Found ${discoveredPOs.size} unique PO numbers in emails`)
          for (const [shortPO, ref] of discoveredPOs) {
            const fullPO = `GI/PO/25-26/${shortPO}`
            const emails = discoveredPOEmails.get(shortPO) || []
            // Guess company from sender
            const company = ref.from_name || ref.from_email?.split('@')[1]?.split('.')[0] || 'Unknown'

            // Extract supplier from email subjects (same logic as email_sync_auto)
            let supplier = 'Unknown'
            for (const e of emails) {
              const subj = e.subject || ''
              const m1 = subj.match(/PO\s*\d{4}\s*[-–]\s*(.+?)(?:\s*$)/i)
              if (m1 && m1[1].trim() !== `PO ${shortPO}`) { supplier = m1[1].trim(); break }
              // Pattern 2: Extract supplier between last two dashes before "PO"
              const m2 = subj.match(/[-–]\s*([A-Za-z][A-Za-z\s.&]+?)\s*[-–]\s*PO\s*\d{4}/i)
              if (m2 && m2[1].trim().length > 1 && !m2[1].trim().match(/^PI\b/i)) { supplier = m2[1].trim(); break }
              // Pattern 3: More flexible "COMPANY NAME - PO 3053"
              const m3 = subj.match(/[-–]\s*([A-Za-z][A-Za-z\s.&]{2,}?)\s*[-–]?\s*PO\s*\d{4}/i)
              if (m3 && m3[1].trim().length > 2 && !m3[1].trim().match(/^(?:PI|PO|NEW|RE)\b/i)) { supplier = m3[1].trim(); break }
            }

            // Extract product from email text using keyword scanning
            let product = 'Unknown'
            const allEmailText = emails.map((e: any) => `${e.subject || ''} ${(e.body_text || '').substring(0, 1000)}`).join(' ').toUpperCase()
            if (allEmailText.includes('SHRIMP') || allEmailText.includes('VANNAMEI') || allEmailText.includes('PDTO')) product = 'Frozen Shrimp'
            else if (allEmailText.includes('SQUID') || allEmailText.includes('CALAMAR') || allEmailText.includes('POTA')) product = 'Frozen Squid'
            else if (allEmailText.includes('CUTTLEFISH') || allEmailText.includes('SEPIA')) product = 'Frozen Cuttlefish'
            else if (allEmailText.includes('OCTOPUS') || allEmailText.includes('PULPO')) product = 'Frozen Octopus'
            else if (allEmailText.includes('FISH') || allEmailText.includes('SURIMI')) product = 'Frozen Fish'

            // Detect highest stage from all emails
            let highestStage = 1
            for (const e of emails) {
              const detected = detectStageFromSubject(e.subject, e.body_text)
              if (detected) highestStage = Math.max(highestStage, detected)
            }

            // AI fallback: if supplier or product still Unknown, use Haiku to extract
            if ((supplier === 'Unknown' || product === 'Unknown') && ANTHROPIC_API_KEY) {
              try {
                const emailSummary = emails.slice(0, 5).map((e: any) =>
                  `From: ${e.from_name} <${e.from_email}>\nSubject: ${e.subject}\nBody: ${(e.body_text || '').substring(0, 1500)}`
                ).join('\n---\n')
                const aiExtractRes = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
                  body: JSON.stringify({
                    model: 'claude-haiku-3-20240307',
                    max_tokens: 300,
                    messages: [{ role: 'user', content: `These emails are about frozen seafood order GI/PO/25-26/${shortPO} for Ganesh International (India-based trading company).
Extract:
- supplier: The supplier/factory name (NOT Ganesh International, NOT the buyer). Look at sender names, email signatures, and body text.
- product: The main seafood product (e.g. "Frozen Squid", "Frozen Shrimp"). Look for words like squid, shrimp, calamar, pota, sepia, cuttlefish, octopus, fish, vannamei, surimi, PDTO etc.

EMAILS:
${emailSummary}

Return ONLY valid JSON: {"supplier": "...", "product": "..."}
If truly unknown, return "Unknown" for that field.` }],
                  }),
                })
                if (aiExtractRes.ok) {
                  const aiData = await aiExtractRes.json()
                  const aiText = aiData.content?.[0]?.text || '{}'
                  const jsonM = aiText.match(/\{[\s\S]*\}/)
                  if (jsonM) {
                    const extracted = JSON.parse(jsonM[0])
                    if (supplier === 'Unknown' && extracted.supplier && extracted.supplier !== 'Unknown' && extracted.supplier !== 'Ganesh International') {
                      supplier = extracted.supplier
                      console.log(`[REGEX DISCOVERY AI] Supplier for GI/PO/25-26/${shortPO}: "${supplier}"`)
                    }
                    if (product === 'Unknown' && extracted.product && extracted.product !== 'Unknown') {
                      product = extracted.product
                      console.log(`[REGEX DISCOVERY AI] Product for GI/PO/25-26/${shortPO}: "${product}"`)
                    }
                  }
                }
              } catch (aiErr: any) {
                console.log(`[REGEX DISCOVERY AI] Failed for ${shortPO}: ${aiErr.message}`)
              }
            }

            const { data: newOrder, error: createErr } = await supabase.from('orders').insert({
              organization_id,
              order_id: fullPO,
              po_number: fullPO,
              company,
              supplier,
              product,
              current_stage: highestStage,
              status: 'sent',
              order_date: new Date().toISOString().split('T')[0],
              metadata: { created_by: 'regex_discovery', needsReview: true },
            }).select('id').single()

            if (!createErr && newOrder) {
              createdOrderCount++
              ordersList.push({ uuid: newOrder.id, id: fullPO, company, supplier, product, currentStage: highestStage, skippedStages: [] })

              // Log each email in order history with real details
              for (const e of emails) {
                const emailStage = detectStageFromSubject(e.subject, e.body_text)
                // Link email to the new order
                await supabase.from('synced_emails').update({
                  matched_order_id: fullPO,
                  ai_summary: `Matched to order ${fullPO} via regex discovery`,
                  detected_stage: emailStage || highestStage,
                }).eq('id', e.id)

                await insertHistoryIfNew({
                  order_id: newOrder.id,
                  organization_id,
                  stage: emailStage || highestStage,
                  timestamp: e.date || new Date().toISOString(),
                  from_address: e.from_name ? `${e.from_name} <${e.from_email}>` : e.from_email || 'Unknown',
                  subject: e.subject || 'No subject',
                  body: (e.body_text || '').substring(0, 5000),
                  has_attachment: e.has_attachment || false,
                })
              }
              console.log(`[REGEX DISCOVERY] Created order ${fullPO} — supplier: ${supplier}, product: ${product}, stage: ${highestStage}`)
            }
          }
          console.log(`[REGEX DISCOVERY] Created ${createdOrderCount} orders`)
        }
      }

      // If still no orders after regex discovery, try AI discovery
      if (ordersList.length === 0) {
        console.log('No orders found — running AI discovery from emails...')

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
- product: The MAIN seafood product being traded (e.g. "Frozen Squid", "Frozen Shrimp", "Frozen Cuttlefish"). Look in email subjects, body text, PI references, and attachment names for product mentions like "squid", "shrimp", "cuttlefish", "octopus", "fish", "calamar", "pota", "sepia" etc. If the subject says something like "CALAMAR TROCEADO" that means squid. Use a short, clean English product name. NEVER return "Unknown" — if truly unclear, use the best guess from any product-related words in the emails.
- from_location: Where goods ship FROM
- highest_stage: The HIGHEST stage this order has reached based on ALL email evidence (1-9)
- skipped_stages: Array of stage numbers that were SKIPPED (no email evidence found for them). For example, if an order went from stage 1 directly to stage 3 with no evidence of stage 2, skipped_stages would be [2].
- stage_reasoning: Brief explanation

STAGE DEFINITIONS:
${STAGE_TRIGGERS}

Stage 1 = Order Confirmed (PO exists/was sent)
Stage 9 = DHL Shipped (DHL tracking number shared)

IMPORTANT RULES FOR SKIPPED STAGES:
- It's common for some stages to be skipped or happen without email evidence
- If you see evidence of stage 6 but nothing for stages 3-5, set highest_stage to 6 and skipped_stages to [3, 4, 5]
- The order should be set to the HIGHEST confirmed stage, not limited to sequential advancement
- Only include stages as "skipped" if they are BETWEEN stage 1 and the highest_stage

RULES:
- Only include orders where you found a clear PO number or order reference
- Be PRECISE with company names — similar names are DIFFERENT entities
- Every field MUST be filled with real data from the emails
- Each order should appear only once (deduplicate by PO number)
- Ganesh International is usually the INTERMEDIARY trading company — the buyer is the end client (e.g. Pescados E. Guillem S.L.) and the supplier is the factory/producer (e.g. JJ Seafood, Premier Exports)
- For the "product" field: look at email subjects, bodies, and attachment filenames for seafood product names. Common patterns: "CALAMAR" = Squid, "POTA" = Flying Squid, "SEPIA" = Cuttlefish, "GAMBA" = Shrimp. Combine with processing type if clear (e.g. "Frozen Squid Rings", "Frozen Baby Squid")
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

      // Helper: detect order stage from email subject keywords
      // Ordered from most specific to most generic to avoid false matches
      const detectStageFromSubject = (subject: string | null, bodyText?: string | null): number | null => {
        const s = (subject || '').toLowerCase()
        const b = (bodyText || '').substring(0, 2000).toLowerCase()
        // Stage 8 — check BEFORE stage 7 (otherwise "final document" matches "document" at stage 7)
        if (s.includes('final doc') || s.includes('original document') || s.includes('telex')) return 8
        // Stage 7 — draft documents
        if (s.includes('draft') || s.includes('bl ') || s.includes('bill of lading')) return 7
        // Stage 9 — courier/tracking
        if (s.includes('dhl') || s.includes('courier') || s.includes('tracking')) return 9
        // Specific invoice types that are NOT proforma
        if (s.includes('commercial invoice')) return 7
        if (s.includes('freight invoice') || s.includes('shipping invoice')) return 6
        // Stage 2 — proforma invoice (check subject AND body for PI references)
        if (s.includes('proforma') || s.includes('pi ') || s.includes('pi-')) return 2
        if (b.includes('attached p.i') || b.includes('attach pi') || b.includes('proforma') || /\bp\.i[\s\.]/i.test(b) || /\bpi\s+\w{2,}[\-\/]\d/i.test(b)) return 2
        // Stage 1 — purchase order
        if (s.includes('purchase order') || s.includes('new po') || s.includes('new purchase')) return 1
        // Stage 4 — artwork confirmed (approval keywords — check before general artwork)
        if (s.includes('artwork approved') || s.includes('artwork confirmed') || s.includes('labels approved') || s.includes('design approved')) return 4
        // Stage 3 — artwork in progress (designs, labels, approval)
        if (s.includes('artwork') || s.includes('label') || s.includes('design')) return 3
        // Stage 5 — quality
        if (s.includes('quality') || s.includes('inspection')) return 5
        // Stage 6 — shipping schedule
        if (s.includes('schedule') || s.includes('vessel') || s.includes('shipment')) return 6
        // Stage 7 — generic "document" (last resort, after all specific doc types checked)
        if (s.includes('document')) return 7
        // Bare "invoice" as last resort — most likely proforma in this business
        if (s.includes('invoice')) return 2
        return null
      }

      // AI-based stage detection: send a batch of emails to AI to determine their stage
      // Much more accurate than keyword matching — reads the full email context
      const detectStagesWithAI = async (emailsToDetect: { id: string, subject: string, body_text: string, from_name: string, has_attachment: boolean }[]): Promise<Map<string, number>> => {
        const stageMap = new Map<string, number>()
        if (emailsToDetect.length === 0) return stageMap

        const stagePrompt = `You are classifying emails for a frozen seafood trading company (Ganesh International). For each email, determine what STAGE of the trade process it represents.

${STAGE_TRIGGERS}

IMPORTANT: Look at the FULL email content (subject AND body), not just the subject. Suppliers often reply with "Re: NEW PO..." but the body is about something completely different like a PI, artwork, or shipping docs.

EMAILS:
${emailsToDetect.map((e, i) => `
EMAIL #${i + 1} (ID: "${e.id}"):
From: ${e.from_name}
Subject: ${e.subject}
Has Attachment: ${e.has_attachment}
Body (first 1500 chars): ${(e.body_text || '').substring(0, 1500)}
`).join('\n')}

Return VALID JSON only, no markdown. One result per email:
[{ "id": "EMAIL_ID", "stage": 2, "reason": "brief reason" }]`

        try {
          const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-haiku-3-20240307',
              max_tokens: 1000,
              messages: [{ role: 'user', content: stagePrompt }],
            }),
          })
          if (res.ok) {
            const data = await res.json()
            const text = data.content?.[0]?.text || '[]'
            const jsonMatch = text.match(/\[[\s\S]*\]/)
            const results = jsonMatch ? JSON.parse(jsonMatch[0]) : []
            for (const r of results) {
              if (r.id && r.stage) stageMap.set(r.id, r.stage)
            }
            console.log(`[AI STAGE] Detected stages for ${stageMap.size}/${emailsToDetect.length} emails`)
          }
        } catch (err) {
          console.error('[AI STAGE] Error:', err)
        }
        return stageMap
      }

      // Helper: insert order_history entry only if a duplicate doesn't already exist.
      // Checks for matching order_id + subject + timestamp to prevent the same email
      // being logged multiple times across sync runs.
      const insertHistoryIfNew = async (entry: {
        organization_id: string, order_id: string, stage: number | null,
        from_address: string, subject: string, body: string,
        timestamp: string, has_attachment?: boolean, attachments?: string[]
      }) => {
        // Check for existing entry with same order + subject + timestamp
        const { count } = await supabase.from('order_history')
          .select('id', { count: 'exact', head: true })
          .eq('order_id', entry.order_id)
          .eq('subject', entry.subject)
          .eq('timestamp', entry.timestamp)
        if (count && count > 0) {
          return // duplicate — skip
        }
        await supabase.from('order_history').insert(entry)
      }

      // ===== THREAD-BASED MATCHING =====
      // If another email in the same Gmail thread is already matched, link this one to the same order.
      let threadMatchCount = 0
      const threadMatched: any[] = []
      const afterThreadMatch: any[] = []

      for (const email of unmatchedEmails) {
        if (!email.thread_id) { afterThreadMatch.push(email); continue }

        // Find any email in the same thread that's already matched to an order
        const { data: threadSibling } = await supabase
          .from('synced_emails')
          .select('matched_order_id, detected_stage')
          .eq('organization_id', organization_id)
          .eq('thread_id', email.thread_id)
          .not('matched_order_id', 'is', null)
          .limit(1)
          .maybeSingle()

        if (threadSibling?.matched_order_id) {
          // Stage will be detected by AI later — use keyword as temporary placeholder
          const keywordStage = detectStageFromSubject(email.subject, email.body_text) || threadSibling.detected_stage
          await supabase
            .from('synced_emails')
            .update({
              matched_order_id: threadSibling.matched_order_id,
              detected_stage: keywordStage,
              ai_summary: `Auto-matched by email thread (same conversation as a matched email)`,
            })
            .eq('id', email.id)

          threadMatchCount++
          threadMatched.push({ email, orderId: threadSibling.matched_order_id, stage: keywordStage })
        } else {
          afterThreadMatch.push(email)
        }
      }

      if (threadMatchCount > 0) {
        console.log(`[THREAD] Auto-matched ${threadMatchCount} emails by conversation thread`)
      }

      // NOTE: Thread-matched email processing is deferred until after AI stage detection (below regex matching)

      // Continue with remaining unmatched emails (thread matching didn't catch them)
      const unmatchedAfterThread = afterThreadMatch

      // ===== PRE-AI REGEX MATCHING =====
      // Match emails by PO number BEFORE calling AI. Runs on ALL unprocessed emails (not just the 5-email batch)
      // AND re-checks previously AI-processed-but-unmatched emails that now have matching orders.
      const regexMatched: any[] = []
      const needsAI: any[] = []

      // Build a lookup map: PO short number -> full order
      const poLookup = new Map<string, any>()
      for (const order of ordersList) {
        const shortMatch = order.id.match(/(\d{4})$/)
        if (shortMatch) {
          poLookup.set(shortMatch[1], order)
        }
        poLookup.set(order.id, order)
      }

      // Helper: try to regex-match a single email to an order
      const tryRegexMatch = (email: any): any | null => {
        const searchText = `${email.subject || ''} ${(email.body_text || '').substring(0, 2000)}`
        const poPatterns = [
          /PO\s*(?:GI\/PO\/\d{2}-\d{2}\/)?(3\d{3})/gi,
          /GI\/PO\/\d{2}-\d{2}\/(3\d{3})/gi,
          /(?:purchase\s+order|PO)\s*#?\s*(3\d{3})/gi,
          /(3\d{3})\s*(?:eguillem|guillem|label|artwork)/gi,  // "3034eguillem-label389"
        ]
        for (const pattern of poPatterns) {
          let match
          while ((match = pattern.exec(searchText)) !== null) {
            if (poLookup.has(match[1])) return poLookup.get(match[1])
          }
        }
        return null
      }

      // PASS 1: Re-check previously unmatched emails (have ai_summary but no matched_order_id)
      // These were processed by AI earlier but the order didn't exist yet at that time
      let regexMatchCount = 0
      if (ordersList.length > 0) {
        const { data: prevUnmatched } = await supabase
          .from('synced_emails')
          .select('id, subject, body_text, from_email, from_name, date, has_attachment')
          .eq('organization_id', organization_id)
          .is('matched_order_id', null)
          .is('user_linked_order_id', null)
          .not('ai_summary', 'is', null)
          .limit(500)

        if (prevUnmatched && prevUnmatched.length > 0) {
          for (const email of prevUnmatched) {
            const order = tryRegexMatch(email)
            if (order) {
              const detectedStage = detectStageFromSubject(email.subject, email.body_text)

              await supabase.from('synced_emails').update({
                matched_order_id: order.id,
                detected_stage: detectedStage,
                ai_summary: `Auto-matched by PO number (re-scan)`,
              }).eq('id', email.id)

              // Create order_history entry so email shows on order detail page (dedup check)
              await insertHistoryIfNew({
                organization_id,
                order_id: order.uuid,
                stage: detectedStage || 1,
                from_address: email.from_name ? `${email.from_name} <${email.from_email}>` : email.from_email || 'Unknown',
                subject: email.subject || 'No subject',
                body: (email.body_text || '').substring(0, 5000),
                timestamp: email.date || new Date().toISOString(),
                has_attachment: email.has_attachment || false,
              })

              regexMatchCount++
            }
          }
          if (regexMatchCount > 0) {
            console.log(`[REGEX PASS 1] Re-matched ${regexMatchCount} previously unmatched emails (with history entries)`)
          }
        }
      }

      // PASS 2: Regex-match the current batch of unprocessed emails (after thread matching)
      for (const email of unmatchedAfterThread) {
        const order = tryRegexMatch(email)
        if (order) {
          regexMatched.push({ email, order })
        } else {
          needsAI.push(email)
        }
      }

      // Use AI to detect stages for regex-matched and thread-matched emails (much more accurate than keywords)
      const allNonAIMatched = [
        ...regexMatched.map(r => r.email),
        ...threadMatched.map(t => t.email),
      ]
      const aiStageMap = await detectStagesWithAI(allNonAIMatched)

      // Process regex-matched emails from Pass 2 (current batch)
      for (const { email, order } of regexMatched) {
        const summary = `Auto-matched by PO number in email subject/body`
        // Use AI-detected stage, fall back to keyword detection
        const detectedStage = aiStageMap.get(email.id) || detectStageFromSubject(email.subject, email.body_text)

        await supabase
          .from('synced_emails')
          .update({
            matched_order_id: order.id,
            detected_stage: detectedStage,
            ai_summary: summary,
          })
          .eq('id', email.id)

        regexMatchCount++

        // Advance order stage if needed
        if (detectedStage && detectedStage > order.currentStage) {
          const newSkipped = [...(order.skippedStages || [])]
          for (let s = order.currentStage + 1; s < detectedStage; s++) {
            if (!newSkipped.includes(s)) newSkipped.push(s)
          }
          await supabase
            .from('orders')
            .update({ current_stage: detectedStage, skipped_stages: newSkipped })
            .eq('order_id', order.id)
            .eq('organization_id', organization_id)
          order.currentStage = detectedStage
          order.skippedStages = newSkipped
        }

        // Create order_history entry so email shows on order detail page (dedup check)
        await insertHistoryIfNew({
          organization_id,
          order_id: order.uuid,
          stage: detectedStage || 1,
          from_address: email.from_name ? `${email.from_name} <${email.from_email}>` : email.from_email || 'Unknown',
          subject: email.subject || 'No subject',
          body: (email.body_text || '').substring(0, 5000),
          timestamp: email.date || new Date().toISOString(),
          has_attachment: email.has_attachment || false,
        })
      }

      // Process thread-matched emails (now with AI-detected stages)
      for (const { email, orderId, stage: keywordStage } of threadMatched) {
        const stage = aiStageMap.get(email.id) || keywordStage
        // Update stored stage if AI detected something different from keyword
        if (aiStageMap.has(email.id) && aiStageMap.get(email.id) !== keywordStage) {
          await supabase.from('synced_emails').update({ detected_stage: stage }).eq('id', email.id)
        }
        const order = ordersList.find((o: any) => o.id === orderId)
        if (order && stage && stage > order.currentStage) {
          const skipped: number[] = []
          for (let s = order.currentStage + 1; s < stage; s++) {
            if (!order.skippedStages.includes(s)) skipped.push(s)
          }
          await supabase
            .from('orders')
            .update({ current_stage: stage, skipped_stages: [...order.skippedStages, ...skipped] })
            .eq('order_id', orderId)
            .eq('organization_id', organization_id)
          order.currentStage = stage
          order.skippedStages = [...order.skippedStages, ...skipped]
        }
        await insertHistoryIfNew({
          order_id: order?.uuid,
          organization_id,
          stage: stage || order?.currentStage || 1,
          timestamp: email.date ? new Date(email.date).toISOString() : new Date().toISOString(),
          from_address: email.from_name ? `${email.from_name} <${email.from_email}>` : email.from_email || 'Unknown',
          subject: email.subject,
          body: (email.body_text || '').substring(0, 2000),
          has_attachment: email.has_attachment || false,
          created_at: new Date().toISOString(),
        })
      }

      if (regexMatchCount > 0) {
        console.log(`[REGEX] Pre-AI matched ${regexMatchCount} emails by PO number`)
      }

      // If ALL emails were regex-matched, skip AI entirely
      if (needsAI.length === 0) {
        const { count: totalCount } = await supabase.from('synced_emails').select('id', { count: 'exact', head: true }).eq('organization_id', organization_id)
        const { count: matchedTotal } = await supabase.from('synced_emails').select('id', { count: 'exact', head: true }).eq('organization_id', organization_id).not('matched_order_id', 'is', null)
        const { count: remaining } = await supabase.from('synced_emails').select('id', { count: 'exact', head: true }).eq('organization_id', organization_id).is('matched_order_id', null).is('user_linked_order_id', null).is('ai_summary', null).neq('dismissed', true).neq('reviewed', true)
        setCors(res)
        return res.status(200).json({
          mode: 'match', done: (remaining || 0) === 0, matched: regexMatchCount, created: createdOrderCount,
          remaining: remaining || 0, totalEmails: totalCount || 0, totalMatched: matchedTotal || 0,
          message: `Regex matched ${regexMatchCount} emails by PO number`,
        })
      }

      // Replace unmatchedEmails with only those that need AI
      // (needsAI already has the right emails, use them for the AI prompt below)
      const aiEmails = needsAI

      // --- Pre-filter: narrow candidate orders per email batch ---
      // Extract PO fragments, supplier/company names, and CC email addresses from emails,
      // then only send the most relevant orders to the AI (saves tokens, improves accuracy)

      // Build a map of contact email → company name for CC-based matching
      const { data: contactRows } = await supabase
        .from('contacts')
        .select('email, name, company')
        .eq('organization_id', organization_id)
      const emailToCompany = new Map<string, string>()
      for (const c of contactRows || []) {
        if (c.email && c.company) emailToCompany.set(c.email.toLowerCase(), c.company.toLowerCase())
        if (c.email && c.name) emailToCompany.set(c.email.toLowerCase(), c.name.toLowerCase())
      }

      const candidateIds = new Set<string>()
      for (const email of aiEmails) {
        const haystack = `${email.subject || ''} ${(email.body_text || '').substring(0, 4000)} ${email.from_name || ''} ${email.from_email || ''}`.toLowerCase()

        // Collect company/supplier names from ALL email addresses (To first priority, then From, then CC) via contacts
        const emailAddresses = [...(email.to_email || '').split(',').map((e: string) => e.trim()), email.from_email, ...(email.cc_emails || '').split(',').map((e: string) => e.trim())].filter(Boolean)
        const contactCompanies = new Set<string>()
        for (const addr of emailAddresses) {
          const company = emailToCompany.get(addr.toLowerCase())
          if (company) contactCompanies.add(company)
        }

        // Boost: if user has previously corrected emails from this sender, include that order
        for (const addr of emailAddresses) {
          const boostedOrderId = correctionBoosts.get(addr.toLowerCase())
          if (boostedOrderId) {
            candidateIds.add(boostedOrderId)
            console.log(`[CORRECTION BOOST] Sender ${addr} → boosting order ${boostedOrderId} based on past user correction`)
          }
        }

        for (const order of ordersList) {
          // Check PO number fragments (e.g. "GI/PO/2024-045" → match on "2024-045", "045", or full PO)
          const poId = (order.id || '').toLowerCase()
          if (poId && haystack.includes(poId)) { candidateIds.add(order.id); continue }
          // Try the numeric tail (e.g. "045" from "GI/PO/2024-045")
          const poTail = poId.split(/[\/\-]/).pop() || ''
          if (poTail.length >= 3 && haystack.includes(poTail)) { candidateIds.add(order.id); continue }

          // Check if any CC'd/From contact matches this order's supplier or company
          const supplier = (order.supplier || '').toLowerCase()
          const company = (order.company || '').toLowerCase()
          for (const contactCo of contactCompanies) {
            if (supplier && (contactCo.includes(supplier) || supplier.includes(contactCo))) { candidateIds.add(order.id); break }
            if (company && (contactCo.includes(company) || company.includes(contactCo))) { candidateIds.add(order.id); break }
          }
          if (candidateIds.has(order.id)) continue

          // Check supplier name in email text
          if (supplier && supplier.length > 3 && haystack.includes(supplier)) { candidateIds.add(order.id); continue }

          // Check company/buyer name in email text
          if (company && company.length > 3 && haystack.includes(company)) { candidateIds.add(order.id); continue }

          // Check product name in email text
          const product = (order.product || '').toLowerCase()
          if (product && product.length > 4 && product !== 'unknown' && haystack.includes(product)) { candidateIds.add(order.id); continue }
        }
      }

      // Use filtered list if we found candidates, otherwise fall back to all orders
      let filteredOrders = ordersList
      if (candidateIds.size > 0 && candidateIds.size < ordersList.length) {
        filteredOrders = ordersList.filter((o: any) => candidateIds.has(o.id))
        // Always include at least a few extra recent orders as context (in case pre-filter missed something)
        const extras = ordersList.filter((o: any) => !candidateIds.has(o.id)).slice(0, 5)
        filteredOrders = [...filteredOrders, ...extras]
        console.log(`[AI PRE-FILTER] Narrowed ${ordersList.length} orders → ${filteredOrders.length} candidates for AI matching`)
      }

      const aiPrompt = `You are an AI assistant for a frozen seafood trading company called Ganesh International. Match each email below to an existing purchase order.
${catalogSection}
ACTIVE ORDERS:
${JSON.stringify(filteredOrders, null, 2)}

STAGE DEFINITIONS:
${STAGE_TRIGGERS}
${correctionExamples}
EMAILS TO MATCH:
${aiEmails.map((e: any, i: number) => `
=== EMAIL #${i + 1} ===
GMAIL_ID: "${e.gmail_id}"
From: ${e.from_name} <${e.from_email}>
To: ${e.to_email}
CC: ${e.cc_emails || 'none'}
Subject: ${e.subject}
Date: ${e.date}
Has Attachment: ${e.has_attachment}
Body (first 4000 chars): ${(e.body_text || '').substring(0, 4000)}
=== END EMAIL #${i + 1} ===
`).join('\n')}

INSTRUCTIONS — Process each email ONE AT A TIME:
For each email above, determine:
1. Which order it matches (by PO number, company, supplier, or product references in the email body/subject/CC addresses). CC addresses often belong to the supplier — match them to orders with that supplier. Use the order "id" field (PO number like "GI/PO/...").
2. What stage this email represents (the stage the email is evidence of).
3. A brief summary of what THIS specific email is about. The summary MUST describe the actual content of THIS email — its subject and body — not any other email.
4. If the matched order has product "Unknown", extract the product name from this email (look in subject, body, attachment names for seafood names like squid, shrimp, cuttlefish, calamar, pota, sepia etc). Return it as "product" field. If order already has a real product name or you can't find one, omit this field.
5. Your CONFIDENCE in the match: "high", "medium", or "low".
   - "high" = PO number found in email, or supplier + product clearly match a specific order
   - "medium" = supplier or company name matches but no PO number, or multiple orders could fit
   - "low" = weak match based on vague keywords, product type only, or best guess

ACCURACY RULES — READ CAREFULLY:
- You MUST copy the GMAIL_ID exactly from each email header above. Do NOT swap or mix up IDs between emails.
- The "summary" field must describe the content of the email with THAT gmail_id — not any other email.
- Process each email independently. Do not let information from one email bleed into another.
- If an email is about banking, compliance, or non-trade matters, set matched_order_id to null.
- If no order matches, set matched_order_id to null.
- If no stage is detected, set detected_stage to null.
- Be HONEST about confidence. Do NOT say "high" unless you are very sure.

STAGE RULES:
- detected_stage is the stage this email provides EVIDENCE for — it can be ANY stage, not just current+1.
- Sometimes steps get skipped in real trade — that's OK.

Return VALID JSON only, no markdown fences. Return exactly ${aiEmails.length} results, one per email, in the same order:
[{ "gmail_id": "EXACT_ID_FROM_ABOVE", "matched_order_id": "PO-NUMBER or null", "detected_stage": 3 or null, "confidence": "high|medium|low", "summary": "What THIS specific email is about", "product": "Product name if order has Unknown product, omit otherwise" }]`

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
      const validGmailIds = new Set(aiEmails.map((e: any) => e.gmail_id))
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

      // Build set of existing order IDs for validation
      const existingOrderIdSet = new Set(ordersList.map((o: any) => o.id))

      for (const email of aiEmails) {
        const ai = aiMap.get(email.gmail_id) || {}
        let matchedOrderId = ai.matched_order_id || null
        const detectedStage = ai.detected_stage || null
        const summary = ai.summary || null
        const aiProduct = ai.product || null
        const confidence = (ai.confidence || 'medium').toLowerCase()

        // Validate: if AI returned an order ID that doesn't exist, don't set it
        // This lets Pass 4 (auto-create orders) handle creating the order instead
        if (matchedOrderId && !existingOrderIdSet.has(matchedOrderId)) {
          console.log(`[AI MATCH] AI returned non-existent order "${matchedOrderId}" for email "${email.subject}" — clearing match so auto-create can handle it`)
          matchedOrderId = null
          // Also clear in the aiMap so Pass 4 doesn't skip this email
          if (ai) ai.matched_order_id = null
        }

        if (!matchedOrderId) {
          // Still save the AI summary so this email won't be re-processed
          await supabase
            .from('synced_emails')
            .update({ ai_summary: summary || 'No order match found', ai_confidence: confidence })
            .eq('id', email.id)
          continue
        }

        // LOW confidence: don't link, just suggest — user must approve
        if (confidence === 'low') {
          console.log(`[AI MATCH] Low confidence for "${email.subject}" → ${matchedOrderId} — saving as suggestion`)
          await supabase
            .from('synced_emails')
            .update({
              ai_suggested_order_id: matchedOrderId,
              detected_stage: detectedStage,
              ai_summary: `[Low confidence] ${summary || ''}`,
              ai_confidence: 'low',
            })
            .eq('id', email.id)
          continue
        }

        // MEDIUM confidence: link but don't auto-advance stage
        // HIGH confidence: link and auto-advance (original behavior)
        await supabase
          .from('synced_emails')
          .update({
            matched_order_id: matchedOrderId,
            detected_stage: detectedStage,
            ai_summary: summary,
            ai_confidence: confidence,
          })
          .eq('id', email.id)

        matchedCount++

        // Update product name if order has "Unknown" and AI found a product
        if (aiProduct && aiProduct !== 'Unknown') {
          const order = ordersList.find((o: any) => o.id === matchedOrderId)
          if (order && (!order.product || order.product === 'Unknown')) {
            await supabase
              .from('orders')
              .update({ product: aiProduct })
              .eq('order_id', matchedOrderId)
              .eq('organization_id', organization_id)
            order.product = aiProduct // Update local copy
          }
        }

        // Medium confidence: log in history but don't advance stage
        if (confidence === 'medium') {
          const order = ordersList.find((o: any) => o.id === matchedOrderId)
          if (order) {
            await insertHistoryIfNew({
              organization_id,
              order_id: order.uuid,
              stage: detectedStage || order.currentStage,
              from_address: `${email.from_name} <${email.from_email}>`,
              subject: email.subject,
              body: email.body_text || summary || `Email from ${email.from_name}`,
              timestamp: email.date || new Date().toISOString(),
              has_attachment: email.has_attachment || false,
            })
            console.log(`[AI MATCH] Medium confidence: linked "${email.subject}" → ${matchedOrderId} (no stage advance)`)
          }
        }

        // Handle stage advancement with skip support (only for HIGH confidence)
        if (detectedStage && confidence === 'high') {
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

              // Log in order_history (dedup check)
              await insertHistoryIfNew({
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
                  try {
                    await processEmailAttachments(supabase, gmailAccessToken, email, matchedOrderId, order.uuid, organization_id, user_id)
                  } catch (attachErr) {
                    console.log(`[MATCH] Attachment processing failed for ${matchedOrderId}, will retry in reprocess: ${attachErr}`)
                  }
                }
              }
            }
          } else if (order) {
            // Email matches an order but doesn't advance stage — still log in history (dedup check)
            await insertHistoryIfNew({
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
                try {
                  await processEmailAttachments(supabase, gmailAccessToken, email, matchedOrderId, order.uuid, organization_id, user_id)
                } catch (attachErr) {
                  console.log(`[MATCH] Attachment processing failed for ${matchedOrderId}, will retry in reprocess: ${attachErr}`)
                }
              }
            }
          }
        }
      }

      // ---- Auto-create orders for unmatched emails with new PO numbers ----
      const existingPOs = new Set(ordersList.map((o: any) => o.id))
      const newPOEmails = new Map<string, any[]>() // po_number -> emails[]

      for (const email of aiEmails) {
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

          // Extract supplier from email subjects — check ALL emails for this PO, not just the earliest
          let supplier = 'Unknown'
          for (const e of emails) {
            const subj = e.subject || ''
            // Pattern 1: "PO 3046 - Raunaq" or "PO 3046 - JJ SEAFOODS"
            const m1 = subj.match(/PO\s*\d{4}\s*[-–]\s*(.+?)(?:\s*$)/i)
            if (m1 && m1[1].trim() !== `PO ${fullPO.split('/').pop()}`) { supplier = m1[1].trim(); break }
            // Pattern 2: PI emails — extract supplier name between last two dashes before "PO"
            // e.g. "NEW PROFORMA INVOICE - PI/SSI/187/25-26 - SS INTERNATIONAL- PO 3055"
            const m2 = subj.match(/[-–]\s*([A-Za-z][A-Za-z\s.&]+?)\s*[-–]\s*PO\s*\d{4}/i)
            if (m2 && m2[1].trim().length > 1 && !m2[1].trim().match(/^PI\b/i)) { supplier = m2[1].trim(); break }
            // Pattern 3: "COMPANY NAME - PO 3053" anywhere (more flexible)
            const m3 = subj.match(/[-–]\s*([A-Za-z][A-Za-z\s.&]{2,}?)\s*[-–]?\s*PO\s*\d{4}/i)
            if (m3 && m3[1].trim().length > 2 && !m3[1].trim().match(/^(?:PI|PO|NEW|RE)\b/i)) { supplier = m3[1].trim(); break }
          }

          // Extract company (buyer) - usually Pescados or the To address
          const toEmail = refEmail.to_email || ''
          let company = 'Pescados E. Guillem S.L.'
          if (toEmail.includes('eguillem')) company = 'Pescados E. Guillem S.L.'

          // Detect highest stage from all emails — use the shared detectStageFromSubject helper
          let highestStage = 1
          for (const e of emails) {
            const detected = detectStageFromSubject(e.subject, e.body_text)
            if (detected) highestStage = Math.max(highestStage, detected)
          }

          // Calculate skipped stages
          const skippedStages: number[] = []
          for (let s = 2; s < highestStage; s++) {
            const hasEvidence = emails.some((e: any) => {
              const subj = (e.subject || '').toUpperCase()
              if (s === 2) return subj.includes('PROFORMA')
              if (s === 3) return subj.includes('ARTWORK') || subj.includes('LABEL')
              if (s === 4) return subj.includes('ARTWORK APPROVED') || subj.includes('ARTWORK CONFIRMED') || subj.includes('LABELS APPROVED')
              if (s === 5) return subj.includes('QUALITY') || subj.includes('INSPECTION')
              if (s === 6) return subj.includes('SCHEDULE') || subj.includes('VESSEL')
              if (s === 7) return subj.includes('DRAFT')
              if (s === 8) return subj.includes('FINAL') || subj.includes('ORIGINAL')
              return false
            })
            if (!hasEvidence) skippedStages.push(s)
          }

          // Product: basic keyword scan across ALL emails
          let product = 'Unknown'
          const allEmailText = emails.map((e: any) => `${e.subject || ''} ${(e.body_text || '').substring(0, 1000)}`).join(' ').toUpperCase()
          if (allEmailText.includes('SHRIMP') || allEmailText.includes('VANNAMEI') || allEmailText.includes('PDTO')) product = 'Frozen Shrimp'
          else if (allEmailText.includes('SQUID') || allEmailText.includes('CALAMAR') || allEmailText.includes('POTA')) product = 'Frozen Squid'
          else if (allEmailText.includes('CUTTLEFISH') || allEmailText.includes('SEPIA')) product = 'Frozen Cuttlefish'
          else if (allEmailText.includes('OCTOPUS') || allEmailText.includes('PULPO')) product = 'Frozen Octopus'
          else if (allEmailText.includes('FISH') || allEmailText.includes('SURIMI')) product = 'Frozen Fish'

          // AI fallback: if supplier or product still Unknown, use Haiku to extract
          if ((supplier === 'Unknown' || product === 'Unknown') && ANTHROPIC_API_KEY) {
            try {
              const emailSummary = emails.slice(0, 5).map((e: any) =>
                `From: ${e.from_name} <${e.from_email}>\nSubject: ${e.subject}\nBody: ${(e.body_text || '').substring(0, 1500)}`
              ).join('\n---\n')
              const aiExtractRes = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
                body: JSON.stringify({
                  model: 'claude-haiku-3-20240307',
                  max_tokens: 300,
                  messages: [{ role: 'user', content: `These emails are about frozen seafood order ${fullPO} for Ganesh International (India-based trading company).
Extract:
- supplier: The supplier/factory name (NOT Ganesh International, NOT the buyer). Look at sender names, email signatures, and body text.
- product: The main seafood product (e.g. "Frozen Squid", "Frozen Shrimp"). Look for words like squid, shrimp, calamar, pota, sepia, cuttlefish, octopus, fish, vannamei, surimi, PDTO etc.

EMAILS:
${emailSummary}

Return ONLY valid JSON: {"supplier": "...", "product": "..."}
If truly unknown, return "Unknown" for that field.` }],
                }),
              })
              if (aiExtractRes.ok) {
                const aiData = await aiExtractRes.json()
                const aiText = aiData.content?.[0]?.text || '{}'
                const jsonM = aiText.match(/\{[\s\S]*\}/)
                if (jsonM) {
                  const extracted = JSON.parse(jsonM[0])
                  if (supplier === 'Unknown' && extracted.supplier && extracted.supplier !== 'Unknown' && extracted.supplier !== 'Ganesh International') {
                    supplier = extracted.supplier
                    console.log(`[AI EXTRACT] Supplier for ${fullPO}: "${supplier}"`)
                  }
                  if (product === 'Unknown' && extracted.product && extracted.product !== 'Unknown') {
                    product = extracted.product
                    console.log(`[AI EXTRACT] Product for ${fullPO}: "${product}"`)
                  }
                }
              }
            } catch (aiErr: any) {
              console.log(`[AI EXTRACT] Failed for ${fullPO}: ${aiErr.message}`)
            }
          }

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

            // Match all emails for this PO to the new order and log each one in history
            for (const e of emails) {
              const emailStage = detectStageFromSubject(e.subject, e.body_text)
              const updateData: any = { matched_order_id: fullPO, ai_summary: `Auto-matched to newly created order ${fullPO}` }
              if (emailStage) updateData.detected_stage = emailStage
              await supabase
                .from('synced_emails')
                .update(updateData)
                .eq('id', e.id)
              matchedCount++

              // Log actual email in order_history so user sees real email details
              await insertHistoryIfNew({
                order_id: newOrder.id,
                organization_id,
                stage: emailStage || highestStage,
                timestamp: e.date || new Date().toISOString(),
                from_address: e.from_name ? `${e.from_name} <${e.from_email}>` : e.from_email || 'Unknown',
                subject: e.subject || 'No subject',
                body: (e.body_text || '').substring(0, 5000),
                has_attachment: e.has_attachment || false,
              })
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
        .neq('dismissed', true)
        .neq('reviewed', true)

      const { count: totalEmails } = await supabase
        .from('synced_emails')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organization_id)

      const { count: totalMatched } = await supabase
        .from('synced_emails')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organization_id)
        .not('matched_order_id', 'is', null)

      // Count dismissed emails
      const { count: dismissedCount } = await supabase
        .from('synced_emails')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organization_id)
        .eq('dismissed', true)

      setCors(res)
      return res.status(200).json({
        mode: 'match',
        done: (remainingCount || 0) === 0,
        matched: matchedCount + regexMatchCount,
        advanced: advancedCount,
        created: createdOrderCount,
        regexMatched: regexMatchCount,
        threadMatched: threadMatchCount,
        aiMatched: matchedCount,
        remaining: remainingCount || 0,
        totalEmails: totalEmails || 0,
        totalMatched: totalMatched || 0,
        dismissed: dismissedCount || 0,
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
          .select('id, order_id, company, supplier, product, metadata')
          .eq('organization_id', organization_id)
          .eq('order_id', targetPO)
          .single()
        if (order) ordersToProcess = [order]
      } else if (retryFailed) {
        // Retry mode: clear extraction_attempted flag and re-process
        const { data } = await supabase
          .from('orders')
          .select('id, order_id, company, supplier, product, metadata, order_line_items(id)')
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
          .select('id, order_id, company, supplier, product, metadata, delivery_terms, payment_terms, commission, to_location, total_kilos, total_value')
          .eq('organization_id', organization_id)
          .eq('po_number', targetPO)
          .single()
        if (order) ordersToProcess = [order]
      } else {
        // Batch mode: find orders with 0 line items via left join, skip already-attempted
        const { data } = await supabase
          .from('orders')
          .select('id, order_id, company, supplier, product, metadata, delivery_terms, payment_terms, commission, to_location, total_kilos, total_value, order_line_items(id)')
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

      const batchLimit = batch_size || 3
      const batch = ordersToProcess.slice(0, batchLimit)
      const results: any[] = []
      let extracted = 0

      for (const order of batch) {
        try {
          let extractedData: any = null
          let visionDebug: any = { attempted: false }

          // PRIORITY: If order already has a stored PO PDF in Supabase, use that directly
          const storedPdfUrl = order.metadata?.pdfUrl
          if (storedPdfUrl) {
            try {
              console.log(`[BULK] Using stored PO PDF for ${order.order_id}: ${storedPdfUrl.substring(0, 80)}...`)
              visionDebug.attempted = true
              visionDebug.source = 'stored_pdf'
              const pdfResp = await fetch(storedPdfUrl)
              if (pdfResp.ok) {
                const pdfBuffer = await pdfResp.arrayBuffer()
                visionDebug.downloadedSize = pdfBuffer.byteLength
                const bytes = new Uint8Array(pdfBuffer)
                let binary = ''
                const chunkSize = 8192
                for (let i = 0; i < bytes.length; i += chunkSize) {
                  const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
                  for (let j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j])
                }
                const base64 = btoa(binary)
                // Detect mime type from URL extension
                const urlLower = storedPdfUrl.toLowerCase()
                const mimeType = urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg') ? 'image/jpeg'
                  : urlLower.endsWith('.png') ? 'image/png'
                  : pdfResp.headers.get('content-type') || 'application/pdf'
                visionDebug.mimeType = mimeType
                extractedData = await extractPODataFromImage(base64, mimeType, order.company || '', order.supplier || '')
                visionDebug.visionResult = extractedData ? extractedData.lineItems.length + ' items' : 'null'
                console.log(`[BULK] Stored PDF extraction: ${extractedData?.lineItems?.length || 0} items, supplier: ${extractedData?.supplier || 'none'}`)
              } else {
                console.log(`[BULK] Failed to download stored PDF: ${pdfResp.status}`)
              }
            } catch (pdfErr) {
              console.log(`[BULK] Stored PDF error: ${pdfErr}`)
            }
          }

          // Fallback: search email attachments if stored PDF didn't work
          if (!extractedData || extractedData.lineItems.length === 0) {
          // Find emails with attachments for this order (PO scans)
          const { data: emails } = await supabase
            .from('synced_emails')
            .select('id, gmail_id, subject, has_attachment, detected_stage')
            .eq('matched_order_id', order.order_id)
            .eq('organization_id', organization_id)
            .eq('has_attachment', true)
            .limit(20)

          if (!gmailAccessToken) {
            if (!extractedData || extractedData.lineItems.length === 0) {
              results.push({ order: order.order_id, status: 'skip', reason: 'no Gmail access and no stored PDF', vision: visionDebug })
              continue
            }
          } else {

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
          } // close else (gmailAccessToken available)
          } // close if (fallback to email attachments)

          if (!extractedData || extractedData.lineItems.length === 0) {
            // Mark order as extraction attempted so it doesn't get retried (merge metadata, don't replace!)
            await supabase.from('orders').update({ metadata: { ...(order.metadata || {}), extraction_attempted: true } }).eq('id', order.id)
            results.push({ order: order.order_id, status: 'skip', reason: 'no PO attachment found', vision: visionDebug })
            continue
          }

          // Check if order already has line items — if so, skip to prevent data loss
          const { count: existingCount } = await supabase.from('order_line_items')
            .select('id', { count: 'exact', head: true }).eq('order_id', order.id)
          if (existingCount && existingCount > 0) {
            console.log(`[BULK] Skipping ${order.order_id} — already has ${existingCount} line items`)
            results.push({ order: order.order_id, status: 'skip', reason: `Already has ${existingCount} line items` })
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

          // Only fill in empty fields — never overwrite existing data
          const updates: any = {}
          if (extractedData.deliveryTerms && !order.delivery_terms) updates.delivery_terms = extractedData.deliveryTerms
          if (extractedData.payment && !order.payment_terms) updates.payment_terms = extractedData.payment
          if (extractedData.commission && !order.commission) updates.commission = extractedData.commission
          if (extractedData.destination && !order.to_location) updates.to_location = extractedData.destination
          if (extractedData.totalKilos > 0 && !order.total_kilos) updates.total_kilos = extractedData.totalKilos
          if (extractedData.totalValue > 0 && !order.total_value) updates.total_value = String(extractedData.totalValue)
          // Only set supplier if order doesn't have one yet
          if (extractedData.supplier && extractedData.supplier !== 'Unknown' && extractedData.supplier !== 'Ganesh International') {
            if (!order.supplier || order.supplier === 'Unknown') {
              updates.supplier = extractedData.supplier
              console.log(`[BULK] Set supplier for ${order.order_id}: "${extractedData.supplier}"`)
            }
          }
          // Update product from PO extraction — replaces generic keyword guesses with the real name
          if (extractedData.lineItems.length > 0) {
            const mainProduct = extractedData.lineItems[0].product
            if (mainProduct && mainProduct !== 'Unknown') {
              const genericNames = ['Unknown', 'Frozen Shrimp', 'Frozen Squid', 'Frozen Cuttlefish', 'Frozen Octopus', 'Frozen Fish']
              if (!order.product || genericNames.includes(order.product)) {
                updates.product = mainProduct
                console.log(`[BULK] Updated product for ${order.order_id}: "${order.product}" → "${mainProduct}"`)
              }
            }
          }
          if (Object.keys(updates).length > 0) await supabase.from('orders').update(updates).eq('id', order.id)

          extracted++
          results.push({ order: order.order_id, status: 'ok', items: extractedData.lineItems.length, totalKilos: extractedData.totalKilos, totalValue: extractedData.totalValue, commission: extractedData.commission || '', destination: extractedData.destination || '', deliveryTerms: extractedData.deliveryTerms || '', source: 'attachment' })
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
    // MODE: RECOVER — Targeted Gmail search for orders with missing data
    // Searches Gmail for specific PO numbers, syncs matching emails,
    // downloads attachments, and extracts order data.
    // ============================================================
    if (syncMode === 'recover') {
      if (!member.gmail_refresh_token) throw new Error('Gmail not connected')
      const { data: recSettings } = await supabase
        .from('organization_settings')
        .select('gmail_client_id')
        .eq('organization_id', organization_id)
        .single()
      const recClientSecret = process.env.GOOGLE_CLIENT_SECRET!
      if (!recSettings?.gmail_client_id || !recClientSecret) throw new Error('Gmail not configured')
      const recAccessToken = await refreshGmailToken(member.gmail_refresh_token, recSettings.gmail_client_id, recClientSecret)
      if (!recAccessToken) throw new Error('Failed to refresh Gmail token')

      // Find orders that need recovery
      const targetPO = reqBody.order_po as string | undefined
      let ordersToRecover: any[] = []

      if (targetPO) {
        // Single order mode
        const { data: order } = await supabase
          .from('orders')
          .select('id, order_id, company, supplier, product, metadata, delivery_terms, payment_terms, commission, to_location, total_kilos, total_value, order_line_items(id)')
          .eq('organization_id', organization_id)
          .eq('order_id', targetPO)
          .single()
        if (order) ordersToRecover = [order]
      } else {
        // Batch mode: find all orders with 0 line items
        const { data } = await supabase
          .from('orders')
          .select('id, order_id, company, supplier, product, metadata, delivery_terms, payment_terms, commission, to_location, total_kilos, total_value, order_line_items(id)')
          .eq('organization_id', organization_id)
        ordersToRecover = (data || []).filter((o: any) =>
          !o.order_line_items || o.order_line_items.length === 0
        )
      }

      if (ordersToRecover.length === 0) {
        setCors(res)
        return res.status(200).json({ mode: 'recover', message: targetPO ? 'Order not found or already has data' : 'All orders already have line items', recovered: 0 })
      }

      const recBatchLimit = batch_size || 5
      const recBatch = ordersToRecover.slice(0, recBatchLimit)
      const recResults: any[] = []
      let recRecovered = 0

      for (const order of recBatch) {
        try {
          // Extract PO number for Gmail search (e.g. "3019" from "GI/PO/25-26/3019")
          const poMatch = order.order_id.match(/(\d{4,})/)
          const poNum = poMatch ? poMatch[1] : ''

          // Tiered Gmail search: most specific first, broadening if nothing found
          // Tier 1: "PURCHASE ORDER" + PO number with attachments (the actual PO email)
          // Tier 2: PO number with attachments (PI, artwork, etc.)
          // Tier 3: PO number in any email (for email body extraction)
          const searchQueries = [
            `"purchase order" "${poNum}" has:attachment`,
            `"${poNum}" has:attachment`,
            `"PO ${poNum}"`,
            poNum ? `"${poNum}"` : '',
          ].filter(Boolean)

          let foundIds: string[] = []
          let usedQuery = ''
          for (const query of searchQueries) {
            const searchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=20`
            const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${recAccessToken}` } })
            const searchData = await searchRes.json()
            const ids = (searchData.messages || []).map((m: any) => m.id)
            if (ids.length > 0) {
              foundIds = ids
              usedQuery = query
              console.log(`[RECOVER] Gmail search hit for ${order.order_id}: "${query}" → ${ids.length} results`)
              break
            }
          }

          if (foundIds.length === 0) {
            recResults.push({ order: order.order_id, status: 'skip', reason: 'No emails found in Gmail for PO number ' + poNum })
            continue
          }

          // Check which ones are already synced
          const { data: alreadySynced } = await supabase
            .from('synced_emails')
            .select('gmail_id')
            .eq('organization_id', organization_id)
            .in('gmail_id', foundIds)
          const syncedSet = new Set((alreadySynced || []).map((e: any) => e.gmail_id))
          const newIds = foundIds.filter((id: string) => !syncedSet.has(id))

          // Sync new emails into synced_emails table AND create order_history entries
          let syncedCount = 0
          const syncedEmailDetails: any[] = []
          for (const msgId of newIds.slice(0, 15)) {
            try {
              const msgRes = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
                { headers: { Authorization: `Bearer ${recAccessToken}` } }
              )
              if (!msgRes.ok) continue
              const msg = await msgRes.json()
              const headers = msg.payload?.headers || []
              const subject = getHeader(headers, 'Subject')
              const from = getHeader(headers, 'From')
              const to = getHeader(headers, 'To')
              const dateStr = getHeader(headers, 'Date')
              const bodyText = extractBody(msg.payload).substring(0, 5000)

              // Check actual attachment parts (not just inline images)
              const attachParts = extractAttachmentParts(msg.payload)
              const hasRealAttachment = attachParts.length > 0

              // Only match to this order if the email actually mentions the PO number
              const emailContent = `${subject} ${bodyText}`.toLowerCase()
              const mentionsPO = poNum && (emailContent.includes(poNum) || emailContent.includes(order.order_id.toLowerCase()))
              if (!mentionsPO) {
                console.log(`[RECOVER] Skipping email "${subject.substring(0, 60)}" — doesn't mention PO ${poNum}`)
                continue
              }

              // Detect stage from subject
              const subjectUpper = subject.toUpperCase()
              let detectedStage = 0
              if (subjectUpper.includes('ORIGINAL DOCUMENT') || subjectUpper.includes('FINAL DOC')) detectedStage = 8
              else if (subjectUpper.includes('PURCHASE ORDER') || subjectUpper.includes('NEW PO')) detectedStage = 1
              else if (subjectUpper.includes('PROFORMA') || subjectUpper.includes('NEW PROFORMA')) detectedStage = 2
              else if (subjectUpper.includes('ARTWORK') || subjectUpper.includes('LABEL') || subjectUpper.includes('APPROVAL')) detectedStage = 3

              const emailRow = {
                organization_id,
                gmail_id: msgId,
                thread_id: msg.threadId || null,
                from_email: extractEmail(from),
                from_name: extractName(from),
                to_email: extractEmail(to),
                subject,
                body_text: bodyText,
                date: dateStr ? new Date(dateStr).toISOString() : new Date().toISOString(),
                has_attachment: hasRealAttachment,
                matched_order_id: order.order_id,
                detected_stage: detectedStage || null,
                connected_user_id: user_id,
              }
              await supabase.from('synced_emails').upsert(emailRow, { onConflict: 'gmail_id,organization_id', ignoreDuplicates: true })
              syncedCount++
              syncedEmailDetails.push({ ...emailRow, gmail_id: msgId })

              // Create an order_history entry so the email shows up in the order detail page
              // Check for duplicates first (same order + subject + close timestamp)
              const historyDate = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString()
              const { data: existingHistory } = await supabase.from('order_history')
                .select('id')
                .eq('order_id', order.id)
                .eq('subject', subject)
                .limit(1)
              if (!existingHistory || existingHistory.length === 0) {
                await supabase.from('order_history').insert({
                  order_id: order.id,
                  stage: detectedStage || 1,
                  subject,
                  from_address: `${extractName(from)} <${extractEmail(from)}>`,
                  has_attachment: hasRealAttachment,
                  timestamp: historyDate,
                })
              }
            } catch (syncErr) {
              console.log(`[RECOVER] Failed to sync email ${msgId}: ${syncErr}`)
            }
          }

          // Also link already-synced but unmatched emails to this order + create history entries
          if (syncedSet.size > 0) {
            const { data: existingSynced } = await supabase
              .from('synced_emails')
              .select('id, gmail_id, subject, body_text, from_email, from_name, date, has_attachment, matched_order_id, detected_stage')
              .eq('organization_id', organization_id)
              .in('gmail_id', [...syncedSet])
            for (const ue of (existingSynced || [])) {
              const content = `${ue.subject} ${ue.body_text || ''}`.toLowerCase()
              if (!(poNum && content.includes(poNum))) continue

              // Link unmatched emails to this order
              if (!ue.matched_order_id || ue.matched_order_id !== order.order_id) {
                await supabase.from('synced_emails').update({ matched_order_id: order.order_id }).eq('id', ue.id)
                console.log(`[RECOVER] Linked existing email "${(ue.subject || '').substring(0, 50)}" to ${order.order_id}`)
              }

              // Detect stage from subject
              const subjectUpper = (ue.subject || '').toUpperCase()
              let stage = 0
              if (subjectUpper.includes('ORIGINAL DOCUMENT') || subjectUpper.includes('FINAL DOC')) stage = 8
              else if (subjectUpper.includes('PURCHASE ORDER') || subjectUpper.includes('NEW PO')) stage = 1
              else if (subjectUpper.includes('PROFORMA')) stage = 2
              else if (subjectUpper.includes('ARTWORK') || subjectUpper.includes('LABEL')) stage = 3

              // Update detected_stage on synced email if it was wrong/missing
              if (stage && (!ue.detected_stage || ue.detected_stage !== stage)) {
                await supabase.from('synced_emails').update({ detected_stage: stage }).eq('id', ue.id)
                console.log(`[RECOVER] Updated detected_stage to ${stage} for "${(ue.subject || '').substring(0, 50)}"`)
              }

              // Create order_history entry if missing (so email shows in UI)
              const { data: existH } = await supabase.from('order_history')
                .select('id').eq('order_id', order.id).eq('subject', ue.subject || '').limit(1)
              if (!existH || existH.length === 0) {
                await supabase.from('order_history').insert({
                  order_id: order.id,
                  stage: stage || 1,
                  subject: ue.subject || '',
                  from_address: `${ue.from_name || ''} <${ue.from_email || ''}>`,
                  has_attachment: ue.has_attachment || false,
                  timestamp: ue.date || new Date().toISOString(),
                })
                console.log(`[RECOVER] Created history entry for existing email "${(ue.subject || '').substring(0, 50)}"`)
              }
            }
          }
          console.log(`[RECOVER] Synced ${syncedCount} new emails for ${order.order_id} (query: "${usedQuery}")`)

          // Now find all emails with attachments for this order (including freshly synced)
          const { data: orderEmails } = await supabase
            .from('synced_emails')
            .select('id, gmail_id, subject, has_attachment, detected_stage, body_text')
            .eq('organization_id', organization_id)
            .eq('matched_order_id', order.order_id)
            .eq('has_attachment', true)
            .limit(20)

          const attachEmails = orderEmails || []

          if (attachEmails.length === 0) {
            // No attachment emails — try to extract from email body text as last resort
            const { data: textEmails } = await supabase
              .from('synced_emails')
              .select('id, gmail_id, subject, body_text')
              .eq('organization_id', organization_id)
              .eq('matched_order_id', order.order_id)
              .not('body_text', 'is', null)
              .limit(5)

            if (textEmails && textEmails.length > 0) {
              // Try extracting PO data from email body text
              for (const te of textEmails) {
                if ((te.body_text || '').length < 50) continue
                try {
                  const emailData = await extractPODataFromEmail(te, order.company || '', order.supplier || '')
                  if (emailData && emailData.lineItems && emailData.lineItems.length > 0) {
                    const lineItemRows = emailData.lineItems.map((item: any, idx: number) => ({
                      order_id: order.id, product: item.product, brand: item.brand || '',
                      size: item.size || '', glaze: item.glaze || '', glaze_marked: item.glazeMarked || '',
                      packing: item.packing || '', freezing: item.freezing || 'IQF',
                      cases: parseInt(item.cases) || 0, kilos: item.kilos || 0, price_per_kg: item.pricePerKg || 0,
                      currency: item.currency || 'USD',
                      total: Number(item.total) || ((item.kilos || 0) * (item.pricePerKg || 0)), sort_order: idx,
                    }))
                    await supabase.from('order_line_items').insert(lineItemRows)
                    const updates: any = {}
                    if (emailData.deliveryTerms && !order.delivery_terms) updates.delivery_terms = emailData.deliveryTerms
                    if (emailData.payment && !order.payment_terms) updates.payment_terms = emailData.payment
                    if (emailData.destination && !order.to_location) updates.to_location = emailData.destination
                    if (emailData.totalKilos > 0 && !order.total_kilos) updates.total_kilos = emailData.totalKilos
                    if (emailData.totalValue > 0 && !order.total_value) updates.total_value = String(emailData.totalValue)
                    if (Object.keys(updates).length > 0) await supabase.from('orders').update(updates).eq('id', order.id)
                    recRecovered++
                    recResults.push({ order: order.order_id, status: 'ok', source: 'email_text', emailsSynced: syncedCount, lineItems: emailData.lineItems.length })
                    break
                  }
                } catch (textErr) {
                  console.log(`[RECOVER] Email text extraction failed: ${textErr}`)
                }
              }
              if (!recResults.some(r => r.order === order.order_id && r.status === 'ok')) {
                recResults.push({ order: order.order_id, status: 'partial', reason: 'Emails synced but no PO data found in email text or attachments', emailsSynced: syncedCount })
              }
            } else {
              recResults.push({ order: order.order_id, status: 'partial', reason: 'Emails synced but none have attachments', emailsSynced: syncedCount })
            }
            continue
          }

          // Score and process attachment emails (PO emails first, then Final Docs)
          const scored = attachEmails.map((e: any) => {
            let score = 0
            const subj = (e.subject || '').toLowerCase()
            if (e.detected_stage === 1) score += 100
            if (subj.includes('purchase order') || subj.includes('new po')) score += 50
            if (subj.includes('proforma')) score += 40
            if (subj.includes('original document') || subj.includes('final doc')) score += 30
            if (subj.includes('audit') || subj.includes('foto') || subj.includes('photo')) score -= 50
            return { email: e, score }
          }).sort((a: any, b: any) => b.score - a.score)

          let extracted = false
          let totalFilesStored = 0
          for (const { email: attachEmail } of scored.slice(0, 5)) {
            if (extracted) break
            try {
              const result = await processEmailAttachments(
                supabase, recAccessToken, attachEmail,
                order.order_id, order.id, organization_id, user_id, false
              )
              totalFilesStored += result.filesStored
              if (result.filesStored > 0) {
                // Check if line items were actually extracted
                const { count: itemCount } = await supabase.from('order_line_items')
                  .select('id', { count: 'exact', head: true }).eq('order_id', order.id)
                if (itemCount && itemCount > 0) {
                  extracted = true
                  recRecovered++
                  recResults.push({ order: order.order_id, status: 'ok', emailsSynced: syncedCount, filesStored: result.filesStored, lineItems: itemCount })
                }
              }
            } catch (procErr) {
              console.log(`[RECOVER] Attachment processing failed for ${order.order_id}: ${procErr}`)
            }
          }

          // If processEmailAttachments didn't extract data, try bulk-extract style (stored PDF fallback)
          if (!extracted) {
            // Check if a pdfUrl was stored during attachment processing
            const { data: refreshedOrder } = await supabase
              .from('orders')
              .select('metadata')
              .eq('id', order.id)
              .single()
            const storedPdf = refreshedOrder?.metadata?.pdfUrl
            if (storedPdf) {
              try {
                const pdfResp = await fetch(storedPdf)
                if (pdfResp.ok) {
                  const pdfBuffer = await pdfResp.arrayBuffer()
                  const bytes = new Uint8Array(pdfBuffer)
                  let binary = ''
                  const chunkSize = 8192
                  for (let i = 0; i < bytes.length; i += chunkSize) {
                    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
                    for (let j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j])
                  }
                  const base64 = btoa(binary)
                  const urlLower = storedPdf.toLowerCase()
                  const mimeType = urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg') ? 'image/jpeg'
                    : urlLower.endsWith('.png') ? 'image/png'
                    : pdfResp.headers.get('content-type') || 'application/pdf'
                  const extractedData = await extractPODataFromImage(base64, mimeType, order.company || '', order.supplier || '')
                  if (extractedData && extractedData.lineItems.length > 0) {
                    const lineItemRows = extractedData.lineItems.map((item: any, idx: number) => ({
                      order_id: order.id, product: item.product, brand: item.brand || '',
                      size: item.size || '', glaze: item.glaze || '', glaze_marked: item.glazeMarked || '',
                      packing: item.packing || '', freezing: item.freezing || 'IQF',
                      cases: parseInt(item.cases) || 0, kilos: item.kilos || 0, price_per_kg: item.pricePerKg || 0,
                      currency: item.currency || 'USD',
                      total: Number(item.total) || ((item.kilos || 0) * (item.pricePerKg || 0)), sort_order: idx,
                    }))
                    await supabase.from('order_line_items').insert(lineItemRows)
                    // Fill empty fields
                    const updates: any = {}
                    if (extractedData.deliveryTerms && !order.delivery_terms) updates.delivery_terms = extractedData.deliveryTerms
                    if (extractedData.payment && !order.payment_terms) updates.payment_terms = extractedData.payment
                    if (extractedData.commission && !order.commission) updates.commission = extractedData.commission
                    if (extractedData.destination && !order.to_location) updates.to_location = extractedData.destination
                    if (extractedData.totalKilos > 0 && !order.total_kilos) updates.total_kilos = extractedData.totalKilos
                    if (extractedData.totalValue > 0 && !order.total_value) updates.total_value = String(extractedData.totalValue)
                    if (extractedData.supplier && extractedData.supplier !== 'Unknown' && (!order.supplier || order.supplier === 'Unknown')) {
                      updates.supplier = extractedData.supplier
                    }
                    if (extractedData.lineItems.length > 0 && extractedData.lineItems[0].product !== 'Unknown') {
                      const genericNames = ['Unknown', 'Frozen Shrimp', 'Frozen Squid', 'Frozen Cuttlefish', 'Frozen Octopus', 'Frozen Fish']
                      if (!order.product || genericNames.includes(order.product)) updates.product = extractedData.lineItems[0].product
                    }
                    if (Object.keys(updates).length > 0) await supabase.from('orders').update(updates).eq('id', order.id)
                    extracted = true
                    recRecovered++
                    recResults.push({ order: order.order_id, status: 'ok', emailsSynced: syncedCount, source: 'stored_pdf', lineItems: extractedData.lineItems.length })
                  }
                }
              } catch (pdfErr) {
                console.log(`[RECOVER] Stored PDF extraction failed for ${order.order_id}: ${pdfErr}`)
              }
            }
          }

          if (!extracted) {
            recResults.push({ order: order.order_id, status: 'partial', reason: 'Emails synced but no PO data extracted', emailsSynced: syncedCount })
          }
        } catch (orderErr) {
          recResults.push({ order: order.order_id, status: 'error', reason: String(orderErr) })
        }
        await delay(500)
      }

      const recRemaining = ordersToRecover.length - recBatch.length
      setCors(res)
      return res.status(200).json({
        mode: 'recover', done: recRemaining === 0, recovered: recRecovered,
        batchProcessed: recBatch.length, remaining: recRemaining,
        totalMissing: ordersToRecover.length, results: recResults,
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

      // Process up to 5 emails per call (300s timeout with Fluid Compute)
      const rpBatchSize = 5
      const { data: emails, error: fetchErr } = await supabase
        .from('synced_emails')
        .select('id, gmail_id, subject, from_name, from_email, date, has_attachment, matched_order_id, detected_stage, body_text')
        .eq('organization_id', organization_id)
        .not('matched_order_id', 'is', null)
        .eq('has_attachment', true)
        .eq('attachment_processed', false)
        .order('date', { ascending: true })
        .limit(rpBatchSize)

      if (fetchErr) throw fetchErr

      // Count total remaining (including the ones we're about to process)
      const { count: totalRemaining } = await supabase
        .from('synced_emails')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organization_id)
        .not('matched_order_id', 'is', null)
        .eq('has_attachment', true)
        .eq('attachment_processed', false)

      if (!emails || emails.length === 0) {
        setCors(res)
        return res.status(200).json({ mode: 'reprocess', done: true, processed: 0, remaining: 0, message: 'All attachments processed' })
      }

      const { data: orders } = await supabase
        .from('orders')
        .select('id, order_id')
        .eq('organization_id', organization_id)
      const orderMap = new Map((orders || []).map((o: any) => [o.order_id, o.id]))

      const rpResults: any[] = []
      let rpProcessed = 0

      for (const email of emails) {
        const orderUuid = orderMap.get(email.matched_order_id)
        let status = 'skip'
        let error = ''
        let shouldMarkProcessed = false

        if (orderUuid) {
          try {
            const result = await processEmailAttachments(supabase, gmailAccessToken, email, email.matched_order_id, orderUuid, organization_id, user_id, true)
            if (result.filesStored > 0) {
              status = 'ok'
            } else if (result.noValidParts) {
              status = 'no_valid_parts'
            } else {
              status = 'no_files'
              error = 'Attachments found but none were stored (classified as other or download failed)'
            }
            // Always mark as processed — prevents infinite retry loop
            // If files genuinely need reprocessing, user can reset attachment_processed manually
            shouldMarkProcessed = true
          } catch (err) {
            status = 'error'
            error = String(err)
            // Mark as processed even on error to prevent infinite retries
            shouldMarkProcessed = true
          }
        } else {
          // Order doesn't exist (was deleted) — mark as processed so we skip it forever
          shouldMarkProcessed = true
        }

        if (shouldMarkProcessed) {
          await supabase.from('synced_emails').update({ attachment_processed: true }).eq('id', email.id)
        }
        rpProcessed++
        rpResults.push({ order: email.matched_order_id, stage: email.detected_stage, status, error: error || undefined })
      }

      const remaining = (totalRemaining || rpProcessed) - rpProcessed
      setCors(res)
      return res.status(200).json({
        mode: 'reprocess', done: remaining <= 0, processed: rpProcessed, remaining: Math.max(0, remaining),
        results: rpResults,
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
    const fetchLimit = 400 // Max emails to download per call (300s timeout with Fluid Compute)
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

    // Fetch full content of new messages (in batches of 10, capped at fetchLimit for Vercel timeout)
    const toFetch = newMessageIds.slice(0, fetchLimit)
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
            thread_id: msg.threadId || null,
            from_email: extractEmail(getHeader(headers, 'From')),
            from_name: extractName(getHeader(headers, 'From')),
            to_email: extractAllEmails(getHeader(headers, 'To')).join(', ') || extractEmail(getHeader(headers, 'To')),
            cc_emails: extractAllEmails(getHeader(headers, 'Cc')).join(', '),
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
          thread_id: email.thread_id || null,
          from_email: email.from_email,
          from_name: email.from_name,
          to_email: email.to_email,
          cc_emails: email.cc_emails || null,
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

    const pendingDownload = newMessageIds.length - toFetch.length
    setCors(res)
      return res.status(200).json({
        mode: syncMode,
        synced: storedCount,
        total: totalStored || 0,
        alreadyHad: existingIds.size,
        pendingDownload,
        done: pendingDownload === 0,
      })
  } catch (err: any) {
    console.error('Sync error:', err)
    setCors(res)
      return res.status(400).json({ error: err.message })
  }
}