import React, { useState } from 'react';
import Icon from '../components/Icon';
import { CONTACTS } from '../data/contacts';
import PageHeader from '../components/PageHeader';
import ContactModal from '../components/ContactModal';
import PhoneIcon from '../components/PhoneIcon';

function ContactsPage({ onBack }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedCountry, setSelectedCountry] = useState('all');
  const [viewMode, setViewMode] = useState('company'); // 'company' or 'list'
  const [showModal, setShowModal] = useState(false);
  const [editingContact, setEditingContact] = useState(null);
  const [expandedCompany, setExpandedCompany] = useState(null);

  // Initialize contacts from CONTACTS constant with additional fields
  const [contacts, setContacts] = useState(() => {
    return Object.entries(CONTACTS).map(([email, data]) => ({
      id: email,
      email,
      ...data,
      phone: data.phone || '',
      country: data.country || 'Unknown',
      category: data.role.toLowerCase().includes('supplier') ? 'suppliers' :
                data.role.toLowerCase().includes('inspector') || data.role.toLowerCase().includes('surveyor') ? 'inspectors' :
                data.role.toLowerCase().includes('buyer') || data.role.toLowerCase().includes('compras') || data.role.toLowerCase().includes('calidad') ? 'buyers' : 'other'
    }));
  });

  // Get unique companies and countries
  const companies = [...new Set(contacts.map(c => c.company))].sort();
  const countries = [...new Set(contacts.map(c => c.country))].sort();

  // Group contacts by company
  const contactsByCompany = companies.reduce((acc, company) => {
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
  const countryFlags = { India: '🇮🇳', China: '🇨🇳', Spain: '🇪🇸', Portugal: '🇵🇹', Italy: '🇮🇹', USA: '🇺🇸', Greece: '🇬🇷' };

  const locationFilters = [
    { id: 'all', label: 'All Locations', flag: '🌍' },
    ...countries.map(c => ({ id: c, label: c, flag: countryFlags[c] || '🏳️' }))
  ];

  const handleSaveContact = (contactData) => {
    if (editingContact) {
      setContacts(contacts.map(c => c.id === editingContact.id ? { ...contactData, id: editingContact.id } : c));
    } else {
      setContacts([...contacts, { ...contactData, id: contactData.email }]);
    }
    setShowModal(false);
    setEditingContact(null);
  };

  const handleEditContact = (contact) => {
    setEditingContact(contact);
    setShowModal(true);
  };

  const handleDeleteContact = (contactId) => {
    if (confirm('Are you sure you want to delete this contact?')) {
      setContacts(contacts.filter(c => c.id !== contactId));
    }
  };

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle={`${contacts.length} contacts across ${companies.length} companies`}
        onBack={onBack}
        actions={
          <button onClick={() => { setEditingContact(null); setShowModal(true); }} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <Icon name="Plus" size={16} /><span className="text-sm font-medium">Add Contact</span>
          </button>
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

      {/* View Toggle */}
      <div className="flex justify-end mb-4">
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
                      <div key={contact.id} className={`p-4 flex items-center justify-between ${idx > 0 ? 'border-t border-gray-50' : ''} hover:bg-gray-50`}>
                        <div className="flex items-center gap-3">
                          <div className="relative">
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
                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <p className="text-sm text-gray-600 flex items-center gap-1"><Icon name="Mail" size={12} /> {contact.email}</p>
                            {contact.phone && <p className="text-sm text-gray-500 flex items-center gap-1 mt-1"><PhoneIcon size={12} /> {contact.phone}</p>}
                          </div>
                          <div className="flex gap-1">
                            <button onClick={() => handleEditContact(contact)} className="p-2 hover:bg-gray-100 rounded-lg" title="Edit">
                              <Icon name="Settings" size={16} className="text-gray-400" />
                            </button>
                            <button onClick={() => handleDeleteContact(contact.id)} className="p-2 hover:bg-red-50 rounded-lg" title="Delete">
                              <Icon name="Trash2" size={16} className="text-red-400" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className="p-3 bg-gray-50 border-t border-gray-100">
                      <button
                        onClick={() => { setEditingContact({ company }); setShowModal(true); }}
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
            <div key={contact.id} className="bg-white rounded-xl border border-gray-100 p-5 hover:shadow-md hover:border-blue-200 transition-all">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
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
                  <Icon name="Mail" size={12} className="text-gray-400" /> {contact.email}
                </p>
                {contact.phone && (
                  <p className="text-xs text-gray-600 flex items-center gap-2">
                    <PhoneIcon size={12} /> {contact.phone}
                  </p>
                )}
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => handleEditContact(contact)} className="flex-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">Edit</button>
                <a href={`mailto:${contact.email}`} className="flex-1 px-3 py-1.5 text-xs bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 text-center">Email</a>
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
          contact={editingContact}
          companies={companies}
          onSave={handleSaveContact}
          onClose={() => { setShowModal(false); setEditingContact(null); }}
        />
      )}
    </div>
  );
}

export default ContactsPage;
