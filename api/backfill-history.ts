import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// One-time endpoint to replace generic "System (Email Sync)" history entries
// with real email data from synced_emails table
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const setCors = (r: VercelResponse) => {
    r.setHeader('Access-Control-Allow-Origin', '*')
    r.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    r.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  }
  if (req.method === 'OPTIONS') { setCors(res); return res.status(200).end() }

  const secret = req.query.secret || req.headers['x-cron-secret']
  if (secret !== process.env.CRON_SECRET) {
    setCors(res)
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const organization_id = '1dc7be49-0354-4843-95e3-93b7064d19b9'

  try {
    // 1. Find all "System (Email Sync)" history entries
    const { data: systemEntries, error: fetchErr } = await supabase
      .from('order_history')
      .select('id, order_id, subject, timestamp')
      .eq('organization_id', organization_id)
      .eq('from_address', 'System (Email Sync)')

    if (fetchErr) {
      setCors(res)
      return res.status(500).json({ error: fetchErr.message })
    }

    if (!systemEntries || systemEntries.length === 0) {
      setCors(res)
      return res.status(200).json({ message: 'No system entries to backfill', count: 0 })
    }

    let updated = 0
    let replaced = 0

    for (const entry of systemEntries) {
      // Extract PO number from subject like "Order auto-created from email: ORIGINAL DOCUMENTS..."
      // We need the order_id (uuid) to find matched emails
      const orderId = entry.order_id

      // Get the order's PO number
      const { data: order } = await supabase
        .from('orders')
        .select('order_id')
        .eq('id', orderId)
        .single()

      if (!order) continue

      const poNumber = order.order_id // e.g. "GI/PO/25-26/3032"

      // Find all synced emails matched to this order
      const { data: matchedEmails } = await supabase
        .from('synced_emails')
        .select('id, from_email, from_name, subject, body_text, date, has_attachment, detected_stage')
        .eq('organization_id', organization_id)
        .eq('matched_order_id', poNumber)
        .order('date', { ascending: true })

      if (!matchedEmails || matchedEmails.length === 0) {
        // Also check user_linked_order_id
        const { data: userLinked } = await supabase
          .from('synced_emails')
          .select('id, from_email, from_name, subject, body_text, date, has_attachment, detected_stage')
          .eq('organization_id', organization_id)
          .eq('user_linked_order_id', orderId)
          .order('date', { ascending: true })

        if (!userLinked || userLinked.length === 0) continue

        // Use user-linked emails instead
        for (const email of userLinked) {
          await insertIfNew(orderId, organization_id, email)
          updated++
        }
      } else {
        // Insert actual email history entries
        for (const email of matchedEmails) {
          await insertIfNew(orderId, organization_id, email)
          updated++
        }
      }

      // Delete the generic system entry
      await supabase.from('order_history').delete().eq('id', entry.id)
      replaced++
    }

    setCors(res)
    return res.status(200).json({
      message: `Backfilled ${updated} real email entries, replaced ${replaced} system entries`,
      systemEntriesFound: systemEntries.length,
      emailsAdded: updated,
      systemEntriesRemoved: replaced,
    })
  } catch (err: any) {
    setCors(res)
    return res.status(500).json({ error: err.message })
  }
}

async function insertIfNew(orderId: string, orgId: string, email: any) {
  // Check for duplicate
  const { count } = await supabase.from('order_history')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId)
    .eq('subject', email.subject || 'No subject')
    .eq('timestamp', email.date || new Date().toISOString())

  if (count && count > 0) return

  await supabase.from('order_history').insert({
    order_id: orderId,
    organization_id: orgId,
    stage: email.detected_stage || 1,
    timestamp: email.date || new Date().toISOString(),
    from_address: email.from_name ? `${email.from_name} <${email.from_email}>` : email.from_email || 'Unknown',
    subject: email.subject || 'No subject',
    body: (email.body_text || '').substring(0, 5000),
    has_attachment: email.has_attachment || false,
  })
}
