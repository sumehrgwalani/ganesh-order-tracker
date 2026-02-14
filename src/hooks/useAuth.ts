import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Session, User } from '@supabase/supabase-js'

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string>('member')
  const [userDepartment, setUserDepartment] = useState<string | null>(null)
  const fetchingRef = useRef(false)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchOrgId(session.user.id, session.user.email || '')
      } else {
        setLoading(false)
      }
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchOrgId(session.user.id, session.user.email || '')
      } else {
        setOrgId(null)
        setUserRole('member')
        setUserDepartment(null)
        setLoading(false)
      }
    })

    return () => subscription?.unsubscribe()
  }, [])

  const fetchOrgId = async (userId: string, userEmail: string) => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    try {
      // Check if user already has an org membership
      const { data: membership } = await supabase
        .from('organization_members')
        .select('organization_id, role, department_id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle()

      if (membership) {
        setOrgId(membership.organization_id)
        setUserRole(membership.role || 'member')
        setUserDepartment(membership.department_id)
        return
      }

      // New user — check for pending invitations FIRST
      // If invited, join that org directly instead of creating a throwaway one
      if (userEmail) {
        const { data: pendingInvite } = await supabase
          .from('invitations')
          .select('id, organization_id, department_id, role')
          .eq('email', userEmail)
          .eq('status', 'pending')
          .limit(1)
          .maybeSingle()

        if (pendingInvite) {
          const { error: memberError } = await supabase
            .from('organization_members')
            .insert({
              organization_id: pendingInvite.organization_id,
              user_id: userId,
              role: pendingInvite.role || 'member',
              email: userEmail,
              department_id: pendingInvite.department_id,
            })

          if (!memberError) {
            await supabase.from('invitations')
              .update({ status: 'accepted' })
              .eq('id', pendingInvite.id)

            setOrgId(pendingInvite.organization_id)
            setUserRole(pendingInvite.role || 'member')
            setUserDepartment(pendingInvite.department_id)
            return
          }
        }
      }

      // No invitation found — create a personal org for the user
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
          .insert({ organization_id: newOrg.id, user_id: userId, role: 'owner', email: userEmail })

        if (memberError) {
          console.error('Error creating membership:', memberError)
          return
        }

        setOrgId(newOrg.id)
        setUserRole('owner')
      }
    } catch (err) {
      console.error('Error in fetchOrgId:', err)
    } finally {
      fetchingRef.current = false
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
    setUserRole('member')
    setUserDepartment(null)
  }

  return { session, user, loading, orgId, userRole, userDepartment, signUp, signIn, signOut }
}
