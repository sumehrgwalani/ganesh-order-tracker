import { useState } from 'react'
import Icon from './Icon'
import { useDocumentChecklist, ChecklistItem } from '../hooks/useDocumentChecklist'

interface Props {
  orderId: string
  orgId: string
  destination?: string
  stage?: 'draft' | 'final'
}

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: string; label: string }> = {
  received: { bg: 'rgba(34, 197, 94, 0.15)', text: '#4ade80', icon: 'check-circle', label: 'Received' },
  missing: { bg: 'rgba(107, 114, 128, 0.15)', text: '#9ca3af', icon: 'circle', label: 'Missing' },
}

export default function DocumentChecklist({ orderId, orgId, destination, stage = 'draft' }: Props) {
  const { checklist, received, total, loading } = useDocumentChecklist(orderId, orgId, destination)
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null)

  if (loading) {
    return (
      <div style={{ padding: '16px', color: '#9ca3af', fontSize: '13px' }}>
        Loading document checklist...
      </div>
    )
  }

  if (total === 0) return null

  const progress = total > 0 ? Math.round((received / total) * 100) : 0
  const isComplete = received === total

  return (
    <div style={{
      background: '#1a1a2e',
      borderRadius: '12px',
      border: '1px solid rgba(255,255,255,0.08)',
      overflow: 'hidden',
    }}>
      {/* Header with progress */}
      <div style={{
        padding: '14px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Icon name="file-text" size={18} />
          <span style={{ fontWeight: 600, fontSize: '14px', color: '#e5e7eb' }}>
            Document Checklist
          </span>
          <span style={{
            fontSize: '12px',
            padding: '2px 8px',
            borderRadius: '10px',
            background: isComplete ? 'rgba(34, 197, 94, 0.15)' : 'rgba(245, 158, 11, 0.15)',
            color: isComplete ? '#4ade80' : '#fbbf24',
          }}>
            {received}/{total}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {destination && (
            <span style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '10px',
              background: 'rgba(59, 130, 246, 0.15)',
              color: '#60a5fa',
            }}>
              {destination.includes('Spain') || destination.includes('Valencia') ? 'EU' : 'Non-EU'}
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ padding: '0 16px', paddingTop: '12px' }}>
        <div style={{
          height: '6px',
          borderRadius: '3px',
          background: 'rgba(255,255,255,0.06)',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${progress}%`,
            borderRadius: '3px',
            background: isComplete
              ? 'linear-gradient(90deg, #22c55e, #4ade80)'
              : 'linear-gradient(90deg, #f59e0b, #fbbf24)',
            transition: 'width 0.5s ease',
          }} />
        </div>
      </div>

      {/* Document list */}
      <div style={{ padding: '8px 0' }}>
        {checklist.map((item) => {
          const doc = stage === 'final' ? (item.final || item.draft) : item.draft
          const hasDoc = !!doc
          const statusKey = hasDoc ? 'received' : 'missing'
          const s = STATUS_STYLES[statusKey]
          const isExpanded = expandedDoc === item.doc_type

          return (
            <div key={item.doc_type}>
              <div
                onClick={() => setExpandedDoc(isExpanded ? null : item.doc_type)}
                style={{
                  padding: '10px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                  background: isExpanded ? 'rgba(255,255,255,0.03)' : 'transparent',
                }}
                onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
                onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = 'transparent' }}
              >
                {/* Status icon */}
                <div style={{
                  width: '22px', height: '22px', borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: s.bg, flexShrink: 0,
                }}>
                  <Icon name={hasDoc ? 'check' : 'minus'} size={12} />
                </div>

                {/* Document name */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '13px',
                    color: hasDoc ? '#e5e7eb' : '#6b7280',
                    fontWeight: hasDoc ? 500 : 400,
                    textDecoration: hasDoc ? 'none' : 'none',
                  }}>
                    {item.display_name}
                  </div>
                  {hasDoc && doc?.filename && (
                    <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                      {doc.filename}
                    </div>
                  )}
                </div>

                {/* Zone badge */}
                {item.zone === 'eu' && (
                  <span style={{
                    fontSize: '10px',
                    padding: '1px 6px',
                    borderRadius: '8px',
                    background: 'rgba(59, 130, 246, 0.12)',
                    color: '#60a5fa',
                    flexShrink: 0,
                  }}>
                    EU
                  </span>
                )}

                {/* Status badge */}
                <span style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  borderRadius: '8px',
                  background: s.bg,
                  color: s.text,
                  flexShrink: 0,
                }}>
                  {s.label}
                </span>

                <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={14} />
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div style={{
                  padding: '4px 16px 12px 48px',
                  fontSize: '12px',
                  color: '#9ca3af',
                  lineHeight: '1.5',
                }}>
                  {item.description && <div>{item.description}</div>}
                  {item.origin_of_document && (
                    <div style={{ marginTop: '4px' }}>
                      <span style={{ color: '#6b7280' }}>Source:</span> {item.origin_of_document}
                    </div>
                  )}
                  {hasDoc && doc?.metadata && (
                    <div style={{ marginTop: '6px', padding: '6px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                      {doc.metadata.referenceNumber && (
                        <div><span style={{ color: '#6b7280' }}>Ref:</span> {doc.metadata.referenceNumber}</div>
                      )}
                      {doc.metadata.issuer && (
                        <div><span style={{ color: '#6b7280' }}>Issuer:</span> {doc.metadata.issuer}</div>
                      )}
                      {doc.metadata.date && (
                        <div><span style={{ color: '#6b7280' }}>Date:</span> {doc.metadata.date}</div>
                      )}
                      {doc.metadata.notes && (
                        <div><span style={{ color: '#6b7280' }}>Notes:</span> {doc.metadata.notes}</div>
                      )}
                      {doc.ai_confidence != null && (
                        <div style={{ marginTop: '4px' }}>
                          <span style={{ color: '#6b7280' }}>AI Confidence:</span>{' '}
                          <span style={{ color: doc.ai_confidence > 0.8 ? '#4ade80' : doc.ai_confidence > 0.5 ? '#fbbf24' : '#f87171' }}>
                            {Math.round(doc.ai_confidence * 100)}%
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  {hasDoc && doc?.file_url && (
                    <a
                      href={doc.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        marginTop: '8px', fontSize: '12px', color: '#60a5fa', textDecoration: 'none',
                      }}
                    >
                      <Icon name="download" size={12} /> View document
                    </a>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
