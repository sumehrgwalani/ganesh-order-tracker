import React, { useRef, useEffect, useState } from 'react'
import Icon from './Icon'
import type { AppNotification } from '../types'
import NotificationActionModal from './NotificationActionModal'

interface NotificationPanelProps {
  notifications: AppNotification[]
  unreadCount: number
  isOpen: boolean
  onClose: () => void
  onMarkAsRead: (id: string) => void
  onMarkAllAsRead: () => void
  onRemoveNotification: (id: string) => void
  onAcceptInvitation: (notification: AppNotification) => void
  onDeclineInvitation: (notification: AppNotification) => void
}

function NotificationPanel({
  notifications,
  unreadCount,
  isOpen,
  onClose,
  onMarkAsRead,
  onMarkAllAsRead,
  onRemoveNotification,
  onAcceptInvitation,
  onDeclineInvitation,
}: NotificationPanelProps) {
  const [actionNotif, setActionNotif] = useState<AppNotification | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const formatTime = (ts: string) => {
    const diff = Math.floor((new Date().getTime() - new Date(ts).getTime()) / 60000)
    if (diff < 1) return 'Just now'
    if (diff < 60) return `${diff}m ago`
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`
    return `${Math.floor(diff / 1440)}d ago`
  }

  const getIcon = (type: string) => {
    switch (type) {
      case 'invitation': return 'Building'
      case 'order_update': return 'FileText'
      case 'inquiry': return 'Mail'
      case 'unknown_contact': return 'UserPlus'
      default: return 'Bell'
    }
  }

  const getIconColor = (type: string) => {
    switch (type) {
      case 'invitation': return 'text-blue-600 bg-blue-50'
      case 'order_update': return 'text-green-600 bg-green-50'
      case 'inquiry': return 'text-purple-600 bg-purple-50'
      case 'unknown_contact': return 'text-orange-600 bg-orange-50'
      default: return 'text-gray-600 bg-gray-50'
    }
  }

  return (
    <div ref={panelRef} className="absolute right-0 top-12 w-96 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-gray-800">Notifications</h3>
          {unreadCount > 0 && (
            <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">{unreadCount}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={onMarkAllAsRead}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              Mark all read
            </button>
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Icon name="X" size={16} />
          </button>
        </div>
      </div>

      {/* Notification List */}
      <div className="max-h-96 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Icon name="Bell" size={32} className="text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No notifications yet</p>
          </div>
        ) : (
          notifications.map((notif) => (
            <div
              key={notif.id}
              className={`px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                !notif.read ? 'bg-blue-50/30' : ''
              }`}
              onClick={() => { if (!notif.read) onMarkAsRead(notif.id) }}
            >
              <div className="flex gap-3">
                {/* Icon */}
                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${getIconColor(notif.type)}`}>
                  <Icon name={getIcon(notif.type)} size={16} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm ${!notif.read ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                      {notif.title}
                    </p>
                    {!notif.read && (
                      <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-1.5"></span>
                    )}
                  </div>
                  {notif.message && (
                    <p className="text-xs text-gray-500 mt-0.5">{notif.message}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    <Icon name="Clock" size={10} className="inline mr-1" />
                    {formatTime(notif.created_at)}
                  </p>

                  {/* Accept/Decline buttons for invitation notifications */}
                  {notif.type === 'invitation' && notif.data.invitation_id && (
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); onAcceptInvitation(notif) }}
                        className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        Accept
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeclineInvitation(notif) }}
                        className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-200 transition-colors"
                      >
                        Decline
                      </button>
                    </div>
                  )}

                  {/* Take Action button for unknown_contact notifications */}
                  {notif.type === 'unknown_contact' && (
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); setActionNotif(notif) }}
                        className="px-3 py-1.5 bg-orange-500 text-white text-xs font-medium rounded-lg hover:bg-orange-600 transition-colors flex items-center gap-1"
                      >
                        <Icon name="UserPlus" size={12} />
                        Add Contact
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onRemoveNotification(notif.id) }}
                        className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-200 transition-colors"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Action Modal for unknown_contact */}
      {actionNotif && (
        <NotificationActionModal
          notification={actionNotif}
          onClose={() => setActionNotif(null)}
          onDone={() => {
            onMarkAsRead(actionNotif.id)
            onRemoveNotification(actionNotif.id)
            setActionNotif(null)
          }}
        />
      )}
    </div>
  )
}

export default NotificationPanel
