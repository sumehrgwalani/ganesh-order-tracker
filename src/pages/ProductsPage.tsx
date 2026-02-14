import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import PageHeader from '../components/PageHeader';
import ProductModal from '../components/ProductModal';
import { useProducts } from '../hooks/useProducts';
import type { CatalogProduct } from '../hooks/useProducts';

interface Props {
  orgId: string | null;
}

const TYPE_ICONS: Record<string, string> = {
  Cuttlefish: '\uD83D\uDC19',
  Squid: '\uD83E\uDD91',
  Shrimp: '\uD83E\uDD90',
  Fish: '\uD83D\uDC1F',
  Other: '\uD83D\uDCE6',
};

const TYPE_COLORS: Record<string, string> = {
  Cuttlefish: 'from-purple-500 to-purple-600',
  Squid: 'from-blue-500 to-blue-600',
  Shrimp: 'from-orange-500 to-orange-600',
  Fish: 'from-teal-500 to-teal-600',
  Other: 'from-gray-500 to-gray-600',
};

function formatGlaze(glaze: number): string {
  return Math.round(glaze * 100) + '%';
}

function ProductsPage({ orgId }: Props) {
  const navigate = useNavigate();
  const { products, loading, addProduct, updateProduct, deleteProduct } = useProducts(orgId);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('all');
  const [selectedFreeze, setSelectedFreeze] = useState('all');
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<CatalogProduct | null>(null);

  // Get unique product types and freeze types from actual data
  const productTypes = useMemo(() => {
    const types = [...new Set(products.map(p => p.product_type))].filter(Boolean).sort();
    return types;
  }, [products]);

  const freezeTypes = useMemo(() => {
    return [...new Set(products.map(p => p.freeze_type))].filter(Boolean).sort();
  }, [products]);

  // Filter products
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = !searchTerm ||
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.size.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.markets || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType = selectedType === 'all' || p.product_type === selectedType;
      const matchesFreeze = selectedFreeze === 'all' || p.freeze_type === selectedFreeze;
      return matchesSearch && matchesType && matchesFreeze;
    });
  }, [products, searchTerm, selectedType, selectedFreeze]);

  // Group products by product_type, then by name
  const groupedByType = useMemo(() => {
    const groups: Record<string, Record<string, CatalogProduct[]>> = {};
    filteredProducts.forEach(p => {
      const type = p.product_type || 'Other';
      if (!groups[type]) groups[type] = {};
      if (!groups[type][p.name]) groups[type][p.name] = [];
      groups[type][p.name].push(p);
    });
    return groups;
  }, [filteredProducts]);

  // Flat grouped by name (for "all" type view)
  const groupedByName = useMemo(() => {
    const groups: Record<string, CatalogProduct[]> = {};
    filteredProducts.forEach(p => {
      if (!groups[p.name]) groups[p.name] = [];
      groups[p.name].push(p);
    });
    return groups;
  }, [filteredProducts]);

  // Get existing product names for the modal datalist
  const existingNames = useMemo(() => {
    return [...new Set(products.map(p => p.name))].sort();
  }, [products]);

  // Type tab counts
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: products.length };
    products.forEach(p => {
      const t = p.product_type || 'Other';
      counts[t] = (counts[t] || 0) + 1;
    });
    return counts;
  }, [products]);

  const handleSave = async (data: Omit<CatalogProduct, 'id' | 'is_active'>) => {
    try {
      if (editingProduct?.id) {
        await updateProduct(editingProduct.id, data);
      } else {
        await addProduct(data);
      }
      setShowModal(false);
      setEditingProduct(null);
    } catch (err) {
      console.error('Failed to save product:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Remove this product from the catalog?')) {
      try {
        await deleteProduct(id);
      } catch (err) {
        console.error('Failed to delete product:', err);
      }
    }
  };

  const handleEdit = (product: CatalogProduct) => {
    setEditingProduct(product);
    setShowModal(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // Render a product group (name + table of variants)
  const renderProductGroup = (name: string, items: CatalogProduct[], type: string) => {
    const groupKey = `${type}:${name}`;
    const isExpanded = expandedGroup === groupKey;

    return (
      <div key={groupKey} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div
          onClick={() => setExpandedGroup(isExpanded ? null : groupKey)}
          className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 bg-gradient-to-br ${TYPE_COLORS[type] || TYPE_COLORS.Other} rounded-lg flex items-center justify-center text-white text-lg`}>
              {TYPE_ICONS[type] || TYPE_ICONS.Other}
            </div>
            <div>
              <h3 className="font-semibold text-gray-800">{name}</h3>
              <p className="text-sm text-gray-500">
                {items.length} variant{items.length > 1 ? 's' : ''}
                <span className="mx-2 text-gray-300">|</span>
                {items[0].freeze_type}
                {items[0].catching_method && (
                  <><span className="mx-2 text-gray-300">|</span>{items[0].catching_method}</>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 font-medium bg-gray-100 px-2 py-1 rounded-full">
              {formatGlaze(items[0].glaze)} glaze
            </span>
            <Icon name="ChevronDown" size={20} className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </div>
        </div>

        {isExpanded && (
          <div className="border-t border-gray-100">
            {/* Table header */}
            <div className="grid grid-cols-[100px_80px_120px_140px_1fr_80px] gap-3 px-4 py-2 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
              <span>Size</span>
              <span>Glaze</span>
              <span>Freeze</span>
              <span>Catch Method</span>
              <span>Markets</span>
              <span className="text-right">Actions</span>
            </div>
            {/* Table rows */}
            {items.map((item) => (
              <div key={item.id} className="grid grid-cols-[100px_80px_120px_140px_1fr_80px] gap-3 px-4 py-3 items-center border-t border-gray-50 hover:bg-gray-50 transition-colors">
                <span className="text-sm font-medium text-gray-800">{item.size}</span>
                <span className="text-sm text-gray-600">{formatGlaze(item.glaze)}</span>
                <span className="inline-flex items-center">
                  <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium">{item.freeze_type}</span>
                </span>
                <span className="text-sm text-gray-600">{item.catching_method || '-'}</span>
                <span className="text-sm text-gray-500 truncate">{item.markets || '-'}</span>
                <div className="flex gap-1 justify-end">
                  <button onClick={() => handleEdit(item)} className="p-1.5 hover:bg-gray-100 rounded-lg" title="Edit">
                    <Icon name="Edit" size={14} className="text-gray-400" />
                  </button>
                  <button onClick={() => handleDelete(item.id)} className="p-1.5 hover:bg-red-50 rounded-lg" title="Remove">
                    <Icon name="Trash2" size={14} className="text-red-400" />
                  </button>
                </div>
              </div>
            ))}
            {/* Add variant button */}
            <div className="p-3 bg-gray-50 border-t border-gray-100">
              <button
                onClick={() => {
                  setEditingProduct({
                    id: '',
                    name: name,
                    category: type,
                    product_type: type,
                    size: '',
                    glaze: items[0].glaze,
                    freeze_type: items[0].freeze_type,
                    catching_method: items[0].catching_method,
                    markets: items[0].markets,
                    is_active: true,
                  } as CatalogProduct);
                  setShowModal(true);
                }}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
              >
                <Icon name="Plus" size={14} /> Add size variant
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle={`${products.length} products in catalog`}
        onBack={() => navigate('/')}
        actions={
          <button
            onClick={() => { setEditingProduct(null); setShowModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Icon name="Plus" size={16} />
            <span className="text-sm font-medium">Add Product</span>
          </button>
        }
      />

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        {/* Product Type Tabs */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide w-12 flex-shrink-0">Type</span>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedType('all')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                selectedType === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              All ({typeCounts.all || 0})
            </button>
            {productTypes.map(type => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${
                  selectedType === type ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <span>{TYPE_ICONS[type] || ''}</span>
                {type} ({typeCounts[type] || 0})
              </button>
            ))}
          </div>
        </div>

        {/* Freeze Type Filter */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide w-12 flex-shrink-0">Freeze</span>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedFreeze('all')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                selectedFreeze === 'all' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              All
            </button>
            {freezeTypes.map(freeze => (
              <button
                key={freeze}
                onClick={() => setSelectedFreeze(freeze)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  selectedFreeze === freeze ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {freeze}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Icon name="Search" className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Search products by name, size, or market..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>

        {/* Active filter summary */}
        {(selectedType !== 'all' || selectedFreeze !== 'all' || searchTerm) && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
            <span className="text-xs text-gray-500">
              Showing {filteredProducts.length} of {products.length} products
            </span>
            <button
              onClick={() => { setSelectedType('all'); setSelectedFreeze('all'); setSearchTerm(''); }}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              <Icon name="X" size={12} /> Clear all filters
            </button>
          </div>
        )}
      </div>

      {/* Product Groups */}
      {filteredProducts.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
          <Icon name="Package" size={48} className="mx-auto mb-4 text-gray-300" />
          <p className="font-medium text-gray-500">No products found</p>
          <p className="text-sm text-gray-400 mt-1">
            {products.length === 0 ? 'Add your first product to get started' : 'Try adjusting your filters'}
          </p>
        </div>
      ) : selectedType === 'all' ? (
        // Show all products grouped by type, then by name
        <div className="space-y-6">
          {Object.entries(groupedByType).sort(([a], [b]) => a.localeCompare(b)).map(([type, nameGroups]) => (
            <div key={type}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">{TYPE_ICONS[type] || TYPE_ICONS.Other}</span>
                <h2 className="text-lg font-bold text-gray-800">{type}</h2>
                <span className="text-sm text-gray-400">
                  ({Object.values(nameGroups).reduce((sum, items) => sum + items.length, 0)} products)
                </span>
              </div>
              <div className="space-y-3">
                {Object.entries(nameGroups).sort(([a], [b]) => a.localeCompare(b)).map(([name, items]) =>
                  renderProductGroup(name, items, type)
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        // Show products for selected type, grouped by name
        <div className="space-y-3">
          {Object.entries(groupedByName).sort(([a], [b]) => a.localeCompare(b)).map(([name, items]) =>
            renderProductGroup(name, items, selectedType)
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <ProductModal
          product={editingProduct?.id ? editingProduct : null}
          defaults={editingProduct && !editingProduct.id ? editingProduct : undefined}
          existingNames={existingNames}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditingProduct(null); }}
        />
      )}
    </div>
  );
}

export default ProductsPage;
