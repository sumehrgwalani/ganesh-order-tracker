import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import { ORDER_STAGES } from '../data/constants';
import PageHeader from '../components/PageHeader';
import StageFilter from '../components/StageFilter';
import OrderRow from '../components/OrderRow';
import type { Order } from '../types';

interface Props {
  orders: Order[];
  onDeleteOrder?: (orderId: string) => Promise<void>;
}

function OrdersPage({ orders, onDeleteOrder }: Props) {
  const navigate = useNavigate();
  const [filterStage, setFilterStage] = useState<number | null>(null);
  const [filterCompany, setFilterCompany] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const activeOrders = orders.filter(o => o.currentStage < 8);

  // Get unique companies from active orders
  const companies = [...new Set(activeOrders.map(o => o.company))].sort();

  const filteredOrders = activeOrders.filter(order => {
    const matchesSearch = !searchTerm ||
      order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.product.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStage = filterStage === null || order.currentStage === filterStage;
    const matchesCompany = filterCompany === 'all' || order.company === filterCompany;
    return matchesSearch && matchesStage && matchesCompany;
  });

  const hasActiveFilters = filterStage !== null || filterCompany !== 'all' || searchTerm;

  return (
    <div>
      <PageHeader
        title="Active Orders"
        subtitle={`${activeOrders.length} orders in progress`}
        onBack={() => navigate('/')}
        actions={
          <button onClick={() => navigate('/create-po')} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <Icon name="Plus" size={16} /><span className="text-sm font-medium">New Order</span>
          </button>
        }
      />

      {/* Search Bar */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        <div className="relative">
          <Icon name="Search" className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Search by PO number, company, or product..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Company Filter */}
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
            All Companies ({activeOrders.length})
          </button>
          {companies.map(company => {
            const count = activeOrders.filter(o => o.company === company).length;
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
            Showing {filteredOrders.length} of {activeOrders.length} orders
          </p>
        )}
      </div>

      {/* Clickable Stage Filter - same as dashboard */}
      <StageFilter
        stages={ORDER_STAGES.slice(0, 7)}
        orders={filterCompany === 'all' ? activeOrders : activeOrders.filter(o => o.company === filterCompany)}
        selectedStage={filterStage}
        onStageSelect={setFilterStage}
      />

      {/* Orders List */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <div className="space-y-0">
          {filteredOrders.length > 0 ? (
            filteredOrders.map(order => (
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
              <p className="text-sm mt-1">Try adjusting your search or filter</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default OrdersPage;
