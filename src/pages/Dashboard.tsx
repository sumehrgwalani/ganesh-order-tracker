import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import StatsCard from '../components/StatsCard';
import StageFilter from '../components/StageFilter';
import OrderRow from '../components/OrderRow';
import { ORDER_STAGES } from '../data/constants';
import type { Order, Stats, ProductInquiry } from '../types';

interface Props {
  orders: Order[];
  stats: Stats;
  filteredOrders: Order[];
  selectedStage: number | null;
  setSelectedStage: (stage: number | null) => void;
  onDeleteOrder?: (orderId: string) => Promise<void>;
  productInquiries: ProductInquiry[];
}

function DashboardContent({ orders, stats, filteredOrders, selectedStage, setSelectedStage, onDeleteOrder, productInquiries }: Props) {
  const navigate = useNavigate();
  return (
    <>
      <div className="mb-6"><h1 className="text-2xl font-bold text-gray-800">Welcome back</h1><p className="text-gray-500 mt-1">Track your seafood export orders with real-time email updates</p></div>
      <div className="grid grid-cols-5 gap-4 mb-8">
        <StatsCard icon="Package" title="Active Orders" value={stats.active} color="primary" onClick={() => navigate('/orders')} trend="+2 this week" />
        <StatsCard icon="CheckCircle" title="Completed" value={stats.completed} color="secondary" onClick={() => navigate('/completed')} />
        <StatsCard icon="MessageSquare" title="Inquiries" value={stats.inquiries} color="secondary" onClick={() => navigate('/inquiries')} />
        <StatsCard icon="Users" title="Contacts" value={stats.contacts} color="secondary" onClick={() => navigate('/contacts')} />
        <StatsCard icon="Box" title="Products" value={stats.products} color="secondary" onClick={() => navigate('/products')} />
      </div>
      <div className="bg-white rounded-2xl p-6 border border-gray-100 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-800">
            {selectedStage ? `Orders at "${ORDER_STAGES[selectedStage-1]?.name}"` : 'Active Orders'}
            <span className="ml-2 text-sm font-normal text-gray-500">({filteredOrders.length} orders)</span>
          </h2>
          <button onClick={() => navigate('/create-po')} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"><Icon name="Plus" size={16} /><span className="text-sm font-medium">New Order</span></button>
        </div>

        {/* Clickable Stage Filter */}
        <StageFilter
          stages={ORDER_STAGES}
          orders={orders}
          selectedStage={selectedStage}
          onStageSelect={setSelectedStage}
        />

        <div className="space-y-0">
          {filteredOrders.length > 0 ? (
            filteredOrders.map(order => (
              <OrderRow key={order.id} order={order} onClick={() => navigate('/orders/' + encodeURIComponent(order.id))} onDelete={onDeleteOrder} />
            ))
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Icon name="Package" size={48} className="mx-auto mb-4 text-gray-300" />
              <p className="font-medium">No orders found</p>
              <p className="text-sm mt-1">
                {selectedStage
                  ? `No orders at stage "${ORDER_STAGES[selectedStage-1]?.name}"`
                  : 'Create a new order to get started'
                }
              </p>
              {selectedStage && (
                <button
                  onClick={() => setSelectedStage(null)}
                  className="mt-4 text-blue-600 hover:text-blue-700 font-medium text-sm"
                >
                  Clear filter to see all orders
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-6 border border-gray-100">
          <h3 className="font-semibold text-gray-800 mb-4">Active Shipments</h3>
          <div className="bg-gradient-to-br from-blue-50 via-green-50 to-blue-50 rounded-xl h-64 flex items-center justify-center">
            <div className="text-center"><Icon name="MapPin" className="mx-auto text-blue-500 mb-3" size={40} /><p className="text-gray-600 font-medium">Shipment Routes</p><p className="text-sm text-gray-400 mt-1">India → Spain</p></div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-6 border border-gray-100">
          <div className="flex justify-between items-center mb-4"><h3 className="font-semibold text-gray-800">Product Inquiries</h3><div className="flex gap-1 bg-gray-100 rounded-lg p-1"><span className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md">Received</span></div></div>
          <div className="space-y-3 max-h-56 overflow-y-auto">
            {productInquiries.map((inq) => (<div key={inq.id || inq.product} className="flex justify-between items-start p-4 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => navigate('/inquiries')}><div><p className="font-medium text-gray-800">{inq.product}</p>{inq.brand && <p className="text-xs text-purple-600 mt-1">{inq.brand}</p>}{inq.sizes && inq.sizes.map((s) => <p key={s} className="text-xs text-gray-500">{s}</p>)}</div><div className="text-right"><p className="font-bold text-gray-800">{inq.total}</p><p className="text-xs text-gray-500">From: {inq.from}</p><button onClick={(e) => { e.stopPropagation(); navigate('/inquiries'); }} className="mt-2 px-3 py-1 text-xs border border-gray-300 rounded-lg hover:bg-white" aria-label={`Respond to ${inq.product} inquiry from ${inq.from}`}>Respond</button></div></div>))}
          </div>
        </div>
      </div>
    </>
  );
}

export default DashboardContent;
