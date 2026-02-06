import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Session, User } from '@supabase/supabase-js'

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [orgId, setOrgId] = useState<string | null>(null)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchOrgId(session.user.id)
      } else {
        setLoading(false)
      }
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchOrgId(session.user.id)
      } else {
        setOrgId(null)
        setLoading(false)
      }
    })

    return () => subscription?.unsubscribe()
  }, [])

  const fetchOrgId = async (userId: string) => {
    try {
      // Use maybeSingle() instead of single() — returns null without throwing when no rows found
      const { data: membership } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle()

      if (membership) {
        setOrgId(membership.organization_id)
      } else {
        // New user — create their organization and add them as owner
        const { data: newOrg, error: orgError } = await supabase
          .from('organizations')
          .insert({ name: 'My Organization', slug: 'org-' + userId.slice(0, 8) })
          .select()
          .single()

        if (orgError) {
          console.error('Error creating organization:', orgError)
          return
        }

        if (newOrg) {
          const { error: memberError } = await supabase
            .from('organization_members')
            .insert({ organization_id: newOrg.id, user_id: userId, role: 'owner' })

          if (memberError) {
            console.error('Error creating membership:', memberError)
            return
          }

          setOrgId(newOrg.id)
        }
      }
    } catch (err) {
      console.error('Error in fetchOrgId:', err)
    } finally {
      setLoading(false)
    }
  }

  const signUp = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    return { data, error }
  }

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { data, error }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setSession(null)
    setUser(null)
    setOrgId(null)
  }

  return { session, user, loading, orgId, signUp, signIn, signOut }
}
