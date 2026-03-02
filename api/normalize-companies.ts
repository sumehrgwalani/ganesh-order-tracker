import type { VercelRequest, VercelResponse } from '@vercel/node'
import { setCors, authenticateRequest } from './_utils/shared'
import { normalizeCompanyName } from './_utils/normalizeCompany'
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
