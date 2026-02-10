import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGIN = 'https://sumehrgwalani.github.io'

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Validate UUID format
function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1) Verify the caller is authenticated via JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Missing or invalid authorization header')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY') || supabaseKey

    // Create a client with the user's JWT to verify their identity
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) {
      throw new Error('Authentication failed. Please log in again.')
    }

    const { code, client_id, redirect_uri, organization_id, user_id } = await req.json()

    if (!code || !client_id || !redirect_uri || !organization_id || !user_id) {
      throw new Error('Missing required fields: code, client_id, redirect_uri, organization_id, user_id')
    }

    // 2) Validate input formats
    if (!isValidUUID(organization_id) || !isValidUUID(user_id)) {
      throw new Error('Invalid organization or user ID format')
    }

    // 3) Verify the authenticated user matches the claimed user_id
    if (user.id !== user_id) {
      throw new Error('You can only connect Gmail for your own account')
    }

    // 4) Verify the user is a member of this organization
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

    // 5) Validate redirect_uri is from our domain
    if (!redirect_uri.startsWith('https://sumehrgwalani.github.io/')) {
      throw new Error('Invalid redirect URI')
    }

    // 6) Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id,
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

    // 7) Get the user's email address from Gmail API
    const profileResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    const profileData = await profileResponse.json()
    const gmailEmail = profileData.emailAddress

    // 8) Store refresh token and email in organization_members (per-user)
    const { error: updateError } = await supabase
      .from('organization_members')
      .update({
        gmail_refresh_token: refresh_token,
        gmail_email: gmailEmail,
      })
      .eq('user_id', user_id)
      .eq('organization_id', organization_id)

    if (updateError) {
      throw new Error(`Failed to save Gmail credentials: ${updateError.message}`)
    }

    return new Response(
      JSON.stringify({ success: true, email: gmailEmail }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
