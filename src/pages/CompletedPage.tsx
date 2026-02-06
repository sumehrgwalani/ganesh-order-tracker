import { useState } from 'react';
import Icon from '../components/Icon';
import ExpandableEmailCard from '../components/ExpandableEmailCard';
import PageHeader from '../components/PageHeader';
import type { Order } from '../types';

interface Props {
  orders: Order[];
  expandedOrder: string | null;
  setExpandedOrder: (id: string | null) => void;
  setSelectedOrder: (order: Order) => void;
  onBack: () => void;
}

function CompletedPage({ orders, expandedOrder, setExpandedOrder, setSelectedOrder, onBack }: Props) {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const completedOrders = orders.filter(o => o.currentStage === 8);

  const filteredOrders = completedOrders.filter(order => {
    return !searchTerm ||
      order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.product.toLowerCase().includes(searchTerm.toLowerCase());
  });

  return (
    <div>
      <PageHeader
        title="Completed Orders"
        subtitle={`${completedOrders.length} orders successfully delivered`}
        onBack={onBack}
      />

      {/* Stats Summary */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-4 text-white">
          <p className="text-green-100 text-sm">Total Completed</p>
          <p className="text-3xl font-bold mt-1">{completedOrders.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-gray-500 text-sm">This Month</p>
          <p className="text-3xl font-bold mt-1 text-gray-800">{completedOrders.filter(o => new Date(o.history[o.history.length-1]?.timestamp) > new Date(Date.now() - 30*24*60*60*1000)).length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-gray-500 text-sm">With DHL</p>
          <p className="text-3xl font-bold mt-1 text-gray-800">{completedOrders.filter(o => o.awbNumber).length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-gray-500 text-sm">Telex Release</p>
          <p className="text-3xl font-bold mt-1 text-gray-800">{completedOrders.filter(o => o.history.some(h => h.body?.toLowerCase().includes('telex'))).length}</p>
        </div>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        <div className="relative">
          <Icon name="Search" className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Search completed orders..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Completed Orders List */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <div className="space-y-0">
          {filteredOrders.length > 0 ? (
            filteredOrders.map(order => (
              <div key={order.id} className="bg-green-50 rounded-xl border border-green-100 p-4 mb-3">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Icon name="CheckCircle" size={20} className="text-green-600" />
                      <span className="font-mono text-sm text-gray-600 font-medium">{order.id}</span>
                      <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-100 text-green-700">Delivered</span>
                      {order.awbNumber && <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded font-mono">AWB: {order.awbNumber}</span>}
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <span className="text-gray-700 font-medium">{order.company}</span>
                      <span className="text-gray-500">{order.product}</span>
                      <span className="text-gray-400">{order.supplier}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">{order.date}</p>
                    <p className="text-xs text-gray-400 mt-1">{order.from} → {order.to}</p>
                  </div>
                  <button
                    onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
                    className="ml-4 p-2 hover:bg-green-100 rounded-lg transition-colors"
                  >
                    <Icon name="ChevronDown" size={16} className={`text-green-600 transition-transform ${expandedOrder === order.id ? 'rotate-180' : ''}`} />
                  </button>
                </div>
                {expandedOrder === order.id && (
                  <div className="mt-4 pt-4 border-t border-green-200">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Delivery Timeline</p>
                    <div className="space-y-2">
                      {order.history.slice(-3).reverse().map((entry, idx) => (
                        <ExpandableEmailCard key={idx} entry={entry} defaultExpanded={idx === 0} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Icon name="CheckCircle" size={48} className="mx-auto mb-4 text-gray-300" />
              <p className="font-medium">No completed orders found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CompletedPage;
