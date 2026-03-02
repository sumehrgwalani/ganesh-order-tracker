import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from './Icon'
import { apiCall } from '../utils/api'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  orgId: string
}

// Match PO numbers like GI/PO/25-26/3038 or **GI/PO/25-26/3038**
const PO_REGEX = /\*{0,2}(GI\/PO\/[\d\-]+\/\d+)\*{0,2}/g

export default function AIChatBox({ orgId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [knownOrders, setKnownOrders] = useState<Record<string, string>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    // Scroll only the messages container, not the whole page
    const container = messagesContainerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [messages, loading])

  // Render text with PO numbers as clickable links
  const renderLinkedContent = (text: string) => {
    const parts: (string | { po: string; key: number })[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    const regex = new RegExp(PO_REGEX.source, 'g')
    let key = 0

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index))
      }
      parts.push({ po: match[1], key: key++ })
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex))
    }

    return parts.map((part, i) => {
      if (typeof part === 'string') return <span key={i}>{part}</span>
      const orderId = part.po
      return (
        <span
          key={`po-${part.key}`}
          onClick={() => navigate(`/orders/${encodeURIComponent(orderId)}`)}
          style={{
            color: '#38bdf8',
            fontWeight: 600,
            cursor: 'pointer',
            textDecoration: 'underline',
            textDecorationColor: 'rgba(56, 189, 248, 0.3)',
            textUnderlineOffset: '2px',
            transition: 'all 0.15s',
          }}
          onMouseOver={e => {
            e.currentTarget.style.color = '#7dd3fc'
            e.currentTarget.style.textDecorationColor = '#7dd3fc'
          }}
          onMouseOut={e => {
            e.currentTarget.style.color = '#38bdf8'
            e.currentTarget.style.textDecorationColor = 'rgba(56, 189, 248, 0.3)'
          }}
          title={`Open ${orderId}`}
        >
          {orderId}
        </span>
      )
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const question = input.trim()
    if (!question || loading) return

    setInput('')
    setExpanded(true)
    setMessages(prev => [...prev, { role: 'user', content: question }])
    setLoading(true)

    try {
      const { data, error } = await apiCall('/api/chat', {
        question,
        organization_id: orgId,
      })

      if (error) {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }])
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: data.answer }])
        if (data.orderMap) {
          setKnownOrders(prev => ({ ...prev, ...data.orderMap }))
        }
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Could not reach the server. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  const handleClear = () => {
    setMessages([])
    setExpanded(false)
  }

  return (
    <div className="mb-6">
      <div
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
          borderRadius: '16px',
          border: '1px solid rgba(56, 189, 248, 0.15)',
          boxShadow: '0 0 30px rgba(56, 189, 248, 0.05), 0 4px 20px rgba(0,0,0,0.15)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Subtle top glow line */}
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
            padding: '14px 20px 0 20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 12px rgba(59, 130, 246, 0.3)',
              }}
            >
              <Icon name="Sparkles" size={14} className="text-white" />
            </div>
            <span
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: '#e2e8f0',
                letterSpacing: '0.025em',
              }}
            >
              AI Assistant
            </span>
            <span
              style={{
                fontSize: '10px',
                color: '#38bdf8',
                background: 'rgba(56, 189, 248, 0.1)',
                padding: '2px 8px',
                borderRadius: '10px',
                border: '1px solid rgba(56, 189, 248, 0.15)',
              }}
            >
              Powered by Claude
            </span>
          </div>
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              style={{
                fontSize: '11px',
                color: '#64748b',
                background: 'rgba(100, 116, 139, 0.1)',
                border: '1px solid rgba(100, 116, 139, 0.15)',
                borderRadius: '6px',
                padding: '4px 10px',
                cursor: 'pointer',
                transition: 'all 0.2s',
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
              Clear chat
            </button>
          )}
        </div>

        {/* Messages area */}
        {expanded && messages.length > 0 && (
          <div
            ref={messagesContainerRef}
            style={{
              maxHeight: '300px',
              overflowY: 'auto',
              padding: '12px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    maxWidth: '85%',
                    padding: '10px 14px',
                    borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                    fontSize: '13px',
                    lineHeight: '1.5',
                    ...(msg.role === 'user'
                      ? {
                          background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                          color: '#ffffff',
                          boxShadow: '0 2px 8px rgba(59, 130, 246, 0.2)',
                        }
                      : {
                          background: 'rgba(30, 41, 59, 0.8)',
                          color: '#e2e8f0',
                          border: '1px solid rgba(56, 189, 248, 0.08)',
                        }),
                  }}
                >
                  {msg.role === 'assistant' && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        marginBottom: '4px',
                      }}
                    >
                      <Icon name="Zap" size={10} className="text-cyan-400" />
                      <span style={{ fontSize: '10px', color: '#38bdf8', fontWeight: 600 }}>
                        Claude
                      </span>
                    </div>
                  )}
                  <span style={{ whiteSpace: 'pre-wrap' }}>
                    {msg.role === 'assistant' ? renderLinkedContent(msg.content) : msg.content}
                  </span>
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '14px 14px 14px 4px',
                    background: 'rgba(30, 41, 59, 0.8)',
                    border: '1px solid rgba(56, 189, 248, 0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <div
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: '#38bdf8',
                      animation: 'pulse 1.5s ease-in-out infinite',
                    }}
                  />
                  <div
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: '#38bdf8',
                      animation: 'pulse 1.5s ease-in-out 0.3s infinite',
                    }}
                  />
                  <div
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: '#38bdf8',
                      animation: 'pulse 1.5s ease-in-out 0.6s infinite',
                    }}
                  />
                  <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '4px' }}>
                    Searching through your orders...
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Input bar */}
        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '14px 20px',
            borderTop: expanded && messages.length > 0 ? '1px solid rgba(56, 189, 248, 0.06)' : 'none',
          }}
        >
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid rgba(56, 189, 248, 0.1)',
              borderRadius: '12px',
              padding: '10px 14px',
              transition: 'all 0.2s',
            }}
            onClick={() => inputRef.current?.focus()}
          >
            <Icon name="Search" size={14} className="text-slate-500" />
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask anything about your orders..."
              disabled={loading}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontSize: '13px',
                color: '#e2e8f0',
                lineHeight: '1.4',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={!input.trim() || loading}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              border: 'none',
              background: input.trim() && !loading
                ? 'linear-gradient(135deg, #3b82f6, #06b6d4)'
                : 'rgba(30, 41, 59, 0.6)',
              color: input.trim() && !loading ? '#ffffff' : '#475569',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
              boxShadow: input.trim() && !loading ? '0 0 15px rgba(59, 130, 246, 0.25)' : 'none',
              flexShrink: 0,
            }}
          >
            {loading ? (
              <div
                style={{
                  width: '16px',
                  height: '16px',
                  border: '2px solid rgba(56, 189, 248, 0.3)',
                  borderTopColor: '#38bdf8',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
            ) : (
              <Icon name="Send" size={15} />
            )}
          </button>
        </form>

        {/* CSS animations */}
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 0.3; transform: scale(0.8); }
            50% { opacity: 1; transform: scale(1.2); }
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  )
}
