import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Department, TeamMember, Invitation } from '../types'

export function useTeam(orgId: string | null) {
  const [departments, setDepartments] = useState<Department[]>([])
  const [members, setMembers] = useState<TeamMember[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [initialLoad, setInitialLoad] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTeam = useCallback(async (silent = false) => {
    if (!orgId) {
      setDepartments([])
      setMembers([])
      setInvitations([])
      setLoading(false)
      setInitialLoad(false)
      return
    }
    try {
      if (!silent) setLoading(true)

      // Fetch departments
      const { data: deptData, error: deptError } = await supabase
        .from('departments')
        .select('*')
        .eq('organization_id', orgId)
        .order('name')

      if (deptError) throw deptError
      const depts = deptData || []
      setDepartments(depts)

      // Fetch members
      const { data: memberData, error: memberError } = await supabase
        .from('organization_members')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at')

      if (memberError) throw memberError

      // Fetch all member-department associations
      const memberIds = (memberData || []).map((m: any) => m.id)
      let mdRows: any[] = []
      if (memberIds.length > 0) {
        const { data: mdData, error: mdError } = await supabase
          .from('member_departments')
          .select('member_id, department_id')
          .in('member_id', memberIds)

        if (mdError) throw mdError
        mdRows = mdData || []
      }

      // Build a lookup: member_id -> department_id[]
      const memberDeptMap: Record<string, string[]> = {}
      for (const row of mdRows) {
        if (!memberDeptMap[row.member_id]) memberDeptMap[row.member_id] = []
        memberDeptMap[row.member_id].push(row.department_id)
      }

      // Build a department lookup by id
      const deptById: Record<string, Department> = {}
      for (const d of depts) deptById[d.id] = d

      const enrichedMembers: TeamMember[] = (memberData || []).map((m: any) => {
        const deptIds = memberDeptMap[m.id] || []
        return {
          id: m.id,
          user_id: m.user_id,
          organization_id: m.organization_id,
          role: m.role || 'member',
          department_id: m.department_id,
          department: m.department_id ? deptById[m.department_id] : undefined,
          department_ids: deptIds,
          departments: deptIds.map(did => deptById[did]).filter(Boolean),
          created_at: m.created_at,
          email: m.email || undefined,
        }
      })
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
      setInitialLoad(false)
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

  // Optimistically update local member state for dept changes
  const updateMemberDeptLocally = useCallback((memberId: string, departmentId: string, action: 'add' | 'remove') => {
    setMembers(prev => prev.map(m => {
      if (m.id !== memberId) return m
      const deptById: Record<string, Department> = {}
      for (const d of departments) deptById[d.id] = d
      let newDeptIds: string[]
      if (action === 'add') {
        newDeptIds = m.department_ids.includes(departmentId) ? m.department_ids : [...m.department_ids, departmentId]
      } else {
        newDeptIds = m.department_ids.filter(did => did !== departmentId)
      }
      return {
        ...m,
        department_ids: newDeptIds,
        departments: newDeptIds.map(did => deptById[did]).filter(Boolean),
      }
    }))
  }, [departments])

  // Add a member to a department (multi-dept) — optimistic
  const addMemberToDept = async (memberId: string, departmentId: string) => {
    updateMemberDeptLocally(memberId, departmentId, 'add')
    const { error } = await supabase
      .from('member_departments')
      .insert({ member_id: memberId, department_id: departmentId })

    if (error) {
      // Revert on failure
      updateMemberDeptLocally(memberId, departmentId, 'remove')
    }
    return { error }
  }

  // Remove a member from a department (multi-dept) — optimistic
  const removeMemberFromDept = async (memberId: string, departmentId: string) => {
    updateMemberDeptLocally(memberId, departmentId, 'remove')
    const { error } = await supabase
      .from('member_departments')
      .delete()
      .eq('member_id', memberId)
      .eq('department_id', departmentId)

    if (error) {
      // Revert on failure
      updateMemberDeptLocally(memberId, departmentId, 'add')
    }
    return { error }
  }

  // Toggle a department for a member — optimistic
  const toggleMemberDept = async (memberId: string, departmentId: string) => {
    const member = members.find(m => m.id === memberId)
    if (!member) return { error: 'Member not found' }

    if (member.department_ids.includes(departmentId)) {
      return removeMemberFromDept(memberId, departmentId)
    } else {
      return addMemberToDept(memberId, departmentId)
    }
  }

  // Legacy: move to single dept (kept for backward compat)
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
    initialLoad,
    error,
    inviteMember,
    cancelInvitation,
    updateMemberRole,
    updateMemberDepartment,
    addMemberToDept,
    removeMemberFromDept,
    toggleMemberDept,
    removeMember,
    refetch: fetchTeam,
  }
}
