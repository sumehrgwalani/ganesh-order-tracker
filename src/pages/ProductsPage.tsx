import { useState } from 'react';
import Icon from '../components/Icon';
import PageHeader from '../components/PageHeader';
import type { Order } from '../types';

interface Product {
  id: number;
  name: string;
  category: string;
  specs: string;
  suppliers: string[];
  orders: number;
  image: string;
}

interface Props {
  orders: Order[];
  onBack: () => void;
}

function ProductsPage({ orders, onBack }: Props) {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Extract unique products from orders
  const productsList: Product[] = [
    { id: 1, name: 'Calamar Troceado', category: 'squid', specs: '20/40 6X1 20%', suppliers: ['RAUNAQ', 'JJ SEAFOODS'], orders: 3, image: '🦑' },
    { id: 2, name: 'Squid Whole IQF', category: 'squid', specs: 'Various sizes', suppliers: ['Nila Exports', 'Silver Sea Foods'], orders: 5, image: '🦑' },
    { id: 3, name: 'Baby Squid Finger Laid', category: 'squid', specs: '200/300', suppliers: ['RAUNAQ'], orders: 1, image: '🦑' },
    { id: 4, name: 'Squid Rings', category: 'squid', specs: '40/60', suppliers: ['Silver Sea Foods'], orders: 1, image: '🦑' },
    { id: 5, name: 'Vannamei PUD Blanched', category: 'shrimp', specs: '31/40', suppliers: ['Nila Exports'], orders: 2, image: '🦐' },
    { id: 6, name: 'Vannamei HLSO', category: 'shrimp', specs: '16/20, 21/25', suppliers: ['Nila Exports'], orders: 1, image: '🦐' },
    { id: 7, name: 'Puntilla Lavada y Congelada', category: 'squid', specs: 'Washed & Frozen', suppliers: ['Multiple'], orders: 0, image: '🦑' },
    { id: 8, name: 'Cuttlefish Whole', category: 'cuttlefish', specs: 'Various sizes', suppliers: ['Nila Exports'], orders: 0, image: '🐙' },
  ];

  const categories = [
    { id: 'all', label: 'All Products' },
    { id: 'squid', label: 'Squid' },
    { id: 'shrimp', label: 'Shrimp' },
    { id: 'cuttlefish', label: 'Cuttlefish' },
  ];

  const filteredProducts = productsList.filter(product => {
    const matchesSearch = !searchTerm ||
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.specs.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || product.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle={`${productsList.length} products in catalog`}
        onBack={onBack}
        actions={
          <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <Icon name="Plus" size={16} /><span className="text-sm font-medium">Add Product</span>
          </button>
        }
      />

      {/* Category Tabs */}
      <div className="flex gap-2 mb-6">
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              selectedCategory === cat.id
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        <div className="relative">
          <Icon name="Search" className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Search products..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Products Grid */}
      <div className="grid grid-cols-4 gap-4">
        {filteredProducts.map(product => (
          <div key={product.id} className="bg-white rounded-xl border border-gray-100 p-5 hover:shadow-md hover:border-blue-200 transition-all cursor-pointer">
            <div className="text-center mb-4">
              <div className="text-5xl mb-2">{product.image}</div>
              <p className="font-medium text-gray-800">{product.name}</p>
              <p className="text-xs text-gray-500 mt-1">{product.specs}</p>
            </div>
            <div className="border-t border-gray-100 pt-4">
              <div className="flex justify-between text-xs mb-2">
                <span className="text-gray-500">Active Orders</span>
                <span className={`font-bold ${product.orders > 0 ? 'text-blue-600' : 'text-gray-400'}`}>{product.orders}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Suppliers</span>
                <span className="font-medium text-gray-700">{product.suppliers.length}</span>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button className="flex-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">Details</button>
              <button className="flex-1 px-3 py-1.5 text-xs bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100">New Order</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ProductsPage;
