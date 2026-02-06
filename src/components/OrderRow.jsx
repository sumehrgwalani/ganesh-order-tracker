import React from 'react';
import Icon from './Icon';
import { ORDER_STAGES } from '../data/constants';
import OrderProgressBar from './OrderProgressBar';
import CompactEmailPreview from './CompactEmailPreview';
import ExpandableEmailCard from './ExpandableEmailCard';

function OrderRow({ order, onClick, expanded, onToggleExpand }) {
  const isCompleted = order.currentStage === 8;
  const lastUpdate = order.history[order.history.length - 1];
  return (
    <div className="bg-white rounded-xl border border-gray-100 hover:shadow-md hover:border-blue-200 transition-all mb-3">
      <div className="p-4 cursor-pointer" onClick={onClick}>
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-3">
              <span className="font-mono text-sm text-gray-600 font-medium">{order.id}</span>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${isCompleted ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
                {ORDER_STAGES[order.currentStage - 1]?.shortName}
              </span>
              {order.brand && <span className="text-xs px-2 py-0.5 bg-purple-50 text-purple-600 rounded">{order.brand}</span>}
            </div>
            <OrderProgressBar currentStage={order.currentStage} />
          </div>
          <div className="text-center px-6 border-l border-gray-100 min-w-[140px]">
            <p className="font-medium text-gray-800 truncate text-sm">{order.company}</p>
            {order.supplier && <p className="text-xs text-gray-400">{order.supplier}</p>}
          </div>
          <div className="text-right px-6 border-l border-gray-100 min-w-[180px]">
            <p className="font-medium text-gray-800 text-sm">{order.product}</p>
            <p className="text-xs text-gray-500 truncate">{order.specs}</p>
          </div>
          <div className="text-right px-6 border-l border-gray-100 min-w-[140px]">
            <p className="text-xs text-gray-500">{order.from} → {order.to}</p>
            {order.awbNumber && <p className="text-xs text-blue-600 font-mono mt-1">AWB: {order.awbNumber}</p>}
          </div>
          <div className="text-right pl-6 text-xs text-gray-500 min-w-[100px]">{order.date}</div>
          <Icon name="ChevronRight" className="ml-4 text-gray-300" size={20} />
        </div>
        <div className="mt-3 pt-3 border-t border-gray-50">
          <CompactEmailPreview entry={lastUpdate} onClick={(e) => { e.stopPropagation(); onToggleExpand(); }} />
          <button onClick={(e) => { e.stopPropagation(); onToggleExpand(); }} className="mt-2 text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
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
