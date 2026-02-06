import React, { useState } from 'react';
import Icon from '../components/Icon';
import PageHeader from '../components/PageHeader';

function InquiriesPage({ onBack }) {
  const [activeTab, setActiveTab] = useState('received');

  const receivedInquiries = [
    { id: 'INQ-001', product: 'Calamar Troceado 20/40', sizes: ['6X1 20% ESTRELLA POLAR - 10 tons'], total: '10 tons', from: 'PESCADOS E.GUILLEM', brand: 'ESTRELLA POLAR', date: '4th Feb 2026', status: 'pending', priority: 'high' },
    { id: 'INQ-002', product: 'Puntilla Lavada y Congelada', total: '8 tons', from: 'PESCADOS E.GUILLEM', brand: 'ESTRELLA POLAR', date: '3rd Feb 2026', status: 'pending', priority: 'medium' },
    { id: 'INQ-003', product: 'Squid Whole IQF', sizes: ['U/3 - 2900 Kgs @ 7.9 USD', '3/6 - 2160 Kgs @ 7.2 USD'], total: '6340 Kgs', from: 'Ocean Fresh GmbH', date: '2nd Feb 2026', status: 'responded', priority: 'high' },
    { id: 'INQ-004', product: 'Vannamei HLSO', sizes: ['16/20 - 5000 Kgs', '21/25 - 3000 Kgs'], total: '8000 Kgs', from: 'SeaFood Europe', date: '1st Feb 2026', status: 'converted', priority: 'low' },
  ];

  const sentInquiries = [
    { id: 'SINQ-001', product: 'Baby Squid 200/300', to: 'RAUNAQ', total: '15 tons', date: '3rd Feb 2026', status: 'awaiting' },
    { id: 'SINQ-002', product: 'Squid Rings 40/60', to: 'Silver Sea Foods', total: '10 tons', date: '2nd Feb 2026', status: 'quoted' },
    { id: 'SINQ-003', product: 'Cuttlefish Whole', to: 'Nila Exports', total: '8 tons', date: '31st Jan 2026', status: 'confirmed' },
  ];

  const getStatusColor = (status) => {
    const colors = {
      pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
      responded: 'bg-blue-50 text-blue-700 border-blue-200',
      converted: 'bg-green-50 text-green-700 border-green-200',
      awaiting: 'bg-orange-50 text-orange-700 border-orange-200',
      quoted: 'bg-purple-50 text-purple-700 border-purple-200',
      confirmed: 'bg-green-50 text-green-700 border-green-200',
    };
    return colors[status] || 'bg-gray-50 text-gray-700 border-gray-200';
  };

  const getPriorityColor = (priority) => {
    const colors = { high: 'bg-red-500', medium: 'bg-yellow-500', low: 'bg-green-500' };
    return colors[priority] || 'bg-gray-500';
  };

  return (
    <div>
      <PageHeader
        title="Product Inquiries"
        subtitle="Manage incoming and outgoing product inquiries"
        onBack={onBack}
        actions={
          <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <Icon name="Plus" size={16} /><span className="text-sm font-medium">New Inquiry</span>
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-gray-500 text-sm">Pending</p>
          <p className="text-3xl font-bold mt-1 text-yellow-600">{receivedInquiries.filter(i => i.status === 'pending').length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-gray-500 text-sm">Responded</p>
          <p className="text-3xl font-bold mt-1 text-blue-600">{receivedInquiries.filter(i => i.status === 'responded').length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-gray-500 text-sm">Converted to Orders</p>
          <p className="text-3xl font-bold mt-1 text-green-600">{receivedInquiries.filter(i => i.status === 'converted').length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-gray-500 text-sm">Sent Inquiries</p>
          <p className="text-3xl font-bold mt-1 text-gray-800">{sentInquiries.length}</p>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-6">
        <button
          onClick={() => setActiveTab('received')}
          className={`px-4 py-2 text-sm rounded-md transition-all ${activeTab === 'received' ? 'bg-white text-gray-800 shadow-sm font-medium' : 'text-gray-600 hover:text-gray-800'}`}
        >
          Received ({receivedInquiries.length})
        </button>
        <button
          onClick={() => setActiveTab('sent')}
          className={`px-4 py-2 text-sm rounded-md transition-all ${activeTab === 'sent' ? 'bg-white text-gray-800 shadow-sm font-medium' : 'text-gray-600 hover:text-gray-800'}`}
        >
          Sent ({sentInquiries.length})
        </button>
      </div>

      {/* Inquiries List */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        {activeTab === 'received' ? (
          <div className="space-y-3">
            {receivedInquiries.map(inq => (
              <div key={inq.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
                <div className="flex items-center gap-4">
                  <div className={`w-2 h-12 rounded-full ${getPriorityColor(inq.priority)}`}></div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs text-gray-400">{inq.id}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${getStatusColor(inq.status)}`}>{inq.status}</span>
                    </div>
                    <p className="font-medium text-gray-800">{inq.product}</p>
                    {inq.brand && <p className="text-xs text-purple-600">{inq.brand}</p>}
                    {inq.sizes && inq.sizes.map((s, j) => <p key={j} className="text-xs text-gray-500">{s}</p>)}
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-800">{inq.total}</p>
                  <p className="text-xs text-gray-500">From: {inq.from}</p>
                  <p className="text-xs text-gray-400 mt-1">{inq.date}</p>
                </div>
                <div className="flex gap-2 ml-4">
                  <button className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-white">View</button>
                  {inq.status === 'pending' && (
                    <button className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">Respond</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {sentInquiries.map(inq => (
              <div key={inq.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-gray-400">{inq.id}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${getStatusColor(inq.status)}`}>{inq.status}</span>
                  </div>
                  <p className="font-medium text-gray-800">{inq.product}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-800">{inq.total}</p>
                  <p className="text-xs text-gray-500">To: {inq.to}</p>
                  <p className="text-xs text-gray-400 mt-1">{inq.date}</p>
                </div>
                <button className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-white ml-4">View</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default InquiriesPage;
