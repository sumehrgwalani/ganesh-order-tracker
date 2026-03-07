import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { ORDER_STAGES } from '../data/constants';
import StageFilter from '../components/StageFilter';
import OrderRow from '../components/OrderRow';
import type { Order } from '../types';

interface Props {
  orders: Order[];
  onDeleteOrder?: (orderId: string) => Promise<void>;
}

type Tab = 'active' | 'completed' | 'all';

function OrdersPage({ orders, onDeleteOrder }: Props) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab) || 'active';
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [filterStage, setFilterStage] = useState<number | null>(null);
  const [filterCompany, setFilterCompany] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [sortBy, setSortBy] = useState<'po-asc' | 'po-desc' | 'stage-asc' | 'stage-desc' | 'date-desc' | 'date-asc'>('po-desc');

  // Sync tab from URL param
  useEffect(() => {
    const urlTab = searchParams.get('tab') as Tab;
    if (urlTab && ['active', 'completed', 'all'].includes(urlTab)) {
      setActiveTab(urlTab);
    }
  }, [searchParams]);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setFilterStage(null);
    setFilterCompany('all');
    setSearchTerm('');
    if (tab === 'active') {
      setSearchParams({});
    } else {
      setSearchParams({ tab });
    }
  };

  // Filter orders by tab
  const tabOrders = orders.filter(o => {
    if (activeTab === 'active') return o.currentStage < 9;
    if (activeTab === 'completed') return o.currentStage === 9;
    return true; // all
  });

  // Get unique companies
  const companies = [...new Set(tabOrders.map(o => o.company))].sort();

  const filteredOrders = tabOrders.filter(order => {
    const matchesSearch = !searchTerm ||
      order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.product.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (order.containerNumber || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStage = filterStage === null || order.currentStage === filterStage;
    const matchesCompany = filterCompany === 'all' || order.company === filterCompany;
    return matchesSearch && matchesStage && matchesCompany;
  });

  const getPoNum = (id: string) => {
    const m = id.match(/(\d{4,})/)
    return m ? parseInt(m[1]) : 0
  }

  const sortedOrders = [...filteredOrders].sort((a, b) => {
    switch (sortBy) {
      case 'po-asc': return getPoNum(a.id) - getPoNum(b.id)
      case 'po-desc': return getPoNum(b.id) - getPoNum(a.id)
      case 'stage-asc': return a.currentStage - b.currentStage
      case 'stage-desc': return b.currentStage - a.currentStage
      case 'date-asc': return new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime()
      case 'date-desc': return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
      default: return 0
    }
  });

  const hasActiveFilters = filterStage !== null || filterCompany !== 'all' || searchTerm;

  const activeCount = orders.filter(o => o.currentStage < 9).length;
  const completedCount = orders.filter(o => o.currentStage === 9).length;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'active', label: 'Active Orders', count: activeCount },
    { key: 'completed', label: 'Completed', count: completedCount },
    { key: 'all', label: 'All Orders', count: orders.length },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/')} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <Icon name="ArrowLeft" size={20} className="text-gray-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Orders</h1>
            <p className="text-gray-500 text-sm mt-0.5">{tabOrders.length} orders</p>
          </div>
        </div>
        <button onClick={() => navigate('/create-po')} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          <Icon name="Plus" size={16} /><span className="text-sm font-medium">New Order</span>
        </button>
      </div>

      {/* Tabs - dark theme matching dashboard */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
          borderRadius: '16px',
          border: '1px solid rgba(56, 189, 248, 0.15)',
          boxShadow: '0 0 30px rgba(56, 189, 248, 0.05), 0 4px 20px rgba(0,0,0,0.15)',
          padding: '6px',
          marginBottom: '16px',
          display: 'flex',
          gap: '4px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Top glow */}
        <div style={{ position: 'absolute', top: 0, left: '10%', right: '10%', height: '1px', background: 'linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.4), transparent)' }} />

        {tabs.map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              style={{
                flex: 1,
                padding: '10px 16px',
                borderRadius: '12px',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'all 0.2s',
                background: isActive
                  ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.2), rgba(168, 85, 247, 0.15))'
                  : 'transparent',
                borderWidth: '1px',
                borderStyle: 'solid',
                borderColor: isActive ? 'rgba(56, 189, 248, 0.3)' : 'transparent',
              }}
              onMouseOver={e => {
                if (!isActive) e.currentTarget.style.background = 'rgba(56, 189, 248, 0.05)';
              }}
              onMouseOut={e => {
                if (!isActive) e.currentTarget.style.background = 'transparent';
              }}
            >
              <span style={{
                fontSize: '13px',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? '#e2e8f0' : '#64748b',
                letterSpacing: '0.025em',
              }}>
                {tab.label}
              </span>
              <span style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: '10px',
                background: isActive ? 'rgba(56, 189, 248, 0.2)' : 'rgba(100, 116, 139, 0.15)',
                color: isActive ? '#38bdf8' : '#64748b',
              }}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search Bar + Sort */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Icon name="Search" className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search by PO number, container, company, or product..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium appearance-none cursor-pointer hover:bg-gray-700 pr-8"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
          >
            <option value="po-desc">PO # (Newest)</option>
            <option value="po-asc">PO # (Oldest)</option>
            <option value="stage-asc">Stage (Earliest)</option>
            <option value="stage-desc">Stage (Latest)</option>
            <option value="date-desc">Date (Newest)</option>
            <option value="date-asc">Date (Oldest)</option>
          </select>
        </div>
      </div>

      {/* Company Filter */}
      {companies.length > 1 && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Filter by Company</p>
            {hasActiveFilters && (
              <button
                onClick={() => { setFilterStage(null); setFilterCompany('all'); setSearchTerm(''); }}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
              >
                <Icon name="X" size={12} />
                Clear all filters
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilterCompany('all')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                filterCompany === 'all'
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              All Companies ({tabOrders.length})
            </button>
            {companies.map(company => {
              const count = tabOrders.filter(o => o.company === company).length;
              return (
                <button
                  key={company}
                  onClick={() => setFilterCompany(company)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    filterCompany === company
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {company} ({count})
                </button>
              );
            })}
          </div>
          {hasActiveFilters && (
            <p className="text-xs text-gray-500 mt-3 pt-3 border-t border-gray-100">
              Showing {filteredOrders.length} of {tabOrders.length} orders
            </p>
          )}
        </div>
      )}

      {/* Stage Filter - only show for active or all tabs */}
      {activeTab !== 'completed' && (
        <StageFilter
          stages={ORDER_STAGES.slice(0, 8)}
          orders={filterCompany === 'all' ? tabOrders : tabOrders.filter(o => o.company === filterCompany)}
          selectedStage={filterStage}
          onStageSelect={setFilterStage}
        />
      )}

      {/* Orders List */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <div className="space-y-0">
          {sortedOrders.length > 0 ? (
            sortedOrders.map(order => (
              <OrderRow
                key={order.id}
                order={order}
                onClick={() => navigate('/orders/' + encodeURIComponent(order.id))}
                onDelete={onDeleteOrder}
              />
            ))
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Icon name="Package" size={48} className="mx-auto mb-4 text-gray-300" />
              <p className="font-medium">No orders found</p>
              <p className="text-sm mt-1">
                {hasActiveFilters ? 'Try adjusting your search or filter' : activeTab === 'completed' ? 'No completed orders yet' : 'Create a new order to get started'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default OrdersPage;
