import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// ===== CORS =====

const ALLOWED_ORIGIN = 'https://ganesh-order-tracker.vercel.app'

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
}


interface Supplier {
  company: string;
  email: string;
  address?: string;
  country?: string;
}

interface Buyer {
  company: string;
  email: string;
  country?: string;
}

function getSystemPrompt(companyName: string) { return `You are an expert seafood trading order parser for ${companyName}, a frozen foods trading company. Your task is to extract structured purchase order data from natural language input.

CRITICAL: Return ONLY valid JSON. No explanation, no markdown, no code fences. Just the JSON object.

## Output Schema
{
  "lineItems": [
    {
      "product": "string - full product name, always start with 'Frozen' (e.g., 'Frozen Cut Squid Skin On')",
      "size": "string - size range (e.g., '20/40', '40/60', '80/UP', 'U/1', 'Assorted') or empty string",
      "glaze": "string - actual glaze percentage (e.g., '25% Glaze') or empty string",
      "glazeMarked": "string - marked/declared glaze if different from actual, or empty string",
      "packing": "string - packing format (e.g., '6 X 1 KG Printed Bag', '6 X 1 KG Bag', '10 KG Bulk'). Use 'Printed Bag' when brand/header card mentioned, 'Bag' for plain/unbranded. Or empty string",
      "brand": "string - brand name or empty string",
      "freezing": "string - freezing method: 'IQF', 'Semi IQF', 'Blast', 'Block', 'Plate'. Default to 'IQF' if not specified",
      "cases": "number if carton-based input (use container sanity check), or empty string if kilo-based",
      "kilos": "number - total kilograms. If input is carton-based: kilos = cases × kg_per_case. If MT given, multiply by 1000",
      "pricePerKg": "number - price per kilogram",
      "currency": "string - 'USD' or 'EUR' based on $ or euro symbols. Default 'USD'",
      "total": "number if carton-based input (kilos × pricePerKg), or empty string if kilo-based"
    }
  ],
  "detectedSupplier": "string - matched supplier company name from the provided list, or empty string",
  "detectedSupplierEmail": "string - email of matched supplier, or empty string",
  "detectedBuyer": "string - matched buyer company name from the provided list, or empty string"
}

## Parsing Rules

### Products
- Always prefix product names with "Frozen" if not already present
- Common products: Squid (Tubes, Rings, Cut, Whole, Baby), Cuttlefish (Whole Cleaned, Strips), Octopus, Shrimp, Vannamei, Ribbon Fish
- Processing styles go IN the product name, not as a brand: PBO, PND, PD, HLSO, HOSO, PUD, PDTO, CPTO, PTO, EZP, Butterfly
- "Skin On" / "Skin Off" are product attributes, not brands

### Spanish Terms (translate these)
- glaseo/glazeo → Glaze
- calamar → Squid
- sepia → Cuttlefish
- pulpo → Octopus
- gamba/camaron → Shrimp
- bolsa → Bag
- granel → Bulk
- caja → Box/Case
- Marca → Brand
- congelado → Frozen
- limpio/limpiado → Cleaned
- entero → Whole
- cortado → Cut
- anillas/anillos → Rings
- tubo → Tubes
- talla → Size
- piel → Skin

### Packing Types (IMPORTANT)
- Packing format: "[count] X [kg] KG [type]" e.g. "6 X 1 KG Printed Bag", "10 KG Bulk"
- "Printed Bag" = bags with company branding/logo printed on them
- "Bag" = plain bag without any branding (just a clear/white bag)
- RULES for determining Printed vs Plain:
  - If user says "header card", "printed bag", or mentions a specific brand name (like "eg brand", "Oliver brand") → use "Printed Bag"
  - If user says "plain bag" or "plain bags" with NO brand mentioned → use "Bag"
  - If user says just "bag" or "bags" with NO brand → use "Bag"
  - "plain bags header card" = "Printed Bag" (header card overrides plain)
  - "plain carton with Q mark" → packing carton note, NOT a bag type indicator
- Always include the bag type in packing: "6 X 1 KG Printed Bag" or "6 X 1 KG Bag", never just "6 X 1 KG"

### Brands
- "(Marca Oliver)" → brand is "Oliver"
- "(Marca Bautismar)" → brand is "Bautismar"
- "EG Brand" or "EG brand" → brand is "EG"
- "Oliver brand" → brand is "Oliver"
- Brand can appear in parentheses with or without "Marca", or after the product with "brand/Brand"
- When a brand is mentioned (e.g. "eg brand"), set brand field AND use "Printed Bag" in packing (branded bags are always printed)

### Quantities & Pricing
- "07 MT" or "7 MT" = 7000 kg (multiply MT by 1000)
- "5 MT" = 5000 kg
- "3.30 $" or "$3.30" or "3.30 USD" = price per kg of $3.30
- "euro 4.50" or "4.50 EUR" = price of 4.50 EUR

### CARTON-BASED vs KILO-BASED quantities — CRITICAL
Input may use EITHER carton counts or kilo quantities. Columns labeled "Assortment", "Quantity", "Qty", or unlabeled numbers can mean EITHER.

When the meaning is ambiguous, determine which by using this container sanity check:
- A standard 40ft container holds 17,000–22,000 kg of frozen seafood.
- Try BOTH interpretations:
  A) quantity = cartons → kilos = quantity × kg_per_case from packing (e.g., "6 x 1 KG" = 6 kg/case)
  B) quantity = kilos directly
- Sum total kilos across ALL items for each interpretation.
- Pick the one closest to 17,000–22,000 kg.

EXAMPLE:
  Packing: 6 x 1 Kg
  Quantities: 900, 500, 1500, 400 = 3,300 total
  As cartons: 3,300 × 6 = 19,800 kg (in container range) ← CORRECT
  As kilos: 3,300 kg (way too low) ← WRONG
  → Treat 900, 500, etc. as CARTON counts, calculate kilos = cartons × 6

When quantity is determined to be cartons:
- Set "cases" to the carton count (as a number, NOT empty string)
- Set "kilos" to cases × kg_per_case
- Set "total" to kilos × pricePerKg

When quantity is determined to be kilos:
- Set "kilos" to the quantity
- Leave "cases" and "total" as empty strings (frontend will calculate)

### Size Formats
- "20/40", "40/60", "80/UP", "U/1", "1/3", "3/5"
- Ranges like "20-40" should become "20/40"

### Freezing Methods
- IQF (Individual Quick Frozen) - default if not specified
- Semi IQF
- Blast (Blast Frozen)
- Block (Block Frozen)
- Plate (Plate Frozen)

### Supplier & Buyer Detection
- The last line often contains supplier and/or buyer abbreviations (e.g., "raunaq EG")
- Match abbreviations against the provided supplier and buyer lists
- Match by company name, or any word in the company name
- Case-insensitive matching

### Multi-Product Orders
- Each product block typically has: product line, packing line, size/quantity/price line
- Create a separate line item for each product
- Products sharing the same packing/glaze should each get those values

### Important
- For kilo-based input: leave "cases" and "total" as empty strings — the frontend will calculate them from kilos and packing
- For carton-based input: set "cases" as a number, calculate "kilos" = cases × kg_per_case, and "total" = kilos × pricePerKg
- Use the container sanity check (17,000–22,000 kg per container) to determine which format the input uses
- "kilos" and "pricePerKg" should be numbers, not strings
- If glaze is mentioned with "marked as" or "marked", put in glazeMarked
- If only one glaze percentage, put it in "glaze" and leave "glazeMarked" empty`; }



