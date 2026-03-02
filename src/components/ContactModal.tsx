import { useState } from 'react';
import { ContactFormData } from '../types';
import Icon from './Icon';
import { findMatchingCompany } from '../utils/normalizeCompany';

interface Props {
  contact: ContactFormData | null;
  onSave: (data: ContactFormData) => void;
  onClose: () => void;
  companies: string[];
}

function ContactModal({ contact, onSave, onClose, companies }: Props) {
  const [formData, setFormData] = useState<ContactFormData>(contact || {
    name: '',
    email: '',
    phone: '',
    address: '',
    company: '',
    role: '',
    category: 'other',
    country: '',
    color: 'bg-blue-500',
    default_brand: '',
  });

  const colors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 'bg-red-500', 'bg-teal-500', 'bg-pink-500', 'bg-indigo-500'];
  const categories = ['buyers', 'suppliers', 'inspectors', 'other'];

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const initials = formData.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    onSave({ ...formData, initials });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-100">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold text-gray-800">{contact ? 'Edit Contact' : 'Add New Contact'}</h2>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><Icon name="X" size={20} /></button>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="John Doe"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({...formData, email: e.target.value})}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="john@company.com"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              value={formData.phone || ''}
              onChange={(e) => setFormData({...formData, phone: e.target.value})}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="+91 98765 43210"
            />
          </div>

          {/* Address */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <input
              type="text"
              value={formData.address || ''}
              onChange={(e) => setFormData({...formData, address: e.target.value})}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="123 Main St, City, Country"
            />
          </div>

          {/* Country */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
            <select
              value={formData.country || ''}
              onChange={(e) => setFormData({...formData, country: e.target.value})}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select Country</option>
              <option value="India">🇮🇳 India</option>
              <option value="China">🇨🇳 China</option>
              <option value="Spain">🇪🇸 Spain</option>
              <option value="Portugal">🇵🇹 Portugal</option>
              <option value="Italy">🇮🇹 Italy</option>
              <option value="USA">🇺🇸 USA</option>
              <option value="Greece">🇬🇷 Greece</option>
              <option value="Vietnam">🇻🇳 Vietnam</option>
              <option value="Thailand">🇹🇭 Thailand</option>
              <option value="Indonesia">🇮🇩 Indonesia</option>
              <option value="Ecuador">🇪🇨 Ecuador</option>
              <option value="Chile">🇨🇱 Chile</option>
              <option value="Peru">🇵🇪 Peru</option>
              <option value="Argentina">🇦🇷 Argentina</option>
              <option value="Morocco">🇲🇦 Morocco</option>
              <option value="Turkey">🇹🇷 Turkey</option>
              <option value="Bangladesh">🇧🇩 Bangladesh</option>
              <option value="Pakistan">🇵🇰 Pakistan</option>
              <option value="UK">🇬🇧 UK</option>
              <option value="Germany">🇩🇪 Germany</option>
              <option value="France">🇫🇷 France</option>
              <option value="Japan">🇯🇵 Japan</option>
              <option value="South Korea">🇰🇷 South Korea</option>
            </select>
          </div>

          {/* Company */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company *</label>
            <input
              type="text"
              required
              list="companies"
              value={formData.company}
              onChange={(e) => setFormData({...formData, company: e.target.value})}
              onBlur={() => {
                if (formData.company) {
                  const match = findMatchingCompany(formData.company, companies)
                  if (match !== formData.company) {
                    setFormData({...formData, company: match})
                  }
                }
              }}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Company Name"
            />
            <datalist id="companies">
              {companies.map((c, i) => <option key={i} value={c} />)}
            </datalist>
          </div>

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role / Title</label>
            <input
              type="text"
              value={formData.role}
              onChange={(e) => setFormData({...formData, role: e.target.value})}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Sales Manager"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select
              value={formData.category}
              onChange={(e) => setFormData({...formData, category: e.target.value})}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
              ))}
            </select>
          </div>

          {/* Default Brand */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Default Brand</label>
            <input
              type="text"
              value={formData.default_brand || ''}
              onChange={(e) => setFormData({...formData, default_brand: e.target.value})}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Buyer's brand, Plain Carton"
            />
            <p className="text-xs text-gray-400 mt-1">Auto-fills brand on new POs for this contact</p>
          </div>

          {/* Color */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Avatar Color</label>
            <div className="flex gap-2">
              {colors.map(color => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setFormData({...formData, color})}
                  className={`w-8 h-8 rounded-full ${color} ${formData.color === color ? 'ring-2 ring-offset-2 ring-blue-500' : ''}`}
                />
              ))}
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
            <button type="submit" className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              {contact ? 'Save Changes' : 'Add Contact'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ContactModal;
