import React, { useState } from 'react';
import { Order, Stats } from './types';
import Sidebar from './layout/Sidebar';
import Header from './layout/Header';
import DashboardContent from './pages/Dashboard';
import OrdersPage from './pages/OrdersPage';
import CompletedPage from './pages/CompletedPage';
import POGeneratorPage from './pages/POGeneratorPage';
import InquiriesPage from './pages/InquiriesPage';
import ContactsPage from './pages/ContactsPage';
import MailboxPage from './pages/MailboxPage';
import ProductsPage from './pages/ProductsPage';
import OrderDetailPage from './pages/OrderDetailPage';
import { initialOrders, productInquiries } from './data/orders';
import { CONTACTS } from './data/contacts';

function App() {
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedStage, setSelectedStage] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<string>(new Date().toISOString());
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Filter orders by search term AND selected stage
  const filteredOrders = orders.filter(order => {
    const matchesSearch = order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.product.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStage = selectedStage === null || order.currentStage === selectedStage;

    return matchesSearch && matchesStage;
  });

  const stats: Stats = { active: orders.filter(o => o.currentStage < 8).length, completed: orders.filter(o => o.currentStage === 8).length, inquiries: productInquiries.length, contacts: Object.keys(CONTACTS).length, products: 8 };

  const handleSync = () => { setIsSyncing(true); setTimeout(() => { setIsSyncing(false); setLastSync(new Date().toISOString()); }, 2000); };

  // Render the current page based on activeTab
  const renderPage = () => {
    // If an order is selected, show the detail page
    if (selectedOrder) {
      return (
        <OrderDetailPage
          order={selectedOrder}
          onBack={() => setSelectedOrder(null)}
        />
      );
    }

    switch(activeTab) {
      case 'orders':
        return (
          <OrdersPage
            orders={orders}
            expandedOrder={expandedOrder}
            setExpandedOrder={setExpandedOrder}
            setSelectedOrder={setSelectedOrder}
            onBack={() => setActiveTab('dashboard')}
          />
        );
      case 'completed':
        return (
          <CompletedPage
            orders={orders}
            expandedOrder={expandedOrder}
            setExpandedOrder={setExpandedOrder}
            setSelectedOrder={setSelectedOrder}
            onBack={() => setActiveTab('dashboard')}
          />
        );
      case 'mailbox':
        return <MailboxPage onBack={() => setActiveTab('dashboard')} />;
      case 'create-po':
        return <POGeneratorPage
          onBack={() => setActiveTab('dashboard')}
          contacts={CONTACTS}
          orders={orders}
          setOrders={setOrders}
          onOrderCreated={(newOrder) => {
            setSelectedOrder(newOrder);
            setActiveTab('orders');
          }}
        />;
      case 'inquiries':
        return <InquiriesPage onBack={() => setActiveTab('dashboard')} />;
      case 'contacts':
        return <ContactsPage onBack={() => setActiveTab('dashboard')} />;
      case 'products':
        return <ProductsPage orders={orders} onBack={() => setActiveTab('dashboard')} />;
      default:
        return (
          <DashboardContent
            orders={orders}
            stats={stats}
            setActiveTab={setActiveTab}
            filteredOrders={filteredOrders}
            selectedStage={selectedStage}
            setSelectedStage={setSelectedStage}
            expandedOrder={expandedOrder}
            setExpandedOrder={setExpandedOrder}
            setSelectedOrder={setSelectedOrder}
          />
        );
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} onSettingsClick={() => setShowSettings(true)} onNavClick={() => setSelectedOrder(null)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header searchTerm={searchTerm} setSearchTerm={setSearchTerm} lastSync={lastSync} isSyncing={isSyncing} onSyncClick={handleSync} />
        <main className="flex-1 overflow-auto p-6">
          {renderPage()}
        </main>
      </div>
    </div>
  );
}

export default App;
