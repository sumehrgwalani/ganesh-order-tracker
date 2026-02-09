import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Session, User } from '@supabase/supabase-js'

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string>('member')
  const [userDepartment, setUserDepartment] = useState<string | null>(null)

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

      // New user — check if they have a pending invitation
      if (userEmail) {
        const { data: invitation } = await supabase
          .from('invitations')
          .select('organization_id, department_id, role')
          .eq('email', userEmail)
          .eq('status', 'pending')
          .limit(1)
          .maybeSingle()

        if (invitation) {
          // Accept the invitation — join the inviting org
          const { data: newMember, error: memberError } = await supabase
            .from('organization_members')
            .insert({
              organization_id: invitation.organization_id,
              user_id: userId,
              role: invitation.role || 'member',
              department_id: invitation.department_id,
              email: userEmail,
            })
            .select('id')
            .single()

          if (!memberError && newMember) {
            // Also add to member_departments if a department was assigned
            if (invitation.department_id) {
              await supabase
                .from('member_departments')
                .insert({ member_id: newMember.id, department_id: invitation.department_id })
            }

            // Mark invitation as accepted
            await supabase
              .from('invitations')
              .update({ status: 'accepted' })
              .eq('email', userEmail)
              .eq('organization_id', invitation.organization_id)
              .eq('status', 'pending')

            setOrgId(invitation.organization_id)
            setUserRole(invitation.role || 'member')
            setUserDepartment(invitation.department_id)
            return
          }
        }
      }

      // No membership and no invitation — create a new org + membership atomically
      // Uses a SECURITY DEFINER function to bypass RLS chicken-and-egg problem
      const { data: newOrgId, error: rpcError } = await supabase
        .rpc('create_org_and_membership', {
          p_org_name: 'My Organization',
          p_org_slug: 'org-' + userId.slice(0, 8),
          p_user_id: userId,
          p_user_email: userEmail,
        })

      if (rpcError) {
        console.error('Error creating organization:', rpcError)
        return
      }

      if (newOrgId) {
        setOrgId(newOrgId)
        setUserRole('owner')
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
    setUserRole('member')
    setUserDepartment(null)
  }

  return { session, user, loading, orgId, userRole, userDepartment, signUp, signIn, signOut }
}
