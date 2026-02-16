import React, { useState, useRef, useEffect } from 'react';
import Icon from '../components/Icon';
import { WTTLogo } from '../components/Logos';
import NotificationPanel from '../components/NotificationPanel';
import type { AppNotification } from '../types';

interface HeaderProps {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  lastSync: string;
  isSyncing: boolean;
  onSyncClick: () => void;
  userEmail?: string;
  onSignOut?: () => void;
  notifications: AppNotification[];
  unreadCount: number;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onRemoveNotification: (id: string) => void;
  onAcceptInvitation: (notification: AppNotification) => void;
  onDeclineInvitation: (notification: AppNotification) => void;
}

function Header({
  searchTerm, setSearchTerm, lastSync, isSyncing, onSyncClick,
  userEmail, onSignOut,
  notifications, unreadCount, onMarkAsRead, onMarkAllAsRead, onRemoveNotification,
  onAcceptInvitation, onDeclineInvitation,
}: HeaderProps) {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatLastSync = (ts: string) => {
    if (!ts) return 'Never';
    const diff = Math.floor((new Date().getTime() - new Date(ts).getTime()) / 60000);
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff}m ago`;
    return `${Math.floor(diff / 60)}h ago`;
  };

  const userInitial = userEmail ? userEmail[0].toUpperCase() : 'U';

  return (
    <div className="bg-white border-b border-gray-100 px-6 py-4 flex justify-between items-center">
      <div className="flex items-center gap-4">
        <WTTLogo size={40} />
        <div>
          <span className="text-xl font-semibold text-gray-800">with<span className="text-blue-600">the</span>tide</span>
          <span className="text-sm text-gray-400 ml-2">Order Tracker</span>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="relative">
          <Icon name="Search" className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
          <input type="text" placeholder="Search orders..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-64" />
        </div>
        <button onClick={onSyncClick} className={`flex items-center gap-2 px-4 py-2 rounded-lg ${isSyncing ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          <Icon name="RefreshCw" size={16} className={isSyncing ? 'animate-spin' : ''} />
          <span className="text-sm">{isSyncing ? 'Syncing...' : 'Sync'}</span>
        </button>
        <div className="flex items-center gap-1 text-xs text-gray-400"><Icon name="Clock" size={12} /><span>{formatLastSync(lastSync)}</span></div>
        <button className="bg-gradient-to-r from-blue-500 to-blue-600 text-white px-3 py-2 rounded-full font-medium hover:from-blue-600 hover:to-blue-700 text-sm">withthetide</button>

        {/* Bell icon with notification dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-1 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          >
            <Icon name="Bell" size={20} className="text-gray-500" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          <NotificationPanel
            notifications={notifications}
            unreadCount={unreadCount}
            isOpen={showNotifications}
            onClose={() => setShowNotifications(false)}
            onMarkAsRead={onMarkAsRead}
            onMarkAllAsRead={onMarkAllAsRead}
            onRemoveNotification={onRemoveNotification}
            onAcceptInvitation={onAcceptInvitation}
            onDeclineInvitation={onDeclineInvitation}
          />
        </div>

        {/* Profile avatar with dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowProfileMenu(!showProfileMenu)}
            className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center cursor-pointer hover:from-blue-600 hover:to-blue-700 transition-all"
            aria-label="User profile menu"
          >
            <span className="text-white font-medium text-sm">{userInitial}</span>
          </button>

          {showProfileMenu && (
            <div className="absolute right-0 top-12 w-56 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50">
              {userEmail && (
                <div className="px-4 py-2 border-b border-gray-100">
                  <p className="text-sm font-medium text-gray-800 truncate">{userEmail}</p>
                  <p className="text-xs text-gray-400">Signed in</p>
                </div>
              )}
              {onSignOut && (
                <button
                  onClick={() => { setShowProfileMenu(false); onSignOut(); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <Icon name="LogOut" size={16} />
                  Sign Out
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Header;
