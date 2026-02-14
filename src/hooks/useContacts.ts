import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Contact, ContactsMap, ContactFormData } from '../types'

export function useContacts(orgId: string | null) {
  const [contacts, setContacts] = useState<ContactsMap>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchContacts = useCallback(async () => {
    if (!orgId) {
      setContacts({})  // Clear stale data from previous user
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('contacts')
        .select('*')
        .eq('organization_id', orgId)
        .order('company')

      if (fetchError) throw fetchError

      // Convert to ContactsMap (keyed by email)
      const map: ContactsMap = {}
      for (const row of data || []) {
        map[row.email] = {
          name: row.name,
          company: row.company,
          role: row.role,
          initials: row.initials || '',
          color: row.color || 'bg-gray-500',
          phone: row.phone || '',
          address: row.address || '',
          notes: row.notes || '',
          country: row.country || '',
          default_brand: row.default_brand || '',
        }
      }
      setContacts(map)
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    fetchContacts()
  }, [fetchContacts])

  const addContact = async (formData: ContactFormData) => {
    if (!orgId) return null
    try {
      const initials = formData.initials || formData.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
      const { data, error: insertError } = await supabase
        .from('contacts')
        .insert({
          organization_id: orgId,
          email: formData.email,
          name: formData.name,
          company: formData.company,
          role: (formData.category && formData.category !== 'other')
            ? formData.category.charAt(0).toUpperCase() + formData.category.slice(1)
            : formData.role || 'Supplier',
          phone: formData.phone || '',
          address: formData.address || '',
          country: formData.country || '',
          initials,
          color: formData.color || 'bg-gray-500',
          notes: '',
          default_brand: formData.default_brand || '',
        })
        .select()
        .single()

      if (insertError) throw insertError
      // No refetch — ContactsPage handles optimistic UI update
      return data
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      throw err
    }
  }

  const updateContact = async (email: string, updates: Partial<Contact>) => {
    if (!orgId) return
    try {
      const { error: updateError } = await supabase
        .from('contacts')
        .update(updates)
        .eq('organization_id', orgId)
        .eq('email', email)

      if (updateError) throw updateError
      // Also update local state so other pages (e.g. POGenerator) see the change
      setContacts(prev => {
        const existing = prev[email]
        if (existing) {
          return { ...prev, [email]: { ...existing, ...updates } }
        }
        return prev
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      throw err
    }
  }

  const deleteContact = async (email: string) => {
    if (!orgId) return
    try {
      const { error: deleteError } = await supabase
        .from('contacts')
        .delete()
        .eq('organization_id', orgId)
        .eq('email', email)

      if (deleteError) throw deleteError
      // No refetch — ContactsPage handles optimistic UI update
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      throw err
    }
  }

  const bulkUpsertContacts = async (rows: Array<{
    email: string; name: string; company: string; role: string;
    phone?: string; country?: string; address?: string; notes?: string;
  }>) => {
    if (!orgId || rows.length === 0) return { inserted: 0, updated: 0 }

    const COLORS = [
      'bg-blue-500','bg-green-500','bg-purple-500','bg-amber-500','bg-teal-500',
      'bg-rose-500','bg-indigo-500','bg-cyan-500','bg-orange-500','bg-emerald-500',
      'bg-violet-500','bg-pink-500','bg-red-500','bg-sky-500','bg-lime-500',
      'bg-fuchsia-500','bg-slate-500','bg-blue-600','bg-green-600','bg-purple-600',
    ]

    // Check which emails already exist
    const emails = rows.map(r => r.email.toLowerCase().trim())
    const { data: existing } = await supabase
      .from('contacts')
      .select('email')
      .eq('organization_id', orgId)
      .in('email', emails)
    const existingEmails = new Set((existing || []).map((e: { email: string }) => e.email.toLowerCase()))

    const records = rows.map((row, idx) => {
      const initials = row.name.split(' ').map(n => n[0] || '').join('').toUpperCase().slice(0, 2)
      return {
        organization_id: orgId,
        email: row.email.toLowerCase().trim(),
        name: row.name.trim(),
        company: row.company?.trim() || '',
        role: row.role?.trim() || 'Supplier',
        phone: row.phone?.trim() || '',
        address: row.address?.trim() || '',
        country: row.country?.trim() || '',
        notes: row.notes?.trim() || '',
        initials,
        color: COLORS[idx % COLORS.length],
      }
    })

    const { error: upsertError } = await supabase
      .from('contacts')
      .upsert(records, { onConflict: 'email,organization_id' })

    if (upsertError) throw upsertError

    await fetchContacts()

    const updatedCount = records.filter(r => existingEmails.has(r.email)).length
    return { inserted: records.length - updatedCount, updated: updatedCount }
  }

  const bulkDeleteContacts = async (emails: string[]) => {
    if (!orgId || emails.length === 0) return
    try {
      const { error: deleteError } = await supabase
        .from('contacts')
        .delete()
        .eq('organization_id', orgId)
        .in('email', emails)

      if (deleteError) throw deleteError
      await fetchContacts()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      throw err
    }
  }

  return {
    contacts,
    loading,
    error,
    addContact,
    updateContact,
    deleteContact,
    bulkDeleteContacts,
    bulkUpsertContacts,
    refetch: fetchContacts,
  }
}
