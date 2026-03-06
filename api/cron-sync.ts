import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// ===== GMAIL HELPERS =====

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

// Extract name from email "Name <email@example.com>" format
function extractName(emailStr: string): string {
  const match = emailStr.match(/^"?([^"<]+)"?\s*</)
  return match ? match[1].trim() : emailStr.split('@')[0]
}

// Extract email from "Name <email@example.com>" format
function extractEmail(emailStr: string): string {
  const match = emailStr.match(/<([^>]+)>/)
  return match ? match[1] : emailStr
}

/**
 * Vercel Cron endpoint — runs daily at 6 AM UTC to keep emails up to date.
 * Authenticates via CRON_SECRET header, not user JWT.
 * Finds the first org member with a Gmail refresh token and runs:
 *   1. Pull (download new emails from Gmail)
 *   2. Match (AI-match emails to orders)
 *   3. Reprocess (download attachments)
 *   4. Extract (extract PO line items)
 */

const BASE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://ganesh-order-tracker.vercel.app'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Verify cron secret
    const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.authorization
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const supabaseUrl = process.env.SUPABASE_URL!
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Find first org member with a Gmail refresh token
    const { data: members, error: membersErr } = await supabase
      .from('organization_members')
      .select('user_id, organization_id, gmail_refresh_token, gmail_email')
      .not('gmail_refresh_token', 'is', null)
      .limit(1)

    if (membersErr || !members || members.length === 0) {
      return res.status(200).json({ skipped: true, reason: 'No Gmail-connected members found' })
    }

    const member = members[0]
    const { user_id, organization_id } = member

    // Generate a service-level JWT for the user so sync-emails accepts it
    // We use Supabase admin to create a session for this user
    const { data: userData, error: userErr } = await supabase.auth.admin.getUserById(user_id)
    if (userErr || !userData?.user) {
      return res.status(200).json({ skipped: true, reason: 'User not found' })
    }

    // Generate a short-lived token for this user (impersonation for internal use only)
    // Supabase doesn't have a direct "generate JWT for user" admin API,
    // so we'll modify sync-emails to accept cron auth instead.
    // For now, call sync-emails internally by importing its logic.

    // Actually, the simplest approach: call each phase directly using
    // the service role key + a special cron mode that skips user auth.
    // Let's do the sync work right here instead of HTTP calls.

    console.log(`[CRON] Starting auto-sync for org ${organization_id}, user ${user_id} (${member.gmail_email})`)

    // Get org settings for Gmail client_id
    const { data: settings } = await supabase
      .from('organization_settings')
      .select('gmail_client_id')
      .eq('organization_id', organization_id)
      .single()

    if (!settings?.gmail_client_id) {
      return res.status(200).json({ skipped: true, reason: 'Gmail not configured for org' })
    }

    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!
    if (!clientSecret) {
      return res.status(200).json({ skipped: true, reason: 'GOOGLE_CLIENT_SECRET missing' })
    }

    // Refresh Gmail access token
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
    if (tokenData.error) {
      console.error(`[CRON] Token refresh failed: ${tokenData.error}`)
      return res.status(200).json({ skipped: true, reason: `Token refresh failed: ${tokenData.error}` })
    }
    const accessToken = tokenData.access_token
    console.log('[CRON] Gmail token refreshed OK')

    // ---- PHASE 1: PULL new emails ----
    // Look back 7 days for incremental sync
    const lookbackDays = 7
    const afterEpoch = Math.floor((Date.now() - lookbackDays * 24 * 60 * 60 * 1000) / 1000)
    const query = `after:${afterEpoch}`

    let messageIds: string[] = []
    let pageToken: string | undefined = undefined
    do {
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=500` + (pageToken ? `&pageToken=${pageToken}` : '')
      const listRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      const listData = await listRes.json()
      const ids = (listData.messages || []).map((m: any) => m.id)
      messageIds = messageIds.concat(ids)
      pageToken = listData.nextPageToken
    } while (pageToken && messageIds.length < 500)

    // Check which we already have
    const { data: existingEmails } = await supabase
      .from('synced_emails')
      .select('gmail_id')
      .eq('organization_id', organization_id)
      .eq('connected_user_id', user_id)
      .in('gmail_id', messageIds.length > 0 ? messageIds : ['__none__'])

    const existingIds = new Set((existingEmails || []).map((e: any) => e.gmail_id))
    const newMessageIds = messageIds.filter((id: string) => !existingIds.has(id))
    console.log(`[CRON] Pull: ${messageIds.length} total, ${existingIds.size} already had, ${newMessageIds.length} new`)

    // Fetch and store new emails
    let storedCount = 0
    const toFetch = newMessageIds.slice(0, 200) // Cap at 200 per cron run
    const BATCH_SIZE = 10

    for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
      const batch = toFetch.slice(i, i + BATCH_SIZE)
      const batchResults = await Promise.all(
        batch.map(async (msgId: string) => {
          try {
            const msgRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
              { headers: { Authorization: `Bearer ${accessToken}` } }
            )
            const msg = await msgRes.json()
            const headers = msg.payload?.headers || []
            const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || ''
            const body = extractBody(msg.payload)
            const attachmentParts = extractAttachmentParts(msg.payload)

            return {
              gmail_id: msgId,
              from_email: extractEmail(getHeader('From')),
              from_name: extractName(getHeader('From')),
              to_email: extractEmail(getHeader('To')),
              subject: getHeader('Subject'),
              body_text: body.substring(0, 5000),
              date: getHeader('Date'),
              has_attachment: attachmentParts.length > 0,
            }
          } catch (err) {
            console.error(`[CRON] Failed to fetch message ${msgId}:`, err)
            return null
          }
        })
      )
      for (const email of batchResults) {
        if (!email) continue
        const { error: insertError } = await supabase
          .from('synced_emails')
          .upsert({
            organization_id,
            gmail_id: email.gmail_id,
            from_email: email.from_email,
            from_name: email.from_name,
            to_email: email.to_email,
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
    }

    // Update last sync time
    await supabase.from('organization_members')
      .update({ gmail_last_sync: new Date().toISOString() })
      .eq('user_id', user_id)
      .eq('organization_id', organization_id)

    console.log(`[CRON] Pull done: ${storedCount} new emails stored`)

    // ---- PHASE 2: MATCH unmatched emails (up to 30) ----
    // We call the sync-emails endpoint for match/reprocess/extract phases
    // since they contain complex AI logic. We need a user JWT for that.
    // Generate one using admin API.
    let matchedCount = 0
    let reprocessedCount = 0
    let extractedCount = 0

    // Try to generate a magic link token for the user
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: userData.user.email!,
    })

    if (!linkErr && linkData?.properties?.access_token) {
      const userToken = linkData.properties.access_token
      const syncUrl = `${BASE_URL}/api/sync-emails`

      // Phase 2: Match (up to 2 rounds of 15)
      for (let round = 0; round < 2; round++) {
        try {
          const matchRes = await fetch(syncUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${userToken}`,
            },
            body: JSON.stringify({ organization_id, user_id, mode: 'match' }),
          })
          const matchData = await matchRes.json()
          if (matchData.error) { console.log(`[CRON] Match error: ${matchData.error}`); break }
          matchedCount += matchData.matched || 0
          if (matchData.done) break
        } catch (err) {
          console.error('[CRON] Match call failed:', err)
          break
        }
      }
      console.log(`[CRON] Match done: ${matchedCount} emails matched`)

      // Phase 3: Reprocess attachments (up to 3 rounds of 5)
      for (let round = 0; round < 3; round++) {
        try {
          const rpRes = await fetch(syncUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${userToken}`,
            },
            body: JSON.stringify({ organization_id, user_id, mode: 'reprocess' }),
          })
          const rpData = await rpRes.json()
          if (rpData.error) { console.log(`[CRON] Reprocess error: ${rpData.error}`); break }
          reprocessedCount += rpData.processed || 0
          if (rpData.done) break
        } catch (err) {
          console.error('[CRON] Reprocess call failed:', err)
          break
        }
      }
      console.log(`[CRON] Reprocess done: ${reprocessedCount} emails processed`)

      // Phase 4: Extract line items (1 round of 3)
      try {
        const extRes = await fetch(syncUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userToken}`,
          },
          body: JSON.stringify({ organization_id, user_id, mode: 'bulk-extract' }),
        })
        const extData = await extRes.json()
        if (!extData.error) extractedCount = extData.extracted || 0
      } catch (err) {
        console.error('[CRON] Extract call failed:', err)
      }
      console.log(`[CRON] Extract done: ${extractedCount} orders extracted`)

      // Phase 5: Run AI agents (follow-up, payment, briefing)
      const agentUrl = `${BASE_URL}/api/agents`
      const agentModes = ['follow_up', 'payment', 'briefing']
      // Run supplier scoring only on Mondays
      if (new Date().getDay() === 1) agentModes.push('supplier_score')

      for (const agentMode of agentModes) {
        try {
          const agentRes = await fetch(agentUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${userToken}`,
            },
            body: JSON.stringify({ organization_id, user_id, mode: agentMode }),
          })
          const agentData = await agentRes.json()
          console.log(`[CRON] Agent ${agentMode}: ${agentData.processed || 0} insights`)
        } catch (err) {
          console.error(`[CRON] Agent ${agentMode} failed:`, err)
        }
      }
      console.log('[CRON] Phase 5 (agents) done')
    } else {
      console.log(`[CRON] Could not generate user token for match/reprocess/extract phases: ${linkErr?.message || 'no token'}`)
    }

    return res.status(200).json({
      success: true,
      pulled: storedCount,
      matched: matchedCount,
      reprocessed: reprocessedCount,
      extracted: extractedCount,
    })
  } catch (err: any) {
    console.error('[CRON] Error:', err)
    return res.status(500).json({ error: err.message })
  }
}

// Gmail helper functions imported from ./_utils/gmail-helpers
