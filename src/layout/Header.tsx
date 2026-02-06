import React from 'react';
import Icon from '../components/Icon';
import { WTTLogo } from '../components/Logos';

interface HeaderProps {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  lastSync: string;
  isSyncing: boolean;
  onSyncClick: () => void;
}

function Header({ searchTerm, setSearchTerm, lastSync, isSyncing, onSyncClick }: HeaderProps) {
  const formatLastSync = (ts: string) => {
    if (!ts) return 'Never';
    const diff = Math.floor((new Date().getTime() - new Date(ts).getTime()) / 60000);
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff}m ago`;
    return `${Math.floor(diff / 60)}h ago`;
  };
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
        <div className="relative"><Icon name="Bell" size={20} className="text-gray-500" /><span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">3</span></div>
        <div className="w-10 h-10 bg-gradient-to-br from-gray-300 to-gray-400 rounded-full flex items-center justify-center"><span className="text-white font-medium text-sm">S</span></div>
      </div>
    </div>
  );
}

export default Header;
