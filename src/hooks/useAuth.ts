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
      const { data } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', userId)
        .limit(1)
        .single()

      if (data) {
        setOrgId(data.organization_id)
      } else {
        // New user - create org and membership
        const { data: newOrg } = await supabase
          .from('organizations')
          .insert({ name: 'My Organization', slug: 'org-' + userId.slice(0, 8) })
          .select()
          .single()

        if (newOrg) {
          await supabase
            .from('organization_members')
            .insert({ organization_id: newOrg.id, user_id: userId, role: 'owner' })
          setOrgId(newOrg.id)
        }
      }
    } catch (err) {
      console.error('Error fetching org:', err)
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
