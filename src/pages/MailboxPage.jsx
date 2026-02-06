import React, { useState } from 'react';
import Icon from '../components/Icon';
import { getContactInfo } from '../utils/helpers';

function MailboxPage({ onBack }) {
  const [selectedFolder, setSelectedFolder] = useState('all');
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Email folders organized by company
  const folders = [
    { id: 'all', name: 'All Mail', icon: 'Inbox', color: 'blue', count: 0 },
    { id: 'starred', name: 'Starred', icon: 'Star', color: 'amber', count: 0 },
    { id: 'office', name: 'With The Tide Office', icon: 'Folder', color: 'orange', isCompany: true },
    { id: 'divider1', type: 'divider', label: 'Buyers' },
    { id: 'pescados', name: 'PESCADOS E.GUILLEM', icon: 'Folder', color: 'purple', isCompany: true },
    { id: 'seapeix', name: 'Seapeix', icon: 'Folder', color: 'green', isCompany: true },
    { id: 'noriberica', name: 'Noriberica', icon: 'Folder', color: 'teal', isCompany: true },
    { id: 'ruggiero', name: 'Ruggiero Seafood', icon: 'Folder', color: 'red', isCompany: true },
    { id: 'divider2', type: 'divider', label: 'Suppliers - India' },
    { id: 'nila', name: 'Nila Seafoods', icon: 'Folder', color: 'emerald', isCompany: true },
    { id: 'raunaq', name: 'Raunaq / JJ Seafoods', icon: 'Folder', color: 'indigo', isCompany: true },
    { id: 'silver', name: 'Silver Star', icon: 'Folder', color: 'slate', isCompany: true },
    { id: 'abad', name: 'ABAD Overseas', icon: 'Folder', color: 'violet', isCompany: true },
    { id: 'divider3', type: 'divider', label: 'Suppliers - China' },
    { id: 'hainan', name: 'Hainan', icon: 'Folder', color: 'rose', isCompany: true },
    { id: 'fivestar', name: 'Fivestar', icon: 'Folder', color: 'yellow', isCompany: true },
    { id: 'divider4', type: 'divider', label: 'Inspectors' },
    { id: 'jbboda', name: 'J B Boda Group', icon: 'Folder', color: 'cyan', isCompany: true },
    { id: 'hansel', name: 'Hansel Fernandez', icon: 'Folder', color: 'pink', isCompany: true },
  ];

  // Sample emails with company associations
  const emails = [
    { id: 1, folder: 'pescados', from: 'oscar@eguillem.com', fromName: 'Oscar García', subject: 'RE: PO 3038 - CALAMAR TROCEADO - Artwork Approval', preview: 'Dear Sumehr, The artworks of EGUILLEM BRAND are OK. REMINDER: send us artworks of OLIVER BRAND...', date: '2026-02-04T17:15:00Z', starred: true, hasAttachment: false, read: true },
    { id: 2, folder: 'pescados', from: 'calidad@eguillem.com', fromName: 'Mª Carmen Martínez', subject: 'RE: NEED ARTWORK APPROVAL - PI GI/PI/25-26/I02047', preview: 'Dear Santosh, The artwork NEEDS CORRECTION. Please check the following and resend...', date: '2026-02-03T15:45:00Z', starred: false, hasAttachment: false, read: true },
    { id: 3, folder: 'nila', from: 'nilaexport@nilaseafoods.com', fromName: 'Nila Exports', subject: 'RE: PESCADOS 04TH CONTAINER - DHL DETAILS - TELEX RELEASE', preview: 'Dear Sir/Madam, Good day! Please find below the telex release message received from the liner...', date: '2026-02-03T18:08:00Z', starred: true, hasAttachment: true, read: false },
    { id: 4, folder: 'nila', from: 'nilaexport@nilaseafoods.com', fromName: 'Nila Exports', subject: 'VESSEL SCHEDULE == GI/PO/25-26/3029 == SHIPMENT DETAILS', preview: 'Dear Sir/Madam, Good Day! Please find below vessel schedule details: Vessel: MSC ANNA...', date: '2026-02-01T11:00:00Z', starred: false, hasAttachment: false, read: true },
    { id: 5, folder: 'raunaq', from: 'rohitkhetalpar@gmail.com', fromName: 'Rohit Khetalpar', subject: 'NEW PURCHASE ORDER - PO GI/PO/25-26/3043', preview: 'Dear Sir, Good day! Please find attached the new Purchase Order. PO Number: GI/PO/25-26/3043...', date: '2026-02-05T09:00:00Z', starred: false, hasAttachment: true, read: false },
    { id: 6, folder: 'jbboda', from: 'jbbvrl@jbbodamail.com', fromName: 'J B Boda Veraval', subject: 'INSPECTION REPORT - PO 3027 - Invoice 3000250122', preview: 'Dear Sir, Good day! Please find attached inspection report and photos. Inspection Result: PASSED...', date: '2026-01-16T08:00:00Z', starred: false, hasAttachment: true, read: true },
    { id: 7, folder: 'hansel', from: 'hanselfernandez@hotmail.com', fromName: 'Hansel Fernandez', subject: 'INSPECTION REPORT - PO 3026 - Invoice 3000250117', preview: 'Dear Sir, Good day! Please find attached the inspection photos and report. Inspection Result: APPROVED...', date: '2026-01-18T09:00:00Z', starred: true, hasAttachment: true, read: true },
    { id: 8, folder: 'office', from: 'ganeshintnlmumbai@gmail.com', fromName: 'Santosh Laxman Satope', subject: 'FWD: Shipping Schedule Update - February 2026', preview: 'Hi Sumehr, Please see the updated shipping schedule for February. We have 3 containers scheduled...', date: '2026-02-02T10:30:00Z', starred: false, hasAttachment: true, read: true },
    { id: 9, folder: 'office', from: 'sumehrgwalani@gmail.com', fromName: 'Sumehr Gwalani', subject: 'Monthly Report - January 2026', preview: 'Team, Please find attached the monthly operations report for January 2026. Key highlights...', date: '2026-02-01T14:00:00Z', starred: true, hasAttachment: true, read: true },
    { id: 10, folder: 'silver', from: 'info@silverseafoodindia.com', fromName: 'Dharmesh Jungi', subject: 'DHL DETAILS == PO 3015 == AWB 1016612890', preview: 'Dear Sir, Good Day! DHL courier dispatched. AWB Number: 1016612890...', date: '2025-12-15T17:00:00Z', starred: false, hasAttachment: true, read: true },
    { id: 11, folder: 'hainan', from: 'littleprincess1127@163.com', fromName: 'Yummy Liu', subject: 'RE: Squid Whole Inquiry - Pricing Update', preview: 'Dear Sumehr, Thank you for your inquiry. Please find our updated pricing for Squid Whole IQF...', date: '2026-01-28T06:30:00Z', starred: false, hasAttachment: true, read: true },
    { id: 12, folder: 'seapeix', from: 'pepe.alonso@seapeix.com', fromName: 'Pepe Alonso', subject: 'RE: Quotation Request - Cuttlefish', preview: 'Dear Sumehr, We are interested in your cuttlefish offer. Please send us samples and...', date: '2026-01-25T09:15:00Z', starred: false, hasAttachment: false, read: true },
    { id: 13, folder: 'abad', from: 'sheraz@abad.in', fromName: 'Sheraz Anwar', subject: 'Product Availability - February 2026', preview: 'Dear Sir, Good day! Please find below our current stock availability for February...', date: '2026-02-01T07:00:00Z', starred: false, hasAttachment: true, read: false },
  ];

  // Update folder counts
  folders.forEach(folder => {
    if (folder.id === 'all') {
      folder.count = emails.length;
    } else if (folder.id === 'starred') {
      folder.count = emails.filter(e => e.starred).length;
    } else if (folder.isCompany) {
      folder.count = emails.filter(e => e.folder === folder.id).length;
    }
  });

  // Filter emails based on selected folder and search
  const filteredEmails = emails.filter(email => {
    const matchesFolder = selectedFolder === 'all' ||
                          (selectedFolder === 'starred' && email.starred) ||
                          email.folder === selectedFolder;
    const matchesSearch = !searchTerm ||
                          email.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          email.fromName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          email.preview.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFolder && matchesSearch;
  }).sort((a, b) => new Date(b.date) - new Date(a.date));

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    const today = new Date();
    const diffDays = Math.floor((today - date) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'short' });
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const selectedFolderData = folders.find(f => f.id === selectedFolder);
  const unreadCount = filteredEmails.filter(e => !e.read).length;

  return (
    <div className="flex h-full -m-6">
      {/* Folder Sidebar */}
      <div className="w-64 bg-gray-50 border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <button onClick={onBack} className="flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            <span className="text-sm">Back</span>
          </button>
          <h2 className="text-lg font-semibold text-gray-800">Mailbox</h2>
          <p className="text-xs text-gray-500 mt-1">Connected to Gmail</p>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {folders.map(folder => {
            if (folder.type === 'divider') {
              return (
                <div key={folder.id} className="px-4 py-2 mt-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{folder.label}</p>
                </div>
              );
            }

            const isSelected = selectedFolder === folder.id;
            const colorClasses = {
              blue: 'text-blue-600', amber: 'text-amber-500', orange: 'text-orange-500',
              purple: 'text-purple-600', green: 'text-green-600', teal: 'text-teal-600',
              red: 'text-red-600', emerald: 'text-emerald-600', indigo: 'text-indigo-600',
              slate: 'text-slate-600', violet: 'text-violet-600', rose: 'text-rose-600',
              yellow: 'text-yellow-600', cyan: 'text-cyan-600', pink: 'text-pink-600',
            };

            return (
              <button
                key={folder.id}
                onClick={() => setSelectedFolder(folder.id)}
                className={`w-full px-4 py-2 flex items-center justify-between hover:bg-gray-100 transition-colors ${isSelected ? 'bg-blue-50 border-r-2 border-blue-600' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <Icon name={folder.icon} size={16} className={isSelected ? 'text-blue-600' : colorClasses[folder.color] || 'text-gray-400'} />
                  <span className={`text-sm ${isSelected ? 'font-medium text-blue-600' : 'text-gray-700'}`}>{folder.name}</span>
                </div>
                {folder.count > 0 && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${isSelected ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-600'}`}>
                    {folder.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="p-4 border-t border-gray-200">
          <button className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
            <Icon name="RefreshCw" size={14} />
            Sync Gmail
          </button>
        </div>
      </div>

      {/* Email List */}
      <div className="flex-1 flex flex-col bg-white">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-gray-800">{selectedFolderData?.name || 'All Mail'}</h3>
              <p className="text-xs text-gray-500">{filteredEmails.length} emails{unreadCount > 0 ? `, ${unreadCount} unread` : ''}</p>
            </div>
            <div className="flex gap-2">
              <button className="p-2 hover:bg-gray-100 rounded-lg"><Icon name="Archive" size={16} className="text-gray-400" /></button>
              <button className="p-2 hover:bg-gray-100 rounded-lg"><Icon name="Trash2" size={16} className="text-gray-400" /></button>
            </div>
          </div>
          <div className="relative">
            <Icon name="Search" className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Search emails..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Email List */}
        <div className="flex-1 overflow-y-auto">
          {filteredEmails.length > 0 ? (
            filteredEmails.map(email => {
              const contact = getContactInfo(email.from);
              return (
                <div
                  key={email.id}
                  onClick={() => setSelectedEmail(selectedEmail === email.id ? null : email.id)}
                  className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${!email.read ? 'bg-blue-50' : ''} ${selectedEmail === email.id ? 'bg-gray-100' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 ${contact.color} rounded-full flex items-center justify-center text-white text-sm font-medium flex-shrink-0`}>
                      {contact.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-sm ${!email.read ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                          {email.fromName}
                        </span>
                        <div className="flex items-center gap-2">
                          {email.starred && <Icon name="Star" size={14} className="text-amber-400 fill-amber-400" />}
                          {email.hasAttachment && <Icon name="Paperclip" size={14} className="text-gray-400" />}
                          <span className="text-xs text-gray-500">{formatDate(email.date)}</span>
                        </div>
                      </div>
                      <p className={`text-sm truncate ${!email.read ? 'font-medium text-gray-800' : 'text-gray-700'}`}>
                        {email.subject}
                      </p>
                      <p className="text-xs text-gray-500 truncate mt-1">{email.preview}</p>
                    </div>
                  </div>

                  {/* Expanded Email View */}
                  {selectedEmail === email.id && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="bg-gray-50 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-800">From:</span>
                            <span className="text-sm text-gray-600">{email.fromName} &lt;{email.from}&gt;</span>
                          </div>
                          <span className="text-xs text-gray-500">{new Date(email.date).toLocaleString()}</span>
                        </div>
                        <p className="text-sm text-gray-700 whitespace-pre-line">{email.preview}</p>
                        {email.hasAttachment && (
                          <div className="mt-3 pt-3 border-t border-gray-200">
                            <p className="text-xs text-gray-500 mb-2">Attachments:</p>
                            <div className="flex gap-2">
                              <span className="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-600">
                                <Icon name="Paperclip" size={12} />
                                document.pdf
                              </span>
                            </div>
                          </div>
                        )}
                        <div className="mt-3 pt-3 border-t border-gray-200 flex gap-2">
                          <button className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700">Reply</button>
                          <button className="px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50">Forward</button>
                          <button className="px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50">Link to Order</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="flex-1 flex items-center justify-center py-12">
              <div className="text-center">
                <Icon name="Inbox" size={48} className="mx-auto mb-4 text-gray-300" />
                <p className="font-medium text-gray-500">No emails found</p>
                <p className="text-sm text-gray-400 mt-1">
                  {searchTerm ? 'Try a different search term' : 'This folder is empty'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default MailboxPage;
