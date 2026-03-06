import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from './Icon'
import { useAgentInsights } from '../hooks/useAgentInsights'
import { apiCall } from '../utils/api'

interface Props {
  orgId: string
  onComposeEmail?: (draft: { subject: string; body: string; recipients: string[] }) => void
}

/* ── Recent-changes types ── */
interface DetailLink { po: string; id: string }
interface SummaryItem { icon: string; text: string; detail?: string; detailLinks?: DetailLink[] }
interface SyncStats {
  newOrders: number; stageUpdates: number; emailsProcessed: number
  ordersAffected: number; docsStored: number; lineItemsExtracted: number
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const ACTIVITY_ICONS: Record<string, { name: string; color: string }> = {
  new_order: { name: 'Plus', color: '#22c55e' },
  stage_update: { name: 'ArrowRight', color: '#3b82f6' },
  line_items: { name: 'List', color: '#f59e0b' },
  document: { name: 'FileCheck', color: '#a855f7' },
  details_updated: { name: 'Edit', color: '#06b6d4' },
  email: { name: 'Mail', color: '#94a3b8' },
}

const PRIORITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  high: { bg: 'rgba(239, 68, 68, 0.12)', text: '#f87171', border: 'rgba(239, 68, 68, 0.3)' },
  medium: { bg: 'rgba(245, 158, 11, 0.12)', text: '#fbbf24', border: 'rgba(245, 158, 11, 0.3)' },
  low: { bg: 'rgba(34, 197, 94, 0.12)', text: '#4ade80', border: 'rgba(34, 197, 94, 0.3)' },
}

type TabKey = 'activity' | 'actions' | 'briefing' | 'suppliers'

