import { useState } from 'react';
import { Order } from '../types';
import Icon from './Icon';
import { ORDER_STAGES } from '../data/constants';
import OrderProgressBar from './OrderProgressBar';
import CompactEmailPreview from './CompactEmailPreview';
import ExpandableEmailCard from './ExpandableEmailCard';

interface Props {
  order: Order;
  expanded: boolean;
  onToggleExpand: () => void;
  onClick: () => void;
  onDelete?: (orderId: string) => Promise<void>;
}

function OrderRow({ order, expanded, onToggleExpand, onClick, onDelete }: Props) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isCompleted = order.currentStage === 8;
  const lastUpdate = order.history[order.history.length - 1];

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete(order.id);
    } catch {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 hover:shadow-md hover:border-blue-200 transition-all mb-3 relative">
      {/* Delete Confirmation Overlay */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 bg-white/95 backdrop-blur-sm rounded-xl z-10 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
          <div className="text-center p-6 max-w-sm">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Icon name="AlertCircle" size={24} className="text-red-600" />
            </div>
            <h4 className="font-semibold text-gray-800 mb-1">Delete this order?</h4>
            <p className="text-sm text-gray-500 mb-4">
              <span className="font-mono font-medium text-gray-700">{order.id}</span> — {order.company} / {order.product}
            </p>
            <p className="text-xs text-red-500 mb-4">This action cannot be undone.</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(false); }}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium disabled:opacity-50 flex items-center gap-2"
              >
                {deleting ? 'Deleting...' : 'Delete Order'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="p-4 cursor-pointer" onClick={onClick}>
        {/* Top row: PO info + actions */}
        <div className="flex items-center gap-2 mb-2">
          <span className="font-mono text-sm text-gray-600 font-medium whitespace-nowrap">{order.id}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${isCompleted ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
            {ORDER_STAGES[order.currentStage - 1]?.shortName}
          </span>
          {order.brand && <span className="text-xs px-2 py-0.5 bg-purple-50 text-purple-600 rounded whitespace-nowrap">{order.brand}</span>}
          <div className="flex-1" />
          <span className="text-xs text-gray-400 whitespace-nowrap">{order.date}</span>
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }}
              className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              title="Delete order"
            >
              <Icon name="Trash2" size={15} />
            </button>
          )}
          <Icon name="ChevronRight" className="text-gray-300 flex-shrink-0" size={18} />
        </div>

        {/* Main content grid */}
        <div className="grid grid-cols-12 gap-4 items-start mb-2">
          {/* Company & Supplier */}
          <div className="col-span-3">
            <p className="font-medium text-gray-800 text-sm truncate">{order.company}</p>
            {order.supplier && <p className="text-xs text-gray-400 truncate">{order.supplier}</p>}
          </div>
          {/* Product & Specs */}
          <div className="col-span-5">
            <p className="font-medium text-gray-800 text-sm truncate">{order.product}</p>
            <p className="text-xs text-gray-500 truncate">{order.specs}</p>
          </div>
          {/* Route */}
          <div className="col-span-2 text-right">
            <p className="text-xs text-gray-500 truncate">{order.from} → {order.to}</p>
            {order.awbNumber && <p className="text-xs text-blue-600 font-mono mt-0.5">AWB: {order.awbNumber}</p>}
          </div>
          {/* Progress */}
          <div className="col-span-2">
            <OrderProgressBar currentStage={order.currentStage} />
          </div>
        </div>

        {/* Email preview */}
        <div className="pt-2 border-t border-gray-50">
          <CompactEmailPreview entry={lastUpdate} onClick={() => { onToggleExpand(); }} />
          <button onClick={(e) => { e.stopPropagation(); onToggleExpand(); }} className="mt-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
            <Icon name="ChevronDown" size={14} className={`transform transition-transform ${expanded ? 'rotate-180' : ''}`} />
            {expanded ? 'Hide' : 'Show'} email history ({order.history.length} emails)
          </button>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100">
          <div className="mt-4 space-y-3">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Email History</p>
            {[...order.history].reverse().map((entry, idx) => (
              <ExpandableEmailCard key={idx} entry={entry} defaultExpanded={idx === 0} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default OrderRow;
