import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface AgentInsight {
  id: string
  organization_id: string
  agent_type: string
  order_id: string | null
  title: string
  body: string
  priority: string
  action_type: string | null
  action_data: any
  dismissed: boolean
  created_at: string
  expires_at: string | null
}

export function useAgentInsights(orgId: string | null) {
  const [insights, setInsights] = useState<AgentInsight[]>([])
  const [loading, setLoading] = useState(true)

  const fetchInsights = useCallback(async () => {
    if (!orgId) {
      setInsights([])
      setLoading(false)
      return
    }

    try {
      const { data, error } = await supabase
        .from('agent_insights')
        .select('*')
        .eq('organization_id', orgId)
        .eq('dismissed', false)
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw error
      setInsights((data || []) as AgentInsight[])
    } catch (err) {
      console.error('Failed to fetch agent insights:', err)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    fetchInsights()
    const interval = setInterval(fetchInsights, 60000) // refresh every minute
    return () => clearInterval(interval)
  }, [fetchInsights])

  const dismissInsight = useCallback(async (id: string) => {
    await supabase.from('agent_insights').update({ dismissed: true }).eq('id', id)
    setInsights(prev => prev.filter(i => i.id !== id))
  }, [])

  const refreshInsights = useCallback(() => fetchInsights(), [fetchInsights])

  // Split by type
  const actionItems = insights.filter(i => i.agent_type === 'follow_up' || i.agent_type === 'payment')
  const briefing = insights.find(i => i.agent_type === 'briefing')
  const supplierScores = insights.filter(i => i.agent_type === 'supplier_score')

  return {
    insights,
    actionItems,
    briefing,
    supplierScores,
    loading,
    dismissInsight,
    refreshInsights,
  }
}
