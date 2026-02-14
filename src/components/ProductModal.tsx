import { useState, useEffect } from 'react';
import Icon from './Icon';
import type { CatalogProduct } from '../hooks/useProducts';

interface Props {
  product: CatalogProduct | null; // null = adding new
  defaults?: Partial<CatalogProduct>; // pre-fill values for new products (e.g. "Add variant")
  existingNames: string[];
  onSave: (product: Omit<CatalogProduct, 'id' | 'is_active'>) => void;
  onClose: () => void;
}

const PRODUCT_TYPES = ['Cuttlefish', 'Squid', 'Shrimp', 'Fish', 'Other'];
const FREEZE_TYPES = ['IQF', 'Blocks', 'Block Frozen', 'Semi IQF', 'Blast'];
const CATCHING_METHODS = ['Trawler', 'One Day Hook Catch', 'Farmed'];
const GLAZE_OPTIONS = [0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50];

function ProductModal({ product, defaults, existingNames, onSave, onClose }: Props) {
  const source = product || defaults;
  const [name, setName] = useState(source?.name || '');
  const [productType, setProductType] = useState(source?.product_type || 'Cuttlefish');
  const [size, setSize] = useState(product?.size || ''); // blank for new variants
  const [glaze, setGlaze] = useState(source?.glaze ?? 0.20);
  const [freezeType, setFreezeType] = useState(source?.freeze_type || 'IQF');
  const [catchingMethod, setCatchingMethod] = useState(source?.catching_method || '');
  const [markets, setMarkets] = useState(source?.markets || '');

  useEffect(() => {
    const s = product || defaults;
    if (s) {
      setName(s.name || '');
      setProductType(s.product_type || 'Cuttlefish');
      setSize(product?.size || '');
      setGlaze(s.glaze ?? 0.20);
      setFreezeType(s.freeze_type || 'IQF');
      setCatchingMethod(s.catching_method || '');
      setMarkets(s.markets || '');
    }
  }, [product, defaults]);

  const handleSubmit = () => {
    if (!name.trim() || !size.trim()) return;
    onSave({
      name: name.trim(),
      category: productType,
      product_type: productType,
      size: size.trim(),
      glaze,
      freeze_type: freezeType,
      catching_method: catchingMethod || null,
      markets: markets.trim() || null,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-800">
            {product ? 'Edit Product' : 'Add Product'}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <Icon name="X" size={18} className="text-gray-400" />
          </button>
        </div>

        {/* Form */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Product Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              list="product-names"
              placeholder="e.g., Cuttlefish Whole Cleaned"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
            <datalist id="product-names">
              {existingNames.map(n => <option key={n} value={n} />)}
            </datalist>
          </div>

          {/* Product Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Product Type</label>
            <select
              value={productType}
              onChange={e => setProductType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
            >
              {PRODUCT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Size + Glaze row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Size</label>
              <input
                type="text"
                value={size}
                onChange={e => setSize(e.target.value)}
                placeholder="e.g., 20/40, U/1"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Glazing</label>
              <select
                value={glaze}
                onChange={e => setGlaze(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
              >
                {GLAZE_OPTIONS.map(g => (
                  <option key={g} value={g}>{Math.round(g * 100)}%</option>
                ))}
              </select>
            </div>
          </div>

          {/* Freeze Type + Catching Method row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Freeze Type</label>
              <select
                value={freezeType}
                onChange={e => setFreezeType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
              >
                {FREEZE_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Catching Method</label>
              <select
                value={catchingMethod}
                onChange={e => setCatchingMethod(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
              >
                <option value="">Not specified</option>
                {CATCHING_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {/* Markets */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Markets</label>
            <input
              type="text"
              value={markets}
              onChange={e => setMarkets(e.target.value)}
              placeholder="e.g., Italy, Spain, Portugal"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">Comma-separated list of countries</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-gray-100 bg-gray-50">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || !size.trim()}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {product ? 'Save Changes' : 'Add Product'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProductModal;
