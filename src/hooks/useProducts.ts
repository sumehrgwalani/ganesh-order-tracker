import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { ProductInquiry } from '../types'

export interface CatalogProduct {
  id: string
  name: string
  category: string
  product_type: string
  size: string
  glaze: number
  freeze_type: string
  catching_method: string | null
  markets: string | null
  is_active: boolean
}

export function useProducts(orgId: string | null) {
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [inquiries, setInquiries] = useState<ProductInquiry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchProducts = useCallback(async () => {
    if (!orgId) {
      setProducts([])
      setInquiries([])
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('products')
        .select('*')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('product_type')
        .order('name')
        .order('size')

      if (fetchError) throw fetchError
      setProducts((data || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        category: row.category || row.product_type || '',
        product_type: row.product_type || row.category || '',
        size: row.size || '',
        glaze: row.glaze != null ? Number(row.glaze) : 0,
        freeze_type: row.freeze_type || '',
        catching_method: row.catching_method || null,
        markets: row.markets || null,
        is_active: row.is_active,
      })))
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  const fetchInquiries = useCallback(async () => {
    if (!orgId) return
    try {
      const { data, error: fetchError } = await supabase
        .from('product_inquiries')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })

      if (fetchError) throw fetchError

      const converted: ProductInquiry[] = (data || []).map((row: any) => ({
        product: row.product,
        sizes: row.sizes || undefined,
        total: row.total || '',
        from: row.from_company,
        brand: row.brand || undefined,
      }))
      setInquiries(converted)
      setError(null)
    } catch (err: any) {
      setError(err.message)
    }
  }, [orgId])

  const addProduct = useCallback(async (product: Omit<CatalogProduct, 'id' | 'is_active'>) => {
    if (!orgId) return
    const { data, error: insertError } = await supabase
      .from('products')
      .insert({
        organization_id: orgId,
        name: product.name,
        category: product.category,
        product_type: product.product_type,
        size: product.size,
        glaze: product.glaze,
        freeze_type: product.freeze_type,
        catching_method: product.catching_method,
        markets: product.markets,
        is_active: true,
      })
      .select()
      .single()

    if (insertError) throw insertError
    if (data) {
      setProducts(prev => [...prev, {
        id: data.id,
        name: data.name,
        category: data.category || data.product_type || '',
        product_type: data.product_type || data.category || '',
        size: data.size || '',
        glaze: data.glaze != null ? Number(data.glaze) : 0,
        freeze_type: data.freeze_type || '',
        catching_method: data.catching_method || null,
        markets: data.markets || null,
        is_active: true,
      }])
    }
  }, [orgId])

  const updateProduct = useCallback(async (id: string, updates: Partial<CatalogProduct>) => {
    if (!orgId) return
    const { error: updateError } = await supabase
      .from('products')
      .update({
        name: updates.name,
        category: updates.category,
        product_type: updates.product_type,
        size: updates.size,
        glaze: updates.glaze,
        freeze_type: updates.freeze_type,
        catching_method: updates.catching_method,
        markets: updates.markets,
      })
      .eq('id', id)

    if (updateError) throw updateError
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p))
  }, [orgId])

  const deleteProduct = useCallback(async (id: string) => {
    if (!orgId) return
    // Soft delete by setting is_active = false
    const { error: deleteError } = await supabase
      .from('products')
      .update({ is_active: false })
      .eq('id', id)

    if (deleteError) throw deleteError
    setProducts(prev => prev.filter(p => p.id !== id))
  }, [orgId])

  useEffect(() => {
    fetchProducts()
    fetchInquiries()
  }, [fetchProducts, fetchInquiries])

  return {
    products,
    inquiries,
    loading,
    error,
    addProduct,
    updateProduct,
    deleteProduct,
    refetchProducts: fetchProducts,
    refetchInquiries: fetchInquiries,
  }
}
