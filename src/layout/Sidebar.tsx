import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../components/Icon';
import { WTTLogo } from '../components/Logos';

interface SidebarProps {
  onSettingsClick: () => void;
}

function Sidebar({ onSettingsClick }: SidebarProps) {
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
            <button key={item.path} onClick={() => navigate(item.path)} className={`p-3 rounded-xl transition-all group relative ${isActive ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
              <Icon name={item.icon} size={20} />
              <span className="absolute left-full ml-1 px-1.5 py-0.5 bg-gray-800 text-white text-[10px] leading-tight rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">{item.label}</span>
            </button>
          );
        })}
      </div>
      <div className="space-y-2 pt-4 border-t border-gray-800">
        <button className="p-3 text-gray-400 hover:bg-gray-800 hover:text-white rounded-xl relative">
          <Icon name="Bell" size={20} /><span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full"></span>
        </button>
        <button onClick={onSettingsClick} className="p-3 text-gray-400 hover:bg-gray-800 hover:text-white rounded-xl"><Icon name="Settings" size={20} /></button>
      </div>
    </div>
  );
}

export default Sidebar;
