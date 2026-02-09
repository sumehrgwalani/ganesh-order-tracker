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

      // New user â check if they have pending invitations
      // Instead of auto-accepting, create a personal org and send a notification
      // so the user can choose to accept or decline

      // Create a new org for the user first (they need somewhere to land)
      // (The database trigger will auto-create default departments)
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

        // Now check for pending invitations and create notifications
        if (userEmail) {
          const { data: pendingInvites } = await supabase
            .from('invitations')
            .select('id, organization_id, department_id, role, invited_by')
            .eq('email', userEmail)
            .eq('status', 'pending')

          if (pendingInvites && pendingInvites.length > 0) {
            for (const inv of pendingInvites) {
              // Get the org name for the notification
              const { data: invOrg } = await supabase
                .from('organizations')
                .select('name')
                .eq('id', inv.organization_id)
                .maybeSingle()

              // Get department name if assigned
              let deptName = ''
              if (inv.department_id) {
                const { data: dept } = await supabase
                  .from('departments')
                  .select('name')
                  .eq('id', inv.department_id)
                  .maybeSingle()
                deptName = dept?.name || ''
              }

              // Get inviter email
              let inviterEmail = ''
              if (inv.invited_by) {
                const { data: inviterMember } = await supabase
                  .from('organization_members')
                  .select('email')
                  .eq('user_id', inv.invited_by)
                  .maybeSingle()
                inviterEmail = inviterMember?.email || ''
              }

              const orgName = invOrg?.name || 'an organization'

              await supabase.from('notifications').insert({
                user_id: userId,
                organization_id: inv.organization_id,
                type: 'invitation',
                title: `You've been invited to join ${orgName}`,
                message: deptName
                  ? `Role: ${inv.role || 'member'} in ${deptName} department`
                  : `Role: ${inv.role || 'member'}`,
                data: {
                  invitation_id: inv.id,
                  org_name: orgName,
                  invited_by_email: inviterEmail,
                  department_name: deptName,
                  role: inv.role || 'member',
                },
              })
            }
          }
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
    setUserRole('member')
    setUserDepartment(null)
  }

  return { session, user, loading, orgId, userRole, userDepartment, signUp, signIn, signOut }
}
