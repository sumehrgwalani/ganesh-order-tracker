import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const results: Record<string, any> = {}

  // 1. Check env vars
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

  results.envVars = {
    hasSupabaseUrl: !!url,
    supabaseUrlPrefix: url ? url.substring(0, 30) + '...' : 'MISSING',
    hasServiceKey: !!serviceKey,
    hasAnonKey: !!anonKey,
  }

  if (!url) {
    return res.status(200).json({ ...results, error: 'No Supabase URL configured' })
  }

  // 2. Check Supabase health
  try {
    const healthRes = await fetch(`${url}/auth/v1/health`, {
      headers: { 'apikey': anonKey },
    })
    results.authHealth = { status: healthRes.status, ok: healthRes.ok }
    if (healthRes.ok) {
      results.authHealth.body = await healthRes.json()
    }
  } catch (err) {
    results.authHealth = { error: String(err) }
  }

  // 3. Check if specific user exists (via admin API)
  const email = (req.query.email as string) || 'ganeshintnlmumbai@gmail.com'
  if (serviceKey) {
    try {
      const supabase = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      // List users matching this email
      const { data, error } = await supabase.auth.admin.listUsers({ perPage: 50 })
      if (error) {
        results.userCheck = { error: error.message }
      } else {
        const user = data.users.find((u: any) => u.email === email)
        if (user) {
          results.userCheck = {
            exists: true,
            email: user.email,
            emailConfirmed: !!user.email_confirmed_at,
            confirmedAt: user.email_confirmed_at,
            createdAt: user.created_at,
            lastSignIn: user.last_sign_in_at,
            banned: user.banned_until ? true : false,
            provider: user.app_metadata?.provider,
          }
        } else {
          results.userCheck = {
            exists: false,
            email,
            message: 'User NOT found in Supabase Auth. They need to sign up first.',
            totalAuthUsers: data.users.length,
            allEmails: data.users.map((u: any) => u.email),
          }
        }
      }
    } catch (err) {
      results.userCheck = { error: String(err) }
    }
  } else {
    results.userCheck = { error: 'No service role key — cannot check auth users' }
  }

  // 4. Check org membership
  if (serviceKey) {
    try {
      const supabase = createClient(url, serviceKey)
      const { data: members } = await supabase
        .from('organization_members')
        .select('user_id, role, email, organization_id')
        .eq('email', email)
      results.orgMembership = members && members.length > 0
        ? { found: true, memberships: members }
        : { found: false, message: 'No org membership found for this email' }
    } catch (err) {
      results.orgMembership = { error: String(err) }
    }
  }

  // 5. Check invitations
  if (serviceKey) {
    try {
      const supabase = createClient(url, serviceKey)
      const { data: invites } = await supabase
        .from('invitations')
        .select('id, email, status, organization_id, role')
        .eq('email', email)
      results.invitations = invites && invites.length > 0
        ? { found: true, invitations: invites }
        : { found: false }
    } catch (err) {
      results.invitations = { error: String(err) }
    }
  }

  return res.status(200).json(results)
}
