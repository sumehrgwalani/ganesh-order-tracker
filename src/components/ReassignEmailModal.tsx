import { useState } from 'react';
import Icon from './Icon';

interface OrderOption {
  id: string;
  poNumber: string;
  company: string;
  product: string;
}

interface Props {
  currentOrderId: string;
  orders: OrderOption[];
  onReassign: (newOrderId: string, note: string) => Promise<void>;
  onRemove: (note: string) => Promise<void>;
  onClose: () => void;
}

function ReassignEmailModal({ currentOrderId, orders, onReassign, onRemove, onClose }: Props) {
  const [selectedOrder, setSelectedOrder] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<'reassign' | 'remove'>('reassign');

  const otherOrders = orders.filter(o => o.id !== currentOrderId);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (mode === 'remove') {
        await onRemove(note);
      } else if (selectedOrder) {
        await onReassign(selectedOrder, note);
      }
      onClose();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-100">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-gray-800">Reassign Email</h3>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
              <Icon name="X" size={18} />
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-1">Move this email to a different order, or remove it from this order.</p>
        </div>

        <div className="p-5 space-y-4">
          {/* Mode toggle */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('reassign')}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                mode === 'reassign' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-gray-50 text-gray-600 border border-gray-200'
              }`}
            >
              Move to Order
            </button>
            <button
              type="button"
              onClick={() => setMode('remove')}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                mode === 'remove' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-gray-50 text-gray-600 border border-gray-200'
              }`}
            >
              Remove from Order
            </button>
          </div>

          {/* Order selection (only for reassign mode) */}
          {mode === 'reassign' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Move to which order?</label>
              <select
                value={selectedOrder}
                onChange={e => setSelectedOrder(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select an order...</option>
                {otherOrders.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.poNumber || o.id} — {o.company} — {o.product}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Optional note */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. This email belongs to PO 3040, not 3039"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="p-5 border-t border-gray-100 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || (mode === 'reassign' && !selectedOrder)}
            className={`flex-1 px-4 py-2 rounded-lg text-sm text-white font-medium ${
              mode === 'remove'
                ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-300'
                : 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300'
            }`}
          >
            {saving ? 'Saving...' : mode === 'remove' ? 'Remove Email' : 'Move Email'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReassignEmailModal;
