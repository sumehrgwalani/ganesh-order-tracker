import { useState, useEffect, useMemo } from 'react';
import Icon from '../components/Icon';
import { CONTACTS } from '../data/contacts';
import PageHeader from '../components/PageHeader';
import ContactModal from '../components/ContactModal';
import ContactImportModal from '../components/ContactImportModal';
import PhoneIcon from '../components/PhoneIcon';
import type { ContactFormData, ContactsMap } from '../types';

interface Contact {
  id: string;
  email: string;
  name: string;
  company: string;
  role: string;
  phone?: string;
  address?: string;
  country?: string;
  category?: string;
  color?: string;
  initials?: string;
  notes?: string;
}

interface Props {
  onBack: () => void;
  dbContacts?: ContactsMap;
  onAddContact?: (formData: ContactFormData) => Promise<any>;
  onUpdateContact?: (email: string, updates: Partial<Contact>) => Promise<void>;
  onDeleteContact?: (email: string) => Promise<void>;
  onBulkImport?: (contacts: Array<{ email: string; name: string; company: string; role: string; phone?: string; address?: string; country?: string; notes?: string }>) => Promise<{ inserted: number; updated: number }>;
  onBulkDelete?: (emails: string[]) => Promise<void>;
  onRefresh?: () => Promise<void>;
}

// Helper to convert ContactsMap to Contact[] — defined outside component for stability
function mapToContacts(source: Record<string, any>): Contact[] {
  return Object.entries(source).map(([email, data]: [string, any]) => ({
    id: email,
    email,
    ...data,
    phone: data.phone || '',
    address: data.address || '',
    country: data.country || 'Unknown',
    notes: data.notes || '',
    category: data.role?.toLowerCase().includes('supplier') ? 'suppliers' :
              data.role?.toLowerCase().includes('inspector') || data.role?.toLowerCase().includes('surveyor') ? 'inspectors' :
              data.role?.toLowerCase().includes('buyer') || data.role?.toLowerCase().includes('compras') || data.role?.toLowerCase().includes('calidad') ? 'buyers' : 'other'
  }));
}

// Check if an email is a placeholder (imported without a real email)
const isPlaceholderEmail = (email: string) => email.endsWith('@placeholder.local');
const displayEmail = (email: string) => isPlaceholderEmail(email) ? '-' : email;

