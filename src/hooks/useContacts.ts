import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Contact, ContactsMap, ContactFormData } from '../types'

export function useContacts(orgId: string | null) {
  const [contacts, setContacts] = useState<ContactsMap>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchContacts = useCallback(async () => {
    if (!orgId) {
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
          notes: row.notes || '',
          country: row.country || '',
        }
      }
      setContacts(map)
      setError(null)
    } catch (err: any) {
      setError(err.message)
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
          role: formData.role || formData.category || 'Supplier',
          phone: formData.phone || '',
          country: '',
          initials,
          color: formData.color || 'bg-gray-500',
          notes: '',
        })
        .select()
        .single()

      if (insertError) throw insertError
      await fetchContacts()
      return data
    } catch (err: any) {
      setError(err.message)
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
      await fetchContacts()
    } catch (err: any) {
      setError(err.message)
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
      await fetchContacts()
    } catch (err: any) {
      setError(err.message)
      throw err
    }
  }

  return {
    contacts,
    contactsList: Object.entries(contacts).map(([email, c]) => ({ email, ...c })),
    loading,
    error,
    addContact,
    updateContact,
    deleteContact,
    refetch: fetchContacts,
  }
}
