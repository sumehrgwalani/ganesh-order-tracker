import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// ===== VALIDATION =====

function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
}

const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://ganesh-order-tracker.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function buildMimeMessage(
  from: string,
  to: string[],
  subject: string,
  body: string,
  attachments?: Array<{ filename: string; data: string; mimeType: string }>,
  inReplyToMessageId?: string
): string {
  const boundary = '----=_Part_' + Date.now() + '_' + Math.random().toString(36).slice(2)
  const lines: string[] = []

  lines.push('MIME-Version: 1.0')
  lines.push('From: ' + from)
  lines.push('To: ' + to.join(', '))
  lines.push('Subject: ' + subject)
  if (inReplyToMessageId) {
    lines.push('In-Reply-To: ' + inReplyToMessageId)
    lines.push('References: ' + inReplyToMessageId)
  }

  if (attachments && attachments.length > 0) {
    lines.push('Content-Type: multipart/mixed; boundary="' + boundary + '"')
    lines.push('')
    lines.push('--' + boundary)
    lines.push('Content-Type: text/plain; charset="UTF-8"')
    lines.push('Content-Transfer-Encoding: 7bit')
    lines.push('')
    lines.push(body)

    for (const att of attachments) {
      lines.push('--' + boundary)
      lines.push('Content-Type: ' + att.mimeType + '; name="' + att.filename + '"')
      lines.push('Content-Disposition: attachment; filename="' + att.filename + '"')
      lines.push('Content-Transfer-Encoding: base64')
      lines.push('')
      const data = att.data
      for (let i = 0; i < data.length; i += 76) {
        lines.push(data.slice(i, i + 76))
      }
    }

    lines.push('--' + boundary + '--')
  } else {
    lines.push('Content-Type: text/plain; charset="UTF-8"')
    lines.push('')
    lines.push(body)
  }

  return lines.join('\r\n')
}

function base64urlEncode(str: string): string {
  const buf = Buffer.from(str, 'utf-8')
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function setCors(res: VercelResponse) {
  for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Missing or invalid authorization header')
    }

    const supabaseUrl = process.env.SUPABASE_URL!
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const supabaseAnon = process.env.SUPABASE_ANON_KEY || supabaseKey

    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) throw new Error('Authentication failed. Please log in again.')

    const { organization_id, user_id, recipients, subject, body, attachments, inReplyToMessageId } = req.body

    if (!organization_id || !user_id) throw new Error('Missing organization_id or user_id')
    if (!isValidUUID(organization_id) || !isValidUUID(user_id)) throw new Error('Invalid ID format')
    if (user.id !== user_id) throw new Error('You can only send emails from your own account')

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      throw new Error('At least one recipient is required')
    }
    if (recipients.length > 20) throw new Error('Too many recipients (max 20)')
    for (const r of recipients) {
      if (!isValidEmail(r)) throw new Error('Invalid email address: ' + r)
    }

    if (!subject || !subject.trim()) throw new Error('Subject is required')
    if (!body || !body.trim()) throw new Error('Email body is required')

    if (attachments && Array.isArray(attachments)) {
      let totalSize = 0
      for (const att of attachments) {
        if (!att.filename || !att.data || !att.mimeType) {
          throw new Error('Each attachment needs filename, data, and mimeType')
        }
        totalSize += att.data.length * 0.75
      }
      if (totalSize > 25 * 1024 * 1024) {
        throw new Error('Total attachment size exceeds 25MB limit')
      }
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: member, error: memberError } = await supabase
      .from('organization_members')
      .select('gmail_refresh_token, gmail_email')
      .eq('user_id', user_id)
      .eq('organization_id', organization_id)
      .single()

    if (memberError || !member) throw new Error('You are not a member of this organization')
    if (!member.gmail_refresh_token || !member.gmail_email) {
      throw new Error('Gmail not connected. Please connect Gmail in Settings first.')
    }

    const { data: settings } = await supabase
      .from('organization_settings')
      .select('gmail_client_id')
      .eq('organization_id', organization_id)
      .single()

    if (!settings?.gmail_client_id) {
      throw new Error('Google Client ID not configured. Ask admin to set it up.')
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: member.gmail_refresh_token,
        client_id: settings.gmail_client_id,
        client_secret: GOOGLE_CLIENT_SECRET,
        grant_type: 'refresh_token',
      }),
    })
    const tokenData = await tokenRes.json()
    if (tokenData.error) {
      throw new Error('Gmail token refresh failed. Please re-connect Gmail in Settings.')
    }
    const accessToken = tokenData.access_token

    const mimeMessage = buildMimeMessage(
      member.gmail_email,
      recipients,
      subject,
      body,
      attachments || [],
      inReplyToMessageId
    )
    const encodedMessage = base64urlEncode(mimeMessage)

    const sendRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: encodedMessage }),
      }
    )

    const sendData = await sendRes.json()
    if (sendData.error) {
      throw new Error('Failed to send: ' + (sendData.error.message || JSON.stringify(sendData.error)))
    }

    return res.status(200).json({ success: true, messageId: sendData.id })
  } catch (err: any) {
    console.error('Send email error:', err)
    return res.status(400).json({ error: err.message })
  }
}
