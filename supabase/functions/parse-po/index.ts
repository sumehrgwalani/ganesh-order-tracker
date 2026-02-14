// Supabase Edge Function: parse-po
// Calls Claude Haiku to parse free-text purchase order input into structured data

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGIN = 'https://sumehrgwalani.github.io';

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
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
- If a Product Catalog is provided below, PREFER matching product names from the catalog. Use the exact catalog name format. If the catalog lists default glaze/freeze for a product and the input doesn't specify, use the catalog defaults.
- Common product types: Squid (Tubes, Rings, Cut, Whole, Baby), Cuttlefish (Whole Cleaned, Strips), Octopus, Shrimp, Vannamei, Ribbon Fish
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
    // Verify the caller is authenticated via JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured. Please add it in Supabase Dashboard > Edge Functions > Secrets.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let rawText: string, suppliers: any, buyers: any, orgId: string | undefined;
    try {
      const body = await req.json();
      rawText = body.rawText;
      suppliers = Array.isArray(body.suppliers) ? body.suppliers : [];
      buyers = Array.isArray(body.buyers) ? body.buyers : [];
      orgId = typeof body.orgId === 'string' ? body.orgId : undefined;
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid request body. Please send valid JSON.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!rawText || !rawText.trim()) {
      return new Response(
        JSON.stringify({ error: 'No text provided to parse.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Input length validation — reject excessively large inputs
    if (rawText.length > 50000) {
      return new Response(
        JSON.stringify({ error: 'Input text too large. Please limit to 50,000 characters.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch product catalog for better AI accuracy
    let productCatalogContext = '';
    if (orgId) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        const { data: products } = await supabase
          .from('products')
          .select('name, size, glaze, freeze_type, markets')
          .eq('organization_id', orgId)
          .eq('is_active', true);

        if (products && products.length > 0) {
          // Group by product name to keep it compact
          const grouped = new Map<string, { sizes: Set<string>, glazes: Set<string>, freezes: Set<string>, markets: Set<string> }>();
          for (const p of products) {
            if (!grouped.has(p.name)) {
              grouped.set(p.name, { sizes: new Set(), glazes: new Set(), freezes: new Set(), markets: new Set() });
            }
            const g = grouped.get(p.name)!;
            if (p.size) g.sizes.add(p.size);
            if (p.glaze != null) g.glazes.add(Math.round(p.glaze * 100) + '%');
            if (p.freeze_type) g.freezes.add(p.freeze_type);
            if (p.markets) p.markets.split(',').forEach((m: string) => g.markets.add(m.trim()));
          }

          const catalogLines = Array.from(grouped).map(([name, attrs]) => {
            const parts = [name];
            if (attrs.sizes.size > 0) parts.push(`Sizes: ${[...attrs.sizes].join(', ')}`);
            if (attrs.glazes.size > 0) parts.push(`Glaze: ${[...attrs.glazes].join(', ')}`);
            if (attrs.freezes.size > 0) parts.push(`Freeze: ${[...attrs.freezes].join(', ')}`);
            return parts.join(' | ');
          }).join('\n');

          productCatalogContext = `\n\nProduct Catalog (use these exact product names and attributes when matching):\n${catalogLines}`;
        }
      } catch (err) {
        console.error('Could not fetch product catalog:', err);
        // Continue without catalog — not a blocker
      }
    }

    // Build context about available suppliers and buyers
    const supplierContext = suppliers && suppliers.length > 0
      ? `\n\nAvailable Suppliers (match abbreviations against these):\n${suppliers.map((s: Supplier) => `- "${s.company}" (email: ${s.email}${s.country ? ', country: ' + s.country : ''})`).join('\n')}`
      : '';

    const buyerContext = buyers && buyers.length > 0
      ? `\n\nAvailable Buyers (match abbreviations against these):\n${buyers.map((b: Buyer) => `- "${b.company}" (email: ${b.email}${b.country ? ', country: ' + b.country : ''})`).join('\n')}`
      : '';

    const userMessage = `Parse this purchase order text into structured data:\n\n${rawText}${supplierContext}${buyerContext}${productCatalogContext}`;

    // Call Claude Haiku API with 30-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    let response: Response;
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
      });
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') {
        return new Response(
          JSON.stringify({ error: 'AI request timed out. Please try again.' }),
          { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw fetchErr;
    } finally {
      clearTimeout(timeoutId);
    }

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

    // Parse the JSON response from Claude - robust extraction
    let parsed;
    try {
      // First try direct parse
      let jsonStr = content.trim();
      // Strip markdown code fences if present
      jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      // If still not valid, find the first { to last } as fallback
      if (!jsonStr.startsWith('{')) {
        const firstBrace = jsonStr.indexOf('{');
        const lastBrace = jsonStr.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
        }
      }
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
