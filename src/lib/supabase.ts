import { createClient } from '@supabase/supabase-js'

const directSupabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!directSupabaseUrl || !supabaseAnonKey) {
  const msg = 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables. Database features will not work.'
  console.error(msg)
  if (typeof document !== 'undefined') {
    document.title = '⚠️ Supabase not configured'
  }
}

// In production, proxy Supabase requests through our own domain to avoid
// network blocks. Some ISPs/firewalls block supabase.co directly.
// The Vercel rewrites in vercel.json forward /supabase/* to the real Supabase.
const isProduction = typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')
const supabaseUrl = isProduction
  ? `${window.location.origin}/supabase`
  : (directSupabaseUrl || 'https://placeholder.supabase.co')

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey || 'placeholder'
)

// Also export the direct URL for server-side API routes that don't need proxying
export const directUrl = directSupabaseUrl || 'https://placeholder.supabase.co'
