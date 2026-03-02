import type { VercelRequest, VercelResponse } from '@vercel/node'
import { setCors, authenticateRequest } from './_utils/shared'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const auth = await authenticateRequest(req, res)
  if (!auth) return
  const { user, supabase } = auth

  const { action, order_id, organization_id, moves } = req.body || {}

  // Verify user belongs to this organization
  if (organization_id) {
    const { data: membership } = await supabase
      .from('organization_members')
      .select('id')
      .eq('organization_id', organization_id)
      .eq('user_id', user.id)
      .single()
    if (!membership) return res.status(403).json({ error: 'Not a member of this organization' })
  }

  // action: "move_attachments"
  // moves: [{ filename: "xxx.pdf", from_stage: 5, to_stage: 7 }, ...]
  if (action !== 'move_attachments' || !order_id || !organization_id || !moves?.length) {
    return res.status(400).json({ error: 'Need action=move_attachments, order_id, organization_id, moves[]' })
  }

  // Get the order UUID
  const { data: orderRow } = await supabase
    .from('orders')
    .select('id')
    .eq('order_id', order_id)
    .eq('organization_id', organization_id)
    .single()

  if (!orderRow) return res.status(404).json({ error: `Order ${order_id} not found` })
  const orderUuid = orderRow.id

  const results: any[] = []

  for (const move of moves) {
    const { filename, from_stage, to_stage } = move
    if (!filename || !from_stage || !to_stage) {
      results.push({ filename, error: 'Missing filename/from_stage/to_stage' })
      continue
    }

    // Find source history entry with this attachment
    const { data: sourceRows } = await supabase
      .from('order_history')
      .select('id, attachments, stage')
      .eq('order_id', orderUuid)
      .eq('stage', from_stage)
      .order('timestamp', { ascending: false })

    let found = false
    let attachmentEntry: string | null = null

    for (const row of (sourceRows || [])) {
      const attachments = row.attachments || []
      const idx = attachments.findIndex((a: string) => {
        try { return JSON.parse(a).name === filename }
        catch { return a.includes(filename) }
      })
      if (idx >= 0) {
        // Remove from source
        attachmentEntry = attachments[idx]
        const updated = [...attachments]
        updated.splice(idx, 1)
        await supabase.from('order_history').update({
          attachments: updated,
          has_attachment: updated.length > 0,
        }).eq('id', row.id)
        found = true
        break
      }
    }

    if (!found || !attachmentEntry) {
      results.push({ filename, error: `Not found in stage ${from_stage}` })
      continue
    }

    // Add to target stage
    const { data: targetRows } = await supabase
      .from('order_history')
      .select('id, attachments')
      .eq('order_id', orderUuid)
      .eq('stage', to_stage)
      .order('timestamp', { ascending: false })
      .limit(1)

    if (targetRows && targetRows.length > 0) {
      const existing = targetRows[0].attachments || []
      await supabase.from('order_history').update({
        attachments: [...existing, attachmentEntry],
        has_attachment: true,
      }).eq('id', targetRows[0].id)
    } else {
      // Create new history entry for this stage
      await supabase.from('order_history').insert({
        organization_id,
        order_id: orderUuid,
        stage: to_stage,
        from_address: 'System',
        subject: 'Document reassigned',
        body: `Attachment moved from stage ${from_stage} to stage ${to_stage}`,
        timestamp: new Date().toISOString(),
        has_attachment: true,
        attachments: [attachmentEntry],
      })
    }

    results.push({ filename, moved: `stage ${from_stage} → stage ${to_stage}` })

    // Log correction so AI can learn from this move
    try {
      await supabase.from('correction_log').insert({
        organization_id,
        order_id,
        correction_type: 'stage_move',
        filename,
        from_stage,
        to_stage,
        note: `Attachment moved from stage ${from_stage} to stage ${to_stage}`,
      })
    } catch (logErr) {
      console.log('Failed to log correction:', logErr)
    }
  }

  return res.status(200).json({ success: true, results })
}
