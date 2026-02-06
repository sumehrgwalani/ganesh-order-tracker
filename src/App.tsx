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
import LoginPage from './pages/LoginPage';
import { useAuth } from './hooks/useAuth';
import { useContacts } from './hooks/useContacts';
import { useOrders } from './hooks/useOrders';
import { useProducts } from './hooks/useProducts';
// Fallback data for offline/setup mode
import { initialOrders, productInquiries as fallbackInquiries } from './data/orders';
import { CONTACTS as FALLBACK_CONTACTS } from './data/contacts';

function App() {
  const { session, user, loading: authLoading, orgId, signOut } = useAuth();
  const { contacts: dbContacts, loading: contactsLoading } = useContacts(orgId);
  const { orders: dbOrders, setOrders: setDbOrders, loading: ordersLoading, createOrder } = useOrders(orgId);
  const { inquiries: dbInquiries, products: dbProducts, loading: productsLoading } = useProducts(orgId);

  // When authenticated with DB, always use DB data (even if empty = fresh account)
  // Only fall back to hardcoded sample data when DB is not connected (e.g. GitHub Pages demo)
  const isDbReady = !!(orgId && !contactsLoading && !ordersLoading);
  const contacts = isDbReady ? dbContacts : FALLBACK_CONTACTS;
  const orders = isDbReady ? dbOrders : initialOrders;
  const productInquiries = isDbReady ? dbInquiries : fallbackInquiries;

  // Local orders state for fallback/demo mode (no DB)
  const [localOrders, setLocalOrders] = useState<Order[]>(initialOrders);
  const activeOrders = isDbReady ? orders : localOrders;
  const setOrders = isDbReady ? setDbOrders : setLocalOrders;

  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedStage, setSelectedStage] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<string>(new Date().toISOString());
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Show login page if not authenticated
  if (!authLoading && !session) {
    return <LoginPage onAuthSuccess={() => {}} />;
  }

  // Show loading while auth or data is loading
  if (authLoading || (orgId && (contactsLoading || ordersLoading))) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Loading your data...</p>
        </div>
      </div>
    );
  }

  // Filter orders by search term AND selected stage
  const filteredOrders = activeOrders.filter(order => {
    const matchesSearch = order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.product.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStage = selectedStage === null || order.currentStage === selectedStage;

    return matchesSearch && matchesStage;
  });

  const stats: Stats = {
    active: activeOrders.filter(o => o.currentStage < 8).length,
    completed: activeOrders.filter(o => o.currentStage === 8).length,
    inquiries: productInquiries.length,
    contacts: Object.keys(contacts).length,
    products: isDbReady ? dbProducts.length : 8,
  };

  const handleSync = async () => {
    setIsSyncing(true);
    // If connected to DB, refetch data
    if (orgId) {
      // The hooks auto-refetch, so just update timestamp
      setTimeout(() => {
        setIsSyncing(false);
        setLastSync(new Date().toISOString());
      }, 1000);
    } else {
      setTimeout(() => { setIsSyncing(false); setLastSync(new Date().toISOString()); }, 2000);
    }
  };

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
            orders={activeOrders}
            expandedOrder={expandedOrder}
            setExpandedOrder={setExpandedOrder}
            setSelectedOrder={setSelectedOrder}
            onBack={() => setActiveTab('dashboard')}
          />
        );
      case 'completed':
        return (
          <CompletedPage
            orders={activeOrders}
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
          contacts={contacts}
          orders={activeOrders}
          setOrders={setOrders}
          onOrderCreated={(newOrder) => {
            if (orgId && createOrder) {
              createOrder(newOrder).catch(console.error);
            }
            setSelectedOrder(newOrder);
            setActiveTab('orders');
          }}
        />;
      case 'inquiries':
        return <InquiriesPage onBack={() => setActiveTab('dashboard')} />;
      case 'contacts':
        return <ContactsPage onBack={() => setActiveTab('dashboard')} />;
      case 'products':
        return <ProductsPage orders={activeOrders} onBack={() => setActiveTab('dashboard')} />;
      default:
        return (
          <DashboardContent
            orders={activeOrders}
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
