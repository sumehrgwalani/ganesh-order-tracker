import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', 'https://ganesh-order-tracker.vercel.app')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
}

// Refresh Gmail access token
async function refreshGmailToken(refreshToken: string, clientId: string, clientSecret: string): Promise<string | null> {
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' }),
    })
    const d = await r.json()
    if (d.error) { console.error('Token refresh failed:', d.error); return null }
    return d.access_token
  } catch (err) { console.error('Token refresh error:', err); return null }
}

// Get attachment parts from a Gmail message
function extractAttachmentParts(payload: any): { filename: string; mimeType: string; attachmentId: string; size: number }[] {
  const parts: any[] = []
  function walk(p: any) {
    if (p.filename && p.filename.length > 0 && p.body?.attachmentId) {
      const lower = p.filename.toLowerCase()
      // Skip inline images
      if (/^image\d{0,3}\.(jpg|jpeg|png|gif)$/.test(lower)) return
      if (/^outlook-.*\.(jpg|jpeg|png|gif)$/.test(lower)) return
      parts.push({ filename: p.filename, mimeType: p.mimeType || 'application/octet-stream', attachmentId: p.body.attachmentId, size: p.body.size || 0 })
    }
    if (p.parts) p.parts.forEach(walk)
  }
  if (payload) walk(payload)
  return parts
}

