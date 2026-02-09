import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Department, TeamMember, Invitation } from '../types'

export function useTeam(orgId: string | null) {
  const [departments, setDepartments] = useState<Department[]>([])
  const [members, setMembers] = useState<TeamMember[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTeam = useCallback(async () => {
    if (!orgId) {
      setDepartments([])
      setMembers([])
      setInvitations([])
      setLoading(false)
      return
    }
    try {
      setLoading(true)

      // Fetch departments
      const { data: deptData, error: deptError } = await supabase
        .from('departments')
        .select('*')
        .eq('organization_id', orgId)
        .order('name')

      if (deptError) throw deptError
      setDepartments(deptData || [])

      // Fetch members with their department info
      const { data: memberData, error: memberError } = await supabase
        .from('organization_members')
        .select('*, departments(*)')
        .eq('organization_id', orgId)
        .order('created_at')

      if (memberError) throw memberError

      const enrichedMembers: TeamMember[] = (memberData || []).map((m: any) => ({
        id: m.id,
        user_id: m.user_id,
        organization_id: m.organization_id,
        role: m.role || 'member',
        department_id: m.department_id,
        department: m.departments || undefined,
        created_at: m.created_at,
        email: m.email || undefined,
      }))
      setMembers(enrichedMembers)

      // Fetch pending invitations
      const { data: invData, error: invError } = await supabase
        .from('invitations')
        .select('*, departments(*)')
        .eq('organization_id', orgId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })

      if (invError) throw invError
      const enrichedInvitations: Invitation[] = (invData || []).map((inv: any) => ({
        ...inv,
        department: inv.departments || undefined,
      }))
      setInvitations(enrichedInvitations)

      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    fetchTeam()
  }, [fetchTeam])

  const inviteMember = async (email: string, departmentId: string | null, role: string = 'member') => {
    if (!orgId) return { error: 'No organization' }

    const { data: userData } = await supabase.auth.getUser()
    const invitedBy = userData?.user?.id || null

    const { data, error } = await supabase
      .from('invitations')
      .insert({
        organization_id: orgId,
        email: email.toLowerCase().trim(),
        department_id: departmentId,
        role,
        invited_by: invitedBy,
      })
      .select()
      .single()

    if (!error) {
      await fetchTeam()
    }
    return { data, error }
  }

  const cancelInvitation = async (invitationId: string) => {
    const { error } = await supabase
      .from('invitations')
      .update({ status: 'cancelled' })
      .eq('id', invitationId)

    if (!error) {
      await fetchTeam()
    }
    return { error }
  }

  const updateMemberRole = async (memberId: string, role: string) => {
    const { error } = await supabase
      .from('organization_members')
      .update({ role })
      .eq('id', memberId)
      .eq('organization_id', orgId)

    if (!error) {
      await fetchTeam()
    }
    return { error }
  }

  const updateMemberDepartment = async (memberId: string, departmentId: string | null) => {
    const { error } = await supabase
      .from('organization_members')
      .update({ department_id: departmentId })
      .eq('id', memberId)
      .eq('organization_id', orgId)

    if (!error) {
      await fetchTeam()
    }
    return { error }
  }

  const removeMember = async (memberId: string) => {
    const { error } = await supabase
      .from('organization_members')
      .delete()
      .eq('id', memberId)
      .eq('organization_id', orgId)

    if (!error) {
      await fetchTeam()
    }
    return { error }
  }

  return {
    departments,
    members,
    invitations,
    loading,
    error,
    inviteMember,
    cancelInvitation,
    updateMemberRole,
    updateMemberDepartment,
    removeMember,
    refetch: fetchTeam,
  }
}
