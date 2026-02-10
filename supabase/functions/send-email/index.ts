import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGIN = 'https://sumehrgwalani.github.io'

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// Build RFC 2822 MIME message
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

  // Headers
  lines.push('MIME-Version: 1.0')
  lines.push('From: ' + from)
  lines.push('To: ' + to.join(', '))
  lines.push('Subject: ' + subject)
  if (inReplyToMessageId) {
    lines.push('In-Reply-To: ' + inReplyToMessageId)
    lines.push('References: ' + inReplyToMessageId)
  }

  if (attachments && attachments.length > 0) {
    // Multipart message with attachments
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
      // Break base64 data into 76-char lines
      const data = att.data
      for (let i = 0; i < data.length; i += 76) {
        lines.push(data.slice(i, i + 76))
      }
    }

    lines.push('--' + boundary + '--')
  } else {
    // Simple text message
    lines.push('Content-Type: text/plain; charset="UTF-8"')
    lines.push('')
    lines.push(body)
  }

  return lines.join('\r\n')
}

// Base64url encode (Gmail API requires this)
function base64urlEncode(str: string): string {
  const encoder = new TextEncoder()
  const data = encoder.encode(str)
  const base64 = btoa(String.fromCharCode(...data))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1) Verify JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Missing or invalid authorization header')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY') || supabaseKey

    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) throw new Error('Authentication failed. Please log in again.')

    const { organization_id, user_id, recipients, subject, body, attachments, inReplyToMessageId } = await req.json()

    if (!organization_id || !user_id) throw new Error('Missing organization_id or user_id')
    if (!isValidUUID(organization_id) || !isValidUUID(user_id)) throw new Error('Invalid ID format')
    if (user.id !== user_id) throw new Error('You can only send emails from your own account')

    // Validate recipients
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      throw new Error('At least one recipient is required')
    }
    if (recipients.length > 20) throw new Error('Too many recipients (max 20)')
    for (const r of recipients) {
      if (!isValidEmail(r)) throw new Error('Invalid email address: ' + r)
    }

    if (!subject || !subject.trim()) throw new Error('Subject is required')
    if (!body || !body.trim()) throw new Error('Email body is required')

    // Check attachment sizes (limit 25MB total)
    if (attachments && Array.isArray(attachments)) {
      let totalSize = 0
      for (const att of attachments) {
        if (!att.filename || !att.data || !att.mimeType) {
          throw new Error('Each attachment needs filename, data, and mimeType')
        }
        totalSize += att.data.length * 0.75 // base64 to bytes approximation
      }
      if (totalSize > 25 * 1024 * 1024) {
        throw new Error('Total attachment size exceeds 25MB limit')
      }
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // 2) Verify org membership and get Gmail token
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

    // 3) Get client_id from org settings
    const { data: settings } = await supabase
      .from('organization_settings')
      .select('gmail_client_id')
      .eq('organization_id', organization_id)
      .single()

    if (!settings?.gmail_client_id) {
      throw new Error('Google Client ID not configured. Ask admin to set it up.')
    }

    // 4) Refresh access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: member.gmail_refresh_token,
        client_id: settings.gmail_client_id,
        grant_type: 'refresh_token',
      }),
    })
    const tokenData = await tokenRes.json()
    if (tokenData.error) {
      throw new Error('Gmail token refresh failed. Please re-connect Gmail in Settings.')
    }
    const accessToken = tokenData.access_token

    // 5) Build MIME message and send
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
      'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'message/rfc822',
        },
        body: mimeMessage,
      }
    )

    const sendData = await sendRes.json()
    if (sendData.error) {
      throw new Error('Failed to send: ' + (sendData.error.message || JSON.stringify(sendData.error)))
    }

    return new Response(
      JSON.stringify({ success: true, messageId: sendData.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('Send email error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