// Download attachment binary from Gmail
async function downloadAttachment(accessToken: string, messageId: string, attachmentId: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!r.ok) { console.error(`Attachment download failed: ${r.status}`); return null }
    const data = await r.json()
    if (!data.data) return null
    const b64 = data.data.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch (err) { console.error('Attachment download error:', err); return null }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const authHeader = req.headers.authorization
  if (!authHeader) return res.status(401).json({ error: 'No auth' })

  const supabaseUrl = process.env.SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabaseAnon = process.env.SUPABASE_ANON_KEY! || supabaseKey

  const userClient = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } }
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' })

  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    const { history_entry_id, target_stage, organization_id } = req.body
    if (!history_entry_id || !organization_id) {
      return res.status(400).json({ error: 'Missing history_entry_id or organization_id' })
    }
    const stage = target_stage || null // null means keep same stage

    // 1. Get the history entry to find subject/order
    const { data: historyEntry } = await supabase
      .from('order_history')
      .select('id, order_id, subject, timestamp, stage, attachments')
      .eq('id', history_entry_id)
      .single()

    if (!historyEntry) return res.status(404).json({ error: 'History entry not found' })

    // 2. Get order info (po_number)
    const { data: order } = await supabase
      .from('orders')
      .select('order_id, po_number')
      .eq('id', historyEntry.order_id)
      .single()

    if (!order) return res.status(404).json({ error: 'Order not found' })

    // 3. Find matching synced_email by subject + order
    const { data: syncedEmails } = await supabase
      .from('synced_emails')
      .select('gmail_id, subject, has_attachment')
      .eq('organization_id', organization_id)
      .eq('matched_order_id', order.order_id)
      .eq('has_attachment', true)
      .ilike('subject', historyEntry.subject?.substring(0, 100) || '')
      .limit(1)

    // Fallback: try broader match if exact subject didn't work
    let gmailId = syncedEmails?.[0]?.gmail_id
    if (!gmailId) {
      // Try matching by timestamp proximity
      const { data: fallbackEmails } = await supabase
        .from('synced_emails')
        .select('gmail_id, subject, has_attachment, date')
        .eq('organization_id', organization_id)
        .eq('matched_order_id', order.order_id)
        .eq('has_attachment', true)
        .order('date', { ascending: false })
        .limit(10)

      // Find closest match by subject similarity
      if (fallbackEmails?.length) {
        const entrySubject = (historyEntry.subject || '').toLowerCase()
        const match = fallbackEmails.find((e: any) =>
          entrySubject.includes(e.subject?.toLowerCase()?.substring(0, 30) || '###') ||
          (e.subject || '').toLowerCase().includes(entrySubject.substring(0, 30))
        )
        gmailId = match?.gmail_id || fallbackEmails[0].gmail_id
      }
    }

    if (!gmailId) return res.status(404).json({ error: 'Could not find Gmail message for this email. The attachment cannot be downloaded.' })

    // 4. Get Gmail credentials
    const { data: member } = await supabase
      .from('organization_members')
      .select('gmail_refresh_token')
      .eq('organization_id', organization_id)
      .eq('user_id', user.id)
      .single()

    if (!member?.gmail_refresh_token) {
      return res.status(400).json({ error: 'No Gmail connection found. Please reconnect Gmail.' })
    }

    const { data: settings } = await supabase
      .from('organization_settings')
      .select('gmail_client_id, gmail_client_secret')
      .eq('organization_id', organization_id)
      .single()

    if (!settings?.gmail_client_id) {
      return res.status(400).json({ error: 'Gmail not configured for this organization.' })
    }

    // 5. Refresh Gmail token
    const accessToken = await refreshGmailToken(member.gmail_refresh_token, settings.gmail_client_id, settings.gmail_client_secret)
    if (!accessToken) return res.status(500).json({ error: 'Failed to refresh Gmail token' })

    // 6. Get attachment parts from the Gmail message
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailId}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!msgRes.ok) return res.status(500).json({ error: 'Failed to fetch Gmail message' })
    const msg = await msgRes.json()
    const parts = extractAttachmentParts(msg.payload)

    if (parts.length === 0) return res.status(404).json({ error: 'No downloadable attachments found in this email' })

    // 7. Download and store each attachment
    const finalStage = stage || historyEntry.stage
    const safePo = (order.po_number || 'unknown').replace(/[^a-zA-Z0-9-_]/g, '_')
    const stored: string[] = []

    for (const part of parts) {
      const fileData = await downloadAttachment(accessToken, gmailId, part.attachmentId)
      if (!fileData) { console.log(`Failed to download ${part.filename}`); continue }

      // Upload to Supabase Storage
      const path = `${organization_id}/${safePo}/${part.filename}`
      const { error: uploadErr } = await supabase.storage.from('po-documents').upload(path, fileData, { contentType: part.mimeType, upsert: true })
      if (uploadErr) { console.error(`Upload error for ${part.filename}:`, uploadErr.message); continue }
      const { data: urlData } = supabase.storage.from('po-documents').getPublicUrl(path)
      const publicUrl = urlData?.publicUrl
      if (!publicUrl) continue

      // Store in order_history
      const attachmentEntry = JSON.stringify({ name: part.filename, meta: { pdfUrl: publicUrl } })
      const existing = historyEntry.attachments || []

      // Dedup
      const alreadyExists = existing.some((entry: string) => {
        try { return JSON.parse(entry).name === part.filename } catch { return false }
      })

      if (!alreadyExists) {
        existing.push(attachmentEntry)
      }

      stored.push(part.filename)
    }

    // 8. Update the history entry with attachments (and optionally new stage)
    const updateData: any = {
      attachments: historyEntry.attachments || [],
      has_attachment: true,
    }

    // Merge all stored attachments
    for (const fname of stored) {
      const safePo2 = (order.po_number || 'unknown').replace(/[^a-zA-Z0-9-_]/g, '_')
      const path = `${organization_id}/${safePo2}/${fname}`
      const { data: urlData } = supabase.storage.from('po-documents').getPublicUrl(path)
      const publicUrl = urlData?.publicUrl
      if (!publicUrl) continue

      const entry = JSON.stringify({ name: fname, meta: { pdfUrl: publicUrl } })
      const exists = (updateData.attachments as string[]).some((e: string) => {
        try { return JSON.parse(e).name === fname } catch { return false }
      })
      if (!exists) updateData.attachments.push(entry)
    }

    if (stage && stage !== historyEntry.stage) {
      updateData.stage = stage
    }

    await supabase.from('order_history').update(updateData).eq('id', history_entry_id)

    setCors(res)
    return res.status(200).json({
      success: true,
      downloaded: stored.length,
      filenames: stored,
      message: `Downloaded ${stored.length} attachment(s) from Gmail`
    })

  } catch (err: any) {
    console.error('download-email-attachment error:', err)
    setCors(res)
    return res.status(500).json({ error: err.message || 'Internal error' })
  }
}
