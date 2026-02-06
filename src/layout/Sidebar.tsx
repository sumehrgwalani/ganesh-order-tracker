import React from 'react';
import Icon from '../components/Icon';
import { WTTLogo } from '../components/Logos';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onSettingsClick: () => void;
  onNavClick: () => void;
}

function Sidebar({ activeTab, setActiveTab, onSettingsClick, onNavClick }: SidebarProps) {
  const menuItems = [
    { icon: 'Home', label: 'Dashboard', id: 'dashboard' },
    { icon: 'FilePlus', label: 'Create PO', id: 'create-po' },
    { icon: 'Inbox', label: 'Mailbox', id: 'mailbox' },
    { icon: 'FileText', label: 'Orders', id: 'orders' },
    { icon: 'Mail', label: 'Inquiries', id: 'inquiries' },
    { icon: 'Package', label: 'Products', id: 'products' },
    { icon: 'Users', label: 'Contacts', id: 'contacts' },
  ];

  const handleNavClick = (tabId: string) => {
    if (onNavClick) onNavClick(); // Clear selected order
    setActiveTab(tabId);
  };

  return (
    <div className="w-16 bg-gray-900 flex flex-col items-center py-4 space-y-2">
      <div className="mb-4">
        <WTTLogo size={40} />
      </div>
      <div className="flex-1 space-y-2">
        {menuItems.map((item) => (
          <button key={item.id} onClick={() => handleNavClick(item.id)} className={`p-3 rounded-xl transition-all group relative ${activeTab === item.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
            <Icon name={item.icon} size={20} />
            <span className="absolute left-full ml-3 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">{item.label}</span>
          </button>
        ))}
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
