import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { OrganizationSettings, Department, UserPreferences } from '../types'

export function useSettings(orgId: string | null) {
  const [orgSettings, setOrgSettings] = useState<OrganizationSettings | null>(null)
  const [orgName, setOrgName] = useState<string>('')
  const [userPrefs, setUserPrefs] = useState<UserPreferences>({
    display_name: null,
    phone: null,
    notify_new_order: null,
    notify_order_updated: null,
    notify_stage_changed: null,
    notify_new_inquiry: null,
  })
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [initialLoad, setInitialLoad] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSettings = useCallback(async (silent = false) => {
    if (!orgId) {
      setOrgSettings(null)
      setOrgName('')
      setUserPrefs({
        display_name: null,
        phone: null,
        notify_new_order: null,
        notify_order_updated: null,
        notify_stage_changed: null,
        notify_new_inquiry: null,
      })
      setDepartments([])
      setLoading(false)
      setInitialLoad(false)
      return
    }

    try {
      if (!silent) setLoading(true)

      // Fetch organization settings
      let { data: settingsData, error: settingsError } = await supabase
        .from('organization_settings')
        .select('*')
        .eq('organization_id', orgId)
        .single()

      if (settingsError && settingsError.code !== 'PGRST116') throw settingsError

      // If no settings exist, create one
      if (!settingsData) {
        const { data: newSettings, error: insertError } = await supabase
          .from('organization_settings')
          .insert({
            organization_id: orgId,
            default_currency: 'USD',
            weight_unit: 'kg',
            date_format: 'DD/MM/YYYY',
            smtp_use_tls: true,
            notify_new_order: true,
            notify_order_updated: true,
            notify_stage_changed: true,
            notify_new_inquiry: true,
          })
          .select()
          .single()

        if (insertError) throw insertError
        settingsData = newSettings
      }

      setOrgSettings(settingsData)

      // Fetch organization name
      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', orgId)
        .single()

      if (orgError) throw orgError
      setOrgName(orgData?.name || '')

      // Fetch current user's profile/preferences
      const { data: userData } = await supabase.auth.getUser()
      if (userData?.user) {
        const { data: memberData, error: memberError } = await supabase
          .from('organization_members')
          .select('display_name, phone, notify_new_order, notify_order_updated, notify_stage_changed, notify_new_inquiry')
          .eq('organization_id', orgId)
          .eq('user_id', userData.user.id)
          .single()

        if (memberError && memberError.code !== 'PGRST116') throw memberError

        if (memberData) {
          setUserPrefs({
            display_name: memberData.display_name || null,
            phone: memberData.phone || null,
            notify_new_order: memberData.notify_new_order ?? null,
            notify_order_updated: memberData.notify_order_updated ?? null,
            notify_stage_changed: memberData.notify_stage_changed ?? null,
            notify_new_inquiry: memberData.notify_new_inquiry ?? null,
          })
        }
      }

      // Fetch departments
      const { data: deptData, error: deptError } = await supabase
        .from('departments')
        .select('*')
        .eq('organization_id', orgId)
        .order('name')

      if (deptError) throw deptError
      setDepartments(deptData || [])

      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
      setInitialLoad(false)
    }
  }, [orgId])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const updateOrgSettings = async (updates: Partial<OrganizationSettings>) => {
    if (!orgId || !orgSettings) return { error: 'No organization' }

    // Optimistic update
    const prevSettings = orgSettings
    setOrgSettings({ ...orgSettings, ...updates })

    const { error } = await supabase
      .from('organization_settings')
      .update(updates)
      .eq('id', orgSettings.id)

    if (error) {
      // Revert on failure
      setOrgSettings(prevSettings)
    }
    return { error }
  }

  const updateOrgName = async (name: string) => {
    if (!orgId) return { error: 'No organization' }

    // Optimistic update
    const prevName = orgName
    setOrgName(name)

    const { error } = await supabase
      .from('organizations')
      .update({ name })
      .eq('id', orgId)

    if (error) {
      // Revert on failure
      setOrgName(prevName)
    }
    return { error }
  }

  const updateUserProfile = async (updates: { display_name?: string; phone?: string }) => {
    if (!orgId) return { error: 'No organization' }

    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) return { error: 'Not authenticated' }

    // Optimistic update
    const prevPrefs = userPrefs
    setUserPrefs({
      ...userPrefs,
      display_name: updates.display_name ?? userPrefs.display_name,
      phone: updates.phone ?? userPrefs.phone,
    })

    const { error } = await supabase
      .from('organization_members')
      .update(updates)
      .eq('organization_id', orgId)
      .eq('user_id', userData.user.id)

    if (error) {
      // Revert on failure
      setUserPrefs(prevPrefs)
    }
    return { error }
  }

  const updateUserNotifications = async (updates: {
    notify_new_order?: boolean
    notify_order_updated?: boolean
    notify_stage_changed?: boolean
    notify_new_inquiry?: boolean
  }) => {
    if (!orgId) return { error: 'No organization' }

    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) return { error: 'Not authenticated' }

    // Optimistic update
    const prevPrefs = userPrefs
    setUserPrefs({
      ...userPrefs,
      notify_new_order: updates.notify_new_order ?? userPrefs.notify_new_order,
      notify_order_updated: updates.notify_order_updated ?? userPrefs.notify_order_updated,
      notify_stage_changed: updates.notify_stage_changed ?? userPrefs.notify_stage_changed,
      notify_new_inquiry: updates.notify_new_inquiry ?? userPrefs.notify_new_inquiry,
    })

    const { error } = await supabase
      .from('organization_members')
      .update(updates)
      .eq('organization_id', orgId)
      .eq('user_id', userData.user.id)

    if (error) {
      // Revert on failure
      setUserPrefs(prevPrefs)
    }
    return { error }
  }

  const changePassword = async (currentPassword: string, newPassword: string) => {
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      return { error }
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : 'Unknown error' }
    }
  }

  const addDepartment = async (name: string, description: string) => {
    if (!orgId) return { error: 'No organization' }

    // Generate slug from name
    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')

    const { data, error } = await supabase
      .from('departments')
      .insert({
        organization_id: orgId,
        name,
        slug,
        description: description || null,
      })
      .select()
      .single()

    if (!error && data) {
      setDepartments(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    }
    return { data, error }
  }

  const renameDepartment = async (id: string, name: string, description: string) => {
    if (!orgId) return { error: 'No organization' }

    // Generate slug from name
    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')

    const { error } = await supabase
      .from('departments')
      .update({ name, slug, description: description || null })
      .eq('id', id)
      .eq('organization_id', orgId)

    if (!error) {
      setDepartments(prev =>
        prev.map(d => (d.id === id ? { ...d, name, slug, description: description || null } : d)).sort((a, b) => a.name.localeCompare(b.name))
      )
    }
    return { error }
  }

  const deleteDepartment = async (id: string) => {
    if (!orgId) return { error: 'No organization' }

    const { error } = await supabase
      .from('departments')
      .delete()
      .eq('id', id)
      .eq('organization_id', orgId)

    if (!error) {
      setDepartments(prev => prev.filter(d => d.id !== id))
    }
    return { error }
  }

  return {
    orgSettings,
    orgName,
    userPrefs,
    departments,
    loading,
    initialLoad,
    error,
    updateOrgSettings,
    updateOrgName,
    updateUserProfile,
    updateUserNotifications,
    changePassword,
    addDepartment,
    renameDepartment,
    deleteDepartment,
    refetch: fetchSettings,
  }
}
