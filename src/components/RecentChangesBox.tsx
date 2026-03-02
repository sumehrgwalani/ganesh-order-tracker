import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from './Icon'
import { apiCall } from '../utils/api'

interface Props {
  orgId: string
}

interface ChangeItem {
  orderId: string
  company: string
  supplier: string
  product?: string
  stage?: string
  subject?: string
  from?: string
  timestamp: string
  hasAttachment?: boolean
}

interface Changes {
  newOrders: ChangeItem[]
  stageUpdates: ChangeItem[]
  newEmails: ChangeItem[]
}

const LAST_LOGIN_KEY = 'ganesh_last_login'

function getLastLogin(): string {
  const stored = localStorage.getItem(LAST_LOGIN_KEY)
  if (stored) return stored
  // Default: 24 hours ago
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
}

function setLastLogin() {
  localStorage.setItem(LAST_LOGIN_KEY, new Date().toISOString())
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

export default function RecentChangesBox({ orgId }: Props) {
  const [changes, setChanges] = useState<Changes | null>(null)
  const [totalChanges, setTotalChanges] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const lastLogin = useRef(getLastLogin())

  useEffect(() => {
    fetchChanges()
    // Update last login after a small delay so this session's view captures changes
    const timer = setTimeout(() => setLastLogin(), 3000)
    return () => clearTimeout(timer)
  }, [orgId])

  const fetchChanges = async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: err } = await apiCall('/api/recent-changes', {
        organization_id: orgId,
        since: lastLogin.current,
      })
      if (err) {
        setError('Could not load updates')
      } else {
        setChanges(data.changes)
        setTotalChanges(data.totalChanges)
      }
    } catch {
      setError('Could not reach server')
    } finally {
      setLoading(false)
    }
  }

  const renderItem = (item: ChangeItem, type: 'new' | 'update' | 'email', idx: number) => {
    const colors = {
      new: { bg: 'rgba(34, 197, 94, 0.1)', border: 'rgba(34, 197, 94, 0.2)', dot: '#22c55e', label: 'NEW ORDER' },
      update: { bg: 'rgba(59, 130, 246, 0.1)', border: 'rgba(59, 130, 246, 0.2)', dot: '#3b82f6', label: 'STAGE UPDATE' },
      email: { bg: 'rgba(168, 85, 247, 0.1)', border: 'rgba(168, 85, 247, 0.2)', dot: '#a855f7', label: 'NEW EMAIL' },
    }
    const c = colors[type]

    return (
      <div
        key={`${type}-${idx}`}
        onClick={() => navigate(`/orders/${encodeURIComponent(item.orderId)}`)}
        style={{
          padding: '10px 12px',
          background: c.bg,
          border: `1px solid ${c.border}`,
          borderRadius: '10px',
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
        onMouseOver={e => {
          e.currentTarget.style.transform = 'translateX(4px)'
          e.currentTarget.style.borderColor = c.dot
        }}
        onMouseOut={e => {
          e.currentTarget.style.transform = 'translateX(0)'
          e.currentTarget.style.borderColor = c.border
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: c.dot, boxShadow: `0 0 6px ${c.dot}` }} />
            <span style={{ fontSize: '9px', fontWeight: 700, color: c.dot, letterSpacing: '0.05em' }}>{c.label}</span>
          </div>
          <span style={{ fontSize: '10px', color: '#64748b' }}>{timeAgo(item.timestamp)}</span>
        </div>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#38bdf8', marginBottom: '2px' }}>{item.orderId}</div>
        <div style={{ fontSize: '11px', color: '#94a3b8' }}>
          {item.company}{item.supplier ? ` → ${item.supplier}` : ''}
        </div>
        {type === 'email' && item.subject && (
          <div style={{ fontSize: '10px', color: '#64748b', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            📧 {item.subject}
          </div>
        )}
        {type === 'update' && item.stage && (
          <div style={{ fontSize: '10px', color: '#64748b', marginTop: '3px' }}>
            → {item.stage}
          </div>
        )}
        {type === 'new' && item.product && (
          <div style={{ fontSize: '10px', color: '#64748b', marginTop: '3px' }}>
            {item.product}
          </div>
        )}
      </div>
    )
  }

  // Combine and sort all changes by timestamp
  const allItems: { item: ChangeItem; type: 'new' | 'update' | 'email' }[] = []
  if (changes) {
    for (const o of changes.newOrders) allItems.push({ item: o, type: 'new' })
    for (const o of changes.stageUpdates) allItems.push({ item: o, type: 'update' })
    for (const o of changes.newEmails) allItems.push({ item: o, type: 'email' })
  }
  allItems.sort((a, b) => new Date(b.item.timestamp).getTime() - new Date(a.item.timestamp).getTime())

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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 20px',
        }}
      >
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
            <Icon name="Bell" size={14} className="text-white" />
          </div>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', letterSpacing: '0.025em' }}>
            What's New
          </span>
          {totalChanges > 0 && (
            <span
              style={{
                fontSize: '10px',
                color: '#22c55e',
                background: 'rgba(34, 197, 94, 0.1)',
                padding: '2px 8px',
                borderRadius: '10px',
                border: '1px solid rgba(34, 197, 94, 0.15)',
                fontWeight: 600,
              }}
            >
              {totalChanges} update{totalChanges !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button
          onClick={fetchChanges}
          style={{
            fontSize: '11px',
            color: '#64748b',
            background: 'rgba(100, 116, 139, 0.1)',
            border: '1px solid rgba(100, 116, 139, 0.15)',
            borderRadius: '6px',
            padding: '4px 10px',
            cursor: 'pointer',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
          onMouseOver={e => {
            e.currentTarget.style.color = '#94a3b8'
            e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.3)'
          }}
          onMouseOut={e => {
            e.currentTarget.style.color = '#64748b'
            e.currentTarget.style.borderColor = 'rgba(100, 116, 139, 0.15)'
          }}
        >
          <Icon name="RefreshCw" size={10} className="text-slate-500" />
          Refresh
        </button>
      </div>

      {/* Content */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 20px 14px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8', animation: 'rcPulse 1.5s ease-in-out infinite' }} />
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8', animation: 'rcPulse 1.5s ease-in-out 0.3s infinite' }} />
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8', animation: 'rcPulse 1.5s ease-in-out 0.6s infinite' }} />
              <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '4px' }}>Loading updates...</span>
            </div>
          </div>
        )}

        {error && !loading && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <Icon name="AlertCircle" size={24} className="text-red-400 mx-auto" />
            <p style={{ fontSize: '12px', color: '#f87171', marginTop: '8px' }}>{error}</p>
          </div>
        )}

        {!loading && !error && allItems.length === 0 && (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <Icon name="CheckCircle" size={28} className="text-green-400 mx-auto" />
            <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '10px', fontWeight: 500 }}>All caught up!</p>
            <p style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>No changes since your last visit</p>
          </div>
        )}

        {!loading && !error && allItems.map((entry, i) => renderItem(entry.item, entry.type, i))}
      </div>

      {/* CSS */}
      <style>{`
        @keyframes rcPulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }
      `}</style>
    </div>
  )
}
