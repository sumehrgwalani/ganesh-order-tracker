import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { createCipheriv, randomBytes } from 'crypto'

// ===== CORS =====

const ALLOWED_ORIGIN = 'https://ganesh-order-tracker.vercel.app'

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
}

// ===== VALIDATION =====

function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
}

const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!

// Encrypt a string using AES-256-GCM. Returns "enc:iv:authTag:ciphertext" (all hex).
// If no encryption key is set, returns plaintext (backward compatible).
function encryptToken(plaintext: string): string {
  const key = process.env.TOKEN_ENCRYPTION_KEY
  if (!key || key.length < 32) return plaintext
  const keyBuf = Buffer.from(key.slice(0, 32), 'utf-8')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyBuf, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `enc:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
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
    if (authError || !user) {
      throw new Error('Authentication failed. Please log in again.')
    }

    const { code, client_id, redirect_uri, organization_id, user_id } = req.body

    if (!code || !client_id || !redirect_uri || !organization_id || !user_id) {
      throw new Error('Missing required fields: code, client_id, redirect_uri, organization_id, user_id')
    }

    if (!isValidUUID(organization_id) || !isValidUUID(user_id)) {
      throw new Error('Invalid organization or user ID format')
    }

    if (user.id !== user_id) {
      throw new Error('You can only connect Gmail for your own account')
    }

    const supabase = createClient(supabaseUrl, supabaseKey)
    const { data: membership, error: memberError } = await supabase
      .from('organization_members')
      .select('user_id')
      .eq('user_id', user_id)
      .eq('organization_id', organization_id)
      .single()

    if (memberError || !membership) {
      throw new Error('You are not a member of this organization')
    }

    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri,
        grant_type: 'authorization_code',
      }),
    })

    const tokenData = await tokenResponse.json()
    if (tokenData.error) {
      throw new Error(`Google OAuth error: ${tokenData.error_description || tokenData.error}`)
    }

    const { access_token, refresh_token } = tokenData
    if (!refresh_token) {
      throw new Error('No refresh token received. Make sure to include access_type=offline and prompt=consent in the OAuth URL.')
    }

    // Get the user's email address from Gmail API
    const profileResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    const profileData = await profileResponse.json()
    const gmailEmail = profileData.emailAddress

    // Encrypt and store refresh token
    const encryptedToken = encryptToken(refresh_token)
    const { error: updateError } = await supabase
      .from('organization_members')
      .update({
        gmail_refresh_token: encryptedToken,
        gmail_email: gmailEmail,
      })
      .eq('user_id', user_id)
      .eq('organization_id', organization_id)

    if (updateError) {
      throw new Error(`Failed to save Gmail credentials: ${updateError.message}`)
    }

    return res.status(200).json({ success: true, email: gmailEmail })
  } catch (err: any) {
    return res.status(400).json({ error: err.message })
  }
}
