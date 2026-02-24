import type { VercelRequest, VercelResponse } from '@vercel/node'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

const SYSTEM_PROMPT = `You are an expert seafood trading order parser for Ganesh International, a frozen foods trading company. Your task is to extract structured purchase order data from natural language input.

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
      "cases": "",
      "kilos": "number - total kilograms (if MT given, multiply by 1000)",
      "pricePerKg": "number - price per kilogram",
      "currency": "string - 'USD' or 'EUR' based on $ or euro symbols. Default 'USD'",
      "total": ""
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
- Leave "cases" and "total" as empty strings - these are calculated by the frontend
- "kilos" and "pricePerKg" should be numbers, not strings
- If glaze is mentioned with "marked as" or "marked", put in glazeMarked
- If only one glaze percentage, put it in "glaze" and leave "glazeMarked" empty`;

function setCors(res: VercelResponse) {
  for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured.' })
    }

    let rawText: string, suppliers: any[], buyers: any[]
    try {
      rawText = req.body.rawText
      suppliers = Array.isArray(req.body.suppliers) ? req.body.suppliers : []
      buyers = Array.isArray(req.body.buyers) ? req.body.buyers : []
    } catch {
      return res.status(400).json({ error: 'Invalid request body.' })
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
          system: SYSTEM_PROMPT,
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
      return res.status(500).json({ error: 'AI returned invalid data. Please try again.', raw: content })
    }

    const lineItems = Array.isArray(parsed.lineItems) ? parsed.lineItems.map((item: any) => ({
      product: String(item.product || ''),
      size: String(item.size || ''),
      glaze: String(item.glaze || ''),
      glazeMarked: String(item.glazeMarked || ''),
      packing: String(item.packing || ''),
      brand: String(item.brand || ''),
      freezing: String(item.freezing || 'IQF'),
      cases: '',
      kilos: typeof item.kilos === 'number' ? item.kilos : (parseFloat(item.kilos) || ''),
      pricePerKg: typeof item.pricePerKg === 'number' ? item.pricePerKg : (parseFloat(item.pricePerKg) || ''),
      currency: String(item.currency || 'USD'),
      total: '',
    })) : []

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
