import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { ProductInquiry } from '../types'

interface Product {
  id: string
  name: string
  category: string
  specs: string
  is_active: boolean
}

export function useProducts(orgId: string | null) {
  const [products, setProducts] = useState<Product[]>([])
  const [inquiries, setInquiries] = useState<ProductInquiry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchProducts = useCallback(async () => {
    if (!orgId) {
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
        .order('name')

      if (fetchError) throw fetchError
      setProducts(data || [])
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

  useEffect(() => {
    fetchProducts()
    fetchInquiries()
  }, [fetchProducts, fetchInquiries])

  return {
    products,
    inquiries,
    loading,
    error,
    refetchProducts: fetchProducts,
    refetchInquiries: fetchInquiries,
  }
}
