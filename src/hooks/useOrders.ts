import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Order, HistoryEntry } from '../types'

export function useOrders(orgId: string | null) {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchOrders = useCallback(async () => {
    if (!orgId) {
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      // Fetch orders with their history
      const { data: orderRows, error: fetchError } = await supabase
        .from('orders')
        .select(`
          *,
          order_history (*)
        `)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })

      if (fetchError) throw fetchError

      // Convert to app's Order format
      const converted: Order[] = (orderRows || []).map((row: any) => ({
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
        history: (row.order_history || [])
          .sort((a: any, b: any) => a.stage - b.stage)
          .map((h: any): HistoryEntry => ({
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

      setOrders(converted)
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  const createOrder = async (order: Order) => {
    if (!orgId) return null
    try {
      // Insert order
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
          size: String(item.size || ''),
          glaze: String(item.glaze || ''),
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

  const updateOrderStage = async (orderId: string, newStage: number) => {
    if (!orgId) return
    try {
      const { error: updateError } = await supabase
        .from('orders')
        .update({ current_stage: newStage, updated_at: new Date().toISOString() })
        .eq('organization_id', orgId)
        .eq('order_id', orderId)

      if (updateError) throw updateError
      await fetchOrders()
    } catch (err: any) {
      setError(err.message)
      throw err
    }
  }

  const deleteOrder = async (orderId: string) => {
    if (!orgId) return
    try {
      // Delete from Supabase — order_history and order_line_items should cascade
      const { error: deleteError } = await supabase
        .from('orders')
        .delete()
        .eq('organization_id', orgId)
        .eq('order_id', orderId)

      if (deleteError) throw deleteError

      // Remove from local state immediately
      setOrders(prev => prev.filter(o => o.id !== orderId))
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
    deleteOrder,
    setOrders: setOrdersCompat,
    refetch: fetchOrders,
  }
}
