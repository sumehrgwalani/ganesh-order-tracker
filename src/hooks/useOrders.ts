import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Order, HistoryEntry } from '../types'
import { ORDER_STAGES } from '../data/constants'

export function useOrders(orgId: string | null) {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchOrders = useCallback(async () => {
    if (!orgId) {
      setOrders([])  // Clear stale data from previous user
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      // Fetch orders with their history — exclude soft-deleted orders
      const { data: orderRows, error: fetchError } = await supabase
        .from('orders')
        .select(`
          *,
          order_history (*),
          order_line_items (*)
        `)
        .eq('organization_id', orgId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (fetchError) {
        // Fallback: if deleted_at column doesn't exist yet, fetch without filter
        if (fetchError.message?.includes('deleted_at')) {
          const { data: fallbackRows, error: fallbackError } = await supabase
            .from('orders')
            .select(`*, order_history (*), order_line_items (*)`)
            .eq('organization_id', orgId)
            .order('created_at', { ascending: false })
          if (fallbackError) throw fallbackError
          setOrders(convertRows(fallbackRows || []))
          setError(null)
          setLoading(false)
          return
        }
        throw fetchError
      }

      setOrders(convertRows(orderRows || []))
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  // Convert DB rows to app's Order format
  const convertRows = (orderRows: any[]): Order[] => {
    return orderRows.map((row: any) => ({
      id: row.order_id,
      poNumber: row.po_number || '',
      piNumber: row.pi_number || undefined,
      company: row.company,
      brand: row.brand || undefined,
      product: row.product,
      specs: row.specs || '',
      from: row.from_location || 'India',
      to: row.to_location || '',
      date: row.order_date || '',
      currentStage: row.current_stage,
      supplier: row.supplier,
      artworkStatus: row.artwork_status || undefined,
      awbNumber: row.awb_number || undefined,
      totalValue: row.total_value || undefined,
      totalKilos: row.total_kilos ? Number(row.total_kilos) : undefined,
      metadata: row.metadata || undefined,
      lineItems: (row.order_line_items || [])
        .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((li: any) => ({
          product: li.product || '',
          brand: li.brand || '',
          freezing: li.freezing || '',
          size: li.size || '',
          glaze: li.glaze || '',
          glazeMarked: li.glaze_marked || '',
          packing: li.packing || '',
          cases: li.cases || 0,
          kilos: li.kilos || 0,
          pricePerKg: li.price_per_kg || 0,
          currency: li.currency || 'USD',
          total: li.total || 0,
        })),
      history: (row.order_history || [])
        .sort((a: any, b: any) => a.stage - b.stage || new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .map((h: any): HistoryEntry => ({
          id: h.id || undefined,
          stage: h.stage,
          timestamp: h.timestamp,
          from: h.from_address || '',
          to: h.to_address || undefined,
          subject: h.subject || '',
          body: h.body || '',
          hasAttachment: h.has_attachment || false,
          attachments: h.attachments || undefined,
        })),
    }))
  }

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  // ── Create Order ──────────────────────────────────────────────────────
  const createOrder = async (order: Order) => {
    if (!orgId) return null
    try {
      const { data: newOrder, error: orderError } = await supabase
        .from('orders')
        .insert({
          organization_id: orgId,
          order_id: order.id,
          po_number: order.poNumber,
          pi_number: order.piNumber || null,
          company: order.company,
          brand: order.brand || null,
          product: order.product,
          specs: order.specs,
          from_location: order.from,
          to_location: order.to,
          order_date: new Date().toISOString().split('T')[0],
          current_stage: order.currentStage,
          supplier: order.supplier,
          total_value: order.totalValue || null,
          total_kilos: order.totalKilos || null,
          status: 'sent',
          metadata: order.metadata || {},
        })
        .select()
        .single()

      if (orderError) throw orderError

      // Insert history entries
      if (order.history && order.history.length > 0 && newOrder) {
        const historyRows = order.history.map(h => ({
          order_id: newOrder.id,
          stage: h.stage,
          timestamp: h.timestamp,
          from_address: h.from,
          to_address: h.to || null,
          subject: h.subject,
          body: h.body || '',
          has_attachment: h.hasAttachment || false,
          attachments: h.attachments || null,
        }))
        await supabase.from('order_history').insert(historyRows)
      }

      // Insert line items if present
      if (order.lineItems && order.lineItems.length > 0 && newOrder) {
        const lineItemRows = order.lineItems.map((item, idx) => ({
          order_id: newOrder.id,
          product: String(item.product || ''),
          brand: String(item.brand || ''),
          freezing: String(item.freezing || ''),
          size: String(item.size || ''),
          glaze: String(item.glaze || ''),
          glaze_marked: String(item.glazeMarked || ''),
          packing: String(item.packing || ''),
          cases: parseInt(String(item.cases)) || 0,
          kilos: parseFloat(String(item.kilos)) || 0,
          price_per_kg: parseFloat(String(item.pricePerKg)) || 0,
          currency: String(item.currency || 'USD'),
          total: parseFloat(String(item.total)) || 0,
          sort_order: idx,
        }))
        await supabase.from('order_line_items').insert(lineItemRows)
      }

      await fetchOrders()
      return newOrder
    } catch (err: any) {
      setError(err.message)
      throw err
    }
  }

  // ── Update Order Stage (with audit log) ───────────────────────────────
  const updateOrderStage = async (orderId: string, newStage: number, oldStage?: number) => {
    if (!orgId) return
    try {
      // Get the DB UUID for this order
      const { data: orderRow, error: lookupError } = await supabase
        .from('orders')
        .select('id, current_stage')
        .eq('organization_id', orgId)
        .eq('order_id', orderId)
        .single()

      if (lookupError) throw lookupError

      const previousStage = oldStage ?? orderRow.current_stage

      // Update the stage
      const { error: updateError } = await supabase
        .from('orders')
        .update({ current_stage: newStage, updated_at: new Date().toISOString() })
        .eq('id', orderRow.id)

      if (updateError) throw updateError

      // Log stage change to order_history for audit trail
      const stageNames: Record<number, string> = Object.fromEntries(
        ORDER_STAGES.map(s => [s.id, s.name])
      )
      await supabase.from('order_history').insert({
        order_id: orderRow.id,
        stage: newStage,
        timestamp: new Date().toISOString(),
        from_address: 'System',
        subject: `Stage updated: ${stageNames[previousStage] || previousStage} → ${stageNames[newStage] || newStage}`,
        body: `Order stage changed from "${stageNames[previousStage] || `Stage ${previousStage}`}" to "${stageNames[newStage] || `Stage ${newStage}`}".`,
        has_attachment: false,
      })

      await fetchOrders()
    } catch (err: any) {
      setError(err.message)
      throw err
    }
  }

  // ── Update Order Details (full edit, supports amendment with line items) ──
  const updateOrder = async (orderId: string, updates: Partial<Order>) => {
    if (!orgId) return
    try {
      // Build the DB update payload from the Order fields provided
      const dbUpdates: Record<string, any> = { updated_at: new Date().toISOString() }
      if (updates.company !== undefined) dbUpdates.company = updates.company
      if (updates.supplier !== undefined) dbUpdates.supplier = updates.supplier
      if (updates.product !== undefined) dbUpdates.product = updates.product
      if (updates.specs !== undefined) dbUpdates.specs = updates.specs
      if (updates.from !== undefined) dbUpdates.from_location = updates.from
      if (updates.to !== undefined) dbUpdates.to_location = updates.to
      if (updates.brand !== undefined) dbUpdates.brand = updates.brand || null
      if (updates.piNumber !== undefined) dbUpdates.pi_number = updates.piNumber || null
      if (updates.awbNumber !== undefined) dbUpdates.awb_number = updates.awbNumber || null
      if (updates.totalValue !== undefined) dbUpdates.total_value = updates.totalValue || null
      if (updates.totalKilos !== undefined) dbUpdates.total_kilos = updates.totalKilos || null
      if (updates.artworkStatus !== undefined) dbUpdates.artwork_status = updates.artworkStatus || null
      if (updates.metadata !== undefined) dbUpdates.metadata = updates.metadata || {}

      // Look up the DB UUID for this order
      const { data: orderRow, error: lookupError } = await supabase
        .from('orders')
        .select('id')
        .eq('organization_id', orgId)
        .eq('order_id', orderId)
        .single()

      if (lookupError) throw lookupError

      const { error: updateError } = await supabase
        .from('orders')
        .update(dbUpdates)
        .eq('id', orderRow.id)

      if (updateError) throw updateError

      // Replace line items if provided (amendment flow)
      if (updates.lineItems && updates.lineItems.length > 0) {
        // Delete existing line items
        await supabase
          .from('order_line_items')
          .delete()
          .eq('order_id', orderRow.id)

        // Insert new line items
        const lineItemRows = updates.lineItems.map((item: any, idx: number) => ({
          order_id: orderRow.id,
          product: String(item.product || ''),
          brand: String(item.brand || ''),
          freezing: String(item.freezing || ''),
          size: String(item.size || ''),
          glaze: String(item.glaze || ''),
          glaze_marked: String(item.glazeMarked || ''),
          packing: String(item.packing || ''),
          cases: parseInt(String(item.cases)) || 0,
          kilos: parseFloat(String(item.kilos)) || 0,
          price_per_kg: parseFloat(String(item.pricePerKg)) || 0,
          currency: String(item.currency || 'USD'),
          total: parseFloat(String(item.total)) || 0,
          sort_order: idx,
        }))
        await supabase.from('order_line_items').insert(lineItemRows)
      }

      // Insert new history entries if provided (amendment audit trail)
      if (updates.history && updates.history.length > 0) {
        // Only insert entries that don't already exist (new amendment entries)
        // We identify new entries by checking for "AMENDED" in subject
        const newEntries = updates.history.filter((h: any) =>
          h.subject?.includes('AMENDED') &&
          h.timestamp && new Date(h.timestamp).getTime() > Date.now() - 60000
        )
        if (newEntries.length > 0) {
          const historyRows = newEntries.map((h: any) => ({
            order_id: orderRow.id,
            stage: h.stage,
            timestamp: h.timestamp,
            from_address: h.from || 'System',
            to_address: h.to || null,
            subject: h.subject,
            body: h.body || '',
            has_attachment: h.hasAttachment || false,
            attachments: h.attachments || null,
          }))
          await supabase.from('order_history').insert(historyRows)
        }
      }

      await fetchOrders()
    } catch (err: any) {
      setError(err.message)
      throw err
    }
  }

  // ── Soft Delete (archive) ─────────────────────────────────────────────
  const deleteOrder = async (orderId: string) => {
    if (!orgId) return
    try {
      // Try soft delete first (set deleted_at)
      const { error: softDeleteError } = await supabase
        .from('orders')
        .update({ deleted_at: new Date().toISOString(), status: 'archived' })
        .eq('organization_id', orgId)
        .eq('order_id', orderId)

      if (softDeleteError) {
        // If deleted_at column doesn't exist yet, fall back to hard delete
        if (softDeleteError.message?.includes('deleted_at')) {
          const { error: hardDeleteError } = await supabase
            .from('orders')
            .delete()
            .eq('organization_id', orgId)
            .eq('order_id', orderId)
          if (hardDeleteError) throw hardDeleteError
        } else {
          throw softDeleteError
        }
      }

      // Remove from local state immediately for responsive UI
      setOrders(prev => prev.filter(o => o.id !== orderId))
    } catch (err: any) {
      setError(err.message)
      throw err
    }
  }

  // ── Restore Order (undo soft delete) ──────────────────────────────────
  const restoreOrder = async (orderId: string) => {
    if (!orgId) return
    try {
      const { error: restoreError } = await supabase
        .from('orders')
        .update({ deleted_at: null, status: 'sent' })
        .eq('organization_id', orgId)
        .eq('order_id', orderId)

      if (restoreError) throw restoreError
      await fetchOrders()
    } catch (err: any) {
      setError(err.message)
      throw err
    }
  }

  // Setter function compatible with existing code: setOrders(fn)
  const setOrdersCompat = (updater: Order[] | ((prev: Order[]) => Order[])) => {
    if (typeof updater === 'function') {
      setOrders(prev => {
        const newOrders = updater(prev)
        return newOrders
      })
    } else {
      setOrders(updater)
    }
  }

  return {
    orders,
    loading,
    error,
    createOrder,
    updateOrderStage,
    updateOrder,
    deleteOrder,
    restoreOrder,
    setOrders: setOrdersCompat,
    refetch: fetchOrders,
  }
}
