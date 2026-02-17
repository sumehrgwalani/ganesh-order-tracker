import { useState } from 'react';
import Icon from './Icon';
import type { Order } from '../types';

interface Props {
  order: Order;
  buyerOptions: string[];
  supplierOptions: string[];
  productOptions: string[];
  brandOptions: string[];
  onSave: (orderId: string, updates: Partial<Order>) => Promise<void>;
  onClose: () => void;
}

export default function EditOrderModal({ order, buyerOptions, supplierOptions, productOptions, brandOptions, onSave, onClose }: Props) {
  const [editForm, setEditForm] = useState<Record<string, string>>({
    company: order.company || '',
    supplier: order.supplier || '',
    product: order.product || '',
    specs: order.specs || '',
    from: order.from || '',
    to: order.to || '',
    brand: order.brand || '',
    piNumber: order.piNumber || '',
    awbNumber: order.awbNumber || '',
    totalValue: order.totalValue || '',
    totalKilos: order.totalKilos ? String(order.totalKilos) : '',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(order.id, {
        company: editForm.company,
        supplier: editForm.supplier,
        product: editForm.product,
        specs: editForm.specs,
        from: editForm.from,
        to: editForm.to,
        brand: editForm.brand,
        piNumber: editForm.piNumber,
        awbNumber: editForm.awbNumber,
        totalValue: editForm.totalValue,
        totalKilos: editForm.totalKilos ? Number(editForm.totalKilos) : undefined,
      });
      onClose();
    } catch { /* error handled by parent */ }
    finally { setSaving(false); }
  };

  const dropdownFields = [
    { key: 'company', label: 'Buyer', options: buyerOptions, customKey: '_customBuyer' },
    { key: 'supplier', label: 'Supplier', options: supplierOptions, customKey: '_customSupplier' },
    { key: 'product', label: 'Product', options: productOptions, customKey: '_customProduct' },
    { key: 'brand', label: 'Brand', options: brandOptions, customKey: '_customBrand' },
  ];

  const textFields = [
    { key: 'from', label: 'Origin' },
    { key: 'to', label: 'Destination' },
    { key: 'piNumber', label: 'PI Number' },
    { key: 'awbNumber', label: 'AWB / Tracking' },
    { key: 'totalValue', label: 'Total Value (USD)' },
    { key: 'totalKilos', label: 'Total Kilos' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-2xl flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">Edit Order Details</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
            <Icon name="X" size={20} className="text-gray-500" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {dropdownFields.map(field => {
              const currentVal = editForm[field.key] || '';
              const isCustomMode = editForm[field.customKey] === 'true';
              const isInList = field.options.includes(currentVal);
              return (
                <div key={field.key}>
                  <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">{field.label}</label>
                  {isCustomMode ? (
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={currentVal}
                        onChange={e => setEditForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                        className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        placeholder={`Type ${field.label.toLowerCase()}...`}
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setEditForm(prev => ({ ...prev, [field.customKey]: '' }))}
                        className="px-2 py-2 text-xs text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg border border-gray-200"
                        title="Switch to dropdown"
                      >
                        <Icon name="List" size={16} />
                      </button>
                    </div>
                  ) : (
                    <select
                      value={isInList || currentVal === '' ? currentVal : '__existing__'}
                      onChange={e => {
                        if (e.target.value === '__custom__') {
                          setEditForm(prev => ({ ...prev, [field.customKey]: 'true', [field.key]: '' }));
                        } else if (e.target.value === '__existing__') {
                          // Keep current value
                        } else {
                          setEditForm(prev => ({ ...prev, [field.key]: e.target.value }));
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
                    >
                      <option value="">— Select {field.label} —</option>
                      {!isInList && currentVal !== '' && (
                        <option value="__existing__">{currentVal}</option>
                      )}
                      {field.options.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                      <option value="__custom__">+ Type custom...</option>
                    </select>
                  )}
                </div>
              );
            })}
            {textFields.map(field => (
              <div key={field.key}>
                <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">{field.label}</label>
                <input
                  type="text"
                  value={editForm[field.key] || ''}
                  onChange={e => setEditForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
            ))}
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Specs / Description</label>
            <textarea
              value={editForm.specs || ''}
              onChange={e => setEditForm(prev => ({ ...prev, specs: e.target.value }))}
              rows={2}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-2xl flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button
            disabled={saving}
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
