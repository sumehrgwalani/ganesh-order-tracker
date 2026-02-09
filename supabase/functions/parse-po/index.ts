// Supabase Edge Function: parse-po
// Calls Claude Haiku to parse free-text purchase order input into structured data

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
      "packing": "string - packing format (e.g., '6 X 1 KG Bag', '10 KG Bulk') or empty string",
      "brand": "string - brand name or empty string",
      "freezing": "string - freezing method: 'IQF', 'Semi IQF', 'Blast', 'Block', 'Plate'. Default to 'IQF' if not specified",
      "cases": "number - total cartons/cases, or empty string if unknown. Calculate from kilos÷kgPerCarton if possible",
      "kilos": "number - total kilograms (if MT given, multiply by 1000). Calculate from cases×kgPerCarton if possible",
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

### Brands
- "(Marca Oliver)" → brand is "Oliver"
- "(Marca Bautismar)" → brand is "Bautismar"
- "EG Brand" or "EG brand" → brand is "EG"
- "Oliver brand" → brand is "Oliver"
- Brand can appear in parentheses with or without "Marca", or after the product with "brand/Brand"

### Quantities & Pricing
- Quantities can be given in KILOS, METRIC TONS, or CARTONS/CASES — these are different units!
- "07 MT" or "7 MT" = 7000 kg (multiply MT by 1000) → put in "kilos"
- "5000 kg" or "5000 kilos" → put in "kilos"
- "500 cartons" or "500 cases" or "500 cajas" or "500 ctns" or "500 ctn" → put in "cases"
- If quantity is given in CARTONS and packing is known, CALCULATE kilos: kilos = cases × kg-per-carton
  Example: "500 cartons, packing 6x1kg" → cases=500, kilos=500×6=3000
  Example: "200 cajas, packing 10kg bulk" → cases=200, kilos=200×10=2000
- If quantity is given in KILOS and packing is known, CALCULATE cases: cases = kilos ÷ kg-per-carton (round up)
  Example: "3000 kg, packing 6x1kg" → kilos=3000, cases=3000÷6=500
- If you cannot calculate one from the other (no packing info), just fill in what you have
- "cases" should be a number (integer) or empty string if unknown
- "kilos" should be a number or empty string if unknown
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
- Leave "total" as empty string - this is calculated by the frontend
- "cases" can be a number (integer) if known or calculable, or empty string if truly unknown
- "kilos" and "pricePerKg" should be numbers, not strings
- If glaze is mentioned with "marked as" or "marked", put in glazeMarked
- If only one glaze percentage, put it in "glaze" and leave "glazeMarked" empty`;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured. Please add it in Supabase Dashboard > Edge Functions > Secrets.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { rawText, suppliers, buyers } = await req.json();

    if (!rawText || !rawText.trim()) {
      return new Response(
        JSON.stringify({ error: 'No text provided to parse.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build context about available suppliers and buyers
    const supplierContext = suppliers && suppliers.length > 0
      ? `\n\nAvailable Suppliers (match abbreviations against these):\n${suppliers.map((s: Supplier) => `- "${s.company}" (email: ${s.email}${s.country ? ', country: ' + s.country : ''})`).join('\n')}`
      : '';

    const buyerContext = buyers && buyers.length > 0
      ? `\n\nAvailable Buyers (match abbreviations against these):\n${buyers.map((b: Buyer) => `- "${b.company}" (email: ${b.email}${b.country ? ', country: ' + b.country : ''})`).join('\n')}`
      : '';

    const userMessage = `Parse this purchase order text into structured data:\n\n${rawText}${supplierContext}${buyerContext}`;

    // Call Claude Haiku API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
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
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', response.status, errorText);

      if (response.status === 401) {
        return new Response(
          JSON.stringify({ error: 'Invalid API key. Please check your ANTHROPIC_API_KEY in Supabase secrets.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'API rate limit reached. Please try again in a moment.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: `AI service error (${response.status}). Please try again.` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiResponse = await response.json();
    const content = aiResponse.content?.[0]?.text || '';

    // Parse the JSON response from Claude
    let parsed;
    try {
      // Strip any markdown code fences if present
      const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error('Failed to parse AI response as JSON:', content);
      return new Response(
        JSON.stringify({ error: 'AI returned invalid data. Please try again.', raw: content }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate and sanitize the response
    const lineItems = Array.isArray(parsed.lineItems) ? parsed.lineItems.map((item: any) => ({
      product: String(item.product || ''),
      size: String(item.size || ''),
      glaze: String(item.glaze || ''),
      glazeMarked: String(item.glazeMarked || ''),
      packing: String(item.packing || ''),
      brand: String(item.brand || ''),
      freezing: String(item.freezing || 'IQF'),
      cases: typeof item.cases === 'number' ? item.cases : (parseInt(item.cases) || ''),
      kilos: typeof item.kilos === 'number' ? item.kilos : (parseFloat(item.kilos) || ''),
      pricePerKg: typeof item.pricePerKg === 'number' ? item.pricePerKg : (parseFloat(item.pricePerKg) || ''),
      currency: String(item.currency || 'USD'),
      total: '',
    })) : [];

    // Look up supplier details if detected
    let detectedSupplierEmail = parsed.detectedSupplierEmail || '';
    if (parsed.detectedSupplier && !detectedSupplierEmail && suppliers) {
      const match = suppliers.find((s: Supplier) =>
        s.company.toLowerCase() === parsed.detectedSupplier.toLowerCase()
      );
      if (match) detectedSupplierEmail = match.email;
    }

    const result = {
      lineItems,
      detectedSupplier: String(parsed.detectedSupplier || ''),
      detectedSupplierEmail,
      detectedBuyer: String(parsed.detectedBuyer || ''),
    };

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Edge function error:', err);
    return new Response(
      JSON.stringify({ error: 'An unexpected error occurred. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
