import { useState, useRef } from 'react'
import Icon from './Icon'
import { apiCall } from '../utils/api'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  orgId: string
}

export default function AIChatBox({ orgId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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
    <div className="bg-white rounded-2xl border border-gray-100 mb-6 overflow-hidden">
      {/* Input bar */}
      <form onSubmit={handleSubmit} className="flex items-center gap-3 p-4">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 flex-shrink-0">
          <Icon name="MessageSquare" size={16} className="text-blue-600" />
        </div>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask about your orders... e.g. &quot;What's the DHL number for PO 3020?&quot;"
          className="flex-1 text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent"
          disabled={loading}
        />
        {loading ? (
          <div className="w-8 h-8 flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            <Icon name="Send" size={14} />
          </button>
        )}
        {messages.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            className="text-xs text-gray-400 hover:text-gray-600 flex-shrink-0"
          >
            Clear
          </button>
        )}
      </form>

      {/* Messages area */}
      {expanded && messages.length > 0 && (
        <div className="border-t border-gray-100 max-h-80 overflow-y-auto">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`px-4 py-3 text-sm ${
                msg.role === 'user'
                  ? 'bg-gray-50 text-gray-600'
                  : 'bg-white text-gray-800'
              }`}
            >
              {msg.role === 'user' ? (
                <div className="flex items-start gap-2">
                  <span className="text-gray-400 font-medium text-xs mt-0.5">Q:</span>
                  <span>{msg.content}</span>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <span className="text-blue-500 font-medium text-xs mt-0.5">AI:</span>
                  <span className="whitespace-pre-wrap leading-relaxed">{msg.content}</span>
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="px-4 py-3 text-sm text-gray-400 flex items-center gap-2">
              <span className="text-blue-500 font-medium text-xs">AI:</span>
              <span>Thinking...</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