function ContactsPage({ onBack, dbContacts, onAddContact, onUpdateContact, onDeleteContact, onBulkImport, onBulkDelete, onRefresh }: Props) {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedCountry, setSelectedCountry] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'company' | 'list'>('company');
  const [showModal, setShowModal] = useState<boolean>(false);
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  // Batch delete state
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  // Use a stable key (number of contacts) to detect when DB data actually changes
  const dbContactsCount = dbContacts !== undefined ? Object.keys(dbContacts).length : -1;

  // Derive contacts from DB or fallback
  const [contacts, setContacts] = useState<Contact[]>(() => {
    const source = dbContacts !== undefined ? dbContacts : CONTACTS;
    return mapToContacts(source);
  });

  // Sync local state when DB data changes (e.g. after import/refresh)
  useEffect(() => {
    if (dbContacts !== undefined) {
      setContacts(mapToContacts(dbContacts));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbContactsCount]);

  // Get unique companies and countries
  const companies = [...new Set(contacts.map(c => c.company))].sort();
  const countries = [...new Set(contacts.map(c => c.country).filter((c): c is string => !!c))].sort();

  // Group contacts by company
  const contactsByCompany = companies.reduce((acc: Record<string, Contact[]>, company) => {
    acc[company] = contacts.filter(c => c.company === company);
    return acc;
  }, {});

  const filteredContacts = contacts.filter(contact => {
    const matchesSearch = !searchTerm ||
      contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || contact.category === selectedCategory;
    const matchesCountry = selectedCountry === 'all' || contact.country === selectedCountry;
    return matchesSearch && matchesCategory && matchesCountry;
  });

  const filteredCompanies = companies.filter(company => {
    const companyContacts = contactsByCompany[company];
    return companyContacts.some(contact => {
      const matchesSearch = !searchTerm ||
        contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        contact.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
        contact.email.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = selectedCategory === 'all' || contact.category === selectedCategory;
      const matchesCountry = selectedCountry === 'all' || contact.country === selectedCountry;
      return matchesSearch && matchesCategory && matchesCountry;
    });
  });

  const categories = [
    { id: 'all', label: 'All', count: contacts.length },
    { id: 'buyers', label: 'Buyers', count: contacts.filter(c => c.category === 'buyers').length },
    { id: 'suppliers', label: 'Suppliers', count: contacts.filter(c => c.category === 'suppliers').length },
    { id: 'inspectors', label: 'Inspectors', count: contacts.filter(c => c.category === 'inspectors').length },
  ];

  // Country flags for visual display
  const countryFlags: Record<string, string> = { India: '🇮🇳', China: '🇨🇳', Spain: '🇪🇸', Portugal: '🇵🇹', Italy: '🇮🇹', USA: '🇺🇸', Greece: '🇬🇷', Vietnam: '🇻🇳', Thailand: '🇹🇭', Indonesia: '🇮🇩', Ecuador: '🇪🇨', Chile: '🇨🇱', Peru: '🇵🇪', Argentina: '🇦🇷', Morocco: '🇲🇦', Turkey: '🇹🇷', Bangladesh: '🇧🇩', Pakistan: '🇵🇰', UK: '🇬🇧', Germany: '🇩🇪', France: '🇫🇷', Japan: '🇯🇵', 'South Korea': '🇰🇷' };

  const locationFilters = [
    { id: 'all', label: 'All Locations', flag: '🌍' },
    ...countries.map(c => ({ id: c ?? '', label: c ?? 'Unknown', flag: (c && countryFlags[c]) || '🏳️' }))
  ];

  const handleSaveContact = async (contactData: ContactFormData) => {
    const initials = contactData.initials || contactData.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    const role = contactData.role || contactData.category || 'Supplier';
    // Use the explicit category from the form dropdown; only derive from role if no category set
    const category = contactData.category || (
      role.toLowerCase().includes('supplier') ? 'suppliers' :
      role.toLowerCase().includes('buyer') ? 'buyers' :
      role.toLowerCase().includes('inspector') ? 'inspectors' : 'other'
    );

    if (editingContact) {
      // Optimistic local update — instant UI feedback
      const updated: Contact = {
        ...editingContact,
        name: contactData.name,
        company: contactData.company,
        role,
        phone: contactData.phone || '',
        address: contactData.address || '',
        country: contactData.country || editingContact.country || '',
        color: contactData.color || editingContact.color,
        initials,
        category,
      };
      setContacts(prev => prev.map(c => c.id === editingContact.id ? updated : c));

      // Persist to Supabase in background — save the category as role if user picked one
      const dbRole = contactData.category && contactData.category !== 'other'
        ? contactData.category.charAt(0).toUpperCase() + contactData.category.slice(1)
        : role;
      if (onUpdateContact) {
        onUpdateContact(editingContact.email, {
          name: contactData.name,
          company: contactData.company,
          role: dbRole,
          phone: contactData.phone || '',
          address: contactData.address || '',
          country: contactData.country || '',
          color: contactData.color,
          initials,
        }).catch(err => console.error('Failed to save contact:', err));
      }
    } else {
      // Optimistic local add
      const newContact: Contact = {
        id: contactData.email,
        email: contactData.email,
        name: contactData.name,
        company: contactData.company,
        role,
        phone: contactData.phone || '',
        address: contactData.address || '',
        country: contactData.country || '',
        category,
        color: contactData.color || 'bg-blue-500',
        initials,
      };
      setContacts(prev => [...prev, newContact]);

      // Persist to Supabase in background
      if (onAddContact) {
        onAddContact(contactData).catch(err => console.error('Failed to add contact:', err));
      }
    }

    setShowModal(false);
    setEditingContact(null);
  };

  const handleEditContact = (contact: Contact) => {
    setEditingContact(contact);
    setShowModal(true);
  };

  const handleDeleteContact = async (contactId: string) => {
    if (confirm('Are you sure you want to delete this contact?')) {
      // Optimistic local delete — instant UI feedback
      setContacts(prev => prev.filter(c => c.id !== contactId));

      // Persist to Supabase in background
      if (onDeleteContact) {
        onDeleteContact(contactId).catch(err => console.error('Failed to delete contact:', err));
      }
    }
  };

  const toggleSelectEmail = (email: string) => {
    setSelectedEmails(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedEmails.size === filteredContacts.length) {
      setSelectedEmails(new Set());
    } else {
      setSelectedEmails(new Set(filteredContacts.map(c => c.email)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedEmails.size === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedEmails.size} contact${selectedEmails.size > 1 ? 's' : ''}? This cannot be undone.`)) return;
    setIsDeleting(true);
    try {
      if (onBulkDelete) {
        await onBulkDelete(Array.from(selectedEmails));
      }
      setContacts(prev => prev.filter(c => !selectedEmails.has(c.email)));
      setSelectedEmails(new Set());
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error('Bulk delete failed:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const contactToFormData = (contact: Contact | null): ContactFormData | null => {
    if (!contact) return null;
    return {
      name: contact.name,
      email: contact.email,
      phone: contact.phone || '',
      address: contact.address || '',
      company: contact.company,
      role: contact.role,
      category: contact.category || 'other',
      country: contact.country || '',
      color: contact.color || 'bg-blue-500',
      initials: contact.initials,
    };
  };

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle={`${contacts.length} contacts across ${companies.length} companies`}
        onBack={onBack}
        actions={
          <div className="flex flex-col items-stretch gap-2 w-44">
            <button onClick={() => { setEditingContact(null); setShowModal(true); }} className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              <Icon name="Plus" size={16} /><span className="text-sm font-medium">Add Contact</span>
            </button>
            {onBulkImport && (
              <button onClick={() => setShowImportModal(true)} className="px-4 py-2 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium text-center">
                Import CSV/Excel
              </button>
            )}
          </div>
        }
      />

      {/* Quick Filters */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        {/* Type Filters */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide w-16">Type</span>
          <div className="flex flex-wrap gap-2">
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  selectedCategory === cat.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {cat.label} ({cat.count})
              </button>
            ))}
          </div>
        </div>

        {/* Location Filters */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide w-16">Location</span>
          <div className="flex flex-wrap gap-2">
            {locationFilters.map(loc => {
              const count = loc.id === 'all' ? contacts.length : contacts.filter(c => c.country === loc.id).length;
              return (
                <button
                  key={loc.id}
                  onClick={() => setSelectedCountry(loc.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${
                    selectedCountry === loc.id
                      ? 'bg-emerald-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <span>{loc.flag}</span>
                  <span>{loc.label}</span>
                  <span className={`text-xs ${selectedCountry === loc.id ? 'text-emerald-200' : 'text-gray-400'}`}>({count})</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Icon name="Search" className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Search contacts by name, company, or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Active Filter Summary */}
        {(selectedCategory !== 'all' || selectedCountry !== 'all' || searchTerm) && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
            <span className="text-xs text-gray-500">Showing {filteredContacts.length} of {contacts.length} contacts</span>
            <button
              onClick={() => { setSelectedCategory('all'); setSelectedCountry('all'); setSearchTerm(''); }}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              <Icon name="X" size={12} />
              Clear all filters
            </button>
          </div>
        )}
      </div>

      {/* View Toggle + Batch Delete Bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {filteredContacts.length > 0 && (
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-500 hover:text-gray-700">
              <input
                type="checkbox"
                checked={selectedEmails.size === filteredContacts.length && filteredContacts.length > 0}
                onChange={toggleSelectAll}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              Select all
            </label>
          )}
          {selectedEmails.size > 0 && (
            <div className="flex items-center gap-3 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg">
              <span className="text-sm font-medium text-red-700">{selectedEmails.size} selected</span>
              <button
                onClick={handleBulkDelete}
                disabled={isDeleting}
                className="flex items-center gap-1.5 px-3 py-1 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm font-medium disabled:opacity-50"
              >
                {isDeleting ? (
                  <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Deleting...</>
                ) : (
                  <><Icon name="Trash2" size={14} /> Delete</>
                )}
              </button>
              <button
                onClick={() => setSelectedEmails(new Set())}
                className="text-sm text-red-600 hover:text-red-800"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode('company')}
            className={`px-3 py-1.5 text-sm rounded-md transition-all ${viewMode === 'company' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-600'}`}
          >
            By Company
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 text-sm rounded-md transition-all ${viewMode === 'list' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-600'}`}
          >
            All Contacts
          </button>
        </div>
      </div>

      {/* Company View */}
      {viewMode === 'company' ? (
        <div className="space-y-4">
          {filteredCompanies.map(company => {
            const companyContacts = contactsByCompany[company].filter(contact => {
              const matchesSearch = !searchTerm ||
                contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                contact.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
                contact.email.toLowerCase().includes(searchTerm.toLowerCase());
              const matchesCategory = selectedCategory === 'all' || contact.category === selectedCategory;
              const matchesCountry = selectedCountry === 'all' || contact.country === selectedCountry;
              return matchesSearch && matchesCategory && matchesCountry;
            });
            if (companyContacts.length === 0) return null;
            const isExpanded = expandedCompany === company;

            return (
              <div key={company} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div
                  onClick={() => setExpandedCompany(isExpanded ? null : company)}
                  className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
                      {company.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-800">{company}</h3>
                      <p className="text-sm text-gray-500">{companyContacts.length} contact{companyContacts.length > 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <Icon name="ChevronDown" size={20} className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-100">
                    {companyContacts.map((contact, idx) => (
                      <div key={contact.id} className={`p-4 grid grid-cols-[260px_1fr_auto] items-start gap-4 ${idx > 0 ? 'border-t border-gray-50' : ''} hover:bg-gray-50 ${selectedEmails.has(contact.email) ? 'bg-blue-50' : ''}`}>
                        {/* Col 1: Checkbox + Avatar + Name (fixed width) */}
                        <div className="flex items-center gap-3 overflow-hidden">
                          <input
                            type="checkbox"
                            checked={selectedEmails.has(contact.email)}
                            onChange={() => toggleSelectEmail(contact.email)}
                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 flex-shrink-0 mt-1"
                          />
                          <div className="relative flex-shrink-0">
                            <div className={`w-10 h-10 ${contact.color} rounded-full flex items-center justify-center text-white font-medium text-sm`}>
                              {contact.initials}
                            </div>
                            {contact.country && (
                              <span className="absolute -bottom-1 -right-1 text-xs" title={contact.country}>
                                {countryFlags[contact.country] || '🏳️'}
                              </span>
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-gray-800">{contact.name}</p>
                            <p className="text-xs text-gray-500">{contact.role}</p>
                          </div>
                        </div>
                        {/* Col 2: Contact details — always starts at same position */}
                        <div className="space-y-1 min-w-0">
                          <p className="text-sm text-gray-600 flex items-center gap-1.5"><Icon name="Mail" size={12} className="flex-shrink-0" /> <span className="truncate">{displayEmail(contact.email)}</span></p>
                          {contact.phone && <p className="text-sm text-gray-500 flex items-center gap-1.5"><PhoneIcon size={12} className="flex-shrink-0" /> <span className="truncate">{contact.phone}</span></p>}
                          {contact.address && <p className="text-sm text-gray-500 flex items-start gap-1.5"><Icon name="MapPin" size={12} className="flex-shrink-0 mt-0.5" /> <span className="break-words">{contact.address}</span></p>}
                        </div>
                        {/* Col 3: Action buttons */}
                        <div className="flex gap-1 flex-shrink-0">
                          <button onClick={() => handleEditContact(contact)} className="p-2 hover:bg-gray-100 rounded-lg" title="Edit">
                            <Icon name="Settings" size={16} className="text-gray-400" />
                          </button>
                          <button onClick={() => handleDeleteContact(contact.id)} className="p-2 hover:bg-red-50 rounded-lg" title="Delete">
                            <Icon name="Trash2" size={16} className="text-red-400" />
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="p-3 bg-gray-50 border-t border-gray-100">
                      <button
                        onClick={() => { setEditingContact({ ...{ company } as Contact }); setShowModal(true); }}
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                      >
                        <Icon name="Plus" size={14} /> Add contact to {company}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* List View */
        <div className="grid grid-cols-3 gap-4">
          {filteredContacts.map((contact) => (
            <div key={contact.id} className={`bg-white rounded-xl border p-5 hover:shadow-md transition-all ${selectedEmails.has(contact.email) ? 'border-blue-400 bg-blue-50' : 'border-gray-100 hover:border-blue-200'}`}>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedEmails.has(contact.email)}
                    onChange={() => toggleSelectEmail(contact.email)}
                    className="w-4 h-4 mt-1 text-blue-600 border-gray-300 rounded focus:ring-blue-500 flex-shrink-0"
                  />
                  <div className="relative">
                    <div className={`w-12 h-12 ${contact.color} rounded-full flex items-center justify-center text-white font-medium`}>
                      {contact.initials}
                    </div>
                    {contact.country && (
                      <span className="absolute -bottom-1 -right-1 text-sm" title={contact.country}>
                        {countryFlags[contact.country] || '🏳️'}
                      </span>
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-gray-800">{contact.name}</p>
                    <p className="text-sm text-gray-500">{contact.company}</p>
                    <div className="flex gap-1 mt-1">
                      <span className="inline-block text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">{contact.role}</span>
                    </div>
                  </div>
                </div>
                <button onClick={() => handleEditContact(contact)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                  <Icon name="Settings" size={14} className="text-gray-400" />
                </button>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
                <p className="text-xs text-gray-600 flex items-center gap-2">
                  <Icon name="Mail" size={12} className="text-gray-400" /> {displayEmail(contact.email)}
                </p>
                {contact.phone && (
                  <p className="text-xs text-gray-600 flex items-center gap-2">
                    <PhoneIcon size={12} /> {contact.phone}
                  </p>
                )}
                {contact.address && (
                  <p className="text-xs text-gray-600 flex items-center gap-2">
                    <Icon name="MapPin" size={12} className="text-gray-400" /> {contact.address}
                  </p>
                )}
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => handleEditContact(contact)} className="flex-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">Edit</button>
                {!isPlaceholderEmail(contact.email) ? (
                  <a href={`mailto:${contact.email}`} className="flex-1 px-3 py-1.5 text-xs bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 text-center">Email</a>
                ) : (
                  <span className="flex-1 px-3 py-1.5 text-xs bg-gray-50 text-gray-400 rounded-lg text-center">No email</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {filteredContacts.length === 0 && viewMode === 'list' && (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-100">
          <Icon name="Users" size={48} className="mx-auto mb-4 text-gray-300" />
          <p className="font-medium text-gray-500">No contacts found</p>
          <p className="text-sm text-gray-400 mt-1">Try adjusting your search</p>
        </div>
      )}

      {/* Contact Modal */}
      {showModal && (
        <ContactModal
          contact={contactToFormData(editingContact)}
          companies={companies}
          onSave={handleSaveContact}
          onClose={() => { setShowModal(false); setEditingContact(null); }}
        />
      )}

      {/* Import Modal */}
      {showImportModal && onBulkImport && (
        <ContactImportModal
          existingEmails={new Set(contacts.map(c => c.email.toLowerCase()))}
          onImport={async (importedContacts) => {
            const result = await onBulkImport(importedContacts);
            // Refresh contacts from DB after import
            if (onRefresh) {
              await onRefresh();
              // We need to update local state too — refetch will update dbContacts via hook
              // For now, also add to local state so UI updates immediately
              const newLocalContacts = importedContacts.map(c => ({
                id: c.email,
                email: c.email,
                name: c.name,
                company: c.company,
                role: c.role,
                phone: c.phone || '',
                country: c.country || 'Unknown',
                notes: c.notes || '',
                category: c.role?.toLowerCase().includes('supplier') ? 'suppliers' :
                          c.role?.toLowerCase().includes('buyer') ? 'buyers' :
                          c.role?.toLowerCase().includes('inspector') ? 'inspectors' : 'other',
                initials: c.name.split(' ').map(n => n[0] || '').join('').toUpperCase().slice(0, 2),
                color: 'bg-blue-500',
              }));
              // Merge: update existing, add new
              const existingMap = new Map(contacts.map(c => [c.email.toLowerCase(), c]));
              for (const nc of newLocalContacts) {
                existingMap.set(nc.email.toLowerCase(), nc);
              }
              setContacts(Array.from(existingMap.values()));
            }
            return result;
          }}
          onClose={() => setShowImportModal(false)}
        />
      )}
    </div>
  );
}

export default ContactsPage;
