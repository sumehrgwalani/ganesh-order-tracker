import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../components/Icon';
import { WTTLogo } from '../components/Logos';

interface SidebarProps {
  onSettingsClick: () => void;
  unreadCount?: number;
  onBellClick?: () => void;
}

function Sidebar({ onSettingsClick, unreadCount = 0, onBellClick }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    { icon: 'Home', label: 'Dashboard', path: '/' },
    { icon: 'FilePlus', label: 'Create PO', path: '/create-po' },
    { icon: 'Inbox', label: 'Mailbox', path: '/mailbox' },
    { icon: 'FileText', label: 'Orders', path: '/orders' },
    { icon: 'Mail', label: 'Inquiries', path: '/inquiries' },
    { icon: 'Package', label: 'Products', path: '/products' },
    { icon: 'Users', label: 'Contacts', path: '/contacts' },
    { icon: 'Building', label: 'Team', path: '/team' },
  ];

  return (
    <div className="w-16 bg-gray-900 flex flex-col items-center py-4 space-y-2">
      <div className="mb-4">
        <WTTLogo size={40} />
      </div>
      <div className="flex-1 space-y-2">
        {menuItems.map((item) => {
          const isActive = location.pathname === item.path || (item.path === '/orders' && location.pathname.startsWith('/orders'));
          return (
            <button key={item.path} onClick={() => navigate(item.path)} className={`p-3 rounded-xl transition-all group relative ${isActive ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`} aria-label={item.label}>
              <Icon name={item.icon} size={20} />
              <span className="absolute left-full ml-1 px-1.5 py-0.5 bg-gray-800 text-white text-[10px] leading-tight rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">{item.label}</span>
            </button>
          );
        })}
      </div>
      <div className="space-y-2 pt-4 border-t border-gray-800">
        <button
          onClick={onBellClick}
          className="p-3 text-gray-400 hover:bg-gray-800 hover:text-white rounded-xl relative group"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        >
          <Icon name="Bell" size={20} />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-red-500 rounded-full border border-gray-900"></span>
          )}
          <span className="absolute left-full ml-1 px-1.5 py-0.5 bg-gray-800 text-white text-[10px] leading-tight rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">Notifications</span>
        </button>
        <button onClick={onSettingsClick} className={`p-3 rounded-xl transition-all ${location.pathname === '/settings' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`} aria-label="Settings"><Icon name="Settings" size={20} /></button>
      </div>
    </div>
  );
}

export default Sidebar;
