import { useState, useEffect } from 'react'
import Icon from './Icon'
import { apiCall } from '../utils/api'

interface Props {
  orgId: string
}

interface SummaryItem {
  icon: string
  text: string
  detail?: string
}

interface SyncStats {
  newOrders: number
  stageUpdates: number
  emailsReceived: number
  ordersAffected: number
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

const ICONS: Record<string, { name: string; color: string }> = {
  new_order: { name: 'Plus', color: '#22c55e' },
  stage_update: { name: 'ArrowRight', color: '#3b82f6' },
  email: { name: 'Mail', color: '#a855f7' },
  attachment: { name: 'Paperclip', color: '#f59e0b' },
}

export default function RecentChangesBox({ orgId }: Props) {
  const [summary, setSummary] = useState<SummaryItem[]>([])
  const [stats, setStats] = useState<SyncStats | null>(null)
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null)
  const [syncLabel, setSyncLabel] = useState('')
  const [initialLoad, setInitialLoad] = useState(true)
  const [error, setError] = useState('')
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  // Fetch on mount, then poll every 30 seconds
  useEffect(() => {
    fetchChanges()
    const interval = setInterval(fetchChanges, 30000)
    return () => clearInterval(interval)
  }, [orgId])

  // Keep sync label fresh
  useEffect(() => {
    const tick = () => {
      if (lastSyncTime) setSyncLabel(timeAgo(lastSyncTime))
    }
    tick()
    const interval = setInterval(tick, 15000)
    return () => clearInterval(interval)
  }, [lastSyncTime])

  const fetchChanges = async () => {
    try {
      const { data, error: err } = await apiCall('/api/recent-changes', {
        organization_id: orgId,
      })
      if (err) {
        setError('Could not load updates')
      } else {
        setSummary(data.summary || [])
        setStats(data.stats || null)
        setLastSyncTime(data.lastSyncTime)
        setError('')
      }
    } catch {
      setError('Could not reach server')
    } finally {
      setInitialLoad(false)
    }
  }

  const totalActivity = stats ? stats.newOrders + stats.stageUpdates + stats.emailsReceived : 0

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
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '10%',
          right: '10%',
          height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.4), transparent)',
        }}
      />

      {/* Header */}
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #a855f7, #06b6d4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 12px rgba(168, 85, 247, 0.3)',
            }}
          >
            <Icon name="Zap" size={14} className="text-white" />
          </div>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', letterSpacing: '0.025em' }}>
            What's New
          </span>
        </div>
        {syncLabel && !initialLoad && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#22c55e',
                boxShadow: '0 0 6px #22c55e',
                animation: 'rcBlink 3s ease-in-out infinite',
              }}
            />
            <span style={{ fontSize: '10px', color: '#64748b' }}>Synced {syncLabel}</span>
          </div>
        )}
      </div>

      {/* Quick stats bar */}
      {stats && !initialLoad && totalActivity > 0 && (
        <div style={{ padding: '0 20px 12px', display: 'flex', gap: '12px' }}>
          {stats.emailsReceived > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Icon name="Mail" size={12} className="text-purple-400" />
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>{stats.emailsReceived} emails</span>
            </div>
          )}
          {stats.ordersAffected > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Icon name="Package" size={12} className="text-cyan-400" />
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>{stats.ordersAffected} orders</span>
            </div>
          )}
          {stats.newOrders > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Icon name="Plus" size={12} className="text-green-400" />
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>{stats.newOrders} new</span>
            </div>
          )}
        </div>
      )}

      {/* Summary items */}
      <div style={{ flex: 1, padding: '0 20px 14px', display: 'flex', flexDirection: 'column', gap: '6px', overflowY: 'auto' }}>
        {initialLoad && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8', animation: 'rcPulse 1.5s ease-in-out infinite' }} />
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8', animation: 'rcPulse 1.5s ease-in-out 0.3s infinite' }} />
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8', animation: 'rcPulse 1.5s ease-in-out 0.6s infinite' }} />
              <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '4px' }}>Loading...</span>
            </div>
          </div>
        )}

        {error && !initialLoad && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <Icon name="AlertCircle" size={24} className="text-red-400 mx-auto" />
            <p style={{ fontSize: '12px', color: '#f87171', marginTop: '8px' }}>{error}</p>
          </div>
        )}

        {!initialLoad && !error && summary.length === 0 && (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <Icon name="CheckCircle" size={28} className="text-green-400 mx-auto" />
            <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '10px', fontWeight: 500 }}>All caught up!</p>
            <p style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>No activity since last sync</p>
          </div>
        )}

        {!initialLoad && !error && summary.map((item, i) => {
          const iconInfo = ICONS[item.icon] || { name: 'Zap', color: '#38bdf8' }
          const isExpanded = expandedIdx === i

          return (
            <div
              key={i}
              onClick={() => setExpandedIdx(isExpanded ? null : i)}
              style={{
                padding: '10px 12px',
                background: 'rgba(30, 41, 59, 0.6)',
                border: '1px solid rgba(56, 189, 248, 0.08)',
                borderRadius: '10px',
                cursor: item.detail ? 'pointer' : 'default',
                transition: 'all 0.2s',
              }}
              onMouseOver={e => {
                if (item.detail) e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.2)'
              }}
              onMouseOut={e => {
                e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.08)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '6px',
                    background: `${iconInfo.color}15`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Icon name={iconInfo.name} size={12} style={{ color: iconInfo.color } as any} className="" />
                </div>
                <span style={{ fontSize: '12px', color: '#e2e8f0', fontWeight: 500, flex: 1 }}>
                  {item.text}
                </span>
                {item.detail && (
                  <Icon
                    name={isExpanded ? 'ChevronDown' : 'ChevronRight'}
                    size={12}
                    className="text-slate-500"
                  />
                )}
              </div>
              {isExpanded && item.detail && (
                <div style={{ marginTop: '8px', paddingLeft: '34px', fontSize: '11px', color: '#38bdf8', lineHeight: '1.6' }}>
                  {item.detail}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <style>{`
        @keyframes rcPulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        @keyframes rcBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}
