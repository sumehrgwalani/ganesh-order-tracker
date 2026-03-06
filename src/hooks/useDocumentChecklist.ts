import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface DocumentRequirement {
  id: number
  doc_type: string
  display_name: string
  zone: string
  origin_country: string
  origin_of_document: string | null
  description: string | null
  sort_order: number
}

export interface OrderDocument {
  id: string
  order_id: string
  organization_id: string
  doc_type: string
  status: string
  stage: string
  filename: string | null
  file_url: string | null
  metadata: any
  ai_confidence: number | null
  uploaded_at: string | null
  created_at: string
}

export interface ChecklistItem extends DocumentRequirement {
  draft: OrderDocument | null
  final: OrderDocument | null
}

export function useDocumentChecklist(orderId: string | null, orgId: string | null, destination?: string) {
  const [requirements, setRequirements] = useState<DocumentRequirement[]>([])
  const [orderDocs, setOrderDocs] = useState<OrderDocument[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    if (!orderId || !orgId) return
    setLoading(true)

    // Fetch requirements (filter by zone based on destination)
    const isEU = destination?.toLowerCase()?.includes('spain') ||
      destination?.toLowerCase()?.includes('valencia') ||
      destination?.toLowerCase()?.includes('europe') ||
      destination?.toLowerCase()?.includes('eu')

    const { data: reqs } = await supabase
      .from('document_requirements')
      .select('*')
      .order('sort_order')

    // Filter: 'all' zone docs always show, 'eu' only if destination is EU
    const filtered = (reqs || []).filter((r: DocumentRequirement) =>
      r.zone === 'all' || (r.zone === 'eu' && isEU)
    )
    setRequirements(filtered)

    // Fetch order documents
    const { data: docs } = await supabase
      .from('order_documents')
      .select('*')
      .eq('order_id', orderId)
      .eq('organization_id', orgId)
      .order('created_at')

    setOrderDocs(docs || [])
    setLoading(false)
  }, [orderId, orgId, destination])

  useEffect(() => { fetchData() }, [fetchData])

  // Build checklist: merge requirements with actual documents
  const checklist: ChecklistItem[] = requirements.map(req => {
    const draft = orderDocs.find(d => d.doc_type === req.doc_type && d.stage === 'draft') || null
    const final_ = orderDocs.find(d => d.doc_type === req.doc_type && d.stage === 'final') || null
    return { ...req, draft, final: final_ }
  })

  const received = checklist.filter(c => c.draft || c.final).length
  const total = checklist.length

  return { checklist, received, total, loading, refresh: fetchData }
}
