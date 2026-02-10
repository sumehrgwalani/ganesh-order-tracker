import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { code, client_id, redirect_uri, organization_id } = await req.json()

    if (!code || !client_id || !redirect_uri || !organization_id) {
      throw new Error('Missing required fields: code, client_id, redirect_uri, organization_id')
    }

    // Exchange authorization code for tokens
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

    // Get the user's email address from Gmail API
    const profileResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    const profileData = await profileResponse.json()
    const gmailEmail = profileData.emailAddress

    // Store refresh token and email in organization_settings
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { error: updateError } = await supabase
      .from('organization_settings')
      .update({
        gmail_refresh_token: refresh_token,
        gmail_email: gmailEmail,
        gmail_client_id: client_id,
      })
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
