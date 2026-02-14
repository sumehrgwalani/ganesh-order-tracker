import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { AppNotification } from '../types'

export function useNotifications(userId: string | null) {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [unreadCount, setUnreadCount] = useState(0)

  const fetchNotifications = useCallback(async () => {
    if (!userId) {
      setNotifications([])
      setUnreadCount(0)
      setLoading(false)
      return
    }

    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw error

      const items = (data || []) as AppNotification[]
      setNotifications(items)
      setUnreadCount(items.filter(n => !n.read).length)
    } catch (err) {
      console.error('Error fetching notifications:', err)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  // Subscribe to real-time notifications
  useEffect(() => {
    if (!userId) return

    const channel = supabase
      .channel('notifications-' + userId)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newNotif = payload.new as AppNotification
          setNotifications(prev => [newNotif, ...prev])
          setUnreadCount(prev => prev + 1)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])

  const markAsRead = async (notificationId: string) => {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId)

    if (!error) {
      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
      )
      setUnreadCount(prev => Math.max(0, prev - 1))
    }
    return { error }
  }

  const markAllAsRead = async () => {
    if (!userId) return
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false)

    if (!error) {
      setNotifications(prev => prev.map(n => ({ ...n, read: true })))
      setUnreadCount(0)
    }
    return { error }
  }

  const removeNotification = async (notificationId: string) => {
    const notif = notifications.find(n => n.id === notificationId)
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId)

    if (!error) {
      setNotifications(prev => prev.filter(n => n.id !== notificationId))
      if (notif && !notif.read) {
        setUnreadCount(prev => Math.max(0, prev - 1))
      }
    }
    return { error }
  }

  // Accept an invitation from a notification
  const acceptInvitation = async (notification: AppNotification) => {
    if (!userId || notification.type !== 'invitation') return { error: 'Invalid' }

    const invitationId = notification.data.invitation_id
    if (!invitationId) return { error: 'No invitation ID' }

    // Get the invitation details
    const { data: invitation, error: fetchError } = await supabase
      .from('invitations')
      .select('organization_id, department_id, role, email')
      .eq('id', invitationId)
      .eq('status', 'pending')
      .maybeSingle()

    if (fetchError || !invitation) return { error: fetchError?.message || 'Invitation not found or expired' }

    // Get user email
    const { data: userData } = await supabase.auth.getUser()
    const userEmail = userData?.user?.email || ''

    // Check if user already has a membership in this org
    const { data: existingMembership } = await supabase
      .from('organization_members')
      .select('id')
      .eq('organization_id', invitation.organization_id)
      .eq('user_id', userId)
      .maybeSingle()

    if (existingMembership) {
      // Already a member, just mark invitation as accepted
      await supabase
        .from('invitations')
        .update({ status: 'accepted' })
        .eq('id', invitationId)

      await removeNotification(notification.id)
      return { error: null, alreadyMember: true }
    }

    // Remove user from any existing org first (user can only be in one org)
    const { data: oldMemberships } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId)

    if (oldMemberships && oldMemberships.length > 0) {
      for (const old of oldMemberships) {
        await supabase.from('organization_members').delete()
          .eq('user_id', userId).eq('organization_id', old.organization_id)
        // Clean up auto-created empty orgs
        const { data: remaining } = await supabase
          .from('organization_members')
          .select('id')
          .eq('organization_id', old.organization_id)
          .limit(1)
        if (!remaining || remaining.length === 0) {
          await supabase.from('organizations').delete()
            .eq('id', old.organization_id)
        }
      }
    }

    // Join the organization
    const { error: memberError } = await supabase
      .from('organization_members')
      .insert({
        organization_id: invitation.organization_id,
        user_id: userId,
        role: invitation.role || 'member',
        department_id: invitation.department_id,
        email: userEmail,
      })

    if (memberError) return { error: memberError.message }

    // If department assigned, also add to member_departments
    if (invitation.department_id) {
      // Get the member id we just created
      const { data: newMember } = await supabase
        .from('organization_members')
        .select('id')
        .eq('organization_id', invitation.organization_id)
        .eq('user_id', userId)
        .maybeSingle()

      if (newMember) {
        await supabase
          .from('member_departments')
          .insert({ member_id: newMember.id, department_id: invitation.department_id })
      }
    }

    // Mark invitation as accepted
    await supabase
      .from('invitations')
      .update({ status: 'accepted' })
      .eq('id', invitationId)

    // Remove the notification
    await removeNotification(notification.id)

    return { error: null, orgId: invitation.organization_id }
  }

  // Decline an invitation from a notification
  const declineInvitation = async (notification: AppNotification) => {
    if (!userId || notification.type !== 'invitation') return { error: 'Invalid' }

    const invitationId = notification.data.invitation_id
    if (!invitationId) return { error: 'No invitation ID' }

    // Mark invitation as cancelled
    await supabase
      .from('invitations')
      .update({ status: 'cancelled' })
      .eq('id', invitationId)

    // Remove the notification
    await removeNotification(notification.id)

    return { error: null }
  }

  return {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    removeNotification,
    acceptInvitation,
    declineInvitation,
    refetch: fetchNotifications,
  }
}
