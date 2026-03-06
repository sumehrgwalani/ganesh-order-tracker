/**
 * Shared Gmail helper functions used by sync-emails.ts and cron-sync.ts.
 * Extracted to eliminate duplication across API routes.
 */

// Decode base64url encoded Gmail message body
export function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/')
  try {
    return atob(base64)
  } catch {
    return ''
  }
}

// Extract plain text body from Gmail message payload
export function extractBody(payload: any): string {
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

// Extract HTML body from Gmail message payload (for rich rendering)
export function extractHtmlBody(payload: any): string {
  if (!payload) return ''

  // Simple text/html part
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return decodeBase64Url(payload.body.data)
  }

  // Multipart: look through parts for HTML
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return decodeBase64Url(part.body.data)
      }
      // Recurse into nested multipart
      if (part.parts) {
        const nested = extractHtmlBody(part)
        if (nested) return nested
      }
    }
  }

  return ''
}

// Get header value from Gmail message headers
export function getHeader(headers: any[], name: string): string {
  const h = headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase())
  return h?.value || ''
}

// Extract name from email "Name <email@example.com>" format
export function extractName(emailStr: string): string {
  const match = emailStr.match(/^"?([^"<]+)"?\s*</)
  return match ? match[1].trim() : emailStr.split('@')[0]
}

// Extract email from "Name <email@example.com>" format
export function extractEmail(emailStr: string): string {
  const match = emailStr.match(/<([^>]+)>/)
  return match ? match[1] : emailStr
}

// Extract all email addresses from a header (e.g. CC with comma-separated entries)
export function extractAllEmails(headerStr: string): string[] {
  if (!headerStr) return []
  const emails: string[] = []
  const angleMatches = headerStr.matchAll(/<([^>]+)>/g)
  for (const m of angleMatches) emails.push(m[1].toLowerCase())
  if (emails.length === 0) {
    for (const part of headerStr.split(',')) {
      const trimmed = part.trim().toLowerCase()
      if (trimmed.includes('@')) emails.push(trimmed)
    }
  }
  return emails
}

// Check if a filename is an inline email image (logos, signatures, etc.)
export function isInlineImage(filename: string): boolean {
  const lower = filename.toLowerCase()
  if (/^image\d{0,3}\.(jpg|jpeg|png|gif)$/.test(lower)) return true
  if (/^outlook-.*\.(jpg|jpeg|png|gif)$/.test(lower)) return true
  return false
}

// Extract attachment parts from Gmail message payload (skips inline images)
export function extractAttachmentParts(payload: any): { filename: string; mimeType: string; attachmentId: string; size: number }[] {
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

// Refresh Gmail access token from refresh token
export async function refreshGmailToken(refreshToken: string, clientId: string, clientSecret: string): Promise<string | null> {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }),
    })
    const data = await res.json()
    if (data.error) { console.error(`Token refresh failed: ${data.error}`); return null }
    return data.access_token
  } catch (err) { console.error('Token refresh error:', err); return null }
}

// Fetch attachment parts for a Gmail message by ID
export async function getAttachmentPartsForMessage(accessToken: string, messageId: string): Promise<{ filename: string; mimeType: string; attachmentId: string; size: number }[]> {
  try {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!res.ok) return []
    const msg = await res.json()
    return extractAttachmentParts(msg.payload)
  } catch (err) { console.error('Failed to fetch message attachments:', err); return [] }
}

// Download attachment data from Gmail API
export async function downloadAttachment(accessToken: string, messageId: string, attachmentId: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!res.ok) return null
    const data = await res.json()
    if (!data.data) return null
    const binary = atob(data.data.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch (err) { console.error('Download attachment error:', err); return null }
}