export default function CommandCenter({ orgId, onComposeEmail }: Props) {
  const navigate = useNavigate()

  /* ── AI Insights state ── */
  const { actionItems, briefing, supplierScores, loading: insightsLoading, dismissInsight, refreshInsights } = useAgentInsights(orgId)
  const [activeTab, setActiveTab] = useState<TabKey>('activity')
  const [runningAgent, setRunningAgent] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  /* ── Recent changes state ── */
  const [summary, setSummary] = useState<SummaryItem[]>([])
  const [rcStats, setRcStats] = useState<SyncStats | null>(null)
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null)
  const [syncLabel, setSyncLabel] = useState('')
  const [rcLoading, setRcLoading] = useState(true)
  const [rcError, setRcError] = useState('')
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  /* ── Fetch recent changes ── */
  const fetchChanges = useCallback(async () => {
    try {
      const { data, error: err } = await apiCall('/api/recent-changes', { organization_id: orgId })
      if (err) { setRcError('Could not load updates') }
      else { setSummary(data.summary || []); setRcStats(data.stats || null); setLastSyncTime(data.lastSyncTime); setRcError('') }
    } catch { setRcError('Could not reach server') }
    finally { setRcLoading(false) }
  }, [orgId])

  useEffect(() => { fetchChanges(); const iv = setInterval(fetchChanges, 30000); return () => clearInterval(iv) }, [fetchChanges])
  useEffect(() => {
    const tick = () => { if (lastSyncTime) setSyncLabel(timeAgo(lastSyncTime)) }
    tick(); const iv = setInterval(tick, 15000); return () => clearInterval(iv)
  }, [lastSyncTime])

  /* ── Agent runner ── */
  const runAgent = async (mode: string) => {
    setRunningAgent(mode)
    try { await apiCall('/api/agents', { organization_id: orgId, mode }); await refreshInsights() }
    catch (err) { console.error('Agent run failed:', err) }
    finally { setRunningAgent(null) }
  }

  /* ── Tab config ── */
  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: 'activity', label: 'Activity', count: summary.length },
    { key: 'actions', label: 'Action Items', count: actionItems.length },
    { key: 'briefing', label: 'Briefing', count: briefing ? 1 : 0 },
    { key: 'suppliers', label: 'Suppliers', count: supplierScores.length },
  ]

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
        borderRadius: '16px',
        border: '1px solid rgba(56, 189, 248, 0.15)',
        boxShadow: '0 0 30px rgba(56, 189, 248, 0.05), 0 4px 20px rgba(0,0,0,0.15)',
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Top glow */}
      <div style={{ position: 'absolute', top: 0, left: '10%', right: '10%', height: '1px', background: 'linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.4), transparent)' }} />

      {/* ─── Header ─── */}
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'linear-gradient(135deg, #a855f7, #06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 12px rgba(168, 85, 247, 0.3)' }}>
            <Icon name="Zap" size={14} className="text-white" />
          </div>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', letterSpacing: '0.025em' }}>
            Command Center
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {syncLabel && !rcLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e', animation: 'ccBlink 3s ease-in-out infinite' }} />
              <span style={{ fontSize: '10px', color: '#64748b' }}>Synced {syncLabel}</span>
            </div>
          )}
          <button
            onClick={() => runAgent('follow_up')}
            disabled={!!runningAgent}
            style={{
              padding: '4px 10px', fontSize: '10px',
              background: 'rgba(168, 85, 247, 0.15)', border: '1px solid rgba(168, 85, 247, 0.3)',
              borderRadius: '6px', color: '#c084fc',
              cursor: runningAgent ? 'wait' : 'pointer', opacity: runningAgent ? 0.5 : 1,
            }}
          >
            {runningAgent ? 'Running...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ─── Quick stats bar (only on Activity tab) ─── */}
      {activeTab === 'activity' && rcStats && !rcLoading && (rcStats.ordersAffected + rcStats.docsStored + rcStats.emailsProcessed) > 0 && (
        <div style={{ padding: '0 20px 8px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {rcStats.ordersAffected > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Icon name="Package" size={12} className="text-cyan-400" />
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>{rcStats.ordersAffected} orders</span>
            </div>
          )}
          {rcStats.docsStored > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Icon name="FileCheck" size={12} className="text-purple-400" />
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>{rcStats.docsStored} docs</span>
            </div>
          )}
          {rcStats.lineItemsExtracted > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Icon name="List" size={12} className="text-amber-400" />
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>{rcStats.lineItemsExtracted} items</span>
            </div>
          )}
          {rcStats.emailsProcessed > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Icon name="Mail" size={12} className="text-slate-400" />
              <span style={{ fontSize: '11px', color: '#64748b' }}>{rcStats.emailsProcessed} emails</span>
            </div>
          )}
        </div>
      )}

      {/* ─── Tabs ─── */}
      <div style={{ padding: '0 20px', display: 'flex', gap: '4px', borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setExpandedId(null); setExpandedIdx(null) }}
            style={{
              padding: '8px 12px', fontSize: '11px',
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? '#e2e8f0' : '#64748b',
              background: 'transparent', border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #a855f7' : '2px solid transparent',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px',
            }}
          >
            {tab.label}
            {tab.count > 0 && (
              <span style={{
                fontSize: '9px', padding: '1px 5px', borderRadius: '8px',
                background: activeTab === tab.key ? 'rgba(168, 85, 247, 0.2)' : 'rgba(148, 163, 184, 0.15)',
                color: activeTab === tab.key ? '#c084fc' : '#94a3b8',
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ─── Content ─── */}
      <div style={{ flex: 1, padding: '12px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>

        {/* ══ ACTIVITY TAB ══ */}
        {activeTab === 'activity' && (
          <>
            {rcLoading && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8', animation: 'ccPulse 1.5s ease-in-out infinite' }} />
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8', animation: 'ccPulse 1.5s ease-in-out 0.3s infinite' }} />
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8', animation: 'ccPulse 1.5s ease-in-out 0.6s infinite' }} />
                  <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '4px' }}>Loading...</span>
                </div>
              </div>
            )}
            {rcError && !rcLoading && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <Icon name="AlertCircle" size={24} className="text-red-400 mx-auto" />
                <p style={{ fontSize: '12px', color: '#f87171', marginTop: '8px' }}>{rcError}</p>
              </div>
            )}
            {!rcLoading && !rcError && summary.length === 0 && (
              <div style={{ textAlign: 'center', padding: '30px 0' }}>
                <Icon name="CheckCircle" size={28} className="text-green-400 mx-auto" />
                <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '10px', fontWeight: 500 }}>All caught up!</p>
                <p style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>No activity since last sync</p>
              </div>
            )}
            {!rcLoading && !rcError && summary.map((item, i) => {
              const iconInfo = ACTIVITY_ICONS[item.icon] || { name: 'Zap', color: '#38bdf8' }
              const isExp = expandedIdx === i
              return (
                <div
                  key={i}
                  onClick={() => setExpandedIdx(isExp ? null : i)}
                  style={{
                    padding: '10px 12px', background: 'rgba(30, 41, 59, 0.6)',
                    border: '1px solid rgba(56, 189, 248, 0.08)', borderRadius: '10px',
                    cursor: item.detail ? 'pointer' : 'default', transition: 'all 0.2s',
                  }}
                  onMouseOver={e => { if (item.detail) e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.2)' }}
                  onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.08)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: `${iconInfo.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon name={iconInfo.name} size={12} style={{ color: iconInfo.color } as any} className="" />
                    </div>
                    <span style={{ fontSize: '12px', color: '#e2e8f0', fontWeight: 500, flex: 1 }}>{item.text}</span>
                    {item.detail && <Icon name={isExp ? 'ChevronDown' : 'ChevronRight'} size={12} className="text-slate-500" />}
                  </div>
                  {isExp && (item.detailLinks || item.detail) && (
                    <div style={{ marginTop: '8px', paddingLeft: '34px', fontSize: '11px', lineHeight: '1.8', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {item.detailLinks ? item.detailLinks.map((link, li) => (
                        <span key={li} onClick={(e) => { e.stopPropagation(); navigate(`/orders/${encodeURIComponent(link.id)}`) }}
                          style={{ color: '#38bdf8', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'rgba(56, 189, 248, 0.3)', textUnderlineOffset: '2px' }}
                          onMouseOver={e => (e.currentTarget.style.textDecorationColor = '#38bdf8')}
                          onMouseOut={e => (e.currentTarget.style.textDecorationColor = 'rgba(56, 189, 248, 0.3)')}
                        >{link.po}</span>
                      )) : <span style={{ color: '#38bdf8' }}>{item.detail}</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}

        {/* ══ ACTION ITEMS TAB ══ */}
        {activeTab === 'actions' && (
          <>
            {insightsLoading && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px 0' }}>
                <span style={{ fontSize: '12px', color: '#64748b' }}>Loading insights...</span>
              </div>
            )}
            {!insightsLoading && actionItems.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <Icon name="CheckCircle" size={28} className="text-green-400 mx-auto" />
                <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '10px' }}>No action items right now</p>
                <button onClick={() => runAgent('follow_up')} disabled={!!runningAgent}
                  style={{ marginTop: '10px', padding: '6px 14px', fontSize: '11px', background: 'rgba(168, 85, 247, 0.15)', border: '1px solid rgba(168, 85, 247, 0.3)', borderRadius: '8px', color: '#c084fc', cursor: 'pointer' }}>
                  Run Follow-Up Check
                </button>
              </div>
            )}
            {!insightsLoading && actionItems.map(item => {
              const pColor = PRIORITY_COLORS[item.priority] || PRIORITY_COLORS.medium
              const isExp = expandedId === item.id
              return (
                <div key={item.id} onClick={() => setExpandedId(isExp ? null : item.id)}
                  style={{ padding: '10px 12px', background: 'rgba(30, 41, 59, 0.6)', border: `1px solid ${pColor.border}`, borderRadius: '10px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '4px', background: pColor.bg, color: pColor.text, fontWeight: 600, textTransform: 'uppercase', flexShrink: 0 }}>
                      {item.priority}
                    </span>
                    <Icon name={item.agent_type === 'follow_up' ? 'Clock' : 'FileText'} size={12}
                      className={item.priority === 'high' ? 'text-red-400' : item.priority === 'medium' ? 'text-amber-400' : 'text-green-400'} />
                    <span style={{ fontSize: '12px', color: '#e2e8f0', fontWeight: 500, flex: 1 }}>{item.title}</span>
                    <Icon name={isExp ? 'ChevronDown' : 'ChevronRight'} size={12} className="text-slate-500" />
                  </div>
                  {isExp && (
                    <div style={{ marginTop: '8px', paddingLeft: '8px' }}>
                      <p style={{ fontSize: '11px', color: '#94a3b8', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>{item.body}</p>
                      <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                        {item.action_type === 'send_email' && item.action_data?.draft_subject && (
                          <button onClick={(e) => { e.stopPropagation(); if (onComposeEmail) onComposeEmail({ subject: item.action_data.draft_subject, body: item.action_data.draft_body, recipients: item.action_data.recipients || [] }) }}
                            style={{ padding: '4px 10px', fontSize: '10px', background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: '6px', color: '#38bdf8', cursor: 'pointer' }}>
                            Send Email
                          </button>
                        )}
                        {item.order_id && (
                          <button onClick={(e) => { e.stopPropagation(); const po = item.action_data?.po_number; if (po) navigate(`/orders/${encodeURIComponent(po)}`) }}
                            style={{ padding: '4px 10px', fontSize: '10px', background: 'rgba(168, 85, 247, 0.15)', border: '1px solid rgba(168, 85, 247, 0.3)', borderRadius: '6px', color: '#c084fc', cursor: 'pointer' }}>
                            View Order
                          </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); dismissInsight(item.id) }}
                          style={{ padding: '4px 10px', fontSize: '10px', background: 'rgba(148, 163, 184, 0.1)', border: '1px solid rgba(148, 163, 184, 0.2)', borderRadius: '6px', color: '#64748b', cursor: 'pointer' }}>
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}

        {/* ══ BRIEFING TAB ══ */}
        {activeTab === 'briefing' && (
          <>
            {insightsLoading && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px 0' }}>
                <span style={{ fontSize: '12px', color: '#64748b' }}>Loading insights...</span>
              </div>
            )}
            {!insightsLoading && !briefing && (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <Icon name="FileText" size={28} className="text-slate-500 mx-auto" />
                <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '10px' }}>No briefing available yet</p>
                <button onClick={() => runAgent('briefing')} disabled={!!runningAgent}
                  style={{ marginTop: '10px', padding: '6px 14px', fontSize: '11px', background: 'rgba(168, 85, 247, 0.15)', border: '1px solid rgba(168, 85, 247, 0.3)', borderRadius: '8px', color: '#c084fc', cursor: 'pointer' }}>
                  Generate Briefing
                </button>
              </div>
            )}
            {!insightsLoading && briefing && (
              <div style={{ padding: '4px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0' }}>{briefing.title}</span>
                  <button onClick={() => runAgent('briefing')} disabled={!!runningAgent}
                    style={{ padding: '3px 8px', fontSize: '9px', background: 'rgba(148, 163, 184, 0.1)', border: '1px solid rgba(148, 163, 184, 0.2)', borderRadius: '4px', color: '#64748b', cursor: 'pointer' }}>
                    Regenerate
                  </button>
                </div>
                <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: '1.7', whiteSpace: 'pre-wrap', padding: '12px', background: 'rgba(30, 41, 59, 0.6)', border: '1px solid rgba(56, 189, 248, 0.08)', borderRadius: '10px' }}>
                  {briefing.body}
                </div>
              </div>
            )}
          </>
        )}

        {/* ══ SUPPLIERS TAB ══ */}
        {activeTab === 'suppliers' && (
          <>
            {insightsLoading && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px 0' }}>
                <span style={{ fontSize: '12px', color: '#64748b' }}>Loading insights...</span>
              </div>
            )}
            {!insightsLoading && supplierScores.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <Icon name="Users" size={28} className="text-slate-500 mx-auto" />
                <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '10px' }}>No supplier scores yet</p>
                <button onClick={() => runAgent('supplier_score')} disabled={!!runningAgent}
                  style={{ marginTop: '10px', padding: '6px 14px', fontSize: '11px', background: 'rgba(168, 85, 247, 0.15)', border: '1px solid rgba(168, 85, 247, 0.3)', borderRadius: '8px', color: '#c084fc', cursor: 'pointer' }}>
                  Score Suppliers
                </button>
              </div>
            )}
            {!insightsLoading && supplierScores.map(score => {
              const stars = score.action_data?.stars || 3
              return (
                <div key={score.id} style={{ padding: '12px', background: 'rgba(30, 41, 59, 0.6)', border: '1px solid rgba(56, 189, 248, 0.08)', borderRadius: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0' }}>{score.action_data?.supplier || 'Unknown'}</span>
                    <span style={{ fontSize: '14px', letterSpacing: '2px' }}>{'★'.repeat(stars)}{'☆'.repeat(5 - stars)}</span>
                  </div>
                  <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>{score.body}</p>
                </div>
              )
            })}
          </>
        )}
      </div>

      <style>{`
        @keyframes ccPulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        @keyframes ccBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}