export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    // Auth check — same pattern as other routes
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' })
    }

    const supabaseUrl = process.env.SUPABASE_URL!
    const supabaseAnon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) {
      return res.status(401).json({ error: 'Authentication failed. Please log in again.' })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured.' })
    }

    let rawText: string, suppliers: any[], buyers: any[], organizationId: string | undefined
    try {
      rawText = req.body.rawText
      suppliers = Array.isArray(req.body.suppliers) ? req.body.suppliers : []
      buyers = Array.isArray(req.body.buyers) ? req.body.buyers : []
      organizationId = req.body.organization_id
    } catch {
      return res.status(400).json({ error: 'Invalid request body.' })
    }

    // Fetch org company name
    let companyName = 'Unknown Trading Company'
    if (organizationId) {
      const supabaseService = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnon)
      const { data: orgRow } = await supabaseService.from('organization_settings').select('company_name').eq('organization_id', organizationId).single()
      if (orgRow?.company_name) companyName = orgRow.company_name
    }

    if (!rawText || !rawText.trim()) {
      return res.status(400).json({ error: 'No text provided to parse.' })
    }

    const supplierContext = suppliers && suppliers.length > 0
      ? `\n\nAvailable Suppliers (match abbreviations against these):\n${suppliers.map((s: Supplier) => `- "${s.company}" (email: ${s.email}${s.country ? ', country: ' + s.country : ''})`).join('\n')}`
      : ''

    const buyerContext = buyers && buyers.length > 0
      ? `\n\nAvailable Buyers (match abbreviations against these):\n${buyers.map((b: Buyer) => `- "${b.company}" (email: ${b.email}${b.country ? ', country: ' + b.country : ''})`).join('\n')}`
      : ''

    const userMessage = `Parse this purchase order text into structured data:\n\n${rawText}${supplierContext}${buyerContext}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    let response
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4096,
          system: getSystemPrompt(companyName),
          messages: [
            { role: 'user', content: userMessage }
          ],
        }),
        signal: controller.signal,
      })
    } catch (fetchErr: any) {
      clearTimeout(timeoutId)
      if (fetchErr.name === 'AbortError') {
        return res.status(504).json({ error: 'AI request timed out. Please try again.' })
      }
      throw fetchErr
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Anthropic API error:', response.status, errorText)

      if (response.status === 401) {
        return res.status(401).json({ error: 'Invalid API key.' })
      }
      if (response.status === 429) {
        return res.status(429).json({ error: 'API rate limit reached. Please try again in a moment.' })
      }

      return res.status(500).json({ error: `AI service error (${response.status}). Please try again.` })
    }

    const aiResponse = await response.json()
    const content = aiResponse.content?.[0]?.text || ''

    let parsed
    try {
      let jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      if (!jsonStr.startsWith('{')) {
        const firstBrace = jsonStr.indexOf('{')
        const lastBrace = jsonStr.lastIndexOf('}')
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          jsonStr = jsonStr.substring(firstBrace, lastBrace + 1)
        }
      }
      parsed = JSON.parse(jsonStr)
    } catch (parseErr) {
      console.error('Failed to parse AI response as JSON:', content)
      return res.status(500).json({ error: 'AI returned invalid data. Please try again.' })
    }

    let lineItems = Array.isArray(parsed.lineItems) ? parsed.lineItems.map((item: any) => ({
      product: String(item.product || ''),
      size: String(item.size || ''),
      glaze: String(item.glaze || ''),
      glazeMarked: String(item.glazeMarked || ''),
      packing: String(item.packing || ''),
      brand: String(item.brand || ''),
      freezing: String(item.freezing || 'IQF'),
      cases: item.cases && typeof item.cases === 'number' ? item.cases : (parseInt(item.cases) || ''),
      kilos: typeof item.kilos === 'number' ? item.kilos : (parseFloat(item.kilos) || ''),
      pricePerKg: typeof item.pricePerKg === 'number' ? item.pricePerKg : (parseFloat(item.pricePerKg) || ''),
      currency: String(item.currency || 'USD'),
      total: item.total && typeof item.total === 'number' ? item.total : (parseFloat(item.total) || ''),
    })) : []

    // Container sanity check — if AI got the cartons/kilos interpretation wrong, fix it
    const extractKgPerCase = (packing: string): number => {
      const m = packing.match(/(\d+)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(?:kg|kilo)?/i)
      if (m) return parseInt(m[1]) * parseFloat(m[2])
      return 0
    }

    const totalKilos = lineItems.reduce((sum: number, li: any) => sum + (parseFloat(li.kilos) || 0), 0)
    const hasPackingInfo = lineItems.some((li: any) => extractKgPerCase(li.packing) > 0)

    // If total kilos too low and packing info exists, quantities were probably cartons
    if (totalKilos > 0 && totalKilos < 5000 && hasPackingInfo) {
      const recalcTotal = lineItems.reduce((sum: number, li: any) => {
        const kgPerCase = extractKgPerCase(li.packing)
        const k = parseFloat(li.kilos) || 0
        return sum + (kgPerCase > 0 && k < 5000 ? k * kgPerCase : k)
      }, 0)
      if (recalcTotal >= 10000 && recalcTotal <= 30000) {
        console.log(`[PARSE-PO] Container sanity fix: ${totalKilos}kg → ${recalcTotal}kg (treating as cartons)`)
        lineItems = lineItems.map((li: any) => {
          const kgPerCase = extractKgPerCase(li.packing)
          const k = parseFloat(li.kilos) || 0
          if (kgPerCase > 0 && k < 5000) {
            const cases = k
            const kilos = cases * kgPerCase
            const price = parseFloat(li.pricePerKg) || 0
            return { ...li, cases, kilos, total: (kilos * price).toFixed(2) }
          }
          return li
        })
      }
    }

    // If total kilos too high, AI may have double-multiplied
    if (totalKilos > 50000 && hasPackingInfo) {
      const recalcTotal = lineItems.reduce((sum: number, li: any) => {
        const kgPerCase = extractKgPerCase(li.packing)
        const k = parseFloat(li.kilos) || 0
        return sum + (kgPerCase > 0 ? k / kgPerCase : k)
      }, 0)
      if (recalcTotal >= 10000 && recalcTotal <= 30000) {
        console.log(`[PARSE-PO] Container sanity fix: ${totalKilos}kg → ${recalcTotal}kg (undoing double multiply)`)
        lineItems = lineItems.map((li: any) => {
          const kgPerCase = extractKgPerCase(li.packing)
          const k = parseFloat(li.kilos) || 0
          if (kgPerCase > 0) {
            const kilos = Math.round(k / kgPerCase)
            const cases = Math.round(kilos / kgPerCase)
            const price = parseFloat(li.pricePerKg) || 0
            return { ...li, cases, kilos, total: (kilos * price).toFixed(2) }
          }
          return li
        })
      }
    }

    let detectedSupplierEmail = parsed.detectedSupplierEmail || ''
    if (parsed.detectedSupplier && !detectedSupplierEmail && suppliers) {
      const match = suppliers.find((s: Supplier) =>
        s.company.toLowerCase() === parsed.detectedSupplier.toLowerCase()
      )
      if (match) detectedSupplierEmail = match.email
    }

    const result = {
      lineItems,
      detectedSupplier: String(parsed.detectedSupplier || ''),
      detectedSupplierEmail,
      detectedBuyer: String(parsed.detectedBuyer || ''),
    }

    return res.status(200).json(result)
  } catch (err) {
    console.error('Edge function error:', err)
    return res.status(500).json({ error: 'An unexpected error occurred. Please try again.' })
  }
}
