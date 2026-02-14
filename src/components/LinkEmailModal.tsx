import { useState } from 'react';
import Icon from './Icon';

interface OrderOption {
  id: string;
  poNumber: string;
  company: string;
  product: string;
}

interface Props {
  orders: OrderOption[];
  onLink: (orderId: string, orderPoNumber: string, note: string) => Promise<void>;
  onClose: () => void;
}

function LinkEmailModal({ orders, onLink, onClose }: Props) {
  const [selectedOrder, setSelectedOrder] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!selectedOrder) return;
    setSaving(true);
    try {
      const order = orders.find((o) => o.id === selectedOrder);
      await onLink(selectedOrder, order?.poNumber || selectedOrder, note);
      onClose();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-100">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-gray-800">Link to Order</h3>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
              <Icon name="X" size={18} />
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Connect this email to an order so it appears in the order timeline.
          </p>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Which order?</label>
            <select
              value={selectedOrder}
              onChange={(e) => setSelectedOrder(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select an order...</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.poNumber || o.id} — {o.company} — {o.product}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. This is about the artwork discussion"
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
            disabled={saving || !selectedOrder}
            className="flex-1 px-4 py-2 rounded-lg text-sm text-white font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300"
          >
            {saving ? 'Linking...' : 'Link to Order'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default LinkEmailModal;
