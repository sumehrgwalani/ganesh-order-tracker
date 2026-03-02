import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// ===== CORS =====

const ALLOWED_ORIGIN = 'https://ganesh-order-tracker.vercel.app'

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
}

// ===== AUTH =====

/**
 * Authenticate the request and return the user + service-role Supabase client.
 * Sends an error response and returns null if auth fails.
 */
async function authenticateRequest(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization' })
    return null
  }

  const supabaseUrl = process.env.SUPABASE_URL!
  const supabaseAnon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
  const userClient = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) {
    res.status(401).json({ error: 'Authentication failed. Please log in again.' })
    return null
  }

  const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  return { user, supabase }
}

// ===== NORMALIZE COMPANY NAME =====

/**
 * Normalize a company name to a canonical form.
 * Strips extra spaces, normalizes dots/periods, standardizes common abbreviations.
 */
function normalizeCompanyName(name: string): string {
  if (!name) return ''
  let n = name.trim()

  // Collapse multiple spaces
  n = n.replace(/\s+/g, ' ')

  // Normalize common suffixes
  n = n.replace(/\bS\s*\.\s*L\s*\.?\b/gi, 'S.L.')
  n = n.replace(/\bPvt\s*\.?\s*Ltd\s*\.?\b/gi, 'Pvt. Ltd.')
  n = n.replace(/\bPrivate\s+Limited\b/gi, 'Pvt. Ltd.')
  n = n.replace(/\bLtd\s*\.?\b/gi, 'Ltd.')
  n = n.replace(/\bInc\s*\.?\b/gi, 'Inc.')
  n = n.replace(/\bCorp\s*\.?\b/gi, 'Corp.')
  n = n.replace(/\bL\s*\.\s*L\s*\.\s*C\s*\.?\b/gi, 'LLC')
  n = n.replace(/\bS\s*\.\s*A\s*\.?\b/gi, 'S.A.')
  n = n.replace(/\bG\s*\.?\s*m\s*\.?\s*b\s*\.?\s*H\s*\.?\b/gi, 'GmbH')

  // Collapse spaces again after replacements
  n = n.replace(/\s+/g, ' ').trim()

  return n
}

export { normalizeCompanyName }

/**
 * Generate a simplified key for fuzzy matching.
 * Strips all punctuation and lowercases for comparison.
 */
function matchKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const auth = await authenticateRequest(req, res)
    if (!auth) return
    const { user, supabase } = auth

    const { organization_id, dry_run } = req.body || {}
    if (!organization_id) {
      return res.status(400).json({ error: 'Missing organization_id' })
    }

    // Verify membership
    const { data: membership } = await supabase
      .from('organization_members')
      .select('id')
      .eq('organization_id', organization_id)
      .eq('user_id', user.id)
      .single()
    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this organization' })
    }

    // Get all contacts for this org
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, company, name, email')
      .eq('organization_id', organization_id)

    // Get all orders for this org
    const { data: orders } = await supabase
      .from('orders')
      .select('id, order_id, company, supplier')
      .eq('organization_id', organization_id)
      .is('deleted_at', null)

    // Group company names by their match key
    const companyGroups: Record<string, { original: string; count: number }[]> = {}

    const allCompanyNames = new Set<string>()
    for (const c of contacts || []) {
      if (c.company) allCompanyNames.add(c.company)
    }
    for (const o of orders || []) {
      if (o.company) allCompanyNames.add(o.company)
      if (o.supplier) allCompanyNames.add(o.supplier)
    }

    for (const name of allCompanyNames) {
      const key = matchKey(normalizeCompanyName(name))
      if (!companyGroups[key]) companyGroups[key] = []

      // Count how many records use this exact name
      const contactCount = (contacts || []).filter(c => c.company === name).length
      const orderBuyerCount = (orders || []).filter(o => o.company === name).length
      const orderSupplierCount = (orders || []).filter(o => o.supplier === name).length

      companyGroups[key].push({
        original: name,
        count: contactCount + orderBuyerCount + orderSupplierCount,
      })
    }

    // Find groups with duplicates
    const duplicates: { canonical: string; variants: { original: string; count: number }[] }[] = []
    const renames: { from: string; to: string }[] = []

    for (const [, group] of Object.entries(companyGroups)) {
      if (group.length <= 1) continue

      // Pick the canonical name: the one with the most records, or the normalized form
      group.sort((a, b) => b.count - a.count)
      const canonical = normalizeCompanyName(group[0].original)

      duplicates.push({ canonical, variants: group })

      for (const variant of group) {
        if (variant.original !== canonical) {
          renames.push({ from: variant.original, to: canonical })
        }
      }
    }

    if (dry_run || duplicates.length === 0) {
      return res.status(200).json({
        duplicates,
        renames,
        totalDuplicateGroups: duplicates.length,
        message: dry_run ? 'Dry run — no changes made' : 'No duplicates found',
      })
    }

    // Apply renames
    let contactsUpdated = 0
    let ordersCompanyUpdated = 0
    let ordersSupplierUpdated = 0

    for (const { from, to } of renames) {
      // Update contacts
      const cResult = await supabase
        .from('contacts')
        .update({ company: to })
        .eq('organization_id', organization_id)
        .eq('company', from)
        .select('id', { count: 'exact', head: true })
      contactsUpdated += cResult.count || 0

      // Update orders — company (buyer)
      const oBuyerResult = await supabase
        .from('orders')
        .update({ company: to })
        .eq('organization_id', organization_id)
        .eq('company', from)
        .is('deleted_at', null)
        .select('id', { count: 'exact', head: true })
      ordersCompanyUpdated += oBuyerResult.count || 0

      // Update orders — supplier
      const oSupResult = await supabase
        .from('orders')
        .update({ supplier: to })
        .eq('organization_id', organization_id)
        .eq('supplier', from)
        .is('deleted_at', null)
        .select('id', { count: 'exact', head: true })
      ordersSupplierUpdated += oSupResult.count || 0
    }

    return res.status(200).json({
      success: true,
      duplicates,
      renames,
      applied: {
        contactsUpdated,
        ordersCompanyUpdated,
        ordersSupplierUpdated,
      },
    })
  } catch (err: any) {
    console.error('[NORMALIZE-COMPANIES] Error:', err)
    return res.status(500).json({ error: err.message || 'Something went wrong' })
  }
}
