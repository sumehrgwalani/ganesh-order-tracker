import { useState } from 'react';
import Icon from './Icon';
import type { AppNotification } from '../types';
import { supabase } from '../lib/supabase';

interface Props {
  notification: AppNotification;
  onClose: () => void;
  onDone: () => void;
}

function NotificationActionModal({ notification, onClose, onDone }: Props) {
  const data = notification.data || {};
  const [name, setName] = useState(data.from_name || '');
  const [email, setEmail] = useState(data.from_email || '');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('Supplier');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const orderId = data.order_id || '';

  const handleAddContact = async () => {
    if (!name.trim() || !email.trim() || !company.trim()) {
      setError('Name, email, and company are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const initials = name.split(' ').map((w: string) => w[0]?.toUpperCase()).join('').slice(0, 2);
      const colors = ['#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#6366F1'];
      const color = colors[Math.floor(Math.random() * colors.length)];

      const { error: insertErr } = await supabase
        .from('contacts')
        .upsert({
          organization_id: notification.organization_id,
          email: email.trim(),
          name: name.trim(),
          company: company.trim(),
          role: role,
          phone: phone.trim() || null,
          country: country.trim() || null,
          initials,
          color,
        }, { onConflict: 'email,organization_id' });

      if (insertErr) throw insertErr;
      setSuccess('Contact added!');
      setTimeout(() => { onDone(); }, 800);
    } catch (err: any) {
      setError(err.message || 'Failed to add contact');
    } finally {
      setSaving(false);
    }
  };

  const handleAddToOrder = async () => {
    if (!orderId || !name.trim()) {
      setError('No order linked to this notification.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      // Update the order's supplier or buyer based on role
      const updateField = role === 'Buyer' ? 'company' : 'supplier';
      const { error: updateErr } = await supabase
        .from('orders')
        .update({ [updateField]: name.trim() })
        .eq('order_id', orderId)
        .eq('organization_id', notification.organization_id);

      if (updateErr) throw updateErr;
      setSuccess(`Order ${orderId} updated!`);
      setTimeout(() => { onDone(); }, 800);
    } catch (err: any) {
      setError(err.message || 'Failed to update order');
    } finally {
      setSaving(false);
    }
  };

  const handleBoth = async () => {
    if (!name.trim() || !email.trim() || !company.trim()) {
      setError('Name, email, and company are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      // Add contact
      const initials = name.split(' ').map((w: string) => w[0]?.toUpperCase()).join('').slice(0, 2);
      const colors = ['#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#6366F1'];
      const color = colors[Math.floor(Math.random() * colors.length)];

      await supabase
        .from('contacts')
        .upsert({
          organization_id: notification.organization_id,
          email: email.trim(),
          name: name.trim(),
          company: company.trim(),
          role: role,
          phone: phone.trim() || null,
          country: country.trim() || null,
          initials,
          color,
        }, { onConflict: 'email,organization_id' });

      // Update order
      if (orderId) {
        const updateField = role === 'Buyer' ? 'company' : 'supplier';
        await supabase
          .from('orders')
          .update({ [updateField]: name.trim() })
          .eq('order_id', orderId)
          .eq('organization_id', notification.organization_id);
      }

      setSuccess('Contact added & order updated!');
      setTimeout(() => { onDone(); }, 800);
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-2xl flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-800">Add Contact Details</h3>
            {orderId && <p className="text-xs text-gray-500 mt-0.5">For order {orderId}</p>}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
            <Icon name="X" size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <div className="p-6 space-y-4">
          {success && (
            <div className="flex items-center gap-2 px-3 py-2 bg-green-50 text-green-700 rounded-lg text-sm">
              <Icon name="CheckCircle" size={16} /> {success}
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-50 text-red-700 rounded-lg text-sm">
              <Icon name="AlertCircle" size={16} /> {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Name *</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Email *</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Company *</label>
              <input type="text" value={company} onChange={e => setCompany(e.target.value)} className={inputClass} placeholder="e.g. JJ Seafoods" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Role</label>
              <select value={role} onChange={e => setRole(e.target.value)} className={inputClass}>
                <option value="Supplier">Supplier</option>
                <option value="Buyer">Buyer</option>
                <option value="Agent">Agent</option>
                <option value="Inspector">Inspector</option>
                <option value="Logistics">Logistics</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Phone</label>
              <input type="text" value={phone} onChange={e => setPhone(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Country</label>
              <input type="text" value={country} onChange={e => setCountry(e.target.value)} className={inputClass} placeholder="e.g. India" />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-2xl flex items-center justify-between">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <div className="flex gap-2">
            <button
              disabled={saving}
              onClick={handleAddContact}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Icon name="UserPlus" size={14} />
              Add Contact
            </button>
            {orderId && (
              <button
                disabled={saving}
                onClick={handleBoth}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                <Icon name="Check" size={14} />
                Add Both
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default NotificationActionModal;
