import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Order, HistoryEntry, OrderLineItem, AttachmentEntry } from '../types'
import { ORDER_STAGES } from '../data/constants'
import { normalizeCompanyName } from '../utils/normalizeCompany'

// DB row shapes returned by Supabase queries
interface DbLineItem {
  product?: string; brand?: string; freezing?: string; size?: string;
  glaze?: string; glaze_marked?: string; packing?: string;
  cases?: number; kilos?: number; price_per_kg?: number;
  currency?: string; total?: number; sort_order?: number;
}
interface DbHistoryRow {
  id?: string; stage: number; timestamp: string;
  from_address?: string; to_address?: string;
  subject?: string; body?: string;
  has_attachment?: boolean; attachments?: string[];
}
interface DbOrderRow {
  id: string; order_id: string; po_number?: string; pi_number?: string;
  company: string; brand?: string; product: string; specs?: string;
  from_location?: string; to_location?: string; order_date?: string;
  current_stage: number; supplier: string; artwork_status?: string;
  awb_number?: string; total_value?: string; total_kilos?: number;
  delivery_terms?: string; payment_terms?: string; commission?: string;
  metadata?: Record<string, unknown>; order_line_items?: DbLineItem[];
  order_history?: DbHistoryRow[];
  container_number?: string; seal_number?: string; vessel_name?: string;
  bl_number?: string; shipping_line?: string; etd?: string; eta?: string;
}

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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  // Convert DB rows to app's Order format
  const convertRows = (orderRows: DbOrderRow[]): Order[] => {
    return orderRows.map((row: DbOrderRow) => ({
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
      delivery_terms: row.delivery_terms || '',
      payment_terms: row.payment_terms || '',
      commission: row.commission || '',
      metadata: row.metadata || undefined,
      containerNumber: row.container_number || undefined,
      sealNumber: row.seal_number || undefined,
      vesselName: row.vessel_name || undefined,
      blNumber: row.bl_number || undefined,
      shippingLine: row.shipping_line || undefined,
      etd: row.etd || undefined,
      eta: row.eta || undefined,
      lineItems: (() => {
        const sorted = (row.order_line_items || [])
          .sort((a: DbLineItem, b: DbLineItem) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((li: DbLineItem) => ({
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
          }))
        // Deduplicate line items (same product + brand + numeric values = duplicate from multiple extractions)
        const seen = new Set<string>()
        return sorted.filter(li => {
          const key = `${li.product}|${li.brand}|${li.cases}|${li.kilos}|${li.pricePerKg}|${li.total}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
      })(),
      history: (row.order_history || [])
        .sort((a: DbHistoryRow, b: DbHistoryRow) => a.stage - b.stage || new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .map((h: DbHistoryRow): HistoryEntry => ({
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
          company: normalizeCompanyName(order.company),
          brand: order.brand || null,
          product: order.product,
          specs: order.specs,
          from_location: order.from,
          to_location: order.to,
          order_date: new Date().toISOString().split('T')[0],
          current_stage: order.currentStage,
          supplier: normalizeCompanyName(order.supplier),
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      throw err
    }
  }

  // ── Update Order Details (full edit, supports amendment with line items) ──
  const updateOrder = async (orderId: string, updates: Partial<Order>) => {
    if (!orgId) return
    try {
      // Build the DB update payload from the Order fields provided
      const dbUpdates: Record<string, string | number | boolean | null | Record<string, unknown>> = { updated_at: new Date().toISOString() }
      if (updates.company !== undefined) dbUpdates.company = normalizeCompanyName(updates.company)
      if (updates.supplier !== undefined) dbUpdates.supplier = normalizeCompanyName(updates.supplier)
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
        const lineItemRows = updates.lineItems.map((item: OrderLineItem, idx: number) => ({
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
        // Only insert entries that don't already exist (new amendment / revised entries)
        // We identify new entries by checking for "AMENDED" or "REVISED" in subject
        const newEntries = updates.history.filter((h: HistoryEntry) =>
          (h.subject?.includes('AMENDED') || h.subject?.includes('REVISED')) &&
          h.timestamp && new Date(h.timestamp).getTime() > Date.now() - 60000
        )
        if (newEntries.length > 0) {
          const historyRows = newEntries.map((h: HistoryEntry) => ({
            order_id: orderRow.id,
            stage: h.stage,
            timestamp: h.timestamp,
            from_address: h.from || 'System',
            to_address: h.to || null,
            subject: h.subject,
            body: h.body || '',
            has_attachment: h.hasAttachment || false,
            attachments: h.attachments ? h.attachments.map((a: AttachmentEntry) => typeof a === 'string' ? a : JSON.stringify(a)) : null,
          }))
          await supabase.from('order_history').insert(historyRows)
        }
      }

      await fetchOrders()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      throw err
    }
  }

  // ── Soft Delete (archive) ─────────────────────────────────────────────
  const deleteOrder = async (orderId: string) => {
    if (!orgId) throw new Error('No organization selected')
    const { error: deleteError } = await supabase
      .from('orders')
      .delete()
      .eq('organization_id', orgId)
      .eq('order_id', orderId)

    if (deleteError) {
      const msg = deleteError.message || JSON.stringify(deleteError)
      setError(msg)
      throw new Error(msg)
    }

    // Remove from local state immediately for responsive UI
    setOrders(prev => prev.filter(o => o.id !== orderId))
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
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
